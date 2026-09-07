import { loadSpz } from "@spz-loader/core";
import { packSpzSphericalHarmonics } from "../Scene/packSpzSphericalHarmonics.js";
import createTaskProcessorWorker from "./createTaskProcessorWorker.js";

async function decodeSpz(parameters, transferableObjects) {
  const gcloud = await loadSpz(parameters.array, {
    unpackOptions: { coordinateSystem: "UNSPECIFIED" },
  });
  const packedSphericalHarmonics =
    parameters.packedDegree !== undefined &&
    parameters.packedDegree === gcloud.shDegree
      ? packSpzSphericalHarmonics(gcloud)
      : undefined;
  // Keep the original SH data for expanded consumers of the shared loader.
  const buffers = new Set();
  for (const value of [...Object.values(gcloud), packedSphericalHarmonics]) {
    if (ArrayBuffer.isView(value)) {
      buffers.add(value.buffer);
    }
  }
  transferableObjects.push(...buffers);
  return { gcloud, packedSphericalHarmonics };
}

export default createTaskProcessorWorker(decodeSpz);
