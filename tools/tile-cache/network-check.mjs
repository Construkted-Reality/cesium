import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.mjs";
import { observeNetwork, summarizeNetwork } from "./network.mjs";
const server = await startServer({ latencyMs: 20 });
const report = { tests: [] };
try {
  for (const worker of [false, true]) {
    const profile = await mkdtemp(join(tmpdir(), "cache-network-check-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", args: ["--remote-debugging-port=0"],
    });
    try {
      const page = context.pages()[0];
      const prefix = `${server.url}/tile-data/v1/`;
      const network = await observeNetwork(context, page, { prefix, httpCache: !worker, profile });
      await page.goto(`${server.url}/tools/tile-cache/contracts.html`);
      if (worker) {
        await page.evaluate(async prefix => {
          const url = new URL("/Build/TileCache/client.js", location.href).href;
          const { registerTileCache } = await import(url);
          window.tileCache = await registerTileCache({
            workerUrl: "/Build/TileCache/worker.js", urlPrefix: prefix,
            scope: "network-check", version: "1", diskBytes: 4096,
          });
        }, prefix);
      }
      const before = server.state.requests.length;
      for (let i = 0; i < 2; i++) {
        await page.evaluate(url => fetch(url).then(r => r.arrayBuffer()), `${prefix}identity.bin`);
        if (worker) { await page.evaluate(() => window.tileCache.stats()); }
      }
      // A browser round trip drains the pending CDP event callbacks.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      const summary = summarizeNetwork(network.records);
      assert.equal(server.state.requests.length - before, 1);
      assert.equal(summary.upstreamCompleted, 1);
      assert.ok(summary.upstreamEncodedBytes > 0);
      assert.equal(summary.serviceWorkerResponses, worker ? 2 : 0);
      assert.deepEqual(network.errors, []);
      report.tests.push({ worker, pass: true, serverRequests: server.state.requests.slice(before), summary, records: network.records });
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
} catch (error) {
  report.error = String(error.stack);
  process.exitCode = 1;
} finally {
  await server.close();
  await writeFile(process.argv[2] || "/tmp/tile-cache-network-check.json", JSON.stringify(report, null, 2));
}
