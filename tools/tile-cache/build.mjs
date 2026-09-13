import { build } from "esbuild";
await build({
  entryPoints: ["tools/tile-cache/decoded-images.js"],
  outfile: "Build/TileCache/decoded-images.js",
  bundle: true,
  format: "esm",
  platform: "browser",
});
await build({
  entryPoints: ["packages/tile-cache/src/worker.js"],
  outfile: "Build/TileCache/worker.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
await build({
  entryPoints: ["packages/tile-cache/src/client.js"],
  outfile: "Build/TileCache/client.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  sourcemap: true,
});
await build({
  entryPoints: ["tools/tile-cache/profile-worker.js"],
  outfile: "Build/TileCache/profile-worker.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});

await build({
  entryPoints: ["packages/tile-cache/src/decoded.js"],
  outfile: "Build/TileCache/decoded-resources.js",
  bundle: true, format: "esm", platform: "browser",
});
