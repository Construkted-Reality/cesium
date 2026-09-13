// Harness-only worker pool. Preserve the original total outstanding-task cap.
export function installDracoExperiment(Cesium, config) {
  const loader = Cesium.DracoLoader;
  if (loader._decoderTaskProcessor) {
    throw new Error("Install Draco experiment before the first decode");
  }
  const original = loader.decodeBufferView;
  const workers = [];
  let ready = false;
  let error;
  let records = [];
  let epoch = performance.now();
  let serial = 0;
  let peakOutstanding = 0;
  const initialization = [];
  const workerHeaps = [];
  function initialize() {
    for (let i = 0; i < config.workers; i++) {
      const processor = new Cesium.TaskProcessor(
        `${location.origin}/Build/TileCache/draco-${config.extraction}.js`,
        loader._maxDecodingConcurrency,
      );
      workers.push(processor);
      const start = performance.now();
      initialization.push(
        processor
          .initWebAssemblyModule({
            wasmBinaryFile: "ThirdParty/draco_decoder.wasm",
          })
          .then((value) => {
            if (!value?.ready) {
              throw new Error("Draco initialization failed");
            }
            workerHeaps[i] = value.wasmHeapBytes;
            return { worker: i, elapsedMs: performance.now() - start };
          }),
      );
    }
    Promise.all(initialization).then(
      () => {
        ready = true;
      },
      (e) => {
        error = e;
      },
    );
  }
  loader.decodeBufferView = function (options) {
    if (!workers.length) {
      initialize();
    }
    if (error) {
      throw error;
    }
    if (!ready) {
      return;
    }
    const outstanding = workers.reduce((sum, p) => sum + p._activeTasks, 0);
    if (outstanding >= loader._maxDecodingConcurrency) {
      return;
    }
    const processor = workers.reduce((a, b) =>
      a._activeTasks <= b._activeTasks ? a : b,
    );
    const worker = workers.indexOf(processor);
    const start = performance.now() - epoch;
    const id = serial++;
    const promise = processor.scheduleTask(
      { ...options, profile: config.profile, verifyExtraction: config.verify },
      [options.array.buffer],
    );
    if (!promise) {
      throw new Error("Unexpected worker rejection");
    }
    peakOutstanding = Math.max(peakOutstanding, outstanding + 1);
    return promise.then((result) => {
      if (result.__dracoTest) {
        workerHeaps[worker] = result.__dracoTest.wasmHeapBytes;
      }
      records.push({
        id,
        worker,
        start,
        end: performance.now() - epoch,
        ...result.__dracoTest,
      });
      delete result.__dracoTest;
      return result;
    });
  };
  return {
    begin() {
      epoch = performance.now();
      records = [];
      peakOutstanding = 0;
    },
    snapshot() {
      return {
        config,
        records,
        peakOutstanding,
        workers: workers.length,
        workerHeaps: config.profile ? [...workerHeaps] : undefined,
      };
    },
    destroy() {
      loader.decodeBufferView = original;
      workers.forEach((p) => p.destroy());
    },
  };
}
