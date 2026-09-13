import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { startServer } from "./server.mjs";
const output = process.argv[2] || "/tmp/decoded-contracts.json";
const server = await startServer({ latencyMs: 0 });
const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const report = { date: new Date().toISOString(), browser: browser.version() };
try {
  const page = await browser.newPage();
  await page.goto(`${server.url}/tools/tile-cache/harness.html`);
  await page.waitForFunction(() => !!window.harness);
  report.tests = await page.evaluate(async () => (await import("./decoded-contracts.js")).runDecodedContracts());
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = String(error.stack); process.exitCode = 1;
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)  }\n`);
  await browser.close(); await server.close();
}
