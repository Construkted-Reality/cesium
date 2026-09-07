import GaussianSplatPositionCache from "../../Source/Core/GaussianSplatPositionCache.js";

describe("Core/GaussianSplatPositionCache", function () {
  it("evicts by bytes and refreshes access order", function () {
    const cache = new GaussianSplatPositionCache(32);
    const a = new Float32Array(4);
    cache.set(1, a);
    cache.set(2, new Float32Array(4));
    expect(cache.get(1)).toBe(a);
    cache.set(3, new Float32Array(4));
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe(a);
    expect(cache.byteLength).toBe(32);
  });
  it("does not evict residents for oversized inputs", function () {
    const cache = new GaussianSplatPositionCache(16);
    const resident = new Float32Array(4);
    cache.set(1, resident);
    cache.set(2, new Float32Array(5));
    expect(cache.get(1)).toBe(resident);
    expect(cache.get(2)).toBeUndefined();
    expect(cache.byteLength).toBe(16);
  });
  it("releases and replaces entries without double counting", function () {
    const cache = new GaussianSplatPositionCache(32);
    cache.set(1, new Float32Array(4));
    cache.set(1, new Float32Array(2));
    expect(cache.byteLength).toBe(8);
    cache.remove(1);
    cache.remove(1);
    expect(cache.byteLength).toBe(0);
  });
  it("retains more than three small generations within the budget", function () {
    const cache = new GaussianSplatPositionCache(128);
    for (let key = 1; key <= 16; key++) {
      cache.set(key, new Float32Array(2));
    }
    for (let key = 1; key <= 16; key++) {
      expect(cache.get(key)).toBeDefined();
    }
    expect(cache.byteLength).toBe(128);
  });
});
