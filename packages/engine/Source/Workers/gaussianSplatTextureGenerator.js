import createTaskProcessorWorker from "./createTaskProcessorWorker.js";
import defined from "../Core/defined.js";

import { initSync, generate_splat_texture } from "@cesium/wasm-splats";

//load built wasm modules for sorting. Ensure we can load webassembly and we support SIMD.
async function initWorker(parameters, transferableObjects) {
  // Require and compile WebAssembly module, or use fallback if not supported
  const wasmConfig = parameters.webAssemblyConfig;
  if (defined(wasmConfig) && defined(wasmConfig.wasmBinary)) {
    initSync({ module: wasmConfig.wasmBinary });
    return true;
  }
  return false;
}

async function generateSplatTextureWorker(parameters, transferableObjects) {
  const wasmConfig = parameters.webAssemblyConfig;
  if (defined(wasmConfig)) {
    return initWorker(parameters, transferableObjects);
  }

  const { attributes, count } = parameters;
  const result = generate_splat_texture(
    attributes.positions,
    attributes.scales,
    attributes.rotations,
    attributes.colors,
    count,
  );

  try {
    // The data getter copies out of WASM memory before the result is freed.
    let data = result.data;
    let width = result.width;
    let height = result.height;
    if (defined(parameters.textureWidth)) {
      width = parameters.textureWidth;
      height = Math.min(width, Math.ceil(count / (width / 2)));
      const requiredLength = width * height * 4;
      if (data.length < requiredLength) {
        // Pad before transfer so the render thread only creates a view.
        const padded = new Uint32Array(requiredLength);
        padded.set(data);
        data = padded;
      } else {
        data = data.subarray(0, requiredLength);
      }
    }
    transferableObjects.push(data.buffer);
    return {
      data: data,
      width: width,
      height: height,
    };
  } finally {
    result.free();
  }
}

export default createTaskProcessorWorker(generateSplatTextureWorker);
