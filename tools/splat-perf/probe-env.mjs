// Reports which framebuffers and post-process passes the scene uses.
// Usage: node tools/splat-perf/probe-env.mjs [--empty]
import { chromium } from "@playwright/test";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";

const empty = process.argv.includes("--empty");
const query = new URLSearchParams({
  tileset: "/splat-data/oracle-run/geo-newdefault/tileset.json",
  frames: "30",
  warmup: "120",
  mode: "orbit",
  sse: "4",
  label: "env-probe",
});
if (empty) {
  query.set("empty", "1");
}

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: GPU_LAUNCH_ARGS,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => process.stdout.write(`pageerror: ${e.message}\n`));
  await page.goto(
    `http://127.0.0.1:8099/tools/splat-perf/harness.html?${query.toString()}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => window.__benchResult !== undefined || window.__benchError,
    undefined,
    { timeout: 600000, polling: 200 },
  );
  const report = await page.evaluate(() => {
    const scene = window.__scene;
    const view = scene._view;
    const es = scene._environmentState;
    const flags = {};
    for (const key of Object.keys(es ?? {})) {
      const value = es[key];
      if (typeof value === "boolean" || typeof value === "number") {
        flags[key] = value;
      } else {
        flags[key] = value === undefined || value === null ? null : "object";
      }
    }
    const fbm = view.sceneFramebuffer?._colorFramebuffer;
    return {
      msaaSamples: scene.msaaSamples,
      highDynamicRange: scene.highDynamicRange,
      fxaaEnabled: scene.postProcessStages?.fxaa?.enabled,
      postProcessReady: scene.postProcessStages?.ready,
      postProcessHasSelected: scene.postProcessStages?.hasSelected,
      environmentState: flags,
      globeDepth: view.globeDepth
        ? {
            hasFramebuffer: !!view.globeDepth.framebuffer,
            hasColorTexture: !!view.globeDepth.colorTexture,
          }
        : null,
      oit: view.oit ? { isSupported: view.oit.isSupported() } : null,
      sceneFramebuffer: fbm
        ? {
            samples: fbm._colorFramebuffer?._numSamples ?? null,
            keys: Object.keys(fbm),
          }
        : null,
      passStateFramebuffer: !!view.passState?.framebuffer,
      frustumCommandsCount: view.frustumCommandsList?.length ?? -1,
      commandListLength: scene.frameState?.commandList?.length ?? -1,
    };
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
