import DeveloperError from "../Core/DeveloperError.js";
import defined from "../Core/defined.js";
import GaussianSplatPositionCache from "../Core/GaussianSplatPositionCache.js";
import FeatureDetection from "../Core/FeatureDetection.js";
import RuntimeError from "../Core/RuntimeError.js";
import TaskProcessor from "../Core/TaskProcessor.js";

/** * A sorter for Gaussian splats that uses a task processor to handle sorting in parallel.
 * This class is responsible for initializing the task processor and scheduling sorting tasks.
 * * @constructor
 * @private
 */
function GaussianSplatSorter() {}

let maximumCacheByteLength = GaussianSplatPositionCache.maximumByteLength;
let budgetDirty = false;
Object.defineProperty(GaussianSplatSorter, "maximumCacheByteLength", {
  get() {
    return maximumCacheByteLength;
  },
  set(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DeveloperError(
        "maximumCacheByteLength must be a nonnegative safe integer.",
      );
    }
    if (value === maximumCacheByteLength) {
      return;
    }
    maximumCacheByteLength = value;
    budgetDirty = true;
    flushReleasedPositions();
  },
});
const pendingReleases = new Set();
let releaseInFlight = false;

function flushReleasedPositions() {
  if (
    releaseInFlight ||
    (pendingReleases.size === 0 && !budgetDirty) ||
    !GaussianSplatSorter._taskProcessorReady
  ) {
    return;
  }
  const keys = Array.from(pendingReleases);
  const promise = GaussianSplatSorter._sorterTaskProcessor.scheduleTask({
    releaseKeys: keys,
    cacheByteBudget: maximumCacheByteLength,
  });
  if (!defined(promise)) {
    return;
  }
  for (const key of keys) {
    pendingReleases.delete(key);
  }
  budgetDirty = false;
  releaseInFlight = true;
  promise
    .catch(() => {})
    .finally(() => {
      releaseInFlight = false;
      flushReleasedPositions();
    });
}

/** Release a snapshot generation without starting an unused worker. @private */
GaussianSplatSorter.releasePositions = function (key) {
  if (key !== 0 && defined(key)) {
    pendingReleases.add(key);
    flushReleasedPositions();
  }
};

GaussianSplatSorter._maxSortingConcurrency = Math.max(
  FeatureDetection.hardwareConcurrency - 1,
  1,
);

GaussianSplatSorter._sorterTaskProcessor = undefined;
GaussianSplatSorter._taskProcessorReady = false;
GaussianSplatSorter._error = undefined;
GaussianSplatSorter._getSorterTaskProcessor = function () {
  if (!defined(GaussianSplatSorter._sorterTaskProcessor)) {
    const processor = new TaskProcessor(
      "gaussianSplatSorter",
      GaussianSplatSorter._maxSortingConcurrency,
    );
    processor
      .initWebAssemblyModule({
        wasmBinaryFile: "ThirdParty/wasm_splats_bg.wasm",
      })
      .then(function (result) {
        if (result) {
          GaussianSplatSorter._taskProcessorReady = true;
          flushReleasedPositions();
        } else {
          GaussianSplatSorter._error = new RuntimeError(
            "Gaussian splat sorter could not be initialized.",
          );
        }
      })
      .catch((error) => {
        GaussianSplatSorter._error = error;
      });
    GaussianSplatSorter._sorterTaskProcessor = processor;
  }

  return GaussianSplatSorter._sorterTaskProcessor;
};
/**
 * Sorts Gaussian splats using a radix sort algorithm. Sorted by distance from the camera.
 * A new list of indexes is returned, which can be used to render the splats in the correct order.
 *
 * @param {object} parameters - The parameters for sorting Gaussian splat indexes.
 * @param {object} parameters.primitive - The primitive containing positions and modelView matrices.
 * @param {number} parameters.positionsKey - Identifies the position set held by the worker.
 * @returns {Promise|undefined} A promise that resolves to the sorted indexes or undefined if the task cannot be scheduled.
 * @exception {RuntimeError} Sorter could not be initialized.
 * @private
 */
GaussianSplatSorter.radixSortIndexes = function (parameters) {
  const sorterTaskProcessor = GaussianSplatSorter._getSorterTaskProcessor();
  if (defined(GaussianSplatSorter._error)) {
    throw GaussianSplatSorter._error;
  }

  if (!GaussianSplatSorter._taskProcessorReady) {
    return;
  }

  // Positions are only present on the first request for a position set. Later
  // requests reuse the copy that the worker already holds.
  const positions = parameters.primitive.positions;
  const transferableObjects = defined(positions) ? [positions.buffer] : [];
  parameters.releaseKeys = Array.from(pendingReleases);
  parameters.cacheByteBudget = maximumCacheByteLength;
  const promise = sorterTaskProcessor.scheduleTask(
    parameters,
    transferableObjects,
  );
  if (defined(promise)) {
    budgetDirty = false;
    for (const key of parameters.releaseKeys) {
      pendingReleases.delete(key);
    }
    // Retry deferred releases when task capacity becomes available.
    promise.finally(flushReleasedPositions).catch(() => {});
  }
  return promise;
};

export default GaussianSplatSorter;
