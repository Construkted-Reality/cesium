// Driver for the Gaussian splat benchmark.
//
// Launches Chromium on the discrete graphics processor, opens the harness page,
// waits for the run to finish, and writes the result to disk.
//
// Example:
//   node tools/splat-perf/bench.mjs \
//     --tileset /splat-data/oracle-run/geo-newdefault/tileset.json \
//     --label geo-orbit --frames 300
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const resultsDir = join(repoRoot, "docs", "splat-perf", "results");

export const GPU_LAUNCH_ARGS = [
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
    label: "run",
    frames: 300,
    warmup: 120,
    mode: "orbit",
    sse: 16,
    empty: false,
    pitch: -25,
    range: 1.6,
    step: 0.35,
    width: 1920,
    height: 1080,
    timeoutMs: 600000,
    headed: false,
    keepRaw: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "headed") {
      options.headed = true;
      continue;
    }
    if (key === "no-raw") {
      options.keepRaw = false;
      continue;
    }
    if (key === "empty") {
      options.empty = true;
      continue;
    }
    const value = argv[++i];
    if (
      typeof options[key] === "number" ||
      [
        "frames",
        "warmup",
        "pitch",
        "range",
        "step",
        "width",
        "height",
        "sse",
      ].includes(key)
    ) {
      options[key] = Number(value);
    } else {
      options[key] = value;
    }
  }
  return options;
}

function formatMs(summary) {
  if (!summary || !summary.count) {
    return "n/a";
  }
  return `${summary.median.toFixed(2)} med / ${summary.mean.toFixed(2)} mean / ${summary.p95.toFixed(2)} p95`;
}

export async function runBenchmark(options) {
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
  if (options.empty) {
    query.set("empty", "1");
  }
  const url = `${options.server}/tools/splat-perf/harness.html?${query.toString()}`;

  const browser = await chromium.launch({
    headless: !options.headed,
    channel: "chromium",
    args: GPU_LAUNCH_ARGS,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__benchResult !== undefined || window.__benchError,
      undefined,
      { timeout: options.timeoutMs, polling: 500 },
    );
    const benchError = await page.evaluate(() => window.__benchError);
    if (benchError) {
      throw new Error(`harness failed: ${benchError}`);
    }
    const result = await page.evaluate(() => window.__benchResult);
    result.consoleErrors = consoleErrors;
    return result;
  } finally {
    await browser.close();
  }
}

function saveResult(result, options) {
  mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(resultsDir, `${options.label}-${stamp}.json`);
  const payload = options.keepRaw ? result : { ...result, raw: undefined };
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const csvPath = join(resultsDir, "summary.csv");
  const header =
    "timestamp,label,tileset,mode,sse,frames,width,height,numSplats,shDegree," +
    "frameMedian,frameMean,frameP95,cpuMedian,cpuMean,cpuP95,gpuMedian,gpuMean,gpuP95,gpuSamples,tileLoadMs,sortRequests,dataGenerations\n";
  if (!existsSync(csvPath)) {
    writeFileSync(csvPath, header);
  }
  const cell = (summary, field) =>
    summary && summary.count ? summary[field].toFixed(3) : "";
  const row = [
    new Date().toISOString(),
    options.label,
    options.tileset,
    options.mode,
    options.sse,
    options.frames,
    result.viewport.width,
    result.viewport.height,
    result.splats?.numSplats ?? "",
    result.splats?.sphericalHarmonicsDegree ?? "",
    cell(result.frameMs, "median"),
    cell(result.frameMs, "mean"),
    cell(result.frameMs, "p95"),
    cell(result.cpuMs, "median"),
    cell(result.cpuMs, "mean"),
    cell(result.cpuMs, "p95"),
    cell(result.gpuMs, "median"),
    cell(result.gpuMs, "mean"),
    cell(result.gpuMs, "p95"),
    result.gpuSampleCount,
    result.tileLoadMs.toFixed(1),
    result.splats?.sortRequestsDuringRun ?? "",
    result.splats?.dataGenerationsDuringRun ?? "",
  ].join(",");
  appendFileSync(csvPath, `${row}\n`);
  return { jsonPath, csvPath };
}

const isMain = process.argv[1] && process.argv[1].endsWith("bench.mjs");
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runBenchmark(options);
  const paths = saveResult(result, options);
  process.stdout.write(
    [
      `label      ${result.label}`,
      `renderer   ${result.renderer}`,
      `viewport   ${result.viewport.width}x${result.viewport.height}`,
      `splats     ${result.splats?.numSplats ?? "unknown"} (SH degree ${result.splats?.sphericalHarmonicsDegree ?? "?"})`,
      `tiles      ${result.statistics.numberOfTilesTotal} total, ${result.statistics.selectedTiles} selected`,
      `sorts      ${result.splats?.sortRequestsDuringRun ?? "?"} requests, ${result.splats?.dataGenerationsDuringRun ?? "?"} rebuilds during run`,
      `tile load  ${result.tileLoadMs.toFixed(0)} ms`,
      `frame ms   ${formatMs(result.frameMs)}`,
      `cpu ms     ${formatMs(result.cpuMs)}`,
      `gpu ms     ${formatMs(result.gpuMs)}  (${result.gpuSampleCount} samples)`,
      `saved      ${paths.jsonPath}`,
      "",
    ].join("\n"),
  );
  const counters = result.primitiveCounters;
  if (counters && Object.keys(counters).length > 0) {
    const names = Object.keys(counters).sort(
      (a, b) => counters[b].totalMs - counters[a].totalMs,
    );
    process.stdout.write("primitive counters (total / calls / max):\n");
    for (const name of names) {
      const entry = counters[name];
      process.stdout.write(
        `  ${name.padEnd(20)} ${entry.totalMs.toFixed(1).padStart(8)} ms  ` +
          `${String(entry.calls).padStart(4)} calls  ` +
          `${(entry.totalMs / Math.max(entry.calls, 1)).toFixed(2).padStart(7)} ms avg  ` +
          `${entry.maxMs.toFixed(2).padStart(7)} ms max\n`,
      );
    }
  }
  if (result.consoleErrors.length > 0) {
    process.stdout.write(
      `console errors:\n  ${result.consoleErrors.slice(0, 10).join("\n  ")}\n`,
    );
  }
}
