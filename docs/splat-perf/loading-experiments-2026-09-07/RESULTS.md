# Loading experiment results

These experiments extend merged pull request (PR) #2, commit `826734d915`.
The harness extends PR #3, commit `c153f20b8f`. Production engine source does not change.
All measurements run on 192.168.8.212 with an NVIDIA RTX A4000.
Hardware runs use Vulkan with graphics and memory clocks locked at 1350 and 7001 MHz.

## Decision

Implement direct spherical harmonics (SH) packing and a configurable position-cache budget next.
Keep worker decoding experimental until snapshot scheduling and complete-view latency improve.
The memory tests find stable array and graphics retention after removal, with small JavaScript heap growth still present.

## 1. Runtime cache budget

The prototype changes the worker position budget during a six-tileset run:
256, 64, 0, then 128 mebibytes (MiB). Lower budgets trigger eviction.
All five invalid values fail validation. Disabling the cache leaves zero entries and zero retained bytes.
The historical peak is 144,720,072 bytes, below the 256 MiB limit active at that time.

This run verifies configuration behavior. It does not isolate a new performance gain.
PR #3 already measures a frame-time 95th percentile improvement from 57.10 to 48.45 milliseconds (ms)
with a 256 MiB limit, at an actual retention increase of approximately 23 MiB.
Production work needs a documented option and tests for multiple users of the shared worker.
A larger budget remains a memory tradeoff, not a universal default.

## 2. Direct packing

The prototype packs decoder SH data directly into the dense half-float representation.
It avoids separate coefficient arrays. The half-float conversion matches the existing implementation.

| SH degree | Existing pack time, ms | Direct pack time, ms | Intermediate arrays avoided |
| --- | --- | --- | --- |
| 1 | 18.68 | 10.58 | 9 MiB |
| 2 | 47.11 | 23.23 | 24 MiB |
| 3 | 69.90 | 42.74 | 45 MiB |

These kernel measurements use 262,144 splats and four interleaved timing pairs.
They measure packing only. Exact comparisons pass for degrees 0 through 3 and exceptional float values.
The final degree-0 fast path passes verification; the earlier degree-0 timing is obsolete.
Malformed lengths fail validation. An incompatible attribute schema uses the existing path.

The fixed-view browser tests measure the first final-count snapshot with all tiles loaded and no pending snapshot.
Times start at the first instrumented startup frame. Each cell contains two runs.

| Asset and mode | Complete view, seconds | Largest startup gap, ms | Retained main array storage, decimal GB |
| --- | --- | --- | --- |
| Geo baseline | 5.94, 6.01 | 443, 440 | 1.422, 1.422 |
| Geo direct | 5.68, 5.72 | 464, 431 | 0.923, 0.923 |
| Geo worker | 8.26, 8.26 | 195, 196 | 1.004, 0.996 |
| Bike baseline | 2.44, 2.30 | 217, 234 | 0.501, 0.500 |
| Bike direct | 2.14, 2.19 | 180, 178 | 0.331, 0.331 |
| Bike worker | 2.82, 3.20 | 101, 87 | 0.351, 0.355 |

Direct packing reduces mean complete-view time by approximately 5% on Geo and 9% on Bike.
Geo main-thread array storage falls approximately 35%. Storage measurements follow garbage collection;
they exclude worker memory and do not represent peak process memory.
The six captures per asset match byte for byte: 2,087,136 Geo splats and 705,883 Bike splats.

The harness carries packed data on an attribute buffer as temporary plumbing.
Production code needs an explicit loader/component field and loader lifetime tests.

## 3. Worker decoding and packing

One worker decodes and packs one tile at a time. The queue transfers input only when a job starts.
It drops queued jobs after loader destruction and preserves the existing guard for active results.
Five destruction cases drain the queue. Malformed compressed input fails, and a subsequent valid tileset renders.
The worker restarts after decoder failure.

| Live streaming asset | Baseline frame p95, ms | Direct frame p95, ms | Worker frame p95, ms |
| --- | --- | --- | --- |
| Geo | 177.6, 175.6 | 139.1, 132.8 | 106.9, 85.6 |
| Bike | 121.8, 137.9 | 122.6, 124.3 | 54.8, 52.5 |

Each run has 1080 measured frames at 1920 by 1080 pixels and repeats the stress camera path twice.
Tile-cache limits are 32 MiB plus 64 MiB overflow. The runs load different amounts of data.
The summary records load, unload, and build counts. These percentiles are responsiveness observations,
not fixed-workload speedup ratios. Two repeats do not establish statistical confidence.

Worker decoding reduces startup stalls but increases complete-view latency on both assets.
Geo produces 15 snapshots instead of 2, with the same 139 tile loads.
Progressive arrivals plausibly cause redundant snapshot work. This attribution still needs an isolated test.
Main-thread decoder timings overlap asynchronous initialization; worker decoder timings are serial.
Do not compare their summed durations as decoder speed measurements.

The installed SPZ loader creates a WebAssembly (WASM) module for each decode.
The prototype preserves that behavior. Measure module initialization before testing safe module reuse.
A bounded worker pool and snapshot coalescing are further candidates, with cancellation and fairness tests required.

## 4. Memory, assets, and graphics backends

Three tests complete 24 load/remove cycles each: Geo baseline, Geo worker, and Bike worker.
Every removal returns worker position retention to zero and graphics-resource counts to the same baseline.
Main-thread array storage stays near 22.6 megabytes (MB).
Main JavaScript heap grows approximately 1.1 to 1.5 MB across each test.
This does not establish indefinite memory stability or account for all browser-native allocations.

Separate eight-cycle tests expose WASM linear memory explicitly because browser heap counters omit it.
The baseline texture generator retains 45,940,736 bytes and sorter retains 19,267,584 bytes.
The worker variant retains 46,333,952 and 18,481,152 bytes respectively.
These values stay constant across all eight removal checkpoints.
The decoder reports a maximum individual module heap of 26,017,792 bytes.
That maximum is not the total live decoder memory.

OpenGL, ANGLE OpenGL, and Ozone OpenGL configurations all fall back to SwiftShader software rendering.
The first full-size software run times out. A smaller 256 by 256 test completes and produces identical
baseline and worker pixels for 42,279 splats. Software rendering provides no GPU timer queries.
A second hardware graphics backend remains untested on this server.

The extra Geo flat asset produces identical pixels across all three modes for 959,630 splats.
Its run labels say `degree0`, but runtime data reports SH degree 3. It does not provide degree-0 browser coverage.
Degree-0 coverage is limited to kernel verification.

## Evidence and reproduction

`summary.json` contains compact measurements and image hashes. The adjacent JSON files preserve run configurations,
kernel results, and backend detection. Raw browser results, captures, logs, and completion markers remain at
`/mnt/data2/cesium-splat-perf/loading-experiment-results` on the GPU server.
Failed runs remain available and are excluded from result comparisons.

The tools use the existing unminified build with explicit response interception for prototypes.
They require this baseline build and installed dependencies. They are not production feature switches.
Start the existing `serve.mjs` server on port 8099, then pass a saved configuration file to `loading-run.mjs`.
Run `python3 tools/splat-perf/loading-summary.py` from the repository to repeat evidence validation.
Run `node tools/splat-perf/loading-kernel-check.mjs --verify-only` to repeat exact packing checks.

No production engine tests run for this experiment-only change. Source formatting, lint, normal commit hooks,
exact packing checks, image equality, lifecycle checks, and recovery checks validate this deliverable.
