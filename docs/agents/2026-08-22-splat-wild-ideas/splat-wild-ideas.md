# Splat renderer: wide-net optimization ideas

- Date: 2026-08-22
- Role: renderer performance researcher, second pass, unconventional ideas explicitly requested
- Question: what optimization directions exist for the CesiumJS Gaussian splat renderer beyond the ones already mined by the 2026-08-21 review and the attribution work
- Model: Fable 5
- Code state: branch `feature/splat-perf` at `8d97a244ef`, with the four shipped optimizations and the measurements in `docs/splat-perf/00..02`

Baseline for every estimate below: graphics mean 4.22 ms (attribution run 4.14 ms), processor mean 1.50 ms, processor p95 2.45 ms, at 1.93 M splats, SH degree 3, 1920x1080, RTX A4000, ANGLE Vulkan. The in-flight non-instanced draw is expected to land at about 3.1 ms graphics (1.51 floor + 1.08 fill + 0.51 vertex compute).

---

## Two observations the existing docs contain but do not exploit

These two drive the top of the idea list, so they come first.

**Observation 1: the 1.51 ms "non-instanced floor" has zero slope, which points at fixed overhead, not throughput.** Three structurally different null-shader draws all cost the same: 3.9 M vertices with zero triangles (1.48 ms), 7.7 M vertices with 7.7 M triangles (1.51 ms), 11.6 M vertices with 3.9 M triangles (1.51 ms). If a throughput limit bound these, the costs would differ by 2-3x. The implied "vertex rates" are inconsistent (5.1 Gverts/s at 7.7 M, 7.7 Gverts/s at 11.6 M). A large fixed component per splat draw would explain all three numbers at once, and nobody has measured where the knee is. If, say, 1.0 ms of the 1.51 is fixed, the in-flight redesign inherits a 1.0 ms tax that geometry restructuring can never remove but something else (state, framebuffer, driver path) might.

**Observation 2: the splat pass blends into a 4x multisampled framebuffer.** `Scene.js:251` defaults `msaaSamples` to 4, the benchmark harness (`tools/splat-perf/harness.html`) never overrides it, and when the globe depth framebuffer is active the splat commands render into `view.globeDepth.framebuffer`, which is allocated with `scene.msaaSamples` (`Scene.js:3941-3951`, framebuffer selection near `Scene.js:3999`). Every blended splat fragment pays multisample ROP cost plus a share of the resolve, and Gaussian splats gain nothing from MSAA because they have no hard edges: the quad border already carries alpha exp(-4) ~ 1.8 % of the splat's own alpha. All measured fill numbers (the 1.08 ms) include this hidden 4x factor.

---

## Group 1: ideas that keep the pixels identical

Ordered by expected value (win divided by verification difficulty).

### 1.1 Decompose the 1.51 ms floor into slope and intercept

**Idea.** Before optimizing per-vertex anything further, find out what the 1.51 ms actually buys. Run the null-shader draw at 10 k, 100 k, 1 M, 4 M, 8 M, 16 M vertices and plot cost against count. Add arms: `msaaSamples = 1`, splat pass into a plain non-multisampled FBO, two draws of half size versus one draw, TRIANGLES versus STRIP versus drawArrays.

**Mechanism.** Observation 1. If the floor is mostly intercept, the lever is not geometry but whatever fixed work surrounds the draw (multisample attachment touch, blend-state pipeline switch under ANGLE Vulkan, timer query bracketing, internal barrier). If it is mostly slope with a knee, the knee value tells you exactly how far splat-count reduction (ideas 2.1, 2.5, 2.6) can go.

**Estimate.** Not an optimization itself; it directs up to 1.5 ms, which is half of the post-in-flight frame. My guess, stated as a guess: at least 0.5 ms of it is fixed, because three workloads spanning 3x vertices and 0 to 7.7 M triangles land within 0.03 ms of each other.

**Test.** One afternoon of agent time with the existing attrib harness. The vertex-count sweep alone answers slope versus intercept.

**Costs.** None. Measurement only.

**Composition.** Directly validates or corrects the 3.1 ms projection of the in-flight non-instanced draw.

### 1.2 Take the splat pass out of the 4x multisampled framebuffer

