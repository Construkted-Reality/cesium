# Where the graphics time goes

Date: 2026-08-21, rewritten 2026-08-22 after two corrections. Hardware and
toolchain: see `00-environment.md`.

**CAUTION:** Every number in this file needs a locked graphics clock. Read the
clock section of `00-environment.md` before you repeat any of it.

## Correction notice

This file has been wrong twice.

1. It said an equivalent draw without instancing saves 1.0 ms. That measurement
   was clamped by `Context.js` to 4 vertices. See "The draw structure
   measurement that failed".
2. It said the renderer is not fill bound, that spherical harmonics are free,
   and that a 1.50 ms floor takes 36% of the frame. All three came from an
   unlocked graphics clock. See `03-the-floor.md`.

The numbers below are re-measured at a locked 1875 MHz, two passes, 400 frames
each, agreeing to within 0.02 ms.

## Summary

**The splat renderer is fill bound.** Fragment work costs about 4.2 ms and hides
the entire 2.98 ms vertex pipeline behind it. No vertex side optimization
changes the frame until fill drops below 2.98 ms.

At 1.93 million splats, 1920 by 1080, screen space error 4, the graphics
processor spends 4.23 ms per frame.

## What the frame is made of

Three numbers come out of the harness and they measure different things.

| Number | What it measures |
| --- | --- |
| `gpu ms` | The graphics processor executing the commands CesiumJS submits for one frame. A `TIME_ELAPSED_EXT` query opened at `preRender` and closed at `postRender`. |
| `cpu ms` | Wall time on the JavaScript thread from `preUpdate` to `postRender`. |
| `frame ms` | Wall time between one `postRender` and the next. |

The graphics processor runs asynchronously, so `frame ms` is not the sum of the
other two. The sort worker runs on a third thread and appears in none of them.

Base scene, 1080p, vertical sync disabled:

| Arm | gpu ms | frame ms |
| --- | --- | --- |
| base | 4.22 | 11.00 |
| 25% of splats drawn | 1.08 | 7.90 |
| no splat draw at all | 0.11 | 6.90 |

Graphics time passes into frame time one for one. Base minus no draw is 4.11 ms
of graphics and 4.10 ms of frame.

There is a fixed 6.9 ms per frame that no rendering causes. It has never been
investigated, and it may be an artifact of a headless browser with vertical sync
disabled. Do not quote a frame time from this harness as a product number.

## Method

Each variant changes one thing and measures again. Every run is 400 frames after
120 warm up frames, orbiting camera, and the reported value is the median of the
graphics timer query. Two passes per variant, interleaved, so machine drift hits
all variants alike. The tileset is `geo-newdefault` with 1929318 splats and
degree 3 spherical harmonics.

The variants change the image, so they are measurement tools only. The scripts
`attrib.py`, `attrib4.py` and `attrib-locked.sh` live in
`/mnt/data2/cesium-splat-perf/` and are not part of the repository.

## The variants

| Variant | Graphics ms | What it removes |
| --- | --- | --- |
| base | 4.23 | nothing |
| no spherical harmonics | 4.19 | the harmonics fetch and evaluation |
| tiny quads | 2.98 | 400 times the quad area, so almost all fill |
| no harmonics and tiny quads | 1.75 | both of the above |
| position only | 1.75 | the covariance fetch and the covariance maths |
| index only | 1.72 | everything except the instanced attribute read |
| null vertex shader | 1.54 | everything except writing a clip position |
| no splat draw at all | 0.11 | the draw command |

## The model that fits every variant

The frame is the larger of the two pipelines, not their sum.

| Variant | Vertex pipeline | Fill | Predicted | Measured |
| --- | --- | --- | --- | --- |
| base | 2.98 | 4.2 | 4.2 | 4.23 |
| no harmonics | 1.75 | 4.2 | 4.2 | 4.19 |
| tiny quads | 2.98 | 0 | 2.98 | 2.98 |
| no harmonics, tiny quads | 1.75 | 0 | 1.75 | 1.75 |
| null vertex shader | 1.54 | 0 | 1.54 | 1.54 |

The vertex pipeline itself breaks down as follows. None of it is on the critical
path today.

| Part of the vertex pipeline | Cost |
| --- | --- |
| Invocation and primitive assembly, 7.7 million vertices | 1.54 ms |
| Reading the instanced index attribute | 0.18 ms |
| Position fetch, covariance fetch and covariance maths | 0.03 ms |
| Spherical harmonics evaluation | 1.23 ms |
| Total | 2.98 ms |

The harmonics run once per vertex, so four times per splat, and the colour is
constant across the quad. That is 7.7 million evaluations doing the work of
1.93 million.

## The harmonics degree sweep confirms it

Lowering the degree with the `u_sphericalHarmonicsDegree` uniform, two passes:

