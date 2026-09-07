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

  resize(maximumByteLength) {
    this.maximumByteLength = maximumByteLength;
    while (this.byteLength > maximumByteLength) {
      this.remove(this._entries.keys().next().value);
    }
  }

  remove(key) {
    const positions = this._entries.get(key);
    if (defined(positions)) {
      this.byteLength -= positions.buffer.byteLength;
      this._entries.delete(key);
    }
  }

  set(key, positions) {
    this.remove(key);
    // Count backing storage, including any bytes outside a subarray view.
    // Oversized inputs can be sorted directly without evicting resident sets.
    if (positions.buffer.byteLength > this.maximumByteLength) {
      return;
    }
    while (
      this.byteLength + positions.buffer.byteLength >
      this.maximumByteLength
    ) {
      this.remove(this._entries.keys().next().value);
    }
    this._entries.set(key, positions);
    this.byteLength += positions.buffer.byteLength;
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
