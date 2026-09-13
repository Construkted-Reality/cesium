// Build a diagnostic copy of the current worker. Engine sources stay unchanged.
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const path = "packages/engine/Source/Workers/decodeDraco.js";
let source = await readFile(path, "utf8");
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`Worker source changed: ${before}`);
  }
  source = source.replace(before, after);
}
replaceOnce("let draco;", `let draco;
let stages;
let verifyExtraction;
function measured(name, fn) {
  if (!stages) return fn();
  const start = performance.now();
  try { return fn(); } finally {
    stages[name] = (stages[name] || 0) + performance.now() - start;
  }
}`);
for (const name of ["decodeIndexArray", "decodeAttribute"]) {
  replaceOnce(`function ${name}(`, `function original_${name}(`);
  source += `\nfunction ${name}(...args) { return measured("${name}", () => original_${name}(...args)); }\n`;
}
replaceOnce("dracoDecoder.DecodeBufferToMesh(buffer, dracoGeometry)",
  'measured("codec", () => dracoDecoder.DecodeBufferToMesh(buffer, dracoGeometry))');
replaceOnce("return decode(parameters, transferableObjects);", `
  verifyExtraction = parameters.verifyExtraction;
  stages = parameters.profile ? {} : undefined;
  const start = performance.now();
  const result = await decode(parameters, transferableObjects);
  if (stages) {
    result.__dracoTest = { ...stages, total: performance.now() - start,
      verified: !!verifyExtraction,
      wasmHeapBytes: draco.HEAPU8.buffer.byteLength,
      decodedBytes: result.indexArray.typedArray.byteLength + Object.values(result.attributeData).reduce((sum, a) => sum + a.array.byteLength, 0) };
  }
  stages = undefined;
  return result;`);
async function buildWorker(name) {
await build({
  stdin: { contents: source, resolveDir: "packages/engine/Source/Workers", sourcefile: "draco-diagnostic.js" },
  outfile: `Build/TileCache/draco-${name}.js`, bundle: true, format: "iife", platform: "browser", external: ["fs", "path"],
});

}
await buildWorker("legacy");
replaceOnce('() => original_decodeIndexArray(...args)', '() => bulk_decodeIndexArray(...args)');
for (const name of ["decodeQuantizedDracoTypedArray", "decodeDracoTypedArray"]) {
  replaceOnce(`function ${name}(`, `function original_${name}(`);
  source += `\nfunction ${name}(...args) { return bulk_${name}(...args); }\n`;
}
source += (await readFile("tools/tile-cache/draco-bulk.js", "utf8")).replaceAll("export function", "function");
await buildWorker("bulk");
