// Static file server for the splat performance harness.
//
// Serves two roots:
//   /            -> the CesiumJS repository root (Build output, harness page)
//   /splat-data  -> the tileset directory given by --data
//
// The Cesium development server rebuilds on every request, which adds noise to
// a benchmark run. This server only reads files from disk.
import express from "express";
import compression from "compression";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const options = { port: 8099, data: "/mnt/data2/gs" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") {
      options.port = Number(argv[++i]);
    } else if (argv[i] === "--data") {
      options.data = argv[++i];
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const app = express();

function setCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
}

app.use(compression());
app.use(
  "/splat-data",
  express.static(options.data, {
    setHeaders: (res, filePath) => {
      setCommonHeaders(res);
      if (filePath.endsWith(".glb") || filePath.endsWith(".gltf")) {
        res.setHeader("Content-Type", "model/gltf-binary");
      }
    },
  }),
);
app.use(express.static(repoRoot, { setHeaders: setCommonHeaders }));

app.listen(options.port, "0.0.0.0", () => {
  process.stdout.write(
    `splat-perf server: repo ${repoRoot}, data ${options.data}, port ${options.port}\n`,
  );
});
