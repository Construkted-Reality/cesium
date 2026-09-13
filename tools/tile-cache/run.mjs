import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir, hostname, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const output = resolve(
  options.output || "/tmp/cesium-tile-cache-2026-09-12/baseline.json",
);
const repetitions = Number(options.repetitions || 5);
const software = options.software === "true";
const backend = software ? "swiftshader" : options.backend || "gl";
assert.ok(["gl", "vulkan", "swiftshader"].includes(backend), "Unknown backend");
const launchArgs = software
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : backend === "vulkan"
    ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu"]
    : ["--use-angle=gl", "--ignore-gpu-blocklist"];
assert.ok(
  Number.isSafeInteger(repetitions) && repetitions > 0,
  "repetitions must be a positive integer",
);
assert.ok(
  [undefined, "baseline", "cache", "retention", "decoded"].includes(
    options.phase,
  ),
  "Unknown test phase",
);
assert.ok(
  Number.isFinite(Number(options.latency || 100)) &&
    Number(options.latency || 100) >= 0,
  "latency must be nonnegative",
);
assert.ok(
  Number.isFinite(Number(options.idleMs || 0)) &&
    Number(options.idleMs || 0) >= 0,
  "idleMs must be nonnegative",
);
const appServer = await startServer({
  latencyMs: Number(options.latency || 100),
  textureSize: Number(options.textureSize || 512),
});
const server =
  options.crossOrigin === "true"
    ? await startServer({
        latencyMs: Number(options.latency || 100),
        textureSize: Number(options.textureSize || 512),
        cors: true,
      })
    : appServer;
