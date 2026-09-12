// Optional probes. Image decode includes browser scheduling. WebGL timings measure
// synchronous API submission, not completion of work on the GPU.
export function instrument(Cesium, gl) {
  const samples = [];
  const restore = [];
  const bitmap = Cesium.Resource.createImageBitmapFromBlob;
  Cesium.Resource.createImageBitmapFromBlob = async function (...args) {
    const start = performance.now();
    try {
      return await bitmap.apply(this, args);
    } finally {
      samples.push({
        phase: "imageBitmapDecode",
        ms: performance.now() - start,
      });
    }
  };
  restore.push(() => {
    Cesium.Resource.createImageBitmapFromBlob = bitmap;
  });
  for (const name of [
    "texImage2D",
    "texSubImage2D",
    "compressedTexImage2D",
    "bufferData",
    "bufferSubData",
  ]) {
    const original = gl[name];
    gl[name] = function (...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        samples.push({ phase: `webgl.${name}`, ms: performance.now() - start });
      }
    };
    restore.push(() => {
      gl[name] = original;
    });
  }
  return {
    reset: () => {
      samples.length = 0;
    },
    snapshot: () => samples.slice(),
    destroy: () => restore.forEach((undo) => undo()),
  };
}
