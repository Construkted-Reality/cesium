/* global Cesium */
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
const events = [];
const frameTimes = [];
let lastFrame = performance.now();
viewer.scene.postRender.addEventListener(() => {
  const now = performance.now();
  frameTimes.push(now - lastFrame);
  lastFrame = now;
});
const tileUrl = (tile) => tile._contentResource?.url;

window.harness = {
  async enableCache(config) {
    const { registerTileCache } =
      await import("../../Build/TileCache/client.js");
    window.tileCache = await registerTileCache(config);
  },
  async setup(config) {
    if (tileset) {
      viewer.scene.primitives.remove(tileset);
    }
    tileset = await Cesium.Cesium3DTileset.fromUrl(
      config.url || "/tile-data/v1/tileset.json",
      {
        cacheBytes: config.cacheBytes,
        maximumCacheOverflowBytes: 64 * 1024 * 1024,
        maximumScreenSpaceError: 16,
        dynamicScreenSpaceError: false,
        foveatedScreenSpaceError: false,
        skipLevelOfDetail: false,
        preloadWhenHidden: false,
        preloadFlightDestinations: false,
      },
    );
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
  async visit(index, { timeoutMs = 30000, camera } = {}) {
    const started = performance.now();
    const eventStart = events.length;
    const frameStart = frameTimes.length;
    performance.clearResourceTimings();
    active = { visible: new Set() };
    viewer.camera.setView(
      camera || {
        destination: new Cesium.Cartesian3(6378437, index * 1000, 0),
        orientation: {
          direction: new Cesium.Cartesian3(-1, 0, 0),
          up: new Cesium.Cartesian3(0, 0, 1),
        },
      },
    );
    let stableFrames = 0;
    await new Promise((resolve, reject) => {
      const subscription = {};
      const timer = setTimeout(() => {
        subscription.remove();
        reject(
          new Error(
            `View ${index} did not settle: ${JSON.stringify(events.slice(eventStart))}`,
          ),
        );
      }, timeoutMs);
      subscription.remove = viewer.scene.postRender.addEventListener(() => {
        stableFrames =
          tileset.tilesLoaded && active.visible.size > 0 ? stableFrames + 1 : 0;
        if (stableFrames >= 4) {
          clearTimeout(timer);
          subscription.remove();
          resolve();
        }
      });
    });
    const result = {
      index,
      settleMs: performance.now() - started,
      residentBytes: tileset.totalMemoryUsageInBytes,
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
};
