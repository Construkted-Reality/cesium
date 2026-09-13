/* global Cesium */
export async function runDecodedContracts() {
  const moduleUrl = new URL(
    "../../Build/TileCache/decoded-resources.js",
    import.meta.url,
  );
  const { retainDecodedResources } = await import(moduleUrl.href);
  const cache = Cesium.ResourceCache;
  const nativeGet = cache.get;
  const nativeUnload = cache.unload;
  const canvas = document.createElement("canvas");
  const prefix = "https://example.test/immutable-v1/";
  const results = [];
  let serial = 0;
  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
  function geometry(buffer = new ArrayBuffer(64), url = `${prefix}tile.glb`) {
    const resource = new Cesium.Resource(url);
    const loader = new Cesium.GltfDracoLoader({
      resourceCache: cache,
      gltf: {},
      primitive: {},
      draco: {},
      gltfResource: resource,
      baseResource: resource,
      cacheKey: `contract-${serial++}`,
    });
    loader._state = Cesium.ResourceLoaderState.READY;
    loader._decodedData = {
      indices: { typedArray: new Uint16Array(buffer, 0, 8) },
      vertexAttributes: { POSITION: { array: new Uint8Array(buffer) } },
    };
    return cache.add(loader);
  }
  function texture() {
    const resource = new Cesium.Resource(`${prefix}tile.glb`);
    const loader = new Cesium.GltfImageLoader({
      resourceCache: cache,
      gltf: { images: [{ uri: "image.ktx2" }] },
      imageId: 0,
      gltfResource: resource,
      baseResource: resource,
      cacheKey: `contract-${serial++}`,
    });
    const buffer = new ArrayBuffer(64);
    loader._image = new Cesium.CompressedTextureBuffer(
      Cesium.PixelFormat.RGB_DXT1,
      Cesium.PixelDatatype.UNSIGNED_BYTE,
      8,
      8,
      new Uint8Array(buffer, 0, 48),
    );
    loader._mipLevels = [new Uint8Array(buffer, 48, 16)];
    loader._state = Cesium.ResourceLoaderState.READY;
    return cache.add(loader);
  }
  function test(name, action, options = {}) {
    const original = cache.get;
    const controller = retainDecodedResources(Cesium, {
      maximumBytes: 128,
      urlPrefix: prefix,
      canvas,
      ...options,
    });
    try {
      action(controller);
    } finally {
      controller.destroy();
    }
    assert(cache.get === original, "Must restore ResourceCache methods");
    assert(
      Object.keys(cache.cacheEntries).length === 0,
      "Must release all loaders",
    );
    assert(
      controller.stats().uniquePayloadBytes === 0,
      "Must release payload references",
    );
    results.push({ name, passed: true });
  }
  test("shared backing buffers, lookup, and clearing", (controller) => {
    const buffer = new ArrayBuffer(64);
    const a = geometry(buffer),
      b = geometry(buffer);
    cache.unload(a);
    cache.unload(b);
    assert(
      controller.stats().chargedBytes === 128,
      "Charge each entry conservatively",
    );
    assert(
      controller.stats().uniquePayloadBytes === 64,
      "Count a shared backing buffer once",
    );
    assert(cache.get(a.cacheKey) === a, "Reuse the same decoded result");
    controller.clear();
    assert(
      !a.isDestroyed() && b.isDestroyed(),
      "Clear must preserve a live caller reference",
    );
    cache.unload(a);
  });
  test("LRU eviction preserves live renderer references", (controller) => {
    const a = geometry(),
      b = geometry();
    cache.unload(a);
    cache.unload(b);
    cache.get(a.cacheKey); // A becomes most recently used and has a live caller.
    const c = geometry();
    cache.unload(c);
    assert(
      b.isDestroyed() && !a.isDestroyed(),
      "Evict the least recently used entry",
    );
    assert(controller.stats().chargedBytes === 128, "Respect the byte budget");
    controller.clear();
    assert(!a.isDestroyed(), "A remains valid for its caller");
    controller.destroy();
    cache.unload(a);
  });
  test("oversized entries and other asset scopes bypass retention", (controller) => {
    const large = geometry(new ArrayBuffer(256));
    cache.unload(large);
    const outside = geometry(
      new ArrayBuffer(64),
      "https://example.test/immutable-v2/tile.glb",
    );
    cache.unload(outside);
    assert(
      large.isDestroyed() && outside.isDestroyed(),
      "Bypassed loaders must be released",
    );
    assert(
      controller.stats().oversized === 1 && controller.stats().entries === 0,
      "Track oversized bypasses",
    );
  });
  test("incomplete and failed results are not retained", (controller) => {
    for (const state of [
      Cesium.ResourceLoaderState.PROCESSING,
      Cesium.ResourceLoaderState.FAILED,
    ]) {
      const loader = geometry();
      loader._state = state;
      cache.unload(loader);
      assert(loader.isDestroyed(), "Do not retain unfinished or failed data");
    }
    assert(controller.stats().entries === 0, "Cache stays empty");
  });
  test("texture mip levels retain their shared backing buffer", (controller) => {
    const loader = texture();
    cache.unload(loader);
    assert(
      controller.stats().textures.chargedBytes === 64,
      "Count all mip storage without double counting",
    );
    assert(
      cache.get(loader.cacheKey).mipLevels[0].byteLength === 16,
      "Preserve mip levels",
    );
    cache.unload(loader);
  });
  test(
    "resource-type switches isolate geometry and textures",
    (controller) => {
      const a = geometry(),
        b = texture();
      cache.unload(a);
      cache.unload(b);
      assert(
        a.isDestroyed() && !b.isDestroyed(),
        "Texture-only mode must not retain geometry",
      );
      assert(controller.stats().geometry.entries === 0, "No geometry entries");
    },
    { geometry: false },
  );
  test("context loss clears entries and suspends admissions", (controller) => {
    const a = texture();
    cache.unload(a);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    assert(
      a.isDestroyed() && controller.stats().entries === 0,
      "Clear incompatible context data",
    );
    const b = texture();
    cache.unload(b);
    assert(b.isDestroyed(), "Do not admit while the context is lost");
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    const c = texture();
    cache.unload(c);
    assert(!c.isDestroyed(), "Resume admission after restoration");
  });
  canvas.width = canvas.height = 2;
  const bitmap = await createImageBitmap(canvas);
  test("ordinary decoded bitmap retention", (controller) => {
    const loader = texture();
    loader._image = bitmap;
    loader._mipLevels = undefined;
    cache.unload(loader);
    assert(
      controller.stats().textures.chargedBytes === 16,
      "Estimate ordinary image pixels as RGBA",
    );
    assert(
      cache.get(loader.cacheKey).image === bitmap,
      "Reuse the decoded bitmap object",
    );
    cache.unload(loader);
  });
  bitmap.close();
  test("duplicate installation fails and destroy is idempotent", (controller) => {
    let rejected = false;
    try {
      retainDecodedResources(Cesium, {
        maximumBytes: 128,
        urlPrefix: prefix,
        canvas,
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "Reject overlapping adapters");
    controller.destroy();
    controller.destroy();
  });
  test("destroy preserves subsequently installed hooks", (controller) => {
    const get = cache.get;
    const unload = cache.unload;
    const wrapperGet = (key) => get(key);
    const wrapperUnload = (loader) => unload(loader);
    cache.get = wrapperGet;
    cache.unload = wrapperUnload;
    controller.destroy();
    assert(
      cache.get === wrapperGet && cache.unload === wrapperUnload,
      "Preserve another adapter's hooks",
    );
    // Restore the native methods saved before the tests, after removing this test's wrappers.
    cache.get = nativeGet;
    cache.unload = nativeUnload;
  });
  return results;
}
