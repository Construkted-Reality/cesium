// Counts how many splats pass the frustum test that the vertex shader runs.
//
// The vertex shader rejects a splat when its clip position falls outside 1.2
// times the clip volume. A rejected splat still costs four vertex invocations,
// so the rejected share is the size of the prize for a cull in the sort worker.
//
// Usage: node tools/splat-perf/probe-visibility.mjs
import { chromium } from "@playwright/test";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";

const server = "http://127.0.0.1:8099";
const tileset = "/splat-data/oracle-run/geo-newdefault/tileset.json";

const query = new URLSearchParams({
  tileset: tileset,
  frames: "30",
  warmup: "120",
  mode: "orbit",
  sse: "4",
  label: "visibility-probe",
});

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
  await page.goto(`${server}/tools/splat-perf/harness.html?${query.toString()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.__benchResult !== undefined || window.__benchError,
    undefined,
    { timeout: 600000, polling: 200 },
  );
  const error = await page.evaluate(() => window.__benchError);
  if (error) {
    throw new Error(error);
  }
  const report = await page.evaluate(() => {
    const scene = window.__scene;
    const primitive = window.__splatPrimitive;
    const positions = primitive._positions;
    const count = primitive._numSplats;
    const Cesium = window.Cesium;

    // The draw command uses the root transform as its model matrix, so the
    // same product the shader sees is czm_projection * czm_modelView.
    const modelView = Cesium.Matrix4.multiply(
      scene.context.uniformState.view,
      primitive._rootTransform,
      new Cesium.Matrix4(),
    );
    const projection = scene.context.uniformState.projection;
    const mvp = Cesium.Matrix4.multiply(
      projection,
      modelView,
      new Cesium.Matrix4(),
    );
    const m = Cesium.Matrix4.toArray(mvp, new Array(16));

    let visible = 0;
    let behind = 0;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const clip = 1.2 * cw;
      if (cz < -clip) {
        behind++;
        continue;
      }
      if (cx < -clip || cx > clip || cy < -clip || cy > clip) {
        continue;
      }
      visible++;
    }
    return { count: count, visible: visible, behind: behind };
  });
  const share = ((report.visible / report.count) * 100).toFixed(1);
  process.stdout.write(
    `splats ${report.count}, pass frustum test ${report.visible} (${share}%), behind camera ${report.behind}\n`,
  );
} finally {
  await browser.close();
}