**Idea.** Stop paying multisample cost for splats. Cheapest form: `scene.msaaSamples = 1` for splat-dominant scenes, which is a product-level one-liner today. Structural form: resolve the multisampled buffer after the opaque passes, then render `Pass.GAUSSIAN_SPLATS` into the resolved single-sample color buffer reusing the resolved depth.

**Mechanism.** Observation 2. Blending is per-sample on paper; color compression reduces the real cost, which is why this needs measuring rather than assuming 4x. The fill bucket is 1.08 ms and the resolve adds unmeasured time on top.

**Estimate.** 0.3 to 0.8 ms. Guessing inside a measured bound: the win cannot exceed fill plus resolve, and compression means it will not be the naive 3/4 of fill.

**Test.** Set `scene.msaaSamples = 1` in the harness and rerun the benchmark. Thirty minutes. If the graphics time barely moves, the structural version is dead too and we learned that ANGLE Vulkan compresses splat blending well. This arm also feeds idea 1.1, since it tests whether part of the floor is MSAA-related.

**Costs.** The one-liner costs opaque-geometry edge quality scene-wide (irrelevant in splat-only scenes, which is Construkted's common case). The structural version keeps opaque MSAA and is pixel-identical for splat interiors, but it reorders the resolve and interacts with translucent and post-process passes: medium Cesium surgery in `Scene.js`.

**Composition.** Composes with the in-flight draw. Conflicts with idea 2.4 (stochastic coverage), which wants MSAA present.

### 1.3 Compute the 3D covariance in the vertex shader and delete the WASM texture generator

**Idea.** Store quaternion and scale in the attribute texture instead of the precomputed f16 covariance, and build `Vrk = R S S^T R^T` in the vertex shader. The `generate_splat_texture` WASM step and its worker round trip disappear.

**Mechanism.** The attribution proved the vertex ALU bucket has headroom: removing the entire covariance fetch and math saved nothing measurable, so adding ~30 ALU ops of quaternion-to-matrix will also cost nothing measurable at this scale. The payload fits the existing layout: position 12 B + quat 4xf16 8 B + scale 3xf16 6 B + color 4 B = 30 B against the current 32 B (2 RGBA32UI texels, `GaussianSplatPrimitive.js:537-539`, VS fetches at `PrimitiveGaussianSplatVS.glsl` main). Packing becomes a trivial interleave that can even happen per tile at load time, which removes most of the 47 ms "build textures" half of the 105 ms rebuild stall and unblocks per-tile incremental texture uploads later.

**Estimate.** ~0 ms steady-state frame change; 20 to 40 ms off every rebuild stall (guessing the split of the 47 ms between attribute texture and SH texture upload); one worker hop removed from the rebuild critical path; the `@cesium/wasm-splats` texture path deleted.

**Test.** Golden-image diff against current output (differences bounded by f16 rounding, same order as today since covariance is already f16), plus the rebuild timer already in the harness. Verification is easy and binary.

**Costs.** Code churn in the aggregation path and shader; no quality cost; no memory cost.

**Composition.** Fully composes with the in-flight draw and with the mined incremental-snapshot idea (P9), which it makes simpler.

### 1.4 Freeze-frame reuse when nothing changed

**Idea.** When the camera is still and no sort or snapshot landed, do not re-execute the splat draw: render the splat pass once into a cached offscreen target and composite it until invalidated. In the simplest product form, enable Cesium's existing `requestRenderMode` for splat viewers and skip whole frames.

**Mechanism.** The splat pass costs 4.2 ms every frame even when the image cannot change. The characterization shows a still camera performs zero sorts; the draw is pure repetition. Real viewers idle most of the time; the orbiting benchmark is the adversarial case, not the typical one.

**Estimate.** 4.2 ms to ~0.1 ms whenever idle; 0 in the orbit benchmark. For the product's actual session mix this may be worth more wall-clock GPU time than everything else on this list. Not guessing about the mechanism, guessing about the session mix.

**Test.** `requestRenderMode` variant: flip the flag in a viewer, confirm identical stills and near-zero GPU when idle. Pass-cache variant: prototype an FBO cache keyed on camera pose + sort generation, pixel-diff stills.

**Costs.** `requestRenderMode` is free but freezes everything, not just splats. The per-pass cache costs one full-resolution RGBA16F target (~16 MB) and care with composite order when translucent geometry or animation exists behind splats. In splat-only scenes it is trivially correct.

**Composition.** Orthogonal to everything.

### 1.5 Cut the per-sort index upload spike

**Idea.** The sorted order costs 7.7 MB of GPU upload every sort (4 B x 1.93 M), measured as ~1.1 ms of extra GPU time on moving-camera frames (5.16 vs 4.09 ms median). Shrink and smooth it: 3-byte indices (21 bits suffice for 1.93 M, and the hard cap of 2 x `maximumTextureSize` rows bounds counts), upload through a `PIXEL_UNPACK_BUFFER` so the driver can DMA asynchronously, and double-buffer the index texture so the upload streams across the 2 idle frames between sorts and flips atomically.

**Mechanism.** Sorts arrive at most every 3 frames (`DEFAULT_SORT_MIN_FRAME_INTERVAL`, `GaussianSplatPrimitive.js:207`), so there are always free frames to hide the transfer in. The flip is atomic, so no torn permutation is ever drawn.

**Estimate.** Removes most of the ~1.1 ms sort-frame spike; amortized mean saving ~0.2-0.4 ms while moving. The p95 smoothing matters more than the mean.

**Test.** GPU timer histogram split by sort frames versus non-sort frames, before and after. Easy.

**Costs.** One extra index texture (6-8 MB); moderate complexity in the upload path; none visual.

**Composition.** Builds directly on the in-flight change (which already moves indices to a texture).

### 1.6 Replicate the attribution matrix on the backends users actually run

**Idea.** All numbers so far come from ANGLE Vulkan on Linux. Construkted's users run Chrome on Windows (ANGLE D3D11) and Safari/Chrome on macOS (Metal). Rerun the attribution suite (null shader, tiny quads, instanced versus non-instanced, msaa arm) on one Windows box and one Mac before committing to designs tuned to the Vulkan numbers.

**Mechanism.** The 1.0 ms instancing penalty and the 1.51 ms floor are exactly the kind of numbers that swing per backend, because instanced small-strip draws take different driver paths in D3D11, Vulkan, and Metal. If D3D11 shows no instancing penalty, the in-flight redesign wins nothing for most users; if it shows a bigger one, it wins more.

**Estimate.** No direct saving. It de-risks every GPU-side bet on this list. Cheap because the harness already exists and the fleet has a Windows ZBook and Macs.

**Test.** The runs are the test.

**Costs.** None.

**Composition.** Informs everything.

---

## Group 2: ideas that trade quality for speed, with the trade stated

### 2.1 Motion-adaptive splat budget: draw an importance-ordered prefix while the camera moves

**Idea.** Order splat storage by importance (opacity x projected volume) at snapshot build. While the camera moves, sort and draw only the top K percent; on rest, refine to 100 percent over 2-3 frames. This is progressive refinement in the splat domain, using motion masking to hide the cut.

**Mechanism.** Post-in-flight, every remaining GPU cost scales with drawn splat count: fill trivially, vertex compute trivially, and the floor if idea 1.1 finds slope. The sort, the index upload, and `buildGSplatDrawCommand`'s per-sort work all shrink by the same factor. At K = 50 the characterization's splat-count scaling suggests roughly 0.8-1.3 ms GPU plus about half the sort-path CPU during motion. Guessing the perceptual threshold, not the mechanics.

**Test.** Two stages. Stage 1, one hour: clamp the draw count to the nearest 50 percent of the sorted list (the back half of the back-to-front order) and record an orbit video; this mislabels *which* splats to keep but prices the win exactly. Stage 2: importance-order the aggregation and A/B the orbit video against baseline at K = 70, 50, 30. Falsified if viewers spot the cut at K >= 50 in side-by-side video.

**Costs.** Visible sparkle or density loss during motion if K is too low; an importance metric in the aggregation path; no memory cost. Refinement pop on stop must be softer than the current LOD pop to be acceptable.

**Composition.** Composes with the in-flight draw (it is just a smaller count) and with 2.5, 2.6.

### 2.2 Render the splat layer at reduced resolution and upsample

**Idea.** Render `Pass.GAUSSIAN_SPLATS` into a half-resolution (per axis) offscreen target and composite with bilinear upsampling. Splats are band-limited Gaussians, the least upsampling-hostile content that exists.

**Mechanism.** Fill is 1.08 ms; quarter the pixels and it becomes ~0.27 ms, plus proportional fragment and resolve savings. Vertex-side costs unchanged.

**Estimate.** 0.6-0.9 ms. The bound is firm (cannot exceed fill), the fraction is a guess.

**Test.** Prototype the offscreen path, then SSIM/eyeball stills at 100/75/50 percent scale against baseline, including a scene with fine high-frequency splat detail (thin structures, text on facades). Falsified if 75 percent scale is already objectionable, because then the win shrinks below 0.5 ms.

**Costs.** Softens the splat layer; fine splat structure blurs first. Opaque geometry stays sharp because only the splat FBO shrinks. One extra FBO plus composite. Note: at half resolution the vertex shader's 2-pixel minimum-size discard (`dot(covVectors) < 4.0`) culls in *small-buffer* pixels, so slightly more splats vanish; either accept (it is consistent with the resolution) or scale the threshold.

**Composition.** Composes with everything in group 1; multiplies with 2.1.

### 2.3 Temporal reprojection: render splats every second or third frame and warp between

**Idea.** Render the splat layer to an offscreen color target at 1/2 or 1/3 rate, with a representative depth per pixel written via MRT (alpha-weighted mean splat depth). On in-between frames, reproject the cached layer with a depth-aware warp using the camera delta.

**Mechanism.** The renderer already tolerates temporal staleness: the sort is at most 3 frames fresh and nobody notices. This extends the same tolerance from *order* to *shading and parallax*. The full splat cost (4.2 ms today, ~3.1 post-in-flight) is paid on refresh frames only; warp frames cost a fullscreen pass, ~0.2-0.3 ms.

**Estimate.** At 1/2 rate, mean splat GPU cost roughly halves plus warp: ~1.5-1.8 ms saved off 3.1. At 1/3 rate, ~2 ms. MRT depth output adds maybe 20-40 percent to fill on refresh frames (guess). Net ~1.2-1.8 ms mean while moving.

**Test.** Do not build the warp first. Offline simulator: capture frames k and k+1 with camera matrices from the orbit run, warp k to k+1's pose in a notebook using the k depth, compute PSNR against the real k+1 across orbit speeds. If PSNR < ~35 dB at the benchmark orbit speed, the ghosting will be visible and the idea dies for moving cameras (it degenerates into idea 1.4, which only helps when still). This kills or confirms for a day of work with zero renderer changes.

**Costs.** Ghosting at disocclusions and screen edges; extra RGBA16F + depth-ish target (~24 MB); the highest code complexity in group 2. Splat scenes are forgiving (soft edges, no thin opaque silhouettes), which is why this is worth pricing at all.

**Composition.** Composes with the in-flight draw and with 2.2 (reproject the low-res layer).

### 2.4 Kill the sort entirely: hashed stochastic alpha into the MSAA target that is already there

**Idea.** Replace sorted alpha blending with stochastic transparency: depth-tested, depth-writing splats whose fragments survive with probability alpha (hashed alpha test, or alpha-to-coverage against the existing 4x MSAA buffer for 5 quantization levels). Order-independence makes the sort, the sort worker, the index texture, and all staleness machinery deletable.

**Mechanism.** Expectation over the stochastic test equals the over-blend result without any ordering. Depth writes turn on early-Z between splats, so heavily overdrawn regions get cheaper, not more expensive. CPU sort path (1.50 ms mean, 2.45 p95, and the whole worker protocol) goes to zero; the ~1.1 ms sort-frame upload spike goes to zero; order-popping artifacts go to zero.

**Estimate.** CPU: essentially the entire sort path. GPU: roughly neutral, possibly better in dense scenes from early-Z (guess). The real payoff is architectural: the largest remaining subsystem is deleted.

**Test.** Half a day: shader + render-state variant (alpha-to-coverage on, blend off, depth write on, hash the threshold by splat id and pixel), screenshot A/B against baseline, then an orbit video. Falsified by visible noise, which is the expected outcome without temporal accumulation: 4 coverage samples give 5 alpha levels and splat alphas commonly sit below 0.2. Cesium has FXAA but no TAA, and without TAA this will sparkle. Run the cheap test anyway: if the result is surprisingly acceptable on real Construkted content at 4x, this is the biggest simplification available in WebGL2; if not, the experiment writes the requirements for the WebGPU variant (2 pass reservoir or 8x coverage).

**Costs.** Image becomes dithered; worst on high-frequency colorful content; fails the "same pixels" bar by design. Conflicts with idea 1.2 (it consumes the MSAA samples that 1.2 wants to remove).

**Composition.** Composes with the in-flight draw structure; replaces the sorter, so it conflicts with 1.5 and with the mined sort improvements.

### 2.5 Prune and merge splats at import time, in the Construkted tiling pipeline

**Idea.** The renderer draws what the tiler emits, and splat-training pipelines massively overprovision. Add an import-time pass: drop splats whose contribution is negligible (opacity x area score), merge near-duplicates, optionally re-quantize. Published results (LightGaussian, Mini-Splatting) prune 50-90 percent with small PSNR loss when finetuning is available; blind pruning without finetuning still typically removes 15-40 percent harmlessly (that fraction is a guess for this content class).

**Mechanism.** Every cost in the entire pipeline is linear or superlinear in N: GPU draw, sort time, index upload, rebuild stalls, memory (SH texture alone is 120 B/splat, 231 MB at 1.93 M), and download size. A 30 percent cut is ~30 percent off all of them at once, forever, with zero renderer risk.

**Estimate.** At 30 percent: ~0.5-0.9 ms GPU post-in-flight, ~70 MB memory, proportional CPU. Content-dependent.

**Test.** Offline and completely safe: prune one benchmark asset at thresholds 10/20/30/40 percent, render stills through the *unmodified* viewer, PSNR/SSIM against unpruned, eyeball the worst tiles. No renderer change involved, which makes this the easiest quality-trade to verify on real user data.

**Costs.** Quality risk lives entirely in the offline tool where it can be gated per asset; pipeline work in the tiler, not in CesiumJS.

**Composition.** Composes with absolutely everything.

### 2.6 Drop screen-space-error during camera motion

**Idea.** Use the tile-domain LOD that already exists: SSE 4 at rest, SSE 8-16 while the camera moves. The characterization table says SSE 8 costs 4.49 ms GPU against 5.33 at SSE 4 (old instanced numbers), with half the splats to sort.

**Mechanism.** Existing machinery, one knob. The catch is measured: every selected-tile-set change triggers the 105 ms snapshot rebuild stall, so toggling SSE per motion state is unusable until the incremental snapshot (mined idea P9) lands. This idea is the *reason* to prioritize P9, which changes P9's value, which is why it appears here despite the dependency.

**Estimate.** ~1-2 ms GPU plus roughly half the sort CPU during motion, after P9.

**Test.** Today, two lines in the harness: animate `maximumScreenSpaceError` with the orbit and record both the win (steady frames) and the stall (transition frames). That quantifies both sides of the trade before P9 is built.

**Costs.** Visible LOD churn during motion; rebuild stalls until P9; nothing new in the renderer.

**Composition.** Multiplies with 2.1 (they cut different axes: tile resolution versus per-splat budget).

### 2.7 gl.POINTS on backends whose point size allows it

**Idea.** Draw each splat as one point primitive: 1.93 M vertex invocations and 1.93 M primitives instead of 7.7-11.6 M, no index buffer, no corner math. The fragment shader reconstructs the ellipse from `gl_PointCoord` and two flat varyings.

**Mechanism.** If idea 1.1 finds the floor is throughput-shaped, points sit far below every candidate limit (4x fewer vertices than the in-flight design, 2x fewer primitives). The earlier review rejected points for the D3D11 1.0-pixel point-size cap, which is correct for Windows; but ANGLE Vulkan on NVIDIA exposes large points (Vulkan `pointSizeRange` up to 2047 on this class of hardware), and Metal supports up to 511. Feature-detect `ALIASED_POINT_SIZE_RANGE` and keep the in-flight path as fallback.

**Estimate.** Vertex/primitive side: up to ~1 ms below the in-flight design if the floor scales; ~0 if the floor is fixed. Fill side: points are axis-aligned squares, so anisotropic splats cover more pixels than the oriented quad; expected fill growth 1.5-2.5x on the 1.08 ms bucket, i.e. +0.5-1.5 ms (guess). Net anywhere from +0.5 to -1.0 ms, which is exactly why it is a cheap experiment and not a design.

**Test.** One attrib-style variant on the existing harness: null-shader POINTS draw of 1.93 M vertices with representative point sizes, compare against the 1.51 ms floor. If it does not land clearly under ~1.0 ms, stop. Only then build the full shader.

**Costs.** Points clip by center, so splats pop at screen edges (quality deviation, worst with large splats near the border); fill increase; a second shader path per backend. Not portable to Windows D3D11.

**Composition.** Replaces the in-flight draw structure where supported, rather than composing with it.

---

## Group 3: ideas that need a different graphics interface or a different algorithm

### 3.1 WebGPU splat layer: GPU sort every frame plus a compute rasterizer, composited over Cesium

**Idea.** Render the splats in a WebGPU context (layered canvas for splat-only scenes; texture handoff for mixed scenes) using the now-standard architecture: GPU radix sort per frame, then either vertex pulling or a full tiled compute rasterizer in the style of the original 3DGS CUDA renderer. Keep Cesium for everything else, camera-synced.

**Mechanism.** WebGPU removes every structural cost at once: compute-shader radix sort makes the order exact every frame with zero CPU, zero worker protocol, zero 7.7 MB uploads, zero staleness; a compute rasterizer with workgroup-shared staging and per-pixel early termination removes the vertex floor, the instancing question, and most overdraw. Existing evidence that this works in browsers: web-splat (KeKsBoTer, WGPU-based) and similar renderers report multi-million-splat scenes at hundreds of FPS at 1080p on desktop GPUs, i.e. total splat cost in the 1-2 ms range including the per-frame sort (citation from memory, verify during the test).

**Estimate.** Splat GPU cost ~1-2 ms total, splat CPU ~0, order always exact (a quality *improvement*). This is the endgame number; everything in groups 1-2 fights for fractions of it.

**Test.** Zero integration required to price it: convert the 1.93 M splat benchmark asset to PLY/SPZ, run web-splat (or gsplat.js WebGPU) headless on the same A4000 rig (Chromium WebGPU works headless with the same Vulkan flags), read its own GPU timings, and pixel-compare against the CesiumJS render. One or two days of agent work, and the result is the single most decision-relevant number this project could produce, because it prices the ceiling of all WebGL2 work.

**Costs.** For splat-only scenes: browser support (Chrome/Edge since 2023, Firefox on Windows since 141 in mid-2025, Safari since 26 in late 2025; from memory, verify) and a WebGL2 fallback that must be kept alive. For mixed globe+splat scenes: depth interop is the hard wall. There is no depth sharing between contexts; the workable route is Cesium encoding depth into a color target and per-frame handoff, or accepting composite-without-occlusion. Large engineering, permanent divergence from upstream.

**Composition.** Replaces the entire WebGL2 splat path. Everything in group 1 still pays for itself in the interim, which matters because the interim is long.

### 3.2 WebGL2 tiled rasterization: one fullscreen pass looping over worker-binned per-tile splat lists

**Idea.** Move rasterization into a fragment shader: the sort worker (which already touches every splat) additionally bins splats into 16x16 pixel tile lists, uploads the concatenated lists as a texture, and a single fullscreen triangle walks each pixel's tile list front-to-back, accumulating until opacity saturates, then stops. No per-splat vertices, no primitives, no ROP blending; overdraw dies at first saturation.

**Mechanism.** Eliminates the entire 2.55 ms (or post-in-flight 1.51 ms) vertex/primitive cost and converts fill from "every splat touches every covered pixel" to "every pixel reads splats until done". Whether that trade wins depends on two unknown numbers: the per-pixel terminated list length L, and the WebGL2 cost per loop iteration (roughly 3 texelFetches plus 20 ALU, no workgroup memory, so it leans on the texture cache, which is favorable since all pixels of a tile walk the same list in the same order).

**Estimate.** Honest answer: unknown, could lose by 3x or win by 2x. Back-of-envelope: 2.07 M pixels x L=30 terminated x ~4 fetches = 250 M fetches, plausibly ~1-2 ms; at L=200 it is dead. The CPU binning is also nontrivial: ~2 M splats x average tiles-touched entries per sort, in the worker, on top of the sort.

**Test.** Staged, and stage 1 is valuable to three other ideas: instrument today's renderer with an additive R32F counting pass to get the per-pixel overdraw histogram and the saturation depth (how many splats until accumulated alpha > 0.98). Stage 2: a standalone fullscreen-loop microbenchmark (texture-cached fetch + blend per iteration) to price one iteration on this GPU. Multiply. Only build the binner if the product of the two numbers beats ~2.5 ms. The stage 1 histogram also tells us how much early termination *would* save any renderer, which feeds 2.1 and 2.4 and the WebGPU decision.

**Costs.** Identical pixels are achievable (same order, same math) but the engineering is the largest of any WebGL2 idea; worker binning latency adds to sort staleness; memory for tile lists (~tens of MB, view-dependent).

**Composition.** Replaces the in-flight draw. The stage 1 probe composes with everything and should run regardless.

---

## What I would run first, in order

1. **1.1 floor decomposition** (afternoon, directs 1.5 ms).
2. **1.2 msaaSamples=1 rerun** (thirty minutes, 0.3-0.8 ms, doubles as a 1.1 arm).
3. **3.2-stage-1 overdraw histogram** (day; prices 3.2, 2.4, 2.1, and the WebGPU rasterizer variant).
4. **3.1 web-splat benchmark on the same asset and rig** (1-2 days, prices the ceiling of all WebGL2 work).
5. **1.3 covariance in the VS** (first actual code change: pixel-identical, kills a worker, shrinks the rebuild stall).
6. **2.1 stage-1 prefix clamp** (one hour, prices the whole motion-LOD direction).
7. **1.6 backend replication** on the fleet's Windows and Mac boxes before committing to the next GPU-side design.

Ideas I considered and dropped, for the record: per-pixel k-buffer OIT (needs ROV/atomics, not in WebGL2), splat-order delta encoding of the index texture (scattered updates cost more than they save), Hi-Z per-splat occlusion against terrain depth (benchmark scene has ~no occluders), CPU frustum cull (measured 100 percent pass rate), weighted-sum sort-free rendering (requires per-asset retraining, wrong place: that is arXiv:2410.18931's approach and it belongs in a training pipeline, not a viewer of user uploads), WebGPU-sort-with-WebGL-render hybrid (readback dance buys little over the mined 16-bit counting sort), panorama-space caching for rotation-only motion (orbit and product cameras translate).

---

## Raw data and references

### File and line references relied on

- `packages/engine/Source/Scene/Scene.js:251` - `msaaSamples` defaults to 4; `Scene.js:3941-3951` globeDepth framebuffer built with `scene.msaaSamples`; framebuffer selection to `view.globeDepth.framebuffer` near `Scene.js:3999`; `performGaussianSplatPass` at `Scene.js:2494-2505` (single mergeSort over the command list, trivial at 1 primitive); splat pass ordering at `Scene.js:3084`.
- `tools/splat-perf/harness.html:145-172` - harness context options: no `msaaSamples` override, `resolutionScale = 1.0`, globe/sky/fog off.
- `packages/engine/Source/Shaders/PrimitiveGaussianSplatVS.glsl` - two RGBA32UI texel fetches per splat (position texel, covariance+color texel); f16 3D covariance unpacked and projected per vertex in `calcCovVectors`; 1.2x guard-band frustum discard; 2-pixel minimum size discard (`dot(covVectors.xy) < 4.0 && dot(covVectors.zw) < 4.0`); corner from `gl_VertexID`.
- `packages/engine/Source/Shaders/PrimitiveGaussianSplatFS.glsl` - `B = exp(-4 r^2) * alpha`, so quad-edge alpha is exp(-4) ~ 0.018 of splat alpha (basis for "MSAA buys nothing" and the half-res claim).
- `packages/engine/Source/Workers/gaussianSplatTextureGenerator.js` - covariance texture built in WASM `generate_splat_texture` from positions/scales/rotations/colors (deleted by idea 1.3).
- `packages/engine/Source/Workers/gaussianSplatSorter.js` - position cache (3 sets max) already resident in the worker; sort returns transferred index buffer.
- `packages/engine/Source/Scene/GaussianSplatPrimitive.js:207` - `DEFAULT_SORT_MIN_FRAME_INTERVAL = 3` (idle frames exploited by idea 1.5); `:537-539` attribute texture width = `maximumTextureSize`, 2 texels per splat; `:1711-1716` instanced TRIANGLE_STRIP draw, count 4; `:2031` splat count hard cap `2 x maximumTextureSize` rows.
- Measurements: `docs/splat-perf/01-characterization.md`, `docs/splat-perf/02-attribution.md`. Mined prior review: `docs/agents/2026-08-21-splat-perf/fable-splat-renderer-review.md`.

### Numbers derived in this report

- Post-in-flight projected graphics frame: 1.51 (floor) + 1.08 (fill) + 0.51 (vertex compute) = 3.10 ms.
- Floor slope check: (3.9 M verts, 0 tris) 1.48 ms; (7.7 M, 7.7 M) 1.51 ms; (11.6 M, 3.9 M) 1.51 ms. Implied throughput if vertex-bound: 5.1 vs 7.7 Gverts/s, inconsistent, hence the fixed-overhead hypothesis.
- Quad-edge alpha: exp(-4) = 0.0183.
- Attribute payload repack for idea 1.3: pos 12 B + quat 8 B (4xf16) + scale 6 B (3xf16) + color 4 B = 30 B <= 32 B available.
- Index upload per sort: 4 B x 1.93 M = 7.7 MB; measured moving-vs-static GPU delta 5.16 - 4.09 = 1.07 ms; sorts per 200 frames: 32-33.
- SH texture: 15 RG32UI texels x 8 B = 120 B/splat = 231 MB at 1.93 M splats.
- Tiled-rasterizer envelope: 2.07 M px x L x ~4 fetches; L = 30 gives ~250 M fetches, L = 200 gives 1.66 G (dead).

### External references (from memory as of my January 2026 cutoff; verify titles and numbers before citing onward)

- Kerbl, Kopanas, Leimkuehler, Drettakis, "3D Gaussian Splatting for Real-Time Radiance Field Rendering", SIGGRAPH 2023. Tiled 16x16 compute rasterizer with per-tile sorted lists and early termination (basis for 3.1/3.2).
- Enderton, Sintorn, Shirley, Luebke, "Stochastic Transparency", I3D 2010; Wyman, McGuire, "Hashed Alpha Testing", I3D 2017 (basis for 2.4).
- Radl et al., "StopThePop: Sorted Gaussian Splatting for View-Consistent Real-time Rendering", SIGGRAPH 2024 (per-pixel ordering context; considered and not proposed).
- "Sort-free Gaussian Splatting via Weighted Sum Rendering", arXiv:2410.18931, ICLR 2025 (rejected: needs retraining).
- Fan et al., "LightGaussian", NeurIPS 2024 (~66 percent prune with finetune); "Mini-Splatting", ECCV 2024 (basis for 2.5 ranges).
- Kerbl et al., "A Hierarchical 3D Gaussian Representation for Real-Time Rendering of Very Large Datasets", SIGGRAPH 2024 (splat-domain LOD context for 2.1/2.6).
- KeKsBoTer/web-splat (GitHub, 2023-2024), WGPU browser renderer with per-frame GPU radix sort; mkkellogg/GaussianSplats3D and antimatter15/splat (WebGL comparisons).
- WebGPU availability: Chrome 113 (2023); Firefox 141 on Windows (2025); Safari 26 (2025).
- Vulkan/Metal large point sizes (NVIDIA pointSizeRange to 2047, Metal 511): from memory, and the 2.7 test measures the real limit anyway via `ALIASED_POINT_SIZE_RANGE`.
