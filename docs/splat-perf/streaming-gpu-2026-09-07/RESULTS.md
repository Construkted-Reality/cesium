# Streaming, memory, and GPU tests

Date: 2026-09-07. Baseline: merged PR #2, `826734d9158ca6f9515f43eb213ffac89505e697`.
All work runs on 192.168.8.212 with an NVIDIA RTX A4000 and Linux ANGLE Vulkan.
Graphics and memory clocks remain at 1350 and 7001 MHz during the tests.
Production renderer source remains unchanged. Candidate changes exist only in the test harness.

## Decisions

- A larger worker cache helps when six active position sets exceed the current 128 MiB budget.
  A configurable budget is worth a production change. Keep a conservative default until more workloads and memory limits are tested.
- Reject immutable texture allocation on this driver. It preserves pixels but increases rebuild stalls.
- Investigate main-thread tile decoding, attribute processing, and harmonics packing next.
  Removing harmonics from the shader does not materially improve the tested GPU workload.

## 1. Streaming and memory

Each navigation run measures 1080 frames with live tile selection.
The camera changes heading and distance every 90 frames and repeats six views.
Each setting has two runs. The default uses a 512 MiB tile cache and 512 MiB maximum overflow.
The pressure test uses a 32 MiB tile cache and 64 MiB maximum overflow.
These tile-cache settings are separate from the sort worker position-cache budget.

| Setting | Frame median | Frame p95 | Frame p99 | Tile loads / unloads |
| --- | ---: | ---: | ---: | --- |
| Default, run 1 | 15.5 ms | 51.5 ms | 180.9 ms | 228 / 0 |
| Default, run 2 | 15.6 ms | 51.6 ms | 191.0 ms | 228 / 0 |
| Pressure, run 1 | 15.9 ms | 175.5 ms | 205.1 ms | 635 / 545 |
| Pressure, run 2 | 16.0 ms | 175.8 ms | 210.4 ms | 633 / 539 |

The 95th and 99th percentiles are abbreviated p95 and p99.
The default-cache runs improve on their second pass through the views: frame p95 reaches 22.9 and 21.6 ms.
These repeated views benefit from retained tiles. They do not establish performance for continuous travel into new data.
The pressure runs have graphics processing unit (GPU) p95 times of about 9.5 ms.
Their largest frame stalls therefore require investigation outside steady GPU rendering.

A separate 640 by 360 pixel-readback run measures visibility over 1080 pressure-test frames.
Every frame contains visible color. The minimum is 11,202 nonblack pixels.
No 1080p timing frame has a zero-sized snapshot or zero draw instance count.
Nonzero pixels do not prove that every expected tile appears, or that no partial holes occur.
Readback changes timing, so the visibility run does not contribute performance numbers.

Four load/remove cycles use six tilesets. After every removal:

- The worker position cache contains zero entries and zero bytes.
- Live graphics counts return to 8 textures, 2 buffers, 4 programs, 1 vertex array, 6 framebuffers, and 2 renderbuffers.
- Main-thread array backing storage returns to approximately 22.6 MB, from loaded values of 5.31 to 6.32 GB.

The browser embedder heap grows from 1.12 to 2.95 MB across the four removal checkpoints.
This test finds no large retained-array or graphics-resource leak. It does not establish a long-term bound for browser-native memory.
Worker cache bytes exclude WebAssembly scratch memory. Main-thread heap measurements exclude other browser processes.

A separate central processing unit (CPU) profile covers the pressure navigation window.
Harmonics packing has approximately 2678 ms of sampled self time, SPZ attribute processing has 1085 ms, and texImage2D has 724 ms.
The profile also contains substantial WebAssembly and decoded-array conversion work.
Sampled self time identifies investigation targets; it is not a prediction of the speedup from removing a function.
Profiler runs do not contribute the paired performance claims.

## 2. GPU attribution

Two interleaved repeats use 2,087,136 splats, fixed tile selection, a static camera, and 400 measured frames.
The viewport is 1920 by 1080. Multisample anti-aliasing remains at four samples.
The table averages the two per-run medians.

| Diagnostic control | GPU median |
| --- | ---: |
| Unchanged renderer | 5.661 ms |
| Remove spherical harmonics evaluation | 5.651 ms |
| Remove the fragment exponential | 5.648 ms |
| Shrink projected quads to tiny coverage | 2.555 ms |
| Skip the splat draw | 0.333 ms |

The controls support a rasterization and blending bottleneck for this view.
They do not provide an additive decomposition because GPU stages overlap.
The tiny-quad control changes interpolation coordinates as well as coverage.
All diagnostic controls change the image and are unsuitable as production optimizations.
No anti-aliasing or opacity-quality reduction is proposed.

