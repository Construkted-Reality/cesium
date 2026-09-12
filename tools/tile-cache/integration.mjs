import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { startServer } from "./server.mjs";

const server = await startServer({ latencyMs: 20 });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  tests: [],
};
const context = await browser.newContext();

async function configure(page, { scope = "A", version = "v1" } = {}) {
  await page.evaluate(
    async ({ scope, version }) => {
      const clientUrl = new URL("/Build/TileCache/client.js", location.href)
        .href;
      const { registerTileCache } = await import(clientUrl);
      window.tileCache = await registerTileCache({
        workerUrl: "/Build/TileCache/worker.js",
        urlPrefix: "/tile-data/v1/",
        scope,
        version,
        memoryBytes: 1024 * 1024,
        diskBytes: 4 * 1024 * 1024,
      });
    },
    { scope, version },
  );
}
async function pageFor() {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto(`${server.url}/tools/tile-cache/contracts.html`);
  return page;
}
async function fetchResult(page, path, headers = {}) {
  return page.evaluate(
    async ({ path, headers }) => {
      const response = await fetch(path, { headers });
      const result = {
        status: response.status,
        tier: response.headers.get("X-Construkted-Cache"),
        text: await response.text(),
      };
      await window.tileCache.stats();
      return result;
    },
    { path, headers },
  );
}
try {
  const page = await pageFor();
  await configure(page);
  const path = "/tile-data/v1/identity.bin";
  const a = await fetchResult(page, path, { "X-Account": "red" });
  const b = await fetchResult(page, path, { "X-Account": "blue" });
  assert.equal(a.text, "red");
  assert.equal(b.text, "blue");
  assert.equal(b.tier, null);
  const red = await fetchResult(page, path, { "X-Account": "red" });
  assert.equal(red.text, "red");
  assert.equal(red.tier, "memory");
  report.tests.push({ test: "same-url-different-headers", pass: true });

  const other = await pageFor();
  await configure(other, { scope: "B" });
  assert.equal(
    (await fetchResult(other, path, { "X-Account": "red" })).tier,
    null,
  );
  await configure(other, { scope: "B", version: "v2" });
  assert.equal(
    (await fetchResult(other, path, { "X-Account": "red" })).tier,
    null,
  );
  assert.equal(
    (await fetchResult(page, path, { "X-Account": "red" })).tier,
    "memory",
  );
  report.tests.push({
    test: "cross-tab-account-and-version-isolation",
    pass: true,
  });

  const workerSession = await context.newCDPSession(page);
  await workerSession.send("ServiceWorker.enable");
  await workerSession.send("ServiceWorker.stopAllWorkers");
  server.state.offline = true;
  assert.equal(
    (await fetchResult(page, path, { "X-Account": "red" })).tier,
    "disk",
  );
  server.state.offline = false;
  report.tests.push({
    test: "worker-termination-restores-client-and-disk",
    pass: true,
  });

  for (const [suffix, headers] of [
    ["?cache=no-store", {}],
    ["", { Range: "bytes=0-1" }],
  ]) {
    const start = server.state.requests.length;
    await fetchResult(page, path + suffix, headers);
    await fetchResult(page, path + suffix, headers);
    assert.equal(server.state.requests.length - start, 2);
  }
  report.tests.push({ test: "no-store-and-range-bypass", pass: true });

  await page.evaluate(() => window.tileCache.clearMemory());
  server.state.offline = true;
  assert.equal(
    (await fetchResult(page, path, { "X-Account": "red" })).tier,
    "disk",
  );
  const missing = await fetchResult(page, "/tile-data/v1/missing.bin");
  assert.equal(missing.status, 503);
  await page.evaluate(() => window.tileCache.clear());
  assert.equal(
    (await fetchResult(page, path, { "X-Account": "red" })).status,
    503,
  );
  server.state.offline = false;
  report.tests.push({
    test: "memory-eviction-offline-hit-and-explicit-purge",
    pass: true,
  });

  // An aborted consumer must not publish a partial body as a valid response.
  server.state.latencyMs = 200;
  const aborted = await page.evaluate(async () => {
    const controller = new AbortController();
    const pending = fetch("/tile-data/v1/identity.bin?cancel", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    try {
      await pending;
      return false;
    } catch (error) {
      return error.name === "AbortError";
    }
  });
  assert.ok(aborted);
  await new Promise((done) => setTimeout(done, 250));
  const complete = await fetchResult(page, "/tile-data/v1/identity.bin?cancel");
  assert.equal(complete.text, "public");
  assert.equal(
    (await fetchResult(page, "/tile-data/v1/identity.bin?cancel")).text,
    "public",
  );
  report.tests.push({ test: "cancel-and-retry-complete-body", pass: true });
  report.stats = await page.evaluate(() => window.tileCache.stats());
  const unavailableContext = await browser.newContext();
  const unavailable = await unavailableContext.newPage();
  await unavailable.goto(`${server.url}/tools/tile-cache/contracts.html`);
  const fallback = await unavailable.evaluate(async () => {
    await navigator.serviceWorker.register(
      "/tools/tile-cache/failing-storage-worker.js",
      { scope: "/" },
    );
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
    }
    return (
      await fetch("/tile-data/v1/identity.bin?storage-unavailable")
    ).text();
  });
  assert.equal(fallback, "public");
  await unavailableContext.close();
  report.tests.push({
    test: "metadata-unavailable-network-fallback",
    pass: true,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error.stack);
  process.exitCode = 1;
} finally {
  report.requests = server.state.requests;
  const output =
    process.argv[2] || "/tmp/cesium-tile-cache-2026-09-12/integration.json";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