const report = {
  startedAt: new Date().toISOString(),
  host: hostname(),
  addresses: networkInterfaces(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  configuration: {
    repetitions,
    software,
    backend,
    launchArgs,
    latencyMs: server.state.latencyMs,
    textureSize: Number(options.textureSize || 512),
    viewport: { width: 800, height: 600 },
    synthetic: true,
    crossOrigin: options.crossOrigin === "true",
    idleMs: Number(options.idleMs || 0),
  },
  runs: [],
};
report.sourceHashes = {};
for (const path of [
  "Build/CesiumUnminified/Cesium.js",
  "Build/TileCache/worker.js",
  "Build/TileCache/decoded-images.js",
  "tools/tile-cache/harness.js",
  "tools/tile-cache/instrument.js",
  "tools/tile-cache/run.mjs",
  "tools/tile-cache/fixture.mjs",
  "tools/tile-cache/server.mjs",
]) {
  try {
    report.sourceHashes[path] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    report.sourceHashes[path] = null;
  }
}
let configurations = [
  { name: "http-disabled-small", httpCache: false, cacheBytes: 1 },
  { name: "http-enabled-small", httpCache: true, cacheBytes: 1 },
  {
    name: "http-disabled-large",
    httpCache: false,
    cacheBytes: 256 * 1024 * 1024,
  },
];
if (options.phase === "cache") {
  configurations = [
    { name: "disk", httpCache: false, cacheBytes: 1, memoryBytes: 0 },
    {
      name: "ram-disk",
      httpCache: false,
      cacheBytes: 1,
      memoryBytes: 16 * 1024 * 1024,
    },
  ];
}

async function enableCache(page, configuration) {
  if (configuration.memoryBytes === undefined) {
    return;
  }
  await page.evaluate(async (config) => {
    await window.harness.enableCache({
      workerUrl: "/Build/TileCache/worker.js",
      urlPrefix: config.urlPrefix,
      scope: "fixture",
      version: "v1",
      memoryBytes: config.memoryBytes,
      diskBytes: config.diskBytes ?? 32 * 1024 * 1024,
      policy: config.policy ?? "lru",
    });
  }, configuration);
}

if (options.phase === "decoded") {
  configurations = [
    {
      name: "ram-disk",
      httpCache: false,
      cacheBytes: 1,
      memoryBytes: 16 * 1024 * 1024,
    },
    {
      name: "ram-disk-decoded",
      httpCache: false,
      cacheBytes: 1,
      memoryBytes: 16 * 1024 * 1024,
      decodedBytes: 16 * 1024 * 1024,
    },
  ];
}
if (options.phase === "retention") {
  configurations = ["lru", "revisited"].map((policy) => ({
    name: `retention-${policy}`,
    policy,
    httpCache: false,
    cacheBytes: 1,
    memoryBytes: 0,
    diskBytes: 2 * 1024 * 1024,
  }));
}
for (const configuration of configurations) {
  configuration.instrument = options.instrument === "true";
}

async function save() {
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}

try {
  for (const configuration of configurations) {
    configuration.url = `${server.url}/tile-data/v1/tileset.json`;
    configuration.urlPrefix = `${server.url}/tile-data/v1/`;
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const profile = await mkdtemp(join(tmpdir(), "cesium-cache-"));
      const launchOptions = {
        channel: "chromium",
        headless: true,
        viewport: report.configuration.viewport,
        deviceScaleFactor: 1,
        args: launchArgs,
      };
      let context = await chromium.launchPersistentContext(
        profile,
        launchOptions,
      );
      try {
        const page = context.pages()[0];
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", {
          cacheDisabled: !configuration.httpCache,
        });
        await page.goto(`${appServer.url}/tools/tile-cache/harness.html`);
        await page.waitForFunction(() => !!window.harness);
        await enableCache(page, configuration);
        const environment = await page.evaluate(
          (config) => window.harness.setup(config),
          configuration,
        );
        assert.ok(
          software ||
            !/swiftshader|llvmpipe|software/i.test(environment.renderer),
          `Hardware GPU required: ${environment.renderer}`,
        );
        const run = {
          configuration,
          repetition,
          environment,
          browser: context.browser()?.version(),
          visits: [],
          errors,
        };
        report.runs.push(run);
        for (const index of [0, 1, 0]) {
          if (run.visits.length === 2 && report.configuration.idleMs) {
            await new Promise((done) =>
              setTimeout(done, report.configuration.idleMs),
            );
          }
          const requestStart = server.state.requests.length;
          const visit = await page.evaluate(
            (index) => window.harness.visit(index),
            index,
          );
          visit.serverRequests = server.state.requests.slice(requestStart);
          if (configuration.memoryBytes !== undefined) {
            visit.cache = await page.evaluate(() => window.tileCache.stats());
          }
          visit.imageHash = createHash("sha256")
            .update(await page.locator("canvas").first().screenshot())
            .digest("hex");
          assert.ok(
            visit.visible.some((url) => url.endsWith(`/${index}.gltf`)),
            `Expected tile ${index}, saw ${visit.visible}`,
          );
          run.visits.push(visit);
        }
        assert.equal(
          run.visits[0].imageHash,
          run.visits[2].imageHash,
          "Returned view must have identical pixels",
        );
        const returned = run.visits[2];
        if (configuration.cacheBytes === 1) {
          assert.ok(
            run.visits[1].events.some(
              (event) =>
                event.name === "unload" && event.url.endsWith("/0.gltf"),
            ),
            "A must be evicted at B",
          );
          assert.ok(
            returned.events.some((event) => event.name === "load"),
            "A must reload",
          );
        } else {
          assert.equal(
            returned.events.filter((event) => event.name === "load").length,
            0,
          );
        }
        assert.equal(
          returned.serverRequests.length,
          configuration.name === "http-disabled-small" ? 3 : 0,
        );
        assert.deepEqual(errors, []);
        if (options.phase === "retention") {
          run.journey = [];
          for (const index of [2, 3, 4, 5, 6, 7, 0]) {
            const requestStart = server.state.requests.length;
            const visit = await page.evaluate(
              (index) => window.harness.visit(index),
              index,
            );
            visit.cache = await page.evaluate(() => window.tileCache.stats());
            visit.serverRequests = server.state.requests.slice(requestStart);
            run.journey.push(visit);
          }
          const final = run.journey.at(-1);
          assert.equal(
            final.serverRequests.length,
            configuration.policy === "revisited" ? 0 : 3,
          );
          assert.ok(final.cache.diskBytes <= configuration.diskBytes);
          run.journeyImageHash = createHash("sha256")
            .update(await page.locator("canvas").first().screenshot())
            .digest("hex");
          assert.equal(run.journeyImageHash, run.visits[0].imageHash);
        }
        if (configuration.decodedBytes) {
          assert.ok(returned.decoded.hits > 0, "Decoded image must be reused");
          assert.ok(returned.decoded.bytes <= configuration.decodedBytes);
        }
        run.cleanup = await page.evaluate(() => window.harness.dispose());
        assert.equal(
          run.cleanup.loaders,
          0,
          "Loader references leaked after teardown",
        );
        if (
          configuration.memoryBytes !== undefined &&
          options.phase !== "retention"
        ) {
          assert.equal(returned.cache.errors, 0);
          assert.ok(
            configuration.memoryBytes === 0
              ? returned.cache.diskHits >= 3
              : returned.cache.memoryHits +
                  (report.configuration.idleMs ? returned.cache.diskHits : 0) >=
                  (configuration.decodedBytes ? 2 : 3),
          );
          // Same profile and origin, entirely new browser process. No HTTP cache.
          await context.close();
          server.state.offline = true;
          context = await chromium.launchPersistentContext(
            profile,
            launchOptions,
          );
          const restarted = context.pages()[0];
          const restartedCdp = await context.newCDPSession(restarted);
          await restartedCdp.send("Network.enable");
          await restartedCdp.send("Network.setCacheDisabled", {
            cacheDisabled: true,
          });
          await restarted.goto(
            `${appServer.url}/tools/tile-cache/harness.html`,
          );
          await restarted.waitForFunction(() => !!window.harness);
          await enableCache(restarted, configuration);
          const requestStart = server.state.requests.length;
          await restarted.evaluate(
            (config) => window.harness.setup(config),
            configuration,
          );
          run.restart = await restarted.evaluate(() => window.harness.visit(0));
          run.restart.cache = await restarted.evaluate(() =>
            window.tileCache.stats(),
          );
          run.restart.serverRequests =
            server.state.requests.slice(requestStart);
          run.restart.imageHash = createHash("sha256")
            .update(await restarted.locator("canvas").first().screenshot())
            .digest("hex");
          assert.equal(run.restart.imageHash, run.visits[0].imageHash);
          assert.equal(
            run.restart.serverRequests.length,
            0,
            "Restart must use persisted content without a server request",
          );
          assert.ok(
            run.restart.cache.diskHits >= 4,
            "Manifest, tile, geometry and image must persist",
          );
          server.state.offline = false;
        }
        console.log(
          JSON.stringify({
            configuration: configuration.name,
            repetition,
            returnMs: returned.settleMs,
            networkRequests: returned.serverRequests.length,
            renderer: environment.renderer,
          }),
        );
        await save();
      } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
      }
    }
  }
} catch (error) {
  report.error = String(error.stack);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await save();
  await server.close();
  if (server !== appServer) {
    await appServer.close();
  }
}
