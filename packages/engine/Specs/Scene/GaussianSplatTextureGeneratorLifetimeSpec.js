import {
  GaussianSplatTextureGenerator as Generator,
  TaskProcessor,
} from "../../index.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";

describe("Scene/GaussianSplatTextureGeneratorLifetime", function () {
  let references;
  beforeEach(function () {
    references = 0;
  });
  afterEach(function () {
    while (references > 0) {
      release();
    }
  });
  function retain() {
    Generator.retain();
    references++;
  }
  function release() {
    Generator.release();
    references--;
  }
  function parameters() {
    return {
      attributes: {
        positions: new Float32Array([1, 2, 3]),
        scales: new Float32Array([1, 1, 1]),
        rotations: new Float32Array([0, 0, 0, 1]),
        colors: new Uint8Array([255, 127, 63, 255]),
      },
      count: 1,
    };
  }
  async function ready() {
    Generator._getTextureTaskProcessor();
    await pollToPromise(() => Generator._taskProcessorReady);
    return Generator._textureTaskProcessor;
  }

  it("keeps the worker for another primitive and recreates it after release", async function () {
    retain();
    retain();
    const processor = await ready();
    release();
    expect(Generator._textureTaskProcessor).toBe(processor);
    expect(processor.isDestroyed()).toBe(false);
    release();
    expect(processor.isDestroyed()).toBe(true);
    expect(Generator._textureTaskProcessor).toBeUndefined();
    retain();
    const replacement = await ready();
    expect(replacement).not.toBe(processor);
    const result = await Generator.generateFromAttributes(parameters());
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("lets an admitted task finish before releasing the worker", async function () {
    retain();
    const processor = await ready();
    const promise = Generator.generateFromAttributes(parameters());
    release();
    expect(processor.isDestroyed()).toBe(false);
    const result = await promise;
    expect(result.data.length).toBeGreaterThan(0);
    expect(processor.isDestroyed()).toBe(true);
    expect(Generator._textureTaskProcessor).toBeUndefined();
  });

  it("cancels deferred release when a new primitive arrives", async function () {
    retain();
    const processor = await ready();
    const promise = Generator.generateFromAttributes(parameters());
    release();
    retain();
    await promise;
    expect(Generator._textureTaskProcessor).toBe(processor);
    expect(processor.isDestroyed()).toBe(false);
  });

  it("waits for worker initialization before releasing it", async function () {
    retain();
    const previous = await ready();
    release();
    expect(previous.isDestroyed()).toBe(true);
    retain();
    const processor = Generator._getTextureTaskProcessor();
    release();
    expect(processor.isDestroyed()).toBe(false);
    await pollToPromise(() => Generator._textureTaskProcessor === undefined);
    expect(processor.isDestroyed()).toBe(true);
    expect(Generator._taskProcessorReady).toBe(false);
  });
  it("releases the worker after a task rejects", async function () {
    retain();
    const processor = await ready();
    const error = new Error("Texture generation failed");
    spyOn(processor, "scheduleTask").and.callFake(function () {
      ++processor._activeTasks;
      return Promise.resolve().then(function () {
        --processor._activeTasks;
        throw error;
      });
    });
    const promise = Generator.generateFromAttributes(parameters());
    release();
    expect(processor.isDestroyed()).toBe(false);
    await expectAsync(promise).toBeRejectedWith(error);
    expect(processor.isDestroyed()).toBe(true);
    expect(Generator._textureTaskProcessor).toBeUndefined();
  });

  it("releases a worker that fails initialization", async function () {
    retain();
    await ready();
    release();
    spyOn(TaskProcessor.prototype, "initWebAssemblyModule").and.returnValue(
      Promise.reject(new Error("Worker initialization failed")),
    );
    retain();
    const processor = Generator._getTextureTaskProcessor();
    release();
    await pollToPromise(() => Generator._textureTaskProcessor === undefined);
    expect(processor.isDestroyed()).toBe(true);
    expect(Generator._error).toBeUndefined();
    expect(Generator._taskProcessorReady).toBe(false);
  });
});