| Degree | Graphics ms |
| --- | --- |
| 3 | 4.22, 4.28 |
| 2 | 4.21, 4.23 |
| 1 | 4.21, 4.22 |
| 0 | 4.21, 4.21 |

Degree 3 down to degree 0 saves 0.01 to 0.07 ms. The harmonics work is real and
costs 1.23 ms, and it is entirely hidden behind fill.

## Cost against splat count

Three interleaved passes, agreeing to within 0.02 ms. Median graphics ms.

| Splats drawn | Millions | 4 samples | 1 sample |
| --- | --- | --- | --- |
| 100% | 1.929 | 4.23 | 3.20 |
| 75% | 1.447 | 3.05 | 2.33 |
| 50% | 0.965 | 2.01 | 1.52 |
| 25% | 0.482 | 1.08 | 0.78 |
| 10% | 0.193 | 0.57 | 0.37 |
| 1% | 0.019 | 0.34 | 0.17 |

A fit over 100% to 25% gives **2.18 ms per million splats with an intercept of
0.03 ms**. Cost is proportional to splat count and there is no overhead to
amortize. Cut 30% of the splats and you cut 30% of the graphics time.

## Multisampling

Four samples against one, at the locked clock:

| Splats drawn | 4 samples | 1 sample | Saving |
| --- | --- | --- | --- |
| 100% | 4.23 | 3.20 | 1.03 ms |
| 50% | 2.01 | 1.52 | 0.49 ms |
| 25% | 1.08 | 0.78 | 0.30 ms |

The saving scales with splat count, so it is per fragment blending cost, not a
fixed resolve. It is 24% of graphics time and 9% of frame time.

It is **not** pixel identical. Four fixed poses, one sample against four:

| Pose | Channels differing | Max delta | Mean delta |
| --- | --- | --- | --- |
| geo-close | 27.3% | 62 | 2.54 |
| geo-h000-p25 | 9.1% | 64 | 3.02 |
| geo-h090-p45 | 19.2% | 62 | 3.36 |
| geo-h200-p10 | 3.5% | 54 | 2.98 |

`scene.msaaSamples` is a runtime property with a setter, and a `Viewer` and
`Scene` construction option. It needs no code change to evaluate.

## What this rules out

- **Every vertex side optimization**, at current settings. That covers
  `gl.POINTS`, an indexed draw without instancing, lowering the harmonics
  degree, and moving the covariance into the vertex shader. The vertex pipeline
  is 2.98 ms and the frame is 4.23 ms. None of that work is on the critical
  path. `gl.POINTS` is worse than neutral, because it raises fill.
- **Splat culling in the sort worker.** At the benchmark viewpoint every splat
  passes the frustum test the vertex shader runs.
  `tools/splat-perf/probe-visibility.mjs` reports 100.0% of 2049998 splats.
- **Order independent translucency, antialiasing and high dynamic range.** All
  measured free: 4.16, 4.14 and 4.16 against a base of 4.12.

## What this opens

Fill reduction is the only lever that moves the frame, and it has a hard stop at
2.98 ms, where the vertex pipeline starts binding. Past that point every closed
idea reopens and they stack.

| Step | Fill | Vertex | Frame |
| --- | --- | --- | --- |
| today | 4.2 | 2.98 | 4.23 |
| multisampling off | 3.2 | 2.98 | 3.20 |
| plus a half resolution splat layer | 0.8 | 2.98 | about 2.98 |
| plus harmonics removal | 0.8 | 1.75 | about 1.75 |

Cutting splat count moves both columns at once, which is why it composes with
everything.

## The draw structure measurement that failed

Four runs tried to price the draw structure with a null vertex shader.

| Variant | Vertices asked for | Graphics ms |
| --- | --- | --- |
| 1.93 M instances of 4 vertices, strip | 7.7 M | 2.51 |
| 1.93 M instances of 2 vertices, strip | 3.9 M | 1.48 |
| one draw of 7.7 M vertices, strip | 7.7 M | 1.51 |
| one draw of 11.6 M vertices, triangles | 11.6 M | 1.51 |

Rows three and four are invalid. `Context.js:1385` clamps a draw that has no
index buffer:

```js
count = Math.min(count, va.numberOfVertices);
```

The vertex array holds 4 vertices, so both runs drew 4. Row two is a valid draw,
but a triangle strip of 2 vertices makes no triangles.

A retest needs an index buffer, or a vertex array whose `numberOfVertices` is at
least the draw count. It has not run, and after the fill bound result it is no
longer worth running.

## A note on the headless browser

A standalone probe page that timed the same draws outside CesiumJS did not work.
Three timing methods failed on this browser and driver:

- `gl.finish` returns at once and reports 0 ms for a draw of 7.7 million
  vertices.
- A graphics timer query read from a plain timer callback loses the context.
- A graphics timer query read in a spin loop never becomes available, because
  the result needs a return to the event loop.

Timer queries do work when the draw and the read both happen inside a frame
callback, which is what CesiumJS does.
