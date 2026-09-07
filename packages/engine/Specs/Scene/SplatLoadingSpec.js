import {
  packSpzSphericalHarmonics,
  getPackedSphericalHarmonicsDegree,
} from "../../Source/Scene/packSpzSphericalHarmonics.js";
import GaussianSplatPrimitive from "../../Source/Scene/GaussianSplatPrimitive.js";
import GaussianSplatSorter from "../../Source/Scene/GaussianSplatSorter.js";
import GaussianSplatPositionCache from "../../Source/Core/GaussianSplatPositionCache.js";
import GltfVertexBufferLoader from "../../Source/Scene/GltfVertexBufferLoader.js";
import ResourceLoaderState from "../../Source/Scene/ResourceLoaderState.js";
import ResourceCacheStatistics from "../../Source/Scene/ResourceCacheStatistics.js";
import ResourceCacheKey from "../../Source/Scene/ResourceCacheKey.js";
import Resource from "../../Source/Core/Resource.js";

describe("Scene/SplatLoading", function () {
  function schema(degree) {
    const result = {};
    for (let l = 1; l <= degree; l++) {
      for (let n = 0; n < 2 * l + 1; n++) {
        result[`_SH_DEGREE_${l}_COEF_${n}`] = 0;
      }
    }
    return result;
  }
  for (const degree of [0, 1, 2, 3]) {
    it(`packs degree ${degree} with exact half values and zero padding`, function () {
      const stride = [0, 9, 24, 45][degree];
      const sh = new Float32Array(stride * 2);
      const values = [0, -0, 1, -2, Infinity, -Infinity, NaN, 1e-40, 65504];
      const halves = [
        0, 0x8000, 0x3c00, 0xc000, 0x7c00, 0xfc00, 0x7e00, 0, 0x7bff,
      ];
      for (let i = 0; i < sh.length; i++) {
        sh[i] = values[i % values.length];
      }
      const packed = packSpzSphericalHarmonics({
        shDegree: degree,
        numPoints: 2,
        sh,
      });
      const padded = Math.ceil(stride / 4) * 4;
      expect(packed.length).toBe(padded);
      for (let p = 0; p < 2; p++) {
        for (let i = 0; i < padded; i++) {
          const word = packed[(p * padded) / 2 + (i >>> 1)];
          const value = (word >>> ((i % 2) * 16)) & 65535;
          expect(value).toBe(
            i < stride ? halves[(p * stride + i) % halves.length] : 0,
          );
        }
      }
    });
  }
  it("rejects malformed decoded data", function () {
    for (const cloud of [
      { shDegree: 4, numPoints: 1, sh: [] },
      { shDegree: 1, numPoints: -1, sh: [] },
      { shDegree: 1, numPoints: 1, sh: [] },
    ]) {
      expect(() => packSpzSphericalHarmonics(cloud)).toThrow();
    }
  });
  it("uses only complete schemas and rejects duplicate aliases", function () {
    for (const degree of [1, 2, 3]) {
      expect(getPackedSphericalHarmonicsDegree(schema(degree))).toBe(degree);
    }
    const partial = schema(2);
    delete partial._SH_DEGREE_1_COEF_1;
    expect(getPackedSphericalHarmonicsDegree(partial)).toBeUndefined();
    const aliases = schema(1);
    delete aliases._SH_DEGREE_1_COEF_1;
    aliases["KHR_gaussian_splatting:SH_DEGREE_1_COEF_0"] = 0;
    expect(getPackedSphericalHarmonicsDegree(aliases)).toBeUndefined();
  });
  it("separates packed and ordinary vertex cache entries", function () {
    const resource = new Resource("https://example.com/test.glb");
    const options = {
      frameState: {},
      gltf: {
        buffers: [{ uri: "data.bin" }],
        bufferViews: [{ buffer: 0, byteLength: 16 }],
      },
      spz: { bufferView: 0 },
      attributeSemantic: "_SH_DEGREE_1_COEF_0",
      gltfResource: resource,
      baseResource: resource,
      loadTypedArray: true,
    };
    const ordinary = ResourceCacheKey.getVertexBufferCacheKey(options);
    expect(
      ResourceCacheKey.getVertexBufferCacheKey({
        ...options,
        packedSphericalHarmonicsDegree: 1,
      }),
    ).not.toBe(ordinary);
    expect(
      ResourceCacheKey.getVertexBufferCacheKey({
        ...options,
        packedSphericalHarmonicsDegree: 2,
      }),
    ).not.toBe(
      ResourceCacheKey.getVertexBufferCacheKey({
        ...options,
        packedSphericalHarmonicsDegree: 1,
      }),
    );
  });
  it("keeps shared decode data intact and releases packed loader storage", function () {
    const resource = new Resource("https://example.com/test.glb");
    const cloud = {
      shDegree: 1,
      numPoints: 1,
      sh: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    };
    const decodedData = { gcloud: cloud };
    const spz = { decodedData, process: () => true };
    function cache() {}
    cache.unload = jasmine.createSpy("unload");
    cache.statistics = new ResourceCacheStatistics();
    function load(degree, semantic, key) {
      const loader = new GltfVertexBufferLoader({
        resourceCache: cache,
        gltf: {},
        gltfResource: resource,
        baseResource: resource,
        spz: { bufferView: 0 },
        attributeSemantic: semantic,
        loadTypedArray: true,
        packedSphericalHarmonicsDegree: degree,
        cacheKey: key,
      });
      loader._spzLoader = spz;
      loader._state = ResourceLoaderState.PROCESSING;
      expect(loader.process({})).toBe(true);
      return loader;
    }
    const packed = load(1, "_SH_DEGREE_1_COEF_0", "packed");
    const other = load(1, "_SH_DEGREE_1_COEF_1", "other");
    const ordinary = load(undefined, "_SH_DEGREE_1_COEF_1", "ordinary");
    const mismatch = load(2, "_SH_DEGREE_1_COEF_1", "mismatch");
    expect(packed.packedSphericalHarmonics).toBe(
      decodedData.packedSphericalHarmonics,
    );
    expect(packed.typedArray).toBeUndefined();
    expect(other.packedSphericalHarmonics).toBeUndefined();
    expect(other.typedArray).toBeUndefined();
    expect(Array.from(ordinary.typedArray)).toEqual([4, 5, 6]);
    expect(mismatch.typedArray).toEqual(ordinary.typedArray);
    expect(cloud.sh.length).toBe(9);
    expect(cache.statistics.geometryByteLength).toBe(24 + 12 + 12);
    for (const loader of [packed, other, ordinary, mismatch]) {
      cache.statistics.removeLoader(loader);
      loader.unload();
    }
    expect(packed.packedSphericalHarmonics).toBeUndefined();
    expect(cache.statistics.geometryByteLength).toBe(0);
  });
  it("shrinks the cache in access order and supports disabling and regrowth", function () {
    const cache = new GaussianSplatPositionCache(32);
    cache.set(1, new Float32Array(4));
    cache.set(2, new Float32Array(4));
    cache.get(1);
    cache.resize(16);
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBeDefined();
    cache.resize(0);
    expect(cache.byteLength).toBe(0);
    cache.set(3, new Float32Array(1));
    expect(cache.get(3)).toBeUndefined();
    cache.resize(32);
    cache.set(3, new Float32Array(8));
    expect(cache.byteLength).toBe(32);
  });
  it("validates the public shared budget without starting a worker", function () {
    const original = GaussianSplatPrimitive.maximumCacheByteLength;
    const ready = GaussianSplatSorter._taskProcessorReady;
    GaussianSplatSorter._taskProcessorReady = false;
    try {
      for (const value of [
        -1,
        0.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        "128",
      ]) {
        expect(() => {
          GaussianSplatPrimitive.maximumCacheByteLength = value;
        }).toThrow();
      }
      GaussianSplatPrimitive.maximumCacheByteLength = 0;
      expect(GaussianSplatSorter.maximumCacheByteLength).toBe(0);
      GaussianSplatPrimitive.maximumCacheByteLength = 256 * 1024 * 1024;
      expect(GaussianSplatSorter.maximumCacheByteLength).toBe(
        256 * 1024 * 1024,
      );
    } finally {
      GaussianSplatPrimitive.maximumCacheByteLength = original;
      GaussianSplatSorter._taskProcessorReady = ready;
    }
  });
  it("delivers budget changes after capacity returns and during a control task", async function () {
    const original = GaussianSplatPrimitive.maximumCacheByteLength;
    const ready = GaussianSplatSorter._taskProcessorReady;
    const processor = GaussianSplatSorter._sorterTaskProcessor;
    let capacity = false;
    const tasks = [];
    const fake = {
      scheduleTask(parameters) {
        if (!capacity) {
          return undefined;
        }
        tasks.push(parameters);
        return Promise.resolve();
      },
    };
    spyOn(GaussianSplatSorter, "_getSorterTaskProcessor").and.returnValue(fake);
    GaussianSplatSorter._sorterTaskProcessor = fake;
    GaussianSplatSorter._taskProcessorReady = true;
    try {
      GaussianSplatPrimitive.maximumCacheByteLength = 0;
      expect(tasks.length).toBe(0);
      capacity = true;
      await GaussianSplatSorter.radixSortIndexes({
        primitive: { positions: new Float32Array(3) },
        sortType: "Index",
        positionsKey: 987654,
      });
      expect(tasks[0].cacheByteBudget).toBe(0);
      GaussianSplatPrimitive.maximumCacheByteLength = 16;
      GaussianSplatPrimitive.maximumCacheByteLength = 32;
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
      }
      expect(tasks[tasks.length - 1].cacheByteBudget).toBe(32);
    } finally {
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
      }
      GaussianSplatSorter._taskProcessorReady = false;
      GaussianSplatPrimitive.maximumCacheByteLength = original;
      GaussianSplatSorter._sorterTaskProcessor = processor;
      GaussianSplatSorter._taskProcessorReady = ready;
    }
  });
});
