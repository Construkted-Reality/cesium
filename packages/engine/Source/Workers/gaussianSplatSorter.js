import createTaskProcessorWorker from "./createTaskProcessorWorker.js";
import defined from "../Core/defined.js";
import GaussianSplatPositionCache from "../Core/GaussianSplatPositionCache.js";

import { initSync, radix_sort_gaussians_indexes } from "@cesium/wasm-splats";

const cachedPositions = new GaussianSplatPositionCache();

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

  for (const key of parameters.releaseKeys ?? []) {
    cachedPositions.remove(key);
  }
  const { primitive, sortType, positionsKey } = parameters;

  if (sortType !== "Index") {
    return undefined;
  }

  if (defined(primitive.positions)) {
    cachedPositions.set(positionsKey, primitive.positions);
  }

  const positions = primitive.positions ?? cachedPositions.get(positionsKey);
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
