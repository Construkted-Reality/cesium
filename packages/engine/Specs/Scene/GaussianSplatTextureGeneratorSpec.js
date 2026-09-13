import { GaussianSplatTextureGenerator } from "../../index.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";

describe("Scene/GaussianSplatTextureGenerator", function () {
  async function generate(textureWidth) {
    let promise;
    await pollToPromise(function () {
      promise = GaussianSplatTextureGenerator.generateFromAttributes({
        attributes: {
          positions: new Float32Array([1, 2, 3]),
          scales: new Float32Array([1, 1, 1]),
          rotations: new Float32Array([0, 0, 0, 1]),
          colors: new Uint8Array([255, 127, 63, 255]),
        },
        count: 1,
        textureWidth: textureWidth,
      });
      return promise !== undefined;
    });
    return promise;
  }

  it("preserves splat data and zero pads a wider texture", async function () {
    const original = await generate();
    const padded = await generate(4096);
    expect(padded.width).toBe(4096);
    expect(padded.height).toBe(1);
    expect(padded.data.length).toBe(4096 * 4);
    expect(padded.data.subarray(0, 8)).toEqual(original.data.subarray(0, 8));
    expect(padded.data.subarray(8).every((value) => value === 0)).toBe(true);
  });

  it("preserves splat data with a smaller texture limit", async function () {
    const original = await generate();
    const smaller = await generate(512);
    expect(smaller.width).toBe(512);
    expect(smaller.height).toBe(1);
    expect(smaller.data.length).toBe(512 * 4);
    expect(smaller.data.subarray(0, 8)).toEqual(original.data.subarray(0, 8));
  });
});
