import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
const server = await startServer({
  latencyMs: Number(options.latency || 100),
  textureSize: Number(options.textureSize || 512),
});
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
    latencyMs: server.state.latencyMs,
    textureSize: Number(options.textureSize || 512),
    viewport: { width: 800, height: 600 },
    synthetic: true,
  },
  runs: [],
};
const configurations = [
  { name: "http-disabled-small", httpCache: false, cacheBytes: 1 },
  { name: "http-enabled-small", httpCache: true, cacheBytes: 1 },
  {
    name: "http-disabled-large",
    httpCache: false,
    cacheBytes: 256 * 1024 * 1024,
  },
];

async function save() {
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}

try {
  for (const configuration of configurations) {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const profile = await mkdtemp(join(tmpdir(), "cesium-cache-"));
      const context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        viewport: report.configuration.viewport,
        deviceScaleFactor: 1,
        args: software
          ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
          : ["--use-angle=gl", "--ignore-gpu-blocklist"],
      });
      try {
        const page = context.pages()[0];
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", {
          cacheDisabled: !configuration.httpCache,
        });
        await page.goto(`${server.url}/tools/tile-cache/harness.html`);
        await page.waitForFunction(() => !!window.harness);
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
          const requestStart = server.state.requests.length;
          const visit = await page.evaluate(
            (index) => window.harness.visit(index),
            index,
          );
          visit.serverRequests = server.state.requests.slice(requestStart);
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
}
