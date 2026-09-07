import SpzDecoder from "../../Source/Scene/SpzDecoder.js";
import ResourceLoaderState from "../../Source/Scene/ResourceLoaderState.js";
import GltfSpzLoader, {
  estimateSpzMemoryBytes,
  getSpzInfoFromGltf,
} from "../../Source/Scene/GltfSpzLoader.js";

describe("Scene/GltfSpzLoader", function () {
  it("derives point count and spherical harmonics degree from glTF JSON", function () {
    const gltf = {
      accessors: [
        {
          count: 4913000,
        },
      ],
    };

    const primitive = {
      attributes: {
        POSITION: 0,
        _SH_DEGREE_1_COEF_0: 1,
        _SH_DEGREE_3_COEF_0: 2,
      },
    };

    expect(getSpzInfoFromGltf(gltf, primitive)).toEqual({
      numPoints: 4913000,
      shDegree: 3,
    });
  });

  it("returns undefined when glTF metadata needed for the estimate is missing", function () {
    const gltf = {
      accessors: [],
    };

    const primitive = {
      attributes: {},
    };

    expect(getSpzInfoFromGltf(gltf, primitive)).toBeUndefined();
  });

  it("estimates SPZ decode memory usage", function () {
    expect(estimateSpzMemoryBytes(4913000, 3)).toBe(2318936000);
  });

  it("loads the bufferView specified by the SPZ extension", async function () {
    const gltf = {};
    const primitive = {};
    const spz = {
      bufferView: 1,
    };
    const gltfResource = {};
    const baseResource = {};
    const bufferViewLoader = {
      typedArray: new Uint8Array([1, 2, 3, 4]),
      load: jasmine.createSpy("load").and.returnValue(Promise.resolve()),
    };
    const resourceCache = function () {};
    resourceCache.getBufferViewLoader = jasmine
      .createSpy("getBufferViewLoader")
      .and.returnValue(bufferViewLoader);
    resourceCache.unload = jasmine.createSpy("unload");

    const loader = new GltfSpzLoader({
      resourceCache: resourceCache,
      gltf: gltf,
      primitive: primitive,
      spz: spz,
      gltfResource: gltfResource,
      baseResource: baseResource,
    });

    await loader.load();

    expect(resourceCache.getBufferViewLoader).toHaveBeenCalledWith({
      gltf: gltf,
      bufferViewId: 1,
      gltfResource: gltfResource,
      baseResource: baseResource,
    });
  });
  function processingLoader() {
    const resourceCache = function () {};
    resourceCache.unload = jasmine.createSpy("unload");
    const loader = new GltfSpzLoader({
      resourceCache,
      gltf: {},
      primitive: { attributes: {} },
      spz: {},
      gltfResource: {},
      baseResource: {},
    });
    loader._state = ResourceLoaderState.PROCESSING;
    loader._bufferViewTypedArray = new Uint8Array([1, 2]);
    return loader;
  }

  it("retries busy workers and retains packed and expanded decoded data", async function () {
    const loader = processingLoader();
    const decode = spyOn(SpzDecoder, "decode").and.returnValue(undefined);
    expect(loader.process({})).toBe(false);
    expect(loader._decodePromise).toBeUndefined();
    const decoded = {
      gcloud: { sh: new Float32Array([1]) },
      packedSphericalHarmonics: new Uint32Array([2]),
    };
    decode.and.returnValue(Promise.resolve(decoded));
    loader.process({});
    await loader._decodePromise;
    expect(loader.process({})).toBe(true);
    expect(loader.decodedData).toBe(decoded);
    expect(decode.calls.count()).toBe(2);
    loader.destroy();
  });

  it("does not admit a destroyed waiting loader", function () {
    const loader = processingLoader();
    const decode = spyOn(SpzDecoder, "decode").and.returnValue(undefined);
    loader.process({});
    loader.destroy();
    expect(loader.isDestroyed()).toBe(true);
    expect(loader._bufferViewTypedArray).toBeUndefined();
    expect(decode.calls.count()).toBe(1);
  });

  it("ignores a decode result after destruction", async function () {
    const loader = processingLoader();
    let resolve;
    spyOn(SpzDecoder, "decode").and.returnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    loader.process({});
    const task = loader._decodePromise;
    loader.destroy();
    resolve({ gcloud: { sh: new Float32Array([1]) } });
    await task;
    expect(loader.decodedData).toBeUndefined();
  });

  it("reports a rejected decode through the loader error path", async function () {
    const loader = processingLoader();
    spyOn(SpzDecoder, "decode").and.returnValue(
      Promise.reject(new Error("bad SPZ")),
    );
    loader.process({});
    await loader._decodePromise;
    expect(() => loader.process({})).toThrowError(/Failed to load SPZ/);
    expect(loader._state).toBe(ResourceLoaderState.FAILED);
    loader.destroy();
  });
});
