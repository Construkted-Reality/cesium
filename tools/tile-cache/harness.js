/* global Cesium */
import { installDracoExperiment } from "./draco-experiment.js";
import { tracePipeline } from "./pipeline.js";
import { instrument } from "./instrument.js";
const viewer = new Cesium.Viewer("view", {
  baseLayer: false,
  globe: false,
  skyBox: false,
  skyAtmosphere: false,
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  useBrowserRecommendedResolution: false,
});
viewer.resolutionScale = 1;
viewer.scene.backgroundColor = Cesium.Color.BLACK;
let tileset;
let active;
let decoded;
let probes;
let pipeline;
let dracoExperiment;
const events = [];
const renderErrors = [];
viewer.scene.renderError.addEventListener((...args) =>
  renderErrors.push(String(args[1])),
);
const frameTimes = [];
let lastFrame = performance.now();
viewer.scene.postRender.addEventListener(() => {
  const now = performance.now();
  frameTimes.push(now - lastFrame);
  lastFrame = now;
});
const tileUrl = (tile) => tile._contentResource?.url;

window.harness = {
  snapshot() {
    return {
      events,
      renderErrors,
      residentBytes: tileset?.totalMemoryUsageInBytes,
      tilesLoaded: tileset?.tilesLoaded,
      statistics: tileset?._statistics,
      visible: [...(active?.visible || [])],
    };
  },
  async enableCache(config) {
    const clientUrl = new URL(
      "../../Build/TileCache/client.js",
      import.meta.url,
    );
    const { registerTileCache } = await import(clientUrl.href);
    window.tileCache = await registerTileCache(config);
  },
  async setup(config) {
    if (config.pipeline && !pipeline) {
      pipeline = tracePipeline(Cesium, viewer);
    }
    if (config.draco && !dracoExperiment) {
      dracoExperiment = installDracoExperiment(Cesium, config.draco);
    }
    if (tileset) {
      viewer.scene.primitives.remove(tileset);
    }
    if (config.decodedBytes && !decoded) {
      const moduleUrl = new URL(
        "../../Build/TileCache/decoded-images.js",
        import.meta.url,
      );
      const { retainDecodedImages } = await import(moduleUrl.href);
      decoded = retainDecodedImages(Cesium, config.decodedBytes);
    }
    tileset = await Cesium.Cesium3DTileset.fromUrl(
      config.url || "/tile-data/v1/tileset.json",
      {
        cacheBytes: config.cacheBytes,
        maximumCacheOverflowBytes: config.overflowBytes ?? 64 * 1024 * 1024,
        maximumScreenSpaceError: config.sse ?? 16,
        dynamicScreenSpaceError: false,
        foveatedScreenSpaceError: false,
        skipLevelOfDetail: false,
        preloadWhenHidden: false,
        preloadFlightDestinations: false,
      },
    );
    if (config.localOrigin) {
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
        "2026-09-13T12:00:00Z",
      );
      tileset.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(...config.localOrigin),
      );
    }
    viewer.scene.primitives.add(tileset);
    for (const [name, event] of [
      ["load", tileset.tileLoad],
      ["unload", tileset.tileUnload],
      ["failed", tileset.tileFailed],
    ]) {
      event.addEventListener((tile) =>
        events.push({
          name,
          url: tileUrl(tile) || tile.url,
          message: tile.message,
          time: performance.now(),
        }),
      );
    }
    tileset.tileVisible.addEventListener((tile) =>
      active?.visible.add(tileUrl(tile)),
    );
    const gl = viewer.scene.context._gl;
    if (config.instrument && !probes) {
      probes = instrument(Cesium, gl);
    }
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: gl.getParameter(
        extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
      ),
      cesium: Cesium.VERSION,
      width: viewer.canvas.width,
      height: viewer.canvas.height,
      devicePixelRatio,
      resolutionScale: viewer.resolutionScale,
    };
  },
  async visit(index, { timeoutMs = 30000, camera, pose } = {}) {
    const started = performance.now();
    probes?.reset();
    pipeline?.begin();
    dracoExperiment?.begin();
    const eventStart = events.length;
    const frameStart = frameTimes.length;
    performance.clearResourceTimings();
    active = { visible: new Set() };
    if (pose) {
      camera = {
        destination: Cesium.Cartesian3.fromDegrees(
          pose.longitude,
          pose.latitude,
          pose.height,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(pose.heading),
          pitch: Cesium.Math.toRadians(pose.pitch),
          roll: Cesium.Math.toRadians(pose.roll || 0),
        },
      };
      viewer.camera.frustum.fov = Cesium.Math.toRadians(pose.fov || 60);
    }
    viewer.camera.setView(
      camera || {
        destination: new Cesium.Cartesian3(6378437, index * 1000, 0),
        orientation: {
          direction: new Cesium.Cartesian3(-1, 0, 0),
          up: new Cesium.Cartesian3(0, 0, 1),
        },
      },
    );
    const milestones = {
      firstVisibleMs: null,
      firstLoadedMs: null,
      lastUnstableMs: 0,
    };
    let stableFrames = 0;
    let previousVisible = "";
    let frameVisible = new Set();
    const removeVisible = tileset.tileVisible.addEventListener((tile) =>
      frameVisible.add(tileUrl(tile)),
    );
    await new Promise((resolve, reject) => {
      const subscription = {};
      const timer = setTimeout(() => {
        subscription.remove();
        removeVisible();
        reject(
          new Error(
            `View ${index} did not settle: ${JSON.stringify({ events: events.slice(eventStart), renderErrors })}`,
          ),
        );
      }, timeoutMs);
      subscription.remove = viewer.scene.postRender.addEventListener(() => {
        const visible = [...frameVisible].sort();
        const elapsed = performance.now() - started;
        if (visible.length && milestones.firstVisibleMs === null) {
          milestones.firstVisibleMs = elapsed;
        }
        if (
          tileset.tilesLoaded &&
          visible.length &&
          milestones.firstLoadedMs === null
        ) {
          milestones.firstLoadedMs = elapsed;
        }
        const key = JSON.stringify(visible);
        stableFrames =
          tileset.tilesLoaded && visible.length > 0 && key === previousVisible
            ? stableFrames + 1
            : 0;
        if (stableFrames === 0) {
          milestones.lastUnstableMs = elapsed;
        }
        previousVisible = key;
        active.visible = frameVisible;
        frameVisible = new Set();
        if (stableFrames >= 4) {
          clearTimeout(timer);
          subscription.remove();
          removeVisible();
          resolve();
        }
      });
    });
    const result = {
      index,
      pose,
      renderErrors: [...renderErrors],
      settleMs: performance.now() - started,
      residentBytes: tileset.totalMemoryUsageInBytes,
      decoded: decoded?.stats(),
      probes: probes?.snapshot(),
      pipeline: await pipeline?.snapshot(),
      draco: dracoExperiment?.snapshot(),
      milestones,
      visible: [...active.visible].sort(),
      events: events.slice(eventStart),
      frameMs: frameTimes.slice(frameStart),
      resources: performance
        .getEntriesByType("resource")
        .map((entry) => entry.toJSON()),
      // This interval includes scheduling, decode and upload. It is not GPU time.
      attribution:
        "Fetch timings plus end-to-end settle; decode/upload are not independently attributed.",
    };
    active = undefined;
    return result;
  },
  dispose() {
    viewer.scene.primitives.remove(tileset);
    tileset = undefined;
    decoded?.destroy();
    probes?.destroy();
    dracoExperiment?.destroy();
    pipeline?.destroy();
    return {
      loaders: Object.keys(Cesium.ResourceCache.cacheEntries).length,
      decoded: decoded?.stats(),
    };
  },
};
