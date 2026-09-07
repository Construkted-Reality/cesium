/* global Cesium */
(() => {
  const params = new URLSearchParams(location.search);
  const stats = {
    sorts: 0,
    bytesSent: 0,
    misses: 0,
    builds: 0,
    gl: {},
    frames: [],
    tileLoads: 0,
    tileUnloads: 0,
    shaderEdits: 0,
  };
  window.__telemetry = stats;
  window.__round2Start = () => {
    stats.before = {
      sorts: stats.sorts,
      bytesSent: stats.bytesSent,
      misses: stats.misses,
    };
  };
  const init = Cesium.TaskProcessor.prototype.initWebAssemblyModule;
  Cesium.TaskProcessor.prototype.initWebAssemblyModule = function (options) {
    if (this._workerPath === "gaussianSplatSorter") {
      this._workerPath = `${location.origin}/Build/CesiumUnminified/Workers/gaussianSplatSorter.js`;
    }
    return init.call(this, options);
  };

  for (const kind of [
    "Buffer",
    "VertexArray",
    "Texture",
    "Program",
    "Framebuffer",
    "Renderbuffer",
  ]) {
    for (const action of ["create", "delete"]) {
      const name = action + kind;
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        const result = original.apply(this, args);
        if (action === "create" ? result : args[0]) {
          stats.gl[name] = (stats.gl[name] || 0) + 1;
        }
        return result;
      };
    }
  }
  stats.uploads = [];
  const texImage = WebGL2RenderingContext.prototype.texImage2D;
  WebGL2RenderingContext.prototype.texImage2D = function (...args) {
    const [target, level, internal, width, height, , format, type, pixels] =
      args;
    if (
      args.length === 9 &&
      level === 0 &&
      (internal === this.RG32UI || internal === this.RGBA32UI) &&
      ArrayBuffer.isView(pixels)
    ) {
      const started = performance.now();
      if (params.get("probe") === "immutable") {
        this.texStorage2D(target, 1, internal, width, height);
        this.texSubImage2D(
          target,
          0,
          0,
          0,
          width,
          height,
          format,
          type,
          pixels,
        );
      } else {
        texImage.apply(this, args);
      }
      stats.uploads.push({
        width,
        height,
        bytes: pixels.byteLength,
        ms: performance.now() - started,
        immutable: params.get("probe") === "immutable",
      });
      return;
    }
    return texImage.apply(this, args);
  };
  let contentUpdateMs = 0;
  const contentUpdate = Cesium.GaussianSplat3DTileContent.prototype.update;
  Cesium.GaussianSplat3DTileContent.prototype.update = function (...args) {
    const start = performance.now();
    try {
      return contentUpdate.apply(this, args);
    } finally {
      contentUpdateMs += performance.now() - start;
    }
  };
  const sort = Cesium.GaussianSplatSorter.radixSortIndexes;
  Cesium.GaussianSplatSorter.radixSortIndexes = function (options) {
    const bytes = options.primitive.positions?.byteLength || 0;
    const result = sort(options);
    if (result) {
      stats.sorts++;
      stats.bytesSent += bytes;
      result.then((value) => {
        if (value === undefined) {
          stats.misses++;
        }
      });
    }
    return result;
  };
  const build = Cesium.GaussianSplatPrimitive.buildGSplatDrawCommand;
  Cesium.GaussianSplatPrimitive.buildGSplatDrawCommand = function (...args) {
    stats.builds++;
    return build(...args);
  };
  for (const stage of ["Vertex", "Fragment"]) {
    const name = `add${stage}Lines`;
    const original = Cesium.ShaderBuilder.prototype[name];
    Cesium.ShaderBuilder.prototype[name] = function (lines) {
      const probe = params.get("probe");
      if (
        typeof lines === "string" &&
        lines.includes("vec4 covVectors = calcCovVectors")
      ) {
        if (probe === "nospherical") {
          lines = lines.replace(
            "v_splatColor.rgb += evaluateSH(texIdx, viewDirModel).rgb;",
            "v_splatColor.rgb += vec3(0.0);",
          );
          stats.shaderEdits++;
        }
        if (probe === "tiny") {
          lines = lines.replace(
            "    gl_Position += vec4(",
            "    corner *= 0.001;\n    gl_Position += vec4(",
          );
          stats.shaderEdits++;
        }
      }
      if (
        typeof lines === "string" &&
        lines.includes("float B = exp(A * 4.)")
      ) {
        if (probe === "flatfragment") {
          lines = lines.replace(
            "exp(A * 4.) * v_splatColor.a",
            "v_splatColor.a",
          );
          stats.shaderEdits++;
        }
      }
      return original.call(this, lines);
    };
  }
  window.__installTelemetry = (scene, tilesets) => {
    for (const t of tilesets) {
      t.tileLoad.addEventListener(() => stats.tileLoads++);
      t.tileUnload.addEventListener(() => stats.tileUnloads++);
    }
    let last = performance.now();
    scene.postRender.addEventListener(() => {
      const now = performance.now();
      if (window.__benchPhase === "measuring" || window.__recordLifecycle) {
        stats.frames.push({
          dt: now - last,
          contentUpdateMs,
          tileLoads: stats.tileLoads,
          tileUnloads: stats.tileUnloads,
          counters: Object.fromEntries(
            Object.entries(
              Cesium.GaussianSplatPrimitive.profiling.counters,
            ).map(([k, v]) => [k, v.totalMs]),
          ),
          phase: window.__lifecyclePhase || "benchmark",
          tiles: tilesets
            .filter((t) => !t.isDestroyed())
            .map((t) => {
              const p = t.gaussianSplatPrimitive;
              return {
                selected: t._selectedTiles.length,
                loaded: t.tilesLoaded,
                count: p?._numSplats || 0,
                draw: p?._drawCommand?.instanceCount || 0,
                generation: p?._splatDataGeneration,
                pending: p?._pendingSnapshot?.state,
                sorter: p?._sorterState,
                reportedBytes: t.totalMemoryUsageInBytes,
                textureBytes:
                  (p?.gaussianSplatTexture?.sizeInBytes || 0) +
                  (p?.sphericalHarmonicsTexture?.sizeInBytes || 0),
              };
            }),
        });
      }
      if (
        params.get("visibility") === "1" &&
        window.__benchPhase === "measuring"
      ) {
        const gl = scene.context._gl,
          w = scene.drawingBufferWidth,
          h = scene.drawingBufferHeight;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let visible = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] || pixels[i + 1] || pixels[i + 2]) {
            visible++;
          }
        }
        stats.frames[stats.frames.length - 1].visiblePixels = visible;
      }
      contentUpdateMs = 0;
      last = now;
    });
  };
})();
