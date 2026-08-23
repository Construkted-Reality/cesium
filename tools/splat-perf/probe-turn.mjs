/* global Cesium */
// Reproduces the pop-in that a user sees when the camera sits close to the
// model and then turns towards geometry that is not loaded.
//
// It changes nothing in the renderer. It settles the scene, turns the camera,
// and then records one row per frame until the geometry appears.
//
// Usage:
//   node tools/splat-perf/probe-turn.mjs --range 0.25 --turn 180 --turnMs 300
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";

const options = {
  server: "http://127.0.0.1:8099",
  tileset: "/splat-data/oracle-run/geo-newdefault/tileset.json",
  sse: 4,
  width: 1920,
  height: 1080,
  range: 0.25,
  pitch: -10,
  heading: 0,
  turn: 180,
  turnMs: 300,
  watchMs: 5000,
  out: "/mnt/data2/cesium-splat-perf/turn",
};
for (let i = 0; i < process.argv.length - 2; i++) {
  const key = process.argv[i + 2].replace(/^--/, "");
  if (!(key in options)) {
    continue;
  }
  const value = process.argv[i + 3];
  options[key] = typeof options[key] === "number" ? Number(value) : value;
}

mkdirSync(options.out, { recursive: true });

const query = new URLSearchParams({
  tileset: options.tileset,
  frames: "30",
  warmup: "60",
  mode: "static",
  heading: String(options.heading),
  pitch: String(options.pitch),
  range: String(options.range),
  sse: String(options.sse),
  capture: "1",
  label: "turn-probe",
});

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: GPU_LAUNCH_ARGS,
});
try {
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => process.stdout.write(`pageerror: ${e.message}\n`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      process.stdout.write(`page error: ${m.text()}\n`);
    }
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
  const harnessError = await page.evaluate(() => window.__benchError);
  if (harnessError) {
    throw new Error(harnessError);
  }

  // Install the recorder. It samples once per frame and keeps the camera
  // wherever the driver last put it.
  await page.evaluate((cfg) => {
    const scene = window.__scene;
    const primitive = window.__splatPrimitive;
    const tileset = primitive._tileset;
    const gl = scene.context._originalGLContext ?? scene.context._gl;

    const centre = tileset.boundingSphere.center;
    const radius = tileset.boundingSphere.radius;

    window.__probeOwnsCamera = true;

    const probe = {
      rows: [],
      turnStart: undefined,
      heading: Cesium.Math.toRadians(cfg.heading),
      settled: 0,
      shots: [],
      nextShotAt: 0,
    };
    window.__probe = probe;

    // Counts pixels that are not the black background, over a coarse grid.
    // A full read of every frame would cost more than the frame itself.
    const sampleWidth = 240;
    const sampleHeight = 135;
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    function coverage() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(
        0,
        0,
        sampleWidth,
        sampleHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 6 || pixels[i + 1] > 6 || pixels[i + 2] > 6) {
          lit++;
        }
      }
      return lit / (sampleWidth * sampleHeight);
    }

    // Settle phase: sit at a fixed spot looking at the model.
    function settlePlace() {
      scene.camera.lookAt(
        centre,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(cfg.heading),
          Cesium.Math.toRadians(cfg.pitch),
          radius * cfg.range,
        ),
      );
      scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }

    // Turn phase: hold the camera where it is and rotate the view direction.
    // This is what a user does when they turn to look somewhere else. An
    // orbit keeps the model in view and never reproduces the symptom.
    function turnPlace(degrees) {
      scene.camera.setView({
        destination: probe.anchorPosition,
        orientation: {
          heading: probe.anchorHeading + Cesium.Math.toRadians(degrees),
          pitch: probe.anchorPitch,
          roll: 0.0,
        },
      });
    }

    scene.preUpdate.addEventListener(function () {
      const now = performance.now();
      if (probe.turnStart === undefined) {
        settlePlace();
        return;
      }
      const elapsed = now - probe.turnStart;
      const fraction = Math.min(1, elapsed / cfg.turnMs);
      turnPlace(cfg.turn * fraction);
    });

    scene.postRender.addEventListener(function () {
      const now = performance.now();
      const command = primitive._drawCommand;
      const stats = tileset._statistics;
      const row = {
        t: probe.turnStart === undefined ? -1 : now - probe.turnStart,
        coverage: coverage(),
        drawnSplats: command ? command.instanceCount : 0,
        selectedTiles: tileset._selectedTiles.length,
        pendingRequests: stats.numberOfPendingRequests,
        processing: stats.numberOfTilesProcessing,
        tilesLoaded: tileset.tilesLoaded,
        snapshotSplats: primitive._snapshot ? primitive._snapshot.numSplats : 0,
        pendingState: primitive._pendingSnapshot
          ? primitive._pendingSnapshot.state
          : null,
        generation: primitive._splatDataGeneration,
        sorterState: primitive._sorterState,
        needsRebuild: !!primitive._needsSnapshotRebuild,
        stableFrames: primitive._selectedTilesStableFrames,
        stallFrames: primitive._snapshotRebuildStallFrames,
        readyTiles: 0,
        readySplats: 0,
      };

      // How much loaded geometry the tileset had selected but the snapshot did
      // not draw. This separates "the data was missing" from "we refused to
      // draw the data we had".
      for (const tile of tileset._selectedTiles) {
        if (tile.contentReady && tile.content && tile.content.pointsLength > 0) {
          row.readyTiles++;
          row.readySplats += tile.content.pointsLength;
        }
      }

      if (probe.turnStart === undefined) {
        // Wait for a completely quiet scene before the turn.
        const quiet =
          tileset.tilesLoaded &&
          stats.numberOfPendingRequests === 0 &&
          !primitive._pendingSnapshot &&
          row.drawnSplats > 0;
        probe.settled = quiet ? probe.settled + 1 : 0;
        if (probe.settled >= 30) {
          probe.anchorPosition = Cesium.Cartesian3.clone(
            scene.camera.positionWC,
          );
          probe.anchorHeading = scene.camera.heading;
          probe.anchorPitch = scene.camera.pitch;
          probe.turnStart = now;
          probe.settledSplats = row.drawnSplats;
          probe.settledCoverage = row.coverage;
        }
        return;
      }

      probe.rows.push(row);
      if (row.t >= probe.nextShotAt && probe.shots.length < 14) {
        probe.shots.push({
          t: row.t,
          data: scene.canvas.toDataURL("image/png"),
        });
        probe.nextShotAt += 200;
      }
      if (row.t > cfg.watchMs) {
        probe.finished = true;
      }
    });
  }, options);

  await page.waitForFunction(() => window.__probe && window.__probe.finished, undefined, {
    timeout: 120000,
    polling: 100,
  });

  const result = await page.evaluate(() => ({
    settledSplats: window.__probe.settledSplats,
    settledCoverage: window.__probe.settledCoverage,
    rows: window.__probe.rows,
    shots: window.__probe.shots,
  }));

  for (const shot of result.shots) {
    const name = `t${String(Math.round(shot.t)).padStart(5, "0")}ms.png`;
    writeFileSync(
      `${options.out}/${name}`,
      Buffer.from(shot.data.split(",")[1], "base64"),
    );
  }
  writeFileSync(
    `${options.out}/rows.json`,
    JSON.stringify({ options, settled: result.settledSplats, rows: result.rows }, null, 1),
  );

  // Report.
  const rows = result.rows;
  process.stdout.write(
    `settled: ${result.settledSplats} splats drawn, coverage ${(result.settledCoverage * 100).toFixed(1)}%\n`,
  );
  process.stdout.write(
    `turn: ${options.turn} degrees over ${options.turnMs} ms, watched ${options.watchMs} ms, ${rows.length} frames\n\n`,
  );
  process.stdout.write(
    "     t ms  coverage  drawn splats  sel tiles  pending  processing  loaded  gen  pending state\n",
  );
  let lastGeneration = rows.length ? rows[0].generation : 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const changed = r.generation !== lastGeneration;
    lastGeneration = r.generation;
    // Print every 10th frame, plus every frame where something changes.
    const interesting =
      i % 10 === 0 ||
      changed ||
      (i > 0 && rows[i - 1].tilesLoaded !== r.tilesLoaded) ||
      (i > 0 && rows[i - 1].drawnSplats !== r.drawnSplats);
    if (!interesting) {
      continue;
    }
    process.stdout.write(
      `${String(Math.round(r.t)).padStart(7)}  ${(r.coverage * 100).toFixed(1).padStart(7)}%  ` +
        `${String(r.drawnSplats).padStart(12)}  ${String(r.readySplats).padStart(11)}  ${String(r.selectedTiles).padStart(9)}  ` +
        `${String(r.pendingRequests).padStart(7)}  ${String(r.processing).padStart(10)}  ` +
        `${String(r.tilesLoaded).padStart(6)}  ${String(r.generation).padStart(3)}  ${r.pendingState ?? ""}\n`,
    );
  }
} finally {
  await browser.close();
}
