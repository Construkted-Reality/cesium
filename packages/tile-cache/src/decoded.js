import { LRUCache } from "lru-cache";

const installed = new WeakMap();

// This adapter uses private Cesium loader APIs. Pin and test the Cesium build.
export function retainDecodedResources(Cesium, options) {
  const {
    maximumBytes,
    urlPrefix,
    canvas,
    geometry = true,
    textures = true,
  } = options;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("maximumBytes must be a positive safe integer");
  }
  const prefix = new URL(urlPrefix);
  if (
    !/^https?:$/.test(prefix.protocol) ||
    !prefix.pathname.endsWith("/") ||
    prefix.search ||
    prefix.hash
  ) {
    throw new Error("Use an immutable HTTP asset directory as urlPrefix");
  }
  if (!canvas?.addEventListener || (!geometry && !textures)) {
    throw new Error("Provide the viewer canvas and at least one resource type");
  }
  const cache = Cesium.ResourceCache;
  if (installed.has(cache)) {
    throw new Error("A decoded resource cache is already installed");
  }
  const originalGet = cache.get;
  const originalUnload = cache.unload;
  const buffers = new Map();
  let imageBytes = 0;
  let suspended = false;
  let destroyed = false;
  const counters = {
    geometry: { hits: 0, admissions: 0, evictions: 0 },
    textures: { hits: 0, admissions: 0, evictions: 0 },
    oversized: 0,
  };
  const held = new LRUCache({
    maxSize: maximumBytes,
    sizeCalculation: (entry) => entry.bytes,
    disposeAfter(entry) {
      counters[entry.kind].evictions++;
      for (const buffer of entry.buffers) {
        const count = buffers.get(buffer) - 1;
        if (count) {
          buffers.set(buffer, count);
        } else {
          buffers.delete(buffer);
        }
      }
      imageBytes -= entry.imageBytes;
      originalUnload(entry.loader);
    },
  });
  function describe(loader) {
    if (!loader._gltfResource?.url.startsWith(prefix.href)) {
      return;
    }
    if (loader._state !== Cesium.ResourceLoaderState.READY) {
      return;
    }
    let arrays;
    let kind;
    let estimatedImageBytes = 0;
    if (
      geometry &&
      loader instanceof Cesium.GltfDracoLoader &&
      loader.decodedData
    ) {
      kind = "geometry";
      arrays = [
        loader.decodedData.indices.typedArray,
        ...Object.values(loader.decodedData.vertexAttributes).map(
          (attribute) => attribute.array,
        ),
      ];
    } else if (
      textures &&
      loader instanceof Cesium.GltfImageLoader &&
      loader.image
    ) {
      kind = "textures";
      const image = loader.image;
      if (ArrayBuffer.isView(image.bufferView)) {
        arrays = [image.bufferView, ...(loader.mipLevels || [])];
      } else if (
        (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) ||
        (typeof HTMLImageElement !== "undefined" &&
          image instanceof HTMLImageElement)
      ) {
        estimatedImageBytes = image.width * image.height * 4;
        arrays = [];
      } else {
        return;
      }
    } else {
      return;
    }
    const backing = new Set(arrays.map((array) => array.buffer));
    const bytes = [...backing].reduce(
      (sum, buffer) => sum + buffer.byteLength,
      estimatedImageBytes,
    );
    return {
      loader,
      kind,
      buffers: backing,
      bytes,
      imageBytes: estimatedImageBytes,
    };
  }
  function get(key) {
    const loader = originalGet(key);
    const entry = held.get(key);
    if (loader && entry) {
      counters[entry.kind].hits++;
    }
    return loader;
  }
  function unload(loader) {
    const current = cache.cacheEntries[loader.cacheKey];
    if (
      !suspended &&
      !destroyed &&
      current?.referenceCount === 1 &&
      !held.has(loader.cacheKey)
    ) {
      const entry = describe(loader);
      if (entry?.bytes > maximumBytes) {
        counters.oversized++;
      } else if (entry?.bytes > 0) {
        originalGet(loader.cacheKey);
        for (const buffer of entry.buffers) {
          buffers.set(buffer, (buffers.get(buffer) || 0) + 1);
        }
        imageBytes += entry.imageBytes;
        held.set(loader.cacheKey, entry);
        counters[entry.kind].admissions++;
      }
    }
    return originalUnload(loader);
  }
  function clear() {
    suspended = true;
    try {
      held.clear();
    } finally {
      suspended = false;
    }
  }
  function contextLost() {
    clear();
  }
  canvas.addEventListener("webglcontextlost", contextLost);
  cache.get = get;
  cache.unload = unload;
  const controller = {
    clear,
    stats() {
      const byKind = {
        geometry: { ...counters.geometry, entries: 0, chargedBytes: 0 },
        textures: { ...counters.textures, entries: 0, chargedBytes: 0 },
      };
      for (const entry of held.values()) {
        byKind[entry.kind].entries++;
        byKind[entry.kind].chargedBytes += entry.bytes;
      }
      return {
        maximumBytes,
        chargedBytes: held.calculatedSize,
        uniquePayloadBytes: [...buffers.keys()].reduce(
          (sum, buffer) => sum + buffer.byteLength,
          imageBytes,
        ),
        entries: held.size,
        oversized: counters.oversized,
        ...byKind,
        destroyed,
        accounting:
          "Full backing buffers; shared buffers charged once per entry. Ordinary image pixels estimated as RGBA. Loader and browser overhead excluded.",
      };
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      canvas.removeEventListener("webglcontextlost", contextLost);
      cache.get = originalGet;
      cache.unload = originalUnload;
      clear();
      installed.delete(cache);
    },
  };
  installed.set(cache, controller);
  return controller;
}
