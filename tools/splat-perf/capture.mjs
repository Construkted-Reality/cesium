// Deterministic image capture for the splat renderer, and image comparison.
//
// Capture a set of fixed camera poses:
//   node tools/splat-perf/capture.mjs --out /tmp/img-before
//
// Compare two sets:
//   node tools/splat-perf/capture.mjs --compare /tmp/img-before /tmp/img-after
//
// The camera poses are static, so a correct optimisation must produce the same
// pixels. Each pose writes a .raw file of RGBA bytes read straight from the
// drawing buffer, and a .png for a human to look at. The comparison reads the
// .raw files, so it needs no image library.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const GPU_LAUNCH_ARGS = [
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--ignore-gpu-blocklist",
  "--enable-gpu",
  "--enable-gpu-rasterization",
];

// One pose per image. Static mode holds the camera still, so the result does
// not depend on frame timing.
const POSES = [
  { name: "geo-h000-p25", heading: 0, pitch: -25, range: 1.6 },
  { name: "geo-h090-p45", heading: 90, pitch: -45, range: 1.2 },
  { name: "geo-h200-p10", heading: 200, pitch: -10, range: 2.2 },
  { name: "geo-close", heading: 45, pitch: -30, range: 0.7 },
];

function parseArgs(argv) {
  const options = {
    server: "http://127.0.0.1:8099",
    tileset: "/splat-data/oracle-run/geo-newdefault/tileset.json",
    sse: 8,
    width: 1280,
    height: 720,
    settleFrames: 240,
    msaa: 0,
    out: undefined,
    compare: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "compare") {
      options.compare = [argv[++i], argv[++i]];
      continue;
    }
    const value = argv[++i];
    options[key] = typeof options[key] === "number" ? Number(value) : value;
  }
  return options;
}

function compareDirectories(leftDir, rightDir) {
  const names = readdirSync(leftDir)
    .filter((name) => name.endsWith(".raw"))
    .sort();
  if (names.length === 0) {
    process.stderr.write(`no .raw files in ${leftDir}\n`);
    process.exit(1);
  }
  let worst = 0;
  for (const name of names) {
    const left = readFileSync(join(leftDir, name));
    const right = readFileSync(join(rightDir, name));
    if (left.length !== right.length) {
      process.stdout.write(`${name}: SIZE MISMATCH\n`);
      worst = 255;
      continue;
    }
    let differing = 0;
    let maxDelta = 0;
    let sumDelta = 0;
    for (let i = 0; i < left.length; i++) {
      const delta = Math.abs(left[i] - right[i]);
      if (delta !== 0) {
        differing++;
        sumDelta += delta;
        if (delta > maxDelta) {
          maxDelta = delta;
        }
      }
    }
    const percent = (differing / left.length) * 100;
    const meanDelta = differing > 0 ? sumDelta / differing : 0;
    worst = Math.max(worst, maxDelta);
    process.stdout.write(
      `${name.padEnd(22)} channels differing ${percent.toFixed(4).padStart(8)}%  ` +
        `max delta ${String(maxDelta).padStart(3)}  mean delta ${meanDelta.toFixed(2)}\n`,
    );
  }
  process.stdout.write(`worst channel delta across all images: ${worst}\n`);
  return worst;
}

const options = parseArgs(process.argv.slice(2));

if (options.compare) {
  const worst = compareDirectories(
    resolve(options.compare[0]),
    resolve(options.compare[1]),
  );
  process.exit(worst === 0 ? 0 : 2);
}

if (!options.out) {
  process.stderr.write("give --out <directory> or --compare <a> <b>\n");
  process.exit(1);
}

const outDir = resolve(options.out);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: GPU_LAUNCH_ARGS,
});
try {
  for (const pose of POSES) {
    const query = new URLSearchParams({
      tileset: options.tileset,
      frames: "1",
      warmup: String(options.settleFrames),
      mode: "static",
      heading: String(pose.heading),
      pitch: String(pose.pitch),
      range: String(pose.range),
      sse: String(options.sse),
      capture: "1",
      label: pose.name,
    });
    if (options.msaa > 0) {
      query.set("msaa", String(options.msaa));
    }
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });
    await page.goto(
      `${options.server}/tools/splat-perf/harness.html?${query.toString()}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(
      () => window.__benchResult !== undefined || window.__benchError,
      undefined,
      { timeout: 600000, polling: 200 },
    );
    const benchError = await page.evaluate(() => window.__benchError);
    if (benchError) {
      throw new Error(`${pose.name}: ${benchError}`);
    }
    const captured = await page.evaluate(() => window.__benchPixels);
    if (!captured) {
      throw new Error(`${pose.name}: no pixels captured`);
    }
    writeFileSync(
      join(outDir, `${pose.name}.raw`),
      Buffer.from(captured.base64, "base64"),
    );
    await page.screenshot({ path: join(outDir, `${pose.name}.png`) });
    process.stdout.write(
      `captured ${pose.name} ${captured.width}x${captured.height}\n`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(`images in ${outDir}\n`);
