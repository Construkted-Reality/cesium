import defined from "../Core/defined.js";
import FeatureDetection from "../Core/FeatureDetection.js";
import RuntimeError from "../Core/RuntimeError.js";
import TaskProcessor from "../Core/TaskProcessor.js";

function GaussianSplatTextureGenerator() {}

GaussianSplatTextureGenerator._maxSortingConcurrency = Math.max(
  FeatureDetection.hardwareConcurrency - 1,
  1,
);

GaussianSplatTextureGenerator._textureTaskProcessor = undefined;
GaussianSplatTextureGenerator._taskProcessorReady = false;
GaussianSplatTextureGenerator._error = undefined;
GaussianSplatTextureGenerator._referenceCount = 0;
GaussianSplatTextureGenerator._initializing = false;
GaussianSplatTextureGenerator._releaseRequested = false;

function releaseUnusedTaskProcessor() {
  const generator = GaussianSplatTextureGenerator;
  const processor = generator._textureTaskProcessor;
  if (
    !generator._releaseRequested ||
    generator._referenceCount !== 0 ||
    generator._initializing ||
    (defined(processor) && processor._activeTasks !== 0)
  ) {
    return;
  }
  if (defined(processor)) {
    processor.destroy();
  }
  generator._textureTaskProcessor = undefined;
  generator._taskProcessorReady = false;
  generator._error = undefined;
  generator._releaseRequested = false;
}

/**
 * Retains the shared worker for a live splat primitive.
 * @private
 */
GaussianSplatTextureGenerator.retain = function () {
  ++GaussianSplatTextureGenerator._referenceCount;
  GaussianSplatTextureGenerator._releaseRequested = false;
};

/**
 * Releases the worker after its last primitive and pending task finish.
 * @private
 */
GaussianSplatTextureGenerator.release = function () {
  --GaussianSplatTextureGenerator._referenceCount;
  if (GaussianSplatTextureGenerator._referenceCount === 0) {
    GaussianSplatTextureGenerator._releaseRequested = true;
    releaseUnusedTaskProcessor();
  }
};

GaussianSplatTextureGenerator._getTextureTaskProcessor = function () {
  if (!defined(GaussianSplatTextureGenerator._textureTaskProcessor)) {
    const processor = new TaskProcessor(
      "gaussianSplatTextureGenerator",
      GaussianSplatTextureGenerator._maxSortingConcurrency,
    );
    GaussianSplatTextureGenerator._initializing = true;
    processor
      .initWebAssemblyModule({
        wasmBinaryFile: "ThirdParty/wasm_splats_bg.wasm",
      })
      .then(function (result) {
        if (result) {
          GaussianSplatTextureGenerator._taskProcessorReady = true;
        } else {
          GaussianSplatTextureGenerator._error = new RuntimeError(
            "Gaussian splat sorter could not be initialized.",
          );
        }
      })
      .catch((error) => {
        GaussianSplatTextureGenerator._error = error;
      })
      .finally(function () {
        GaussianSplatTextureGenerator._initializing = false;
        releaseUnusedTaskProcessor();
      });
    GaussianSplatTextureGenerator._textureTaskProcessor = processor;
  }

  return GaussianSplatTextureGenerator._textureTaskProcessor;
};

GaussianSplatTextureGenerator.generateFromAttributes = function (parameters) {
  const textureTaskProcessor =
    GaussianSplatTextureGenerator._getTextureTaskProcessor();
  if (defined(GaussianSplatTextureGenerator._error)) {
    throw GaussianSplatTextureGenerator._error;
  }

  if (!GaussianSplatTextureGenerator._taskProcessorReady) {
    return;
  }

  const { attributes } = parameters;
  const promise = textureTaskProcessor.scheduleTask(parameters, [
    attributes.positions.buffer,
    attributes.scales.buffer,
    attributes.rotations.buffer,
    attributes.colors.buffer,
  ]);
  return promise?.finally(releaseUnusedTaskProcessor);
};

export default GaussianSplatTextureGenerator;
