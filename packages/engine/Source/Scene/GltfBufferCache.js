import defined from "../Core/defined.js";

const entries = new Map();

/**
 * Shares GPU buffers between glTF loaders with different CPU retention policies.
 * Entries remain only while loaders own their buffers.
 * @private
 */
const GltfBufferCache = {
  acquire(key) {
    const entry = entries.get(key);
    if (defined(entry)) {
      ++entry.references;
      return entry.buffer;
    }
    return undefined;
  },
  add(key, buffer) {
    if (defined(key)) {
      entries.set(key, { buffer: buffer, references: 1 });
    }
  },
  release(key) {
    const entry = entries.get(key);
    if (--entry.references === 0) {
      entry.buffer.destroy();
      entries.delete(key);
    }
  },
};
export default GltfBufferCache;
