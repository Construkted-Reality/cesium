// Main thread profiler for the Gaussian splat benchmark.
//
// Runs the same harness as bench.mjs, but records a V8 sampling profile over
// the measured window only. Reports self time per function, so the processor
// cost of the splat pipeline can be attributed without changing CesiumJS.
//
// Example:
//   node tools/splat-perf/profile.mjs \
//     --tileset /splat-data/oracle-run/geo-newdefault/tileset.json \
//     --label geo-orbit-profile --sse 4
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const resultsDir = join(repoRoot, "docs", "splat-perf", "results");

const GPU_LAUNCH_ARGS = [
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--ignore-gpu-blocklist",
  "--enable-gpu",
  "--enable-gpu-rasterization",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
];

function parseArgs(argv) {
  const options = {
    server: "http://127.0.0.1:8099",
    tileset: "/splat-data/oracle-run/geo-newdefault/tileset.json",
    label: "profile",
    frames: 300,
    warmup: 120,
    mode: "orbit",
    sse: 4,
    pitch: -25,
    range: 1.6,
    step: 0.35,
    width: 1920,
    height: 1080,
    intervalUs: 100,
    top: 40,
    timeoutMs: 900000,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    const value = argv[++i];
    options[key] =
      typeof options[key] === "number" ? Number(value) : (value ?? true);
  }
  return options;
}

// Turn a V8 sampling profile into self time per call frame.
function aggregateSelfTime(profile) {
  const byId = new Map();
  for (const node of profile.nodes) {
    byId.set(node.id, node);
  }
  const selfSamples = new Map();
  for (const id of profile.samples) {
    selfSamples.set(id, (selfSamples.get(id) ?? 0) + 1);
  }
  const totalDurationMs = (profile.endTime - profile.startTime) / 1000;
  const totalSamples = profile.samples.length || 1;
  const msPerSample = totalDurationMs / totalSamples;

  const rows = [];
  for (const [id, count] of selfSamples) {
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    const frame = node.callFrame;
    const name = frame.functionName || "(anonymous)";
    const file = (frame.url || "").split("/").pop();
    rows.push({
      name: name,
      location: file ? `${file}:${frame.lineNumber + 1}` : "",
      samples: count,
      selfMs: count * msPerSample,
      selfPercent: (count / totalSamples) * 100,
    });
  }
  rows.sort((a, b) => b.samples - a.samples);
  return { rows, totalDurationMs, totalSamples };
}

// Group by function name only, so the same function split across inline
// caches or line numbers is reported once.
function groupByName(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.name}|${row.location}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.samples += row.samples;
      existing.selfMs += row.selfMs;
      existing.selfPercent += row.selfPercent;
    } else {
      grouped.set(key, { ...row });
    }
  }
  return [...grouped.values()].sort((a, b) => b.samples - a.samples);
}

const options = parseArgs(process.argv.slice(2));

const query = new URLSearchParams({
  tileset: options.tileset,
  frames: String(options.frames),
  warmup: String(options.warmup),
  mode: options.mode,
  pitch: String(options.pitch),
  range: String(options.range),
  step: String(options.step),
  sse: String(options.sse),
  label: options.label,
});
const url = `${options.server}/tools/splat-perf/harness.html?${query.toString()}`;

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: GPU_LAUNCH_ARGS,
});

let profileResult;
let benchResult;
try {
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
  });
  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", {
    interval: options.intervalUs,
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait until the harness leaves the warmup phase, then profile only the
  // measured window.
  await page.waitForFunction(
    () => window.__benchPhase === "measuring" || window.__benchError,
    undefined,
    { timeout: options.timeoutMs, polling: 50 },
  );
  await client.send("Profiler.start");

  await page.waitForFunction(
    () => window.__benchResult !== undefined || window.__benchError,
    undefined,
    { timeout: options.timeoutMs, polling: 50 },
  );
  const stopped = await client.send("Profiler.stop");
  profileResult = stopped.profile;

  const benchError = await page.evaluate(() => window.__benchError);
  if (benchError) {
    throw new Error(`harness failed: ${benchError}`);
  }
  benchResult = await page.evaluate(() => window.__benchResult);
} finally {
  await browser.close();
}

const { rows, totalDurationMs, totalSamples } = aggregateSelfTime(profileResult);
const grouped = groupByName(rows);

mkdirSync(resultsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(resultsDir, `${options.label}-profile-${stamp}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      label: options.label,
      options: options,
      summary: {
        totalDurationMs: totalDurationMs,
        totalSamples: totalSamples,
        frameMs: benchResult.frameMs,
        cpuMs: benchResult.cpuMs,
        gpuMs: benchResult.gpuMs,
        splats: benchResult.splats,
      },
      selfTime: grouped,
    },
    null,
    2,
  )}\n`,
);

const lines = [
  `label        ${options.label}`,
  `splats       ${benchResult.splats?.numSplats ?? "unknown"}`,
  `window       ${totalDurationMs.toFixed(0)} ms, ${totalSamples} samples`,
  `frame ms     ${benchResult.frameMs.median.toFixed(2)} med`,
  `cpu ms       ${benchResult.cpuMs.median.toFixed(2)} med / ${benchResult.cpuMs.mean.toFixed(2)} mean / ${benchResult.cpuMs.p95.toFixed(2)} p95`,
  `gpu ms       ${benchResult.gpuMs.median.toFixed(2)} med`,
  "",
  "self time on the main thread, highest first:",
  "  self ms    pct   function".padEnd(10),
];
for (const row of grouped.slice(0, options.top)) {
  lines.push(
    `  ${row.selfMs.toFixed(1).padStart(8)}  ${row.selfPercent.toFixed(1).padStart(5)}%  ${row.name} ${row.location}`,
  );
}
lines.push("", `saved        ${outPath}`, "");
process.stdout.write(lines.join("\n"));
