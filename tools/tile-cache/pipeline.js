// Harness-only pipeline instrumentation. Async spans overlap and must not be
// summed as a decomposition of elapsed time. Worker clocks use timeOrigin.
export function tracePipeline(Cesium, viewer) {
  let epoch = performance.now();
  let samples = [];
  let frames = [];
  let active = true;
  const restore = [];
  const workerUrls = [];
  const now = () => performance.now() - epoch;
  const push = (event) => {
    if (active) {
      samples.push(event);
    }
  };
  function wrap(
    object,
    name,
    phase,
    asynchronous = false,
    describe = () => ({}),
  ) {
    const original = object?.[name];
    if (!original) {
      throw new Error(`Missing probe target ${phase}`);
    }
    object[name] = function (...args) {
      const start = now();
      const details = describe.call(this, args);
      const result = original.apply(this, args);
      if (asynchronous) {
        if (result?.then) {
          result.then(
            () => push({ phase, start, end: now(), ...details }),
            (error) =>
              push({
                phase,
                start,
                end: now(),
                error: String(error),
                ...details,
              }),
          );
        }
      } else {
        push({
          phase,
          start,
          end: now(),
          ...details,
          accepted: typeof result === "boolean" ? result : undefined,
        });
      }
      return result;
    };
    restore.push(() => {
      object[name] = original;
    });
  }
  wrap(
    Cesium.Resource.prototype,
    "fetchArrayBuffer",
    "resource.body",
    true,
    function () {
      return { url: this.url };
    },
  );
  for (const name of [
    "GltfLoader",
    "GltfDracoLoader",
    "GltfImageLoader",
    "GltfTextureLoader",
    "GltfVertexBufferLoader",
    "GltfIndexBufferLoader",
  ]) {
    wrap(Cesium[name].prototype, "process", `${name}.process`);
  }
  wrap(
    Cesium.JobScheduler.prototype,
    "execute",
    "job.execute",
    false,
    (args) => ({ type: args[1], job: args[0].constructor.name }),
  );
  const gl = viewer.scene.context._gl;
  for (const name of [
    "texImage2D",
    "texSubImage2D",
    "compressedTexImage2D",
    "bufferData",
    "bufferSubData",
    "compileShader",
    "linkProgram",
  ]) {
    wrap(gl, name, `gl.${name}`);
  }
  let creatingWorker;
  function wrapWorkerCreation(name) {
    const original = Cesium.TaskProcessor.prototype[name];
    Cesium.TaskProcessor.prototype[name] = function (...args) {
      const previous = creatingWorker;
      creatingWorker = this._workerPath;
      try {
        return original.apply(this, args);
      } finally {
        creatingWorker = previous;
      }
    };
    restore.push(() => {
      Cesium.TaskProcessor.prototype[name] = original;
    });
  }
  ["scheduleTask", "initWebAssemblyModule"].forEach(wrapWorkerCreation);
  let workerSerial = 0;
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      const absolute = new URL(url, location.href).href;
      const label = creatingWorker || absolute;
      const match = label.match(/(decodeDraco|transcodeKTX2)(?:\.js)?$/);
      let workerUrl = url;
      if (match) {
        const script = `
const starts = new Map();
const post = self.postMessage.bind(self);
let handler, wrapped;
Object.defineProperty(self, "onmessage", {
  configurable: true,
  get: () => handler,
  set: fn => {
    if (wrapped) self.removeEventListener("message", wrapped);
    handler = fn;
    wrapped = fn && (event => {
      starts.set(event.data.id, performance.timeOrigin + performance.now());
      return fn.call(self, event);
    });
    if (wrapped) self.addEventListener("message", wrapped);
  }
});
self.postMessage = (message, ...args) => {
  const start = starts.get(message.id);
  if (start !== undefined) {
    message.__pipeline = { start, end: performance.timeOrigin + performance.now() };
    starts.delete(message.id);
  }
  return post(message, ...args);
};
${options?.type === "module" ? `await import(${JSON.stringify(absolute)});` : `importScripts(${JSON.stringify(absolute)});`}`;
        workerUrl = URL.createObjectURL(
          new Blob([script], { type: "application/javascript" }),
        );
        workerUrls.push(workerUrl);
      }
      super(workerUrl, options);
      const workerId = ++workerSerial;
      if (match) {
        const sent = new Map();
        const post = this.postMessage;
        this.postMessage = (message, ...args) => {
          sent.set(message.id, {
            start: now(),
            initialization: !!message.parameters?.webAssemblyConfig,
          });
          return post.call(this, message, ...args);
        };
        this.addEventListener("message", ({ data }) => {
          const entry = sent.get(data.id);
          sent.delete(data.id);
          if (!entry || !data.__pipeline) {
            return;
          }
          const clockOffset = performance.timeOrigin + epoch;
          push({
            phase: `worker.${match[1]}`,
            workerId,
            ...entry,
            workerStart: data.__pipeline.start - clockOffset,
            workerEnd: data.__pipeline.end - clockOffset,
            end: now(),
          });
        });
      }
    }
  };
  restore.push(() => {
    window.Worker = OriginalWorker;
  });
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  let queries = [];
  let currentQuery;
  let frameStart;
  function pollGpu() {
    const disjoint = timer && gl.getParameter(timer.GPU_DISJOINT_EXT);
    queries = queries.filter((entry) => {
      if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) {
        return true;
      }
      samples.push({
        phase: "gpu.frame",
        start: entry.start,
        end: entry.end,
        gpuMs: disjoint
          ? null
          : gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6,
        disjoint: !!disjoint,
      });
      gl.deleteQuery(entry.query);
      return false;
    });
  }
  const before = viewer.scene.preUpdate.addEventListener(() => {
    pollGpu();
    frameStart = now();
    if (active && timer) {
      currentQuery = { query: gl.createQuery(), start: frameStart };
      gl.beginQuery(timer.TIME_ELAPSED_EXT, currentQuery.query);
    }
  });
  const after = viewer.scene.postRender.addEventListener(() => {
    if (active) {
      frames.push({ start: frameStart, end: now() });
    }
    if (currentQuery) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      currentQuery.end = now();
      queries.push(currentQuery);
      currentQuery = undefined;
    }
  });
  restore.push(before, after);
  return {
    begin() {
      queries.forEach((entry) => gl.deleteQuery(entry.query));
      queries = [];
      epoch = performance.now();
      samples = [];
      frames = [];
      active = true;
    },
    async snapshot() {
      active = false;
      const deadline = performance.now() + 500;
      while (queries.length && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        pollGpu();
      }
      return {
        samples,
        frames,
        gpuTimerSupported: !!timer,
        pendingGpuQueries: queries.length,
        note: "Async intervals overlap. Worker execution is receive-to-post elapsed time; queue and main-thread delivery are separate. GL calls measure synchronous submission, not GPU completion.",
      };
    },
    destroy() {
      restore.reverse().forEach((fn) => fn());
      workerUrls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