## 3. Candidate comparisons

### Immutable texture allocation: reject

The candidate replaces integer texture allocation through texImage2D with texStorage2D followed by texSubImage2D.
Three interleaved pairs force eight snapshot rebuilds with the same 2,087,136 splats over 720 frames.
The uploaded bytes, dimensions, splat counts, and final pixels match.

| Metric | Baseline range | Candidate range |
| --- | ---: | ---: |
| Total texture-processing time, eight rebuilds | 608.7-616.7 ms | 1236.6-1247.3 ms |
| Frame p99 | 99.1-99.3 ms | 174.5-176.4 ms |

This allocation path approximately doubles texture-processing time on the tested driver.
GPU query results alone can suggest an improvement because uploads occur outside the timed rendering window.
End-to-end frame results expose the regression.

### Larger worker position cache: retain as a candidate

Two interleaved pairs compare 128 and 256 MiB worker budgets.
Each run draws six copies of the asset, totaling 12,060,006 splats, for 400 frames.
Every measured frame has the same six-element splat-count vector. Tile selection remains fixed.
The final baseline and candidate images match byte for byte in both pairs.
The following values average the two per-run statistics.

| Metric | 128 MiB budget | 256 MiB budget |
| --- | ---: | ---: |
| Frame median | 45.45 ms | 45.35 ms |
| Frame p95 | 57.10 ms | 48.45 ms |
| Frame p99 | 62.50 ms | 54.30 ms |
| CPU rendering-span p95 | 15.25 ms | 5.15 ms |
| GPU median | 32.829 ms | 32.847 ms |
| Worker cache misses during each measured run | 59 | 0 |
| Position bytes resent during each measured run | 1,423,080,708 | 0 |
| Retained position bytes at the end | 120,600,060 | 144,720,072 |

Frame p95 falls by 15.1%. CPU rendering-span p95 falls by 66.2%.
Median frame and GPU times show no material gain.
Actual retained positions increase by 24,120,012 bytes, approximately 23 MiB, in this workload.
The maximum permitted retention doubles. Other workloads can consume the entire additional 128 MiB.
The test changes the worker budget only. Its individual position sets fit below either budget.
A production configuration must keep the main-thread admission limit and worker budget consistent, including oversized inputs.
Six overlapping copies test cache contention. They do not validate global depth ordering across primitives.

## Reproduction and evidence

Build the baseline with `npm run build`. Start `node tools/splat-perf/serve.mjs --port 8099` on the GPU server.
The asset must exist at `/mnt/data2/gs/oracle-run/geo-newdefault/tileset.json`.
Lock clocks with the commands in the existing environment report. Run one suite at a time:

```sh
node tools/splat-perf/streaming-gpu-run.mjs docs/splat-perf/streaming-gpu-2026-09-07/streaming-runs.json
node tools/splat-perf/streaming-gpu-run.mjs docs/splat-perf/streaming-gpu-2026-09-07/profile-runs.json
node tools/splat-perf/streaming-gpu-run.mjs docs/splat-perf/streaming-gpu-2026-09-07/visibility-runs.json
node tools/splat-perf/streaming-gpu-run.mjs docs/splat-perf/streaming-gpu-2026-09-07/candidate-runs.json
node tools/splat-perf/streaming-gpu-run.mjs docs/splat-perf/streaming-gpu-2026-09-07/cache-runs.json
node tools/splat-perf/streaming-gpu-run.mjs docs/splat-perf/streaming-gpu-2026-09-07/attribution-runs.json
python3 tools/splat-perf/summarize-streaming-gpu.py
```

Restore automatic clocks after measurement with `sudo nvidia-smi -rgc` and `sudo nvidia-smi -rmc`.
The harness explicitly loads the built sorter worker module to observe its cache instead of using the embedded worker.
The driver retains failed attempts and retries only the known framebuffer initialization failure before any splat command builds.
An initial CPU-profile attempt failed at startup three times. Starting CPU sampling after warmup produces the retained successful profile.

[summary.json](summary.json) contains the measurements, cache checkpoints, image hashes, and failed-attempt filenames.
[NOTES.md](NOTES.md) records the investigation and rejected approaches.
Raw frames, profiles, logs, and JSON remain under `/mnt/data2/cesium-splat-perf/streaming-gpu-results/` on the server.
These results cover one GPU, operating system, asset family, and set of camera paths.
The renderer source is unchanged, so the existing engine specification suite is not repeated for these harness-only experiments.
