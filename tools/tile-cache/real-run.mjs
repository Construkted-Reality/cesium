import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { observeNetwork, summarizeNetwork } from "./network.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
const configPath = args.config || "tools/tile-cache/palace.json";
const asset = JSON.parse(await readFile(configPath, "utf8"));
const output = resolve(args.output || "/tmp/palace-cache/results.json");
const repetitions = Number(args.repetitions || 5);
assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0);
const idleMs = Number(args.idleMs || 0);
assert.ok(Number.isFinite(idleMs) && idleMs >= 0);
const draco = args.draco ? { extraction: args.draco, workers: Number(args.workers || 1), profile: args.pipeline === "true" } : undefined;
if (draco) {
  assert.ok(["legacy", "bulk"].includes(draco.extraction));
  assert.ok([1, 2, 4].includes(draco.workers));
}
const prefix = new URL("./", asset.url).href;
const launch = { channel: "chromium", headless: args.software === "true",
  viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
  args: args.software === "true" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : ["--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu", "--ozone-platform=wayland"] };
launch.args.push("--remote-debugging-port=0");
const conditions = [
  { name: "uncached", cacheBytes: 1, httpCache: false },
  { name: "http-cache", cacheBytes: 1, httpCache: true },
  { name: "resident", cacheBytes: asset.residentBytes, httpCache: false },
  { name: "disk", cacheBytes: 1, httpCache: false, memoryBytes: 0 },
  { name: "ram-disk", cacheBytes: 1, httpCache: false, memoryBytes: asset.memoryBytes },
];
const selected = args.conditions ? args.conditions.split(",") : conditions.map(c => c.name);
assert.ok(selected.every(name => conditions.some(c => c.name === name)));
await mkdir(dirname(output), { recursive: true });
const report = { startedAt: new Date().toISOString(), host: hostname(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  asset, launch, draco, repetitions, idleMs, pipeline: args.pipeline === "true", sourceHashes: {}, runs: [],
  measurement: "Direct Wasabi HTTPS. No artificial latency. CDP observes page and Service Worker network sessions. Encoded bytes include response transport overhead. Camera movement is an immediate pose change." };
for (const path of [...(draco ? [`Build/TileCache/draco-${draco.extraction}.js`, "tools/tile-cache/draco-build.mjs", "tools/tile-cache/draco-experiment.js"] : []), configPath, "tools/tile-cache/real-run.mjs", "tools/tile-cache/network.mjs", "tools/tile-cache/harness.js", "tools/tile-cache/pipeline.js", "Build/CesiumUnminified/Cesium.js", "Build/TileCache/worker.js", "Build/TileCache/profile-worker.js", "Build/CesiumUnminified/ThirdParty/draco_decoder.wasm", "Build/CesiumUnminified/ThirdParty/basis_transcoder.wasm"]) {
  report.sourceHashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
}
const server = await startServer({ latencyMs: 0 });
const save = async () => {
  await writeFile(`${output}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  await rename(`${output}.tmp`, output);
};
async function configure(page, condition) {
  await page.goto(`${server.url}/tools/tile-cache/harness.html`);
  await page.waitForFunction(() => !!window.harness);
  if (condition.memoryBytes !== undefined) {
    await page.evaluate(config => window.harness.enableCache(config), {
      workerUrl: args.pipeline === "true" ? "/Build/TileCache/profile-worker.js" : "/Build/TileCache/worker.js", urlPrefix: prefix,
      scope: "public-palace-measurement", version: "2026-09-13",
      diskBytes: asset.diskBytes, memoryBytes: condition.memoryBytes,
      maximumEntryBytes: asset.maximumEntryBytes,
    });
  }
  return page.evaluate(config => window.harness.setup(config), { ...asset, ...condition, draco, pipeline: args.pipeline === "true" });
}
async function visit(page, network, condition, label, pose, start = network.records.length) {
  const before = condition.memoryBytes === undefined ? null : await page.evaluate(() => window.tileCache.stats());
  const result = await page.evaluate(pose => window.harness.visit(pose.name, { pose, timeoutMs: 180000 }), pose);
  const after = condition.memoryBytes === undefined ? null : await page.evaluate(() => window.tileCache.stats());
  result.cache = after;
  result.cacheDelta = after && Object.fromEntries(Object.keys(after).filter(key => typeof after[key] === "number").map(key => [key, after[key] - (before?.[key] || 0)]));
  result.network = network.records.slice(start);
  result.transfer = summarizeNetwork(result.network);
  result.screenshot = `${label}.png`;
  const image = await page.locator("canvas").first().screenshot({ path: join(dirname(output), result.screenshot) });
  result.imageHash = createHash("sha256").update(image).digest("hex");
  assert.deepEqual(result.renderErrors, []);
  assert.ok(!result.events.some(event => event.name === "failed"), "Tiles failed to load");
  return result;
}
try {
  // Rotate condition order between repetitions to reduce endpoint warmup bias.
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const ordered = conditions.filter(c => selected.includes(c.name));
    ordered.push(...ordered.splice(0, repetition % ordered.length));
    for (const condition of ordered) {
      const run = { condition, repetition, visits: [], errors: [], consoleErrors: [] };
      report.runs.push(run);
      const profile = await mkdtemp(join(tmpdir(), "palace-cache-"));
      let context;
      try {
        context = await chromium.launchPersistentContext(profile, launch);
        const page = context.pages()[0];
        page.on("pageerror", error => run.errors.push(String(error)));
        page.on("console", message => {
          if (message.type() === "error" && run.consoleErrors.length < 100) {
            run.consoleErrors.push(message.text());
          }
        });
        const network = await observeNetwork(context, page, { prefix, httpCache: condition.httpCache, profile });
        run.allNetwork = network.records;
        const started = performance.now();
        run.environment = await configure(page, condition);
        assert.ok(typeof run.environment.renderer === "string" &&
          (args.software === "true" || /NVIDIA RTX A4000/.test(run.environment.renderer)), "Expected hardware renderer");
        run.browser = context.browser().version();
        run.setupMs = performance.now() - started;
        for (const [step, poseIndex] of [0, 1, 0].entries()) {
          if (step === 2 && idleMs) {
            await new Promise(resolve => setTimeout(resolve, idleMs));
          }
          const pose = asset.poses[poseIndex];
          run.visits.push(await visit(page, network, condition,
            `${condition.name}-r${repetition}-${step}-${pose.name}`, pose,
            step === 0 ? 0 : network.records.length));
          await save();
        }
        run.sameReturnPixels = run.visits[0].imageHash === run.visits[2].imageHash;
        run.sameReturnTiles = JSON.stringify(run.visits[0].visible) === JSON.stringify(run.visits[2].visible);
        run.evictedAtB = run.visits[1].events.filter(event => event.name === "unload").length;
        run.reloadedAtA = run.visits[2].events.filter(event => event.name === "load").length;
        assert.ok(run.sameReturnPixels, "Returned pose pixels differ");
        assert.ok(run.sameReturnTiles, "Returned pose selected tiles differ");
        if (condition.cacheBytes === 1) {
          assert.ok(run.evictedAtB > 0 && run.reloadedAtA > 0, "Expected eviction and reload");
        } else {
          assert.equal(run.reloadedAtA, 0, "Resident condition must retain A");
        }
        if (condition.memoryBytes !== undefined) {
          assert.equal(run.visits[2].transfer.upstreamRequests, 0, "Warm return must use local data");
          assert.equal(run.visits[2].cache.errors, 0);
        }
        run.networkErrors = network.errors;
        run.cleanup = await page.evaluate(() => window.harness.dispose());
        assert.equal(run.cleanup.loaders, 0);
        assert.deepEqual(network.errors, []);
        assert.deepEqual(run.errors, []);
        if (condition.memoryBytes !== undefined) {
          await context.close();
          context = await chromium.launchPersistentContext(profile, launch);
          const page = context.pages()[0];
          // This route blocks only actual worker network access. Worker-served
          // cached page responses still work. Record every blocked attempt.
          run.blockedRestartRequests = [];
          await context.route(`${prefix}**`, route => {
            run.blockedRestartRequests.push(route.request().url());
            return route.abort("internetdisconnected");
          });
          const network = await observeNetwork(context, page, { prefix, httpCache: false, profile });
          await configure(page, condition);
          run.restart = await visit(page, network, condition,
            `${condition.name}-r${repetition}-restart-A`, asset.poses[0], 0);
          run.sameRestartPixels = run.restart.imageHash === run.visits[0].imageHash;
          assert.ok(run.sameRestartPixels, "Offline restart pixels differ");
          assert.deepEqual(run.restart.visible, run.visits[0].visible);
          run.restartCleanup = await page.evaluate(() => window.harness.dispose());
          assert.equal(run.restartCleanup.loaders, 0);
          assert.deepEqual(run.blockedRestartRequests, []);
        }
        run.complete = true;
        console.log(JSON.stringify({ condition: condition.name, repetition,
          returnMs: run.visits[2].settleMs, transfer: run.visits[2].transfer,
          evicted: run.evictedAtB, samePixels: run.sameReturnPixels }));
      } catch (error) {
        run.error = String(error.stack);
        const page = context?.pages()[0];
        if (page && !page.isClosed()) {
          run.diagnostic = await page.evaluate(() => window.harness?.snapshot()).catch(String);
          await page.screenshot({ path: join(dirname(output), `${condition.name}-r${repetition}-failure.png`) }).catch(() => {});
        }
        process.exitCode = 1;
      } finally {
        await context?.close();
        await rm(profile, { recursive: true, force: true });
        await save();
      }
    }
  }
} finally {
  report.completedAt = new Date().toISOString();
  await save();
  await server.close();
}
