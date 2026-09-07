import defined from "../Core/defined.js";
import FeatureDetection from "../Core/FeatureDetection.js";
import RuntimeError from "../Core/RuntimeError.js";
import TaskProcessor from "../Core/TaskProcessor.js";

// One active task per worker. Loaders retry through process() instead of
// retaining another queue of compressed buffers in the decoder.
const slots = Array.from(
  {
    length: Math.min(2, Math.max(1, FeatureDetection.hardwareConcurrency - 1)),
  },
  () => ({ processor: undefined, busy: false }),
);

/** @private */
class SpzDecoder {
  static decode(array, packedDegree) {
    const slot = slots.find((candidate) => !candidate.busy);
    if (!defined(slot)) {
      return undefined;
    }
    slot.busy = true;
    return decode(slot, array, packedDegree);
  }
}

async function decode(slot, array, packedDegree) {
  let worker;
  let onError;
  try {
    slot.processor ??= new TaskProcessor("decodeSpz", 1);
    // The buffer view can share its backing store with other resources.
    // Copy only the requested view, and only after admission to a worker.
    const input = new Uint8Array(array);
    const task = slot.processor.scheduleTask({ array: input, packedDegree }, [
      input.buffer,
    ]);
    worker = slot.processor._worker;
    const failed = new Promise((resolve, reject) => {
      onError = (event) =>
        reject(new RuntimeError(event.message || "SPZ decoder worker failed."));
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
    });
    return await Promise.race([task, failed]);
  } catch (error) {
    if (defined(slot.processor)) {
      slot.processor.destroy();
      slot.processor = undefined;
    }
    throw error;
  } finally {
    if (defined(worker) && defined(onError)) {
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onError);
    }
    slot.busy = false;
  }
}

// Test access also permits deterministic cleanup of the shared workers.
SpzDecoder._slots = slots;
export default SpzDecoder;
