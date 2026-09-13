import { LRUCache } from "lru-cache";

// Harness-only experiment: hold decoded image loaders, never GPU textures.
export function retainDecodedImages(Cesium, maximumBytes) {
  const cache = Cesium.ResourceCache;
  const originalGet = cache.get;
  const originalUnload = cache.unload;
  const stats = { hits: 0, admissions: 0, evictions: 0 };
  const held = new LRUCache({
    maxSize: maximumBytes,
    sizeCalculation: (entry) => entry.bytes,
    disposeAfter: (entry) => {
      stats.evictions++;
      originalUnload(entry.loader);
    },
  });
  cache.get = function (key) {
    const loader = originalGet(key);
    if (loader && held.get(key)) {
      stats.hits++;
    }
    return loader;
  };
  cache.unload = function (loader) {
    const entry = cache.cacheEntries[loader.cacheKey];
    if (
      loader instanceof Cesium.GltfImageLoader &&
      entry?.referenceCount === 1 &&
      !held.has(loader.cacheKey)
    ) {
      const image = loader.image;
      if (image instanceof ImageBitmap || image instanceof HTMLImageElement) {
        const bytes = image.width * image.height * 4;
        if (bytes > 0 && bytes <= maximumBytes) {
          originalGet(loader.cacheKey);
          held.set(loader.cacheKey, { loader, bytes });
          stats.admissions++;
        }
      }
    }
    return originalUnload(loader);
  };
  return {
    stats: () => ({
      ...stats,
      bytes: held.calculatedSize,
      entries: held.size,
      byteAccounting:
        "RGBA pixel estimate; excludes browser image and loader overhead",
    }),
    destroy() {
      cache.get = originalGet;
      cache.unload = originalUnload;
      held.clear();
    },
  };
}
