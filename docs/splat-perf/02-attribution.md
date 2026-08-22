# Where the graphics time goes

Date: 2026-08-21. Hardware and toolchain: see `00-environment.md`.

## Summary

The splat renderer is not fill bound. It is bound by the number of vertex
invocations, and most of that cost is the structure of the draw, not the work
inside the vertex shader.

At 1.93 million splats, 1920 by 1080, screen space error 4, the graphics
processor spends 4.14 ms per frame. Of that:

| Part | Cost | Share |
| --- | --- | --- |
| Vertex invocations that write only a clip position | 2.55 ms | 62% |
| Rasterization and blending of the quads | 1.08 ms | 26% |
| Everything the vertex shader computes | 0.51 ms | 12% |

The last row includes the position fetch, the covariance fetch, the covariance
maths and the whole spherical harmonics evaluation.

An equivalent draw without instancing costs 1.51 ms instead of 2.51 ms. That
is a saving of 1.0 ms, or 24% of the whole frame.

## Method

Each variant changes one thing and measures again. Every run is 300 frames
after 120 warm up frames, orbiting camera, and the reported value is the median
of the graphics timer query. Two runs per variant. The tileset is
`geo-newdefault` with 1929318 splats and degree 3 spherical harmonics.

The variants change the image, so they are measurement tools only. The script
`attrib.py` and its companions live in `/mnt/data2/cesium-splat-perf/` and are
not part of the repository.

## Vertex shader variants

| Variant | Graphics ms | What it removes |
| --- | --- | --- |
| base | 4.14 | nothing |
| no spherical harmonics | 4.13 | the harmonics fetch and evaluation |
| tiny quads | 3.06 | 400 times the quad area, so almost all fill |
| no harmonics and tiny quads | 2.64 | both of the above |
| position only | 2.62 | the covariance fetch and the covariance maths |
| index only | 2.70 | everything except the instanced attribute read |
| null | 2.55 | everything except writing a clip position |

Three results stand out.

1. Spherical harmonics are free with full size quads. Removing them saves
   0.01 ms. With tiny quads the same change saves 0.42 ms, so the harmonics
   work hides behind rasterization when the quads are large.
2. The covariance maths is free. The position only variant and the null variant
   are within 0.07 ms of each other.
3. The null variant still costs 2.55 ms. That is the price of 7.7 million
   vertex invocations that produce a constant, before any useful work.

## Draw structure variants

These runs use the null vertex shader, so only the shape of the draw changes.

| Variant | Vertices | Triangles | Graphics ms |
| --- | --- | --- | --- |
| 1.93 M instances of 4 vertices, strip | 7.7 M | 3.9 M | 2.51 |
| 1.93 M instances of 2 vertices, strip | 3.9 M | 0 | 1.48 |
| one draw of 7.7 M vertices, strip | 7.7 M | 7.7 M | 1.51 |
| one draw of 11.6 M vertices, triangles | 11.6 M | 3.9 M | 1.51 |

Halving the vertices per instance halves the cost, so the instanced path scales
with vertex invocations and not with instance count.

The two draws without instancing cost the same 1.51 ms, even though one shades
50% more vertices and the other assembles twice as many triangles. Neither the
vertex count nor the triangle count binds at that level. The instanced draw
costs 1.0 ms more for the same geometry.

## What this rules out

Two ideas that looked promising are now closed.

- **Fill reduction.** Fill is 26% of graphics time. Shrinking the quads by 400
  times in area saves only 1.08 ms. A tighter cutoff inside the current quad
  can save a fraction of that at best.
- **Splat culling in the sort worker.** At the benchmark viewpoint every splat
  passes the frustum test that the vertex shader runs. The tool
  `tools/splat-perf/probe-visibility.mjs` reports 100.0% of 2049998 splats. A
  cull would gain nothing in this scene. It may still help when the camera sits
  inside the data.

An earlier estimate in `01-characterization.md` read the 720p against 1080p
pair as evidence that fill dominates. That reading was wrong. The two runs
differed in splat count, and resolution also changes how many splats pass the
two pixel size test in the vertex shader.

## What this opens

Draw the splats without instancing. The shape that keeps four vertex
invocations per splat is:

1. A static index buffer with six entries per splat, holding
   `splatSlot * 4 + corner` with corner taken from the list 0, 1, 2, 1, 3, 2.
   The buffer never changes with the sort order, so it is built once.
2. `drawElements` over that buffer. The post transform cache turns the six
   indices into four vertex invocations per splat.
3. The vertex shader reads `splatSlot` as `gl_VertexID >> 2` and the corner as
   `gl_VertexID & 3`.
4. The sorted splat index moves from an instanced vertex attribute to a texture,
   read with one `texelFetch`. The upload per sort stays at 4 bytes per splat.

Expected result: 4.14 ms falls to about 3.1 ms, a saving of 25%.

## A note on the headless browser

A standalone probe page that timed the same draws outside CesiumJS did not
work. Three timing methods failed on this browser and driver:

- `gl.finish` returns at once and reports 0 ms for a draw of 7.7 million
  vertices.
- A graphics timer query read from a plain timer callback loses the context.
- A graphics timer query read in a spin loop never becomes available, because
  the result needs a return to the event loop.

Timer queries do work when the draw and the read both happen inside a frame
callback, which is what CesiumJS does. All the numbers above therefore come
from the CesiumJS harness.
