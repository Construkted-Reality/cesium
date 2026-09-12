import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createFixture } from "./fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

export async function startServer({
  port = 0,
  latencyMs = 100,
  textureSize = 512,
  cors = false,
} = {}) {
  const fixture = createFixture({ textureSize });
  const state = { offline: false, requests: [], latencyMs };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (cors) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, X-Account");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
    }
    res.setHeader("Timing-Allow-Origin", "*");
    const prefix = "/tile-data/";
    if (url.pathname.startsWith(prefix)) {
      const record = {
        path: url.pathname,
        startedAt: Date.now(),
        bytes: 0,
        status: null,
        aborted: false,
      };
      state.requests.push(record);
      res.on("close", () => {
        record.aborted = !res.writableFinished;
      });
      await new Promise((done) => setTimeout(done, state.latencyMs));
      let bytes = fixture.get(url.pathname.split("/").at(-1));
      if (url.pathname.endsWith("/identity.bin")) {
        bytes = Buffer.from(req.headers["x-account"] || "public");
      }
      record.status = state.offline ? 503 : bytes ? 200 : 404;
      res.statusCode = record.status;
      res.setHeader(
        "Cache-Control",
        state.offline || url.searchParams.get("cache") === "no-store"
          ? "no-store"
          : "public, max-age=31536000, immutable",
      );
      if (req.headers.range && record.status === 200) {
        record.status = 206;
        res.statusCode = 206;
        res.setHeader(
          "Content-Range",
          `bytes 0-${bytes.length - 1}/${bytes.length}`,
        );
      }
      res.setHeader(
        "Content-Type",
        mime[extname(url.pathname)] || "application/octet-stream",
      );
      const body =
        record.status === 200 || record.status === 206
          ? bytes
          : Buffer.from("Unavailable");
      res.setHeader("Content-Length", body.length);
      res.on("finish", () => {
        record.bytes = body.length;
        record.finishedAt = Date.now();
      });
      res.end(body);
      return;
    }
    try {
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (
        !path.startsWith(root.endsWith(sep) ? root : root + sep) ||
        !["/Build/", "/tools/tile-cache/", "/node_modules/"].some((prefix) =>
          url.pathname.startsWith(prefix),
        )
      ) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader(
        "Content-Type",
        mime[extname(path)] || "application/octet-stream",
      );
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}
