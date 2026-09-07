# Streaming and GPU investigation, 2026-09-07

Baseline: merged PR #2, 826734d915. All builds and measurements run on 192.168.8.212.

Test 1 measures rapid view changes with streaming enabled, then repeated removal and reload under cache pressure.
Test 2 isolates harmonics, fragment arithmetic, and rasterization using diagnostic shader substitutions.
Test 3 tests a quality-preserving candidate selected from those measurements against the unchanged baseline.

Instrumentation records frame distributions, tile loads/unloads, snapshot states, worker cache bytes and releases, and graphics resource creation/deletion.
Raw evidence lives in /mnt/data2/cesium-splat-perf/streaming-gpu-results.
Diagnostic substitutions are test controls, not proposed product changes.

Two streaming repeats force 633-635 tile loads and 539-545 unloads in 1080 measured frames.
Frame p95 is 175.5 / 175.8 ms, p99 is 205.1 / 210.4 ms. GPU p95 is 9.48 / 9.47 ms.
No measured frame has a zero-sized snapshot or zero draw instance count. Pixel visibility requires a separate readback run.
Thirteen rebuilds per run cost 835.5 / 848.4 ms of aggregation in total and 1047.6 / 1072.2 ms of texture processing.
Texture-processing maxima are 215.0 / 211.1 ms. Worker retention peaks at 35,291,892 bytes in these single-tileset runs.

The initial GPU pilot reports 5.658 ms baseline, 5.651 ms without harmonics, 5.647 ms without the fragment exponential,
and 2.549 ms with tiny projected quads. This supports a rasterization/blending bottleneck for the tested view.
The prior opacity histogram has zero fully transparent splats among 1,840,345, so an exact zero-opacity cull cannot improve that fixture.
The next candidate tests immutable texture allocation with identical uploaded bytes, targeting measured rebuild stalls.

The combined Cesium build embeds workers. The first worker telemetry route missed that embedded path.
The corrected harness explicitly loads the equivalent built sorter worker module so its retained cache can be read.
A known framebuffer startup failure occurs before any splat command builds; failed attempts are retained and isolated from completed runs.

Four six-tileset load/remove cycles return worker retention to zero every time.
After removal, graphics counts return to 8 textures, 2 buffers, 4 programs, 1 vertex array, 6 framebuffers, and 2 renderbuffers.
Main-thread array backing storage returns to 22.62 MB from loaded peaks of 5.31-6.32 GB.
The browser embedder heap grows from 1.12 to 2.95 MB across removals. Four cycles do not establish its long-term bound.
The initial six-tileset workload records 63 total cache misses, including warmup, and 2.05 GB of position transfers.
The follow-up cache-budget comparison records separate measurement-start counters.

Immutable texture storage loses in all three paired rebuild runs. Eight rebuilds cost 608.7-616.7 ms of baseline texture processing
versus 1236.6-1247.3 ms with immutable allocation. Frame p99 increases from 99.1-99.3 ms to 174.5-176.4 ms.
All six final raw images have the same SHA-256 hash. Reject this upload path on the tested driver.
The GPU timer alone misleadingly improves on rebuild frames because upload work moves outside its timed rendering window.
End-to-end frame timing exposes the regression.

The second candidate increases the test worker cache budget to 256 MiB for the same six-tileset workload.
This is a memory/performance tradeoff, not a default budget change. Production source remains unchanged.

The 256 MiB worker-budget comparison passes both image pairs with the same 12,060,006 splats in every measured frame.
Frame p95 averages 57.10 to 48.45 ms, CPU p95 15.25 to 5.15 ms, with 59 to zero cache misses per run.
Retained positions increase by 24,120,012 bytes. This supports a configurable budget, not an unconditional default change.

Default tile-cache navigation has frame p95 of 51.5 / 51.6 ms, with 228 loads and no unloads in either repeat.
Second-pass frame p95 is 22.9 / 21.6 ms. The severe 176 ms p95 belongs to the deliberate cache-pressure test.
A separate main-thread profile samples 2678 ms in harmonics packing and 1085 ms in SPZ attribute processing.
Tile decoding and packing are stronger future streaming targets than immutable allocation.

The summary validator confirms all five candidate image pairs, all six-tileset frame-count vectors, worker budget bounds,
and zero retained worker positions at every removal checkpoint. Production source remains unchanged.
