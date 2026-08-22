# Synthesis: the budget, the ideas, and the order to run them

Date: 2026-08-22. This file merges the measurements in `01` to `03` with the
two agent reviews in `docs/agents/`. It supersedes the idea lists in those
reviews where a measurement now contradicts them.

## The budget

At 1920 by 1080, 1.93 million splats, degree 3 spherical harmonics, screen
space error 4, orbiting camera, four times multisampling.

| Bucket | Graphics ms | Share | Source |
| --- | --- | --- | --- |
| Scene floor, per pixel, no splat causes it | 1.50 | 36% | `03-the-floor.md` |
| Vertex invocations, 7.7 million, null shader | 1.05 | 25% | `02-attribution.md` |
| Rasterization and blending of the quads | 1.08 | 26% | `02-attribution.md` |
| Vertex shader compute | 0.51 | 12% | `02-attribution.md` |
| Total | 4.14 | 100% | |

The floor splits into 0.40 ms of multisampling and 1.10 ms of Cesium frame
composition.

The processor side costs 1.50 ms mean and 2.45 ms at the 95th percentile, after
the four optimizations that already shipped. A snapshot rebuild stalls for
about 105 ms, of which about 58 ms is aggregation and about 47 ms is texture
build.

## What each idea attacks

Every idea from both reviews maps onto one bucket. An idea that attacks no
bucket cannot help the steady frame, whatever else it does.

### The floor, 1.50 ms

| Idea | Expected | State |
| --- | --- | --- |
| `msaaSamples = 1` | 0.47 ms | measured, image check in progress |
| Order independent translucency off | 0 ms | measured, free |
| Fast approximate antialiasing off | 0 ms | measured, free |
| High dynamic range off | 0 ms | measured, free |
| The other 1.10 ms | unknown | Cesium frame composition, out of scope |

### Vertex invocations, 1.05 ms

| Idea | Expected | State |
| --- | --- | --- |
| Indexed draw without instancing | unknown, at most 1.05 ms | the earlier price was invalid |
| `gl.POINTS`, four times fewer invocations | at most 1.05 ms, and fill grows | untested |
| Fewer splats, by any route | proportional | see below |

### Rasterization and blending, 1.08 ms

| Idea | Expected | State |
| --- | --- | --- |
| Half resolution splat layer | 0.6 to 0.9 ms | untested, softens the image |
| Tighter alpha cutoff inside the quad | small | bounded by 1.08 ms |
| Fewer splats, by any route | proportional | see below |

### Vertex shader compute, 0.51 ms

Nothing here is worth doing. Spherical harmonics cost 0.01 ms. The covariance
maths costs nothing measurable.

### Outside the steady frame

| Idea | Expected | What it changes |
| --- | --- | --- |
| Freeze the frame when the camera is still | 4.1 ms to 0.1 ms while idle | viewer setting, not the renderer |
| Covariance in the vertex shader | 20 to 40 ms off each rebuild | deletes the WebAssembly texture generator |
| Index upload through a pixel buffer object | 0.2 to 0.4 ms while moving | smooths the 95th percentile |
| Hashed stochastic alpha | deletes the sort, about 1.5 ms of processor time | dithers the image |
| Motion adaptive screen space error | 1 to 2 ms while moving | needs incremental snapshots first |

## The multiplier

Four of the five buckets scale with the number of splats. Anything that cuts
the splat count cuts vertex invocations, fill, vertex compute, sort time, index
upload, texture memory and download size at the same time.

At 30% fewer splats the graphics frame falls by about 0.8 ms and the processor
frame by about 0.5 ms, with no renderer change at all. Published pruning work
removes 50% to 90% with fine tuning and 15% to 40% without it.

This is the highest return for the lowest renderer risk on the whole list, and
it does not live in CesiumJS. It lives in the Construkted tiling pipeline.

## What is closed

Do not spend more time on these.

| Closed idea | Why |
| --- | --- |
| Instancing is expensive | the measurement was clamped to 4 vertices and is invalid |
| A fixed cost per draw explains the floor | the floor is per pixel, intercept near zero |
| Order independent translucency, antialiasing, high dynamic range | all measured free |
| Frustum culling in the sort worker | 100.0% of splats pass at the benchmark viewpoint |
| Spherical harmonics evaluation | 0.01 ms |
| Covariance maths in the vertex shader | free, and it hides behind rasterization |
| Weighted sum sort free rendering | needs the asset retrained, wrong layer |
| Per pixel k buffer transparency | needs atomics that WebGL 2 does not have |

## Run order

Ordered by what unblocks other work, then by how hard the result is to confirm.

1. **Set `msaaSamples = 1`.** One line. 0.47 ms, which is 11% of the frame. The
   image check is running now. Ship it if the check passes.
2. **Measure the overdraw histogram.** A counting pass that reports, per pixel,
   how many splats blend and how many blend before alpha saturates. It prices
   four separate ideas at once: the prefix clamp, the half resolution layer,
   stochastic alpha, and a tiled rasterizer. Measurement only, no risk.
3. **Price the prefix clamp.** Clamp the instance count to the front half of
   the sorted list and record an orbit. One hour. It prices the whole motion
   adaptive direction without any shipping code.
4. **Move the covariance into the vertex shader.** Pixel identical to within
   half precision rounding. It deletes the WebAssembly texture generator and
   one worker round trip, and takes 20 to 40 ms off every rebuild stall. Two
   files change and the check is a golden image diff.
5. **Prune splats at import time in the Construkted tiler.** Highest return,
   zero renderer risk, and the quality gate sits in an offline tool where it can
   be set per asset. Verify by rendering pruned assets through the unmodified
   viewer.
6. **Turn on `requestRenderMode` in the product viewer.** Free, and it removes
   the whole frame cost whenever the camera stops. Worth more than the rest of
   this list for a real session mix.
7. **Benchmark a WebGPU splat renderer on the same asset and the same machine.**
   It prices the ceiling of all WebGL 2 work before anyone commits to a large
   design. One to two days, no integration.
8. **Repeat the attribution on Windows and macOS.** Every number here comes
   from ANGLE on Vulkan. Do this before committing to any graphics side design.
9. **Retest the indexed draw without instancing.** It needs an index buffer, or
   a vertex array whose vertex count is at least the draw count. The payoff is
   bounded by 1.05 ms and is unknown inside that bound.

Items 1 to 3 are cheap and each one either pays or closes a direction. Items 4
to 6 are the real work. Items 7 and 8 protect the next large decision.
