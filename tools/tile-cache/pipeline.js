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
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      const absolute = new URL(url, location.href).href;
      const match = absolute.match(/\/(decodeDraco|transcodeKTX2)\.js$/);
      let workerUrl = url;
      if (match) {
        const script = `import ${JSON.stringify(absolute)};
const starts = new Map();
const handler = self.onmessage;
const post = self.postMessage.bind(self);
self.onmessage = event => {
  starts.set(event.data.id, performance.timeOrigin + performance.now());
  return handler(event);
};
self.postMessage = (message, ...args) => {
  const start = starts.get(message.id);
  if (start !== undefined) {
    message.__pipeline = { start, end: performance.timeOrigin + performance.now() };
    starts.delete(message.id);
  }
  return post(message, ...args);
};`;
        workerUrl = URL.createObjectURL(
          new Blob([script], { type: "application/javascript" }),
        );
        workerUrls.push(workerUrl);
      }
      super(workerUrl, options);
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
  let frameStart;
  const before = viewer.scene.preUpdate.addEventListener(() => {
    frameStart = now();
  });
  const after = viewer.scene.postRender.addEventListener(() => {
    if (active) {
      frames.push({ start: frameStart, end: now() });
    }
  });
  restore.push(before, after);
  return {
    begin() {
      epoch = performance.now();
      samples = [];
      frames = [];
      active = true;
    },
    snapshot() {
      active = false;
      return {
        samples,
        frames,
        note: "Async intervals overlap. Worker execution is receive-to-post elapsed time; queue and main-thread delivery are separate. GL calls measure synchronous submission, not GPU completion.",
      };
    },
    destroy() {
      restore.reverse().forEach((fn) => fn());
      workerUrls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
