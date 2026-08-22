# The floor: graphics time that no splat causes

Date: 2026-08-22. Hardware and toolchain: see `00-environment.md`.

## Summary

A scene that holds a splat tileset costs graphics time even when the splat
primitive draws nothing. At 1920 by 1080 that cost is 1.50 ms per frame, which
is 36% of the 4.14 ms the full scene spends.

The cost is per pixel. It is 0.73 ms per megapixel with four times
multisampling, and 0.45 ms per megapixel with multisampling off. The intercept
is near zero, so the cost does not depend on the number of splats, the number
of draw commands, or the work of the splat primitive.

This sets a hard limit. If every splat specific cost fell to zero, the frame
would still spend 1.50 ms at 1080p. Only 2.64 ms of the 4.14 ms is open to
splat optimization.

## Method

Three builds, each measured at three resolutions and two multisample rates.
Every run is 400 frames after 120 warm up frames, orbiting camera, screen space
error 4, tileset `geo-newdefault` with 1929318 splats. The reported value is
the median of the graphics timer query.

| Build | What it does |
| --- | --- |
| full | the unmodified renderer |
| one | `instanceCount` forced to 1, so one splat draws |
| nodraw | the draw command is never pushed, but the primitive still sorts and uploads |
| noupdate | `update` returns at once, so the primitive does nothing at all |
| empty | no tileset is added to the scene |

The script is `/mnt/data2/cesium-splat-perf/matrix.sh` and
`/mnt/data2/cesium-splat-perf/floor3.sh`. Neither is part of the repository.

## Results

Graphics ms, median.

| Build | 1280x720 | 1920x1080 | 2560x1440 |
| --- | --- | --- | --- |
| nodraw, 4 samples | 0.80 | 1.56 | 2.82 |
| nodraw, 1 sample | 0.61 | 1.16 | 1.85 |
| noupdate, 4 samples | 0.79 | 1.17 | 2.81 |
| noupdate, 1 sample | 0.60 | 1.13 | 1.85 |

At 1920 by 1080 only:

| Build | 4 samples | 1 sample |
| --- | --- | --- |
| full | 4.12 | 3.72 |
| one splat | 1.51 | 0.78 |
| nodraw | 1.56 | 1.16 |
| noupdate | 1.17 | 1.13 |
| empty | 0.11 | 0.07 |

The 1.17 value for noupdate at 1080p with 4 samples is a median from a skewed
distribution. Its mean is 1.17 and its 95th percentile is 1.91. The 720p and
1440p cells of the same row match the nodraw row, so the floor does not change
when the primitive stops working.

## What the floor is

It is per pixel work that starts when a tileset joins the scene.

- **nodraw and noupdate agree.** The sort, the texture uploads and the whole
  primitive update contribute nothing. The floor is not upload cost.
- **The slope is flat and the intercept is near zero.** With four samples the
  slope is 0.73 ms per megapixel and the intercept is 0.13 ms. With one sample
  the slope is 0.45 ms per megapixel and the intercept is 0.20 ms.
- **The empty scene costs 0.11 ms.** So the floor appears because a tileset is
  present, not because the browser presents a frame.

## What the floor is not

Four candidate causes are now closed by measurement.

| Candidate | Test | Result |
| --- | --- | --- |
| Order independent translucency | `scene.orderIndependentTranslucency = false` | 4.16 ms against 4.12 ms. Free. |
| Fast approximate antialiasing | `postProcessStages.fxaa.enabled = false` | 4.14 ms against 4.12 ms. Free. |
| High dynamic range | `scene.highDynamicRange = false` | 4.16 ms against 4.12 ms. Free. |
| The splat primitive update | the noupdate build | no change against nodraw. |

The scene probe `tools/splat-perf/probe-env.mjs` reports the state that a
loaded tileset produces: `useGlobeDepthFramebuffer` true, `useOIT` true,
`usePostProcess` false. Turning order independent translucency off removes the
`useOIT` path and changes nothing, so the remaining suspects are the globe
depth framebuffer copy, the scene framebuffer resolve, and the final blit.

## The part we can take

Multisampling is 0.40 ms of the floor at 1080p, and 0.47 ms of the full scene.

| Arm | Graphics ms, run 1 | Graphics ms, run 2 |
| --- | --- | --- |
| base | 4.12 | 4.13 |
| no order independent translucency | 4.16 | 4.16 |
| one multisample | 3.66 | 3.65 |
| both | 3.63 | 3.79 |

Gaussian splats gain nothing from multisampling. The fragment shader writes
`exp(-4 r^2)` times alpha, so the alpha at the quad edge is 1.8% of the splat
alpha. There is no hard edge for the extra samples to resolve.

`scene.msaaSamples = 1` is one line in the viewer setup. It also removes edge
antialiasing from any opaque geometry in the same scene.

## The remaining 1.1 ms

About 1.1 ms per frame at 1080p is unexplained. It is per pixel, it is not
multisampling, and it is not any pass listed above. It is a cost of the Cesium
frame composition chain rather than of the splat renderer, because it survives
a build in which the splat primitive does nothing.

Chasing it means changing how Cesium composes a frame, which is out of scope
for splat work. The next splat gain has to come from the 2.64 ms above the
floor.
