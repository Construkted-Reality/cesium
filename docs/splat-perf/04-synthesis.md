# Synthesis: the budget, the ideas, and what is left

Date: 2026-08-22. This file merges the measurements in `00` to `03` with the two
agent reviews in `docs/agents/`. It supersedes the idea lists in those reviews
wherever a measurement contradicts them.

## The one sentence

The splat renderer is fill bound. Fragment work costs about 4.2 ms and hides the
whole 2.98 ms vertex pipeline. Cut fill, or cut splat count, or nothing changes.

## The budget

At 1920 by 1080, 1.93 million splats, degree 3 spherical harmonics, screen space
error 4, orbiting camera, four times multisampling, locked 1875 MHz.

| Number | Value |
| --- | --- |
| Frame period | 11.00 ms |
| Graphics time inside CesiumJS | 4.23 ms |
| Processor time inside CesiumJS | 1.00 ms |
| Frame period with no splat draw | 6.90 ms |

Graphics time passes into frame time one for one. The 6.9 ms remainder is
browser work and has never been investigated.

The graphics time splits into two pipelines. The frame takes the larger.

| Pipeline | Cost |
| --- | --- |
| Fragment, that is fill and blending | about 4.2 ms |
| Vertex, all of it, hidden today | 2.98 ms |

Cost is proportional to splat count at **2.18 ms per million splats**, intercept
0.03 ms.

The processor side costs 1.00 ms median and 2.40 ms at the 95th percentile,
after the three optimizations that shipped. A snapshot rebuild stalls for about
110 ms: 61.7 ms to aggregate and 49.3 ms to build textures.

## What each idea attacks

### Fill, about 4.2 ms, the only thing that binds

| Idea | Expected | State |
| --- | --- | --- |
| `msaaSamples = 1` | 1.03 ms | measured, and it changes the image |
| `msaaSamples = 2` | unknown | not measured at a locked clock |
| Half resolution splat layer | up to 2.4 ms | untested, softens the image |
| Overdraw reduction with early termination | unknown | needs the histogram |
| Tighter alpha cutoff inside the quad | small | bounded by the 2.98 ms vertex floor |

Fill reduction alone cannot take the frame below 2.98 ms.

### Vertex, 2.98 ms, worth nothing until fill drops below it

| Idea | Value today | Value after fill drops |
| --- | --- | --- |
| Remove spherical harmonics | 0.04 ms | 1.23 ms |
| Lower the harmonics degree | 0.01 to 0.07 ms | up to 1.23 ms |
| Indexed draw without instancing | 0 | at most 1.54 ms |
| `gl.POINTS` | negative, it raises fill | up to 1.5 ms |
| Covariance in the vertex shader | 0 | 0 |

### Splat count, which moves both pipelines at once

| Idea | Expected | State |
| --- | --- | --- |
| Prune at import time in the Construkted tiler | 2.18 ms per million removed | untested, zero renderer risk |
| Motion adaptive prefix draw | proportional while moving | untested |
| Motion adaptive screen space error | proportional while moving | needs incremental snapshots |

### Outside the steady frame

| Idea | Expected | What it changes |
| --- | --- | --- |
| Freeze the frame when the camera is still | 4.2 ms to 0.1 ms while idle | viewer setting |
| Covariance in the vertex shader | 20 to 40 ms off each rebuild | deletes the WebAssembly texture generator |
| Index upload through a pixel buffer object | smooths the 95th percentile | untested |
| Hashed stochastic alpha | deletes the sort | dithers the image |
| Look at `drawCommandBuild` | 1.42 ms per sort, 81 ms per run | never investigated |

## What is closed

| Closed idea | Why |
| --- | --- |
| Instancing is expensive | the measurement was clamped to 4 vertices |
| A fixed cost per draw or a 1.50 ms floor | it was 0.11 ms, the clock was not locked |
| The renderer is not fill bound | it is fill bound |
| Spherical harmonics evaluation is free | it costs 1.23 ms, and it is hidden |
| Order independent translucency, antialiasing, high dynamic range | all measured free |
| Frustum culling in the sort worker | 100.0% of splats pass at the benchmark viewpoint |
| Weighted sum sort free rendering | needs the asset retrained, wrong layer |
| Per pixel k buffer transparency | needs atomics that WebGL 2 does not have |

## Run order

1. **Overdraw histogram.** The most valuable measurement left. It says how much
   fill is removable, and it prices the half resolution layer, the prefix clamp,
   stochastic alpha and a tiled rasterizer at once.
2. **Multisampling at 2 samples**, at a locked clock, with an image check.
3. **Sort worker time.** The last completely unmeasured subsystem.
4. **Spec suite baseline** at the base commit. Owed since the start, and it
   blocks any upstream pull request.
5. **Half resolution splat layer.** The largest single fill lever.
6. **Prune splats at import time.** Highest return per unit of renderer risk,
   because the risk is zero, and it lives in the Construkted tiler.
7. **`requestRenderMode` in the product viewer.** Free, and it removes the whole
   frame cost whenever the camera stops.
8. **Investigate the 6.9 ms of frame time that no rendering causes.**
9. **Investigate `drawCommandBuild`**, 1.42 ms per sort.
10. **Repeat the attribution on Windows and macOS**, before committing to any
    graphics side design.
11. **Benchmark a WebGPU splat renderer**, to price the ceiling.

## The shipped work

Three changes, all processor side, all verified pixel identical over four fixed
camera poses.

| Change | Yield |
| --- | --- |
| Cache the sort positions in the worker, and transfer results | `sortPositionCopy` 8.67 ms → 0.17 ms per sort |
| Build the harmonics texture without a repack | `textureProcess` 127.2 ms → 49.3 ms per rebuild |
| Do not draw splats in the pick pass | a correctness fix; the pick framebuffer held splat colours |

Aggregate, before against after:

| | Before | After |
| --- | --- | --- |
| Processor 95th percentile | 10.80 ms | 2.40 ms |
| Processor mean | 3.22 ms | 1.45 ms |
| Frame 95th percentile | 23.40 ms | 12.70 ms |

Graphics time did not change. An earlier claim of 5.16 ms falling to 4.13 ms was
wrong: the two runs had different splat counts and an unlocked graphics clock,
and none of the three changes touches a draw call, a shader or a render state.
