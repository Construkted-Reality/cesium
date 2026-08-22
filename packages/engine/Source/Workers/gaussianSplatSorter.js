import createTaskProcessorWorker from "./createTaskProcessorWorker.js";
import defined from "../Core/defined.js";

import { initSync, radix_sort_gaussians_indexes } from "@cesium/wasm-splats";

// Splat positions do not change while a snapshot is active, but the sort runs
// again every time the camera moves. Holding the positions here lets the main
// thread send them once per snapshot instead of copying them for every request.
//
// The cache holds a few entries so that two visible tilesets do not evict each
// other. Each entry costs 12 bytes per splat.
const MAXIMUM_CACHED_POSITION_SETS = 3;
const cachedPositions = new Map();

function rememberPositions(key, positions) {
  cachedPositions.delete(key);
  cachedPositions.set(key, positions);
  while (cachedPositions.size > MAXIMUM_CACHED_POSITION_SETS) {
    const oldestKey = cachedPositions.keys().next().value;
    cachedPositions.delete(oldestKey);
  }
}

function recallPositions(key) {
  const positions = cachedPositions.get(key);
  if (defined(positions)) {
    // Refresh the insertion order so an active set is never the one evicted.
    cachedPositions.delete(key);
    cachedPositions.set(key, positions);
  }
  return positions;
}

//load built wasm modules for sorting. Ensure we can load webassembly and we support SIMD.
async function initWorker(parameters, transferableObjects) {
  // Require and compile WebAssembly module, or use fallback if not supported
  const wasmConfig = parameters.webAssemblyConfig;
  if (defined(wasmConfig) && defined(wasmConfig.wasmBinary)) {
    initSync({ module: wasmConfig.wasmBinary });
    return true;
  }
}

function generateGaussianSortWorker(parameters, transferableObjects) {
  // Handle initialization
  const wasmConfig = parameters.webAssemblyConfig;
  if (defined(wasmConfig)) {
    return initWorker(parameters, transferableObjects);
  }

  const { primitive, sortType, positionsKey } = parameters;

  if (sortType !== "Index") {
    return undefined;
  }

  if (defined(primitive.positions)) {
    rememberPositions(positionsKey, primitive.positions);
  }

  const positions = recallPositions(positionsKey);
  if (!defined(positions)) {
    // The caller believed the worker still held this position set. Return
    // nothing so the caller discards the result and sends the positions again.
    return undefined;
  }

  const indexes = radix_sort_gaussians_indexes(
    positions,
    primitive.modelView,
    primitive.count,
  );

  // Hand the buffer over instead of letting the structured clone copy it.
  transferableObjects.push(indexes.buffer);
  return indexes;
}

export default createTaskProcessorWorker(generateGaussianSortWorker);
