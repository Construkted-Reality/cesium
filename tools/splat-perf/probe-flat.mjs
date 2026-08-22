// Reports the state of the splat draw command after a benchmark run.
import { chromium } from "@playwright/test";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";

const query = new URLSearchParams({
  tileset: "/splat-data/oracle-run/geo-newdefault/tileset.json",
  frames: "30",
  warmup: "120",
  mode: "orbit",
  sse: "4",
  label: "flat-probe",
});

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: GPU_LAUNCH_ARGS,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page.on("console", (m) => process.stdout.write(`page: ${m.text()}\n`));
  page.on("pageerror", (e) => process.stdout.write(`pageerror: ${e.message}\n`));
  await page.goto(
    `http://127.0.0.1:8099/tools/splat-perf/harness.html?${query.toString()}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => window.__benchResult !== undefined || window.__benchError,
    undefined,
    { timeout: 600000, polling: 200 },
  );
  const error = await page.evaluate(() => window.__benchError);
  if (error) {
    throw new Error(error);
  }
  const report = await page.evaluate(() => {
    const scene = window.__scene;
    const primitive = window.__splatPrimitive;
    const gl = scene.context._originalGLContext ?? scene.context._gl;
    const command = primitive._drawCommand;
    const texture = primitive._sortedIndexTexture;

    const out = {
      glError: gl.getError(),
      numSplats: primitive._numSplats,
      indexCount: primitive._indexes?.length,
      firstIndexes: Array.from(primitive._indexes?.slice(0, 6) ?? []),
      command: {
        count: command?.count,
        instanceCount: command?.instanceCount,
        primitiveType: command?.primitiveType,
        offset: command?.offset,
        hasVertexArray: !!command?.vertexArray,
        hasShaderProgram: !!command?.shaderProgram,
      },
      texture: texture
        ? { width: texture.width, height: texture.height }
        : null,
      uniformMapHasSortedIndex: !!command?.uniformMap?.u_sortedIndexTexture,
      uniformReturnsTexture: !!command?.uniformMap?.u_sortedIndexTexture?.(),
    };

    const shaderProgram = command?.shaderProgram;
    out.shaderProgramKeys = Object.keys(shaderProgram ?? {});
    const vertexSource =
      shaderProgram?._vertexShaderText ?? shaderProgram?.vertexShaderSource;
    const sourceText =
      typeof vertexSource === "string"
        ? vertexSource
        : (vertexSource?.createCombinedVertexShader?.(scene.context) ?? "");
    out.shaderHasSortedFetch = sourceText.includes("u_sortedIndexTexture");
    out.shaderHasQuadCorners = sourceText.includes("QUAD_CORNERS");
    out.shaderHasOldAttribute = sourceText.includes("a_splatIndex");
    out.shaderMainExtract = sourceText.slice(
      Math.max(0, sourceText.indexOf("void main()")),
      sourceText.indexOf("void main()") + 700,
    );

    // Which uniforms and attributes does the linked program actually have?
    const program = command?.shaderProgram?._program;
    if (program) {
      const uniforms = [];
      const uniformCount = gl.getProgramParameter(
        program,
        gl.ACTIVE_UNIFORMS,
      );
      for (let i = 0; i < uniformCount; i++) {
        uniforms.push(gl.getActiveUniform(program, i).name);
      }
      out.activeUniforms = uniforms;
      const attributes = [];
      const attributeCount = gl.getProgramParameter(
        program,
        gl.ACTIVE_ATTRIBUTES,
      );
      for (let i = 0; i < attributeCount; i++) {
        attributes.push(gl.getActiveAttrib(program, i).name);
      }
      out.activeAttributes = attributes;
    }

    // Read the first few texels back to confirm the upload landed.
    if (texture) {
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture._texture,
        0,
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      out.readbackStatus = status;
      if (status === gl.FRAMEBUFFER_COMPLETE) {
        const pixels = new Uint32Array(6 * 4);
        gl.readPixels(0, 0, 6, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, pixels);
        out.readbackError = gl.getError();
        const texels = [];
        for (let i = 0; i < pixels.length; i += 4) {
          texels.push(pixels[i]);
        }
        out.firstTexels = texels;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
    }
    return out;
  });
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
} finally {
  await browser.close();
}
