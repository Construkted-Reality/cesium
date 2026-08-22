// Probe which headless Chrome configuration reaches the discrete GPU.
// Prints the WebGL2 renderer string for each candidate launch configuration.
import { chromium } from "@playwright/test";

const CONFIGS = [
  {
    name: "headless-shell default",
    opts: {},
  },
  {
    name: "headless-shell swiftshader",
    opts: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  {
    name: "chromium new-headless angle-vulkan",
    opts: {
      channel: "chromium",
      args: [
        "--use-angle=vulkan",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--enable-gpu",
        "--enable-gpu-rasterization",
      ],
    },
  },
  {
    name: "chromium new-headless angle-gl-egl",
    opts: {
      channel: "chromium",
      args: ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"],
    },
  },
  {
    name: "chromium new-headless egl",
    opts: {
      channel: "chromium",
      args: ["--use-gl=egl", "--ignore-gpu-blocklist", "--enable-gpu"],
    },
  },
];

async function probe(config) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...config.opts });
    const page = await browser.newPage();
    await page.goto("about:blank");
    const info = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      if (!gl) {
        return { webgl2: false };
      }
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        webgl2: true,
        renderer: dbg
          ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "",
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        timerQuery: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
        floatBlend: !!gl.getExtension("EXT_float_blend"),
      };
    });
    return info;
  } catch (error) {
    return { error: String(error).split("\n")[0] };
  } finally {
    await browser?.close();
  }
}

for (const config of CONFIGS) {
  const result = await probe(config);
  console.log(`## ${config.name}`);
  console.log(JSON.stringify(result));
  console.log("");
}
