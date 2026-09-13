/* global Cesium, DecodedTest */
export function installAppProbe(config) {
  const probe = (window.cacheAppProbe = {
    tilesets: [],
    events: [],
    contextEvents: [],
    jobs: [],
    frameTimes: [],
    errors: [],
    config,
  });
  let namespace;
  Object.defineProperty(window, "Cesium", {
    configurable: true,
    get() {
      return namespace;
    },
    set(value) {
      namespace = value;
      const schedule = value.TaskProcessor.prototype.scheduleTask;
      value.TaskProcessor.prototype.scheduleTask = function (...args) {
        const result = schedule.apply(this, args);
        const path = String(this._workerPath);
        if (result?.then && /decodeDraco|transcodeKTX2/.test(path)) {
          const job = { path, started: performance.now() };
          probe.jobs.push(job);
          result.then(
            () => {
              job.completed = performance.now();
            },
            (error) => {
              job.error = String(error);
            },
          );
        }
        return result;
      };
      const original = value.Cesium3DTileset.fromUrl;
      value.Cesium3DTileset.fromUrl = function (url, options) {
        if (!String(url).startsWith(config.prefix)) {
          return original.call(this, url, options);
        }
        const canvas = document.querySelector(".cesium-widget canvas");
        probe.originalOptions = { ...options };
        if (config.gpuBytes) {
          options = { ...options, cacheBytes: config.gpuBytes };
        }
        if (config.decoded && !probe.cache) {
          probe.cache = DecodedTest.retainDecodedResources(value, {
            canvas,
            urlPrefix: config.prefix,
            maximumBytes: config.decodedBytes,
            geometry: config.decoded !== "textures",
            textures: config.decoded !== "geometry",
          });
        }
        for (const name of ["webglcontextlost", "webglcontextrestored"]) {
          canvas.addEventListener(name, () =>
            probe.contextEvents.push({
              name,
              time: performance.now(),
              cache: probe.cache?.stats(),
            }),
          );
        }
        return original.call(this, url, options).then((tileset) => {
          probe.tilesets.push(tileset);
          for (const [name, event] of [
            ["load", tileset.tileLoad],
            ["unload", tileset.tileUnload],
            ["failed", tileset.tileFailed],
          ]) {
            event.addEventListener((tile) =>
              probe.events.push({
                name,
                url: tile._contentResource?.url || tile.url,
                message: tile.message,
                time: performance.now(),
              }),
            );
          }
          return tileset;
        });
      };
    },
  });
}

export function attachAppProbe() {
  const probe = window.cacheAppProbe;
  const viewer = window.Construkted.cesiumViewer;
  const tileset = probe.tilesets[0];
  probe.viewer = viewer;
  let lastFrame = performance.now();
  viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    probe.frameTimes.push(now - lastFrame);
    lastFrame = now;
  });
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
    "2026-09-13T12:00:00Z",
  );
  viewer.scene.renderError.addEventListener((...args) =>
    probe.errors.push(String(args[1])),
  );
  const gl = viewer.scene.context._gl;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  probe.environment = {
    cesium: Cesium.VERSION,
    renderer: gl.getParameter(
      debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
    ),
    cacheBytes: tileset.cacheBytes,
    overflowBytes: tileset.maximumCacheOverflowBytes,
    sse: tileset.maximumScreenSpaceError,
    skipLevelOfDetail: tileset.skipLevelOfDetail,
    loadSiblings: tileset.loadSiblings,
    dynamicScreenSpaceError: tileset.dynamicScreenSpaceError,
    foveatedScreenSpaceError: tileset.foveatedScreenSpaceError,
    width: viewer.canvas.width,
    height: viewer.canvas.height,
    resolutionScale: viewer.resolutionScale,
    privateAPIs:
      !!Cesium.ResourceCache &&
      !!Cesium.GltfDracoLoader &&
      !!Cesium.GltfImageLoader,
  };
  probe.visit = async (pose) => {
    const started = performance.now(),
      start = probe.events.length;
    const jobStart = probe.jobs.length,
      frameStart = probe.frameTimes.length;
    let camera;
    if (pose.position) {
      const position = Cesium.Matrix4.multiplyByPoint(
        tileset.modelMatrix,
        Cesium.Cartesian3.fromArray(pose.position),
        new Cesium.Cartesian3(),
      );
      const target = Cesium.Matrix4.multiplyByPoint(
        tileset.modelMatrix,
        Cesium.Cartesian3.fromArray(pose.target),
        new Cesium.Cartesian3(),
      );
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(target, position, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      const vertical = Cesium.Matrix4.multiplyByPointAsVector(
        tileset.modelMatrix,
        Cesium.Cartesian3.UNIT_Z,
        new Cesium.Cartesian3(),
      );
      const right = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(direction, vertical, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      camera = {
        destination: position,
        orientation: {
          direction,
          up: Cesium.Cartesian3.cross(
            right,
            direction,
            new Cesium.Cartesian3(),
          ),
        },
      };
    } else {
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
    }
    viewer.camera.frustum.fov = Cesium.Math.toRadians(pose.fov || 60);
    viewer.camera.setView(camera);
    let visible = new Set(),
      previous = "",
      stable = 0,
      final = [];
    const removeVisible = tileset.tileVisible.addEventListener((tile) =>
      visible.add(tile._contentResource?.url),
    );
    await new Promise((resolve, reject) => {
      const subscription = {};
      const timer = setTimeout(() => {
        subscription.remove();
        removeVisible();
        reject(new Error("App view did not settle"));
      }, 180000);
      subscription.remove = viewer.scene.postRender.addEventListener(() => {
        final = [...visible].sort();
        visible = new Set();
        const key = JSON.stringify(final);
        stable =
          performance.now() - started >= 1000 * tileset.foveatedTimeDelay &&
          tileset.tilesLoaded &&
          final.length &&
          key === previous
            ? stable + 1
            : 0;
        previous = key;
        if (stable >= 4) {
          clearTimeout(timer);
          subscription.remove();
          removeVisible();
          resolve();
        }
      });
    });
    return {
      pose,
      jobs: probe.jobs.slice(jobStart),
      frameTimes: probe.frameTimes.slice(frameStart),
      settleMs: performance.now() - started,
      visible: final,
      events: probe.events.slice(start),
      memoryAdjustedScreenSpaceError: tileset.memoryAdjustedScreenSpaceError,
      residentBytes: tileset.totalMemoryUsageInBytes,
      cache: probe.cache?.stats(),
      errors: [...probe.errors],
    };
  };
  probe.capture = () =>
    new Promise((resolve) => {
      const remove = viewer.scene.postRender.addEventListener(() => {
        const data = viewer.canvas.toDataURL("image/png");
        remove();
        resolve(data);
      });
      viewer.scene.requestRender();
    });
  return probe.environment;
}
