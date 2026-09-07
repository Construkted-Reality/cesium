import defined from "./defined.js";

/** A byte-bounded least-recently-used cache of worker position arrays. @private */
class GaussianSplatPositionCache {
  constructor(
    maximumByteLength = GaussianSplatPositionCache.maximumByteLength,
  ) {
    this.maximumByteLength = maximumByteLength;
    this.byteLength = 0;
    this._entries = new Map();
  }

  remove(key) {
    const positions = this._entries.get(key);
    if (defined(positions)) {
      this.byteLength -= positions.byteLength;
      this._entries.delete(key);
    }
  }

  set(key, positions) {
    this.remove(key);
    // Oversized inputs can be sorted directly without evicting resident sets.
    if (positions.byteLength > this.maximumByteLength) {
      return;
    }
    while (this.byteLength + positions.byteLength > this.maximumByteLength) {
      this.remove(this._entries.keys().next().value);
    }
    this._entries.set(key, positions);
    this.byteLength += positions.byteLength;
  }

  get(key) {
    const positions = this._entries.get(key);
    if (defined(positions)) {
      this._entries.delete(key);
      this._entries.set(key, positions);
    }
    return positions;
  }
}

GaussianSplatPositionCache.maximumByteLength = 128 * 1024 * 1024;
export default GaussianSplatPositionCache;
