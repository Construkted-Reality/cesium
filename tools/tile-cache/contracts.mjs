import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { startServer } from "./server.mjs";

await build({
  entryPoints: ["tools/tile-cache/contracts-browser.js"],
  outfile: "Build/TileCache/contracts.js",
  bundle: true,
  platform: "browser",
});
const server = await startServer({ latencyMs: 0 });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  tests: [],
};
try {
  const page = await browser.newPage();
  await page.goto(`${server.url}/tools/tile-cache/contracts.html`);
  await page.addScriptTag({
    url: `${server.url}/Build/TileCache/contracts.js`,
  });
  report.tests = await page.evaluate(() => window.cacheContracts());
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error.stack);
  process.exitCode = 1;
} finally {
  await writeFile(
    process.argv[2] || "/tmp/cesium-tile-cache-2026-09-12/contracts.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await server.close();
}
