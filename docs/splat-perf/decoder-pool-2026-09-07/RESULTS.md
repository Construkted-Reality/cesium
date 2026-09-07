# Bounded SPZ decoder pool

The production pool makes partial content visible earlier and reduces loading stalls.
Geo tile loading improves by about 6 percent. Bike tile loading and the time to the final splat count remain approximately unchanged.
This result does not reproduce the prototype full-load gains reported in PR #5.

## Implementation

`GltfSpzLoader` sends compressed data to `SpzDecoder`. The decoder creates at most two `TaskProcessor` workers, with one active task per worker.
Devices that report one or two logical processors use one worker.
A busy loader retries on a later frame. The pool does not retain another queue.
It copies a compressed buffer view only after admission, so it does not detach the shared source buffer.

The worker decodes SPZ and packs supported spherical harmonics (SH) layouts.
It returns the packed data separately and preserves the original coefficients for expanded consumers of the shared resource cache.
The existing SH validation and fallback remain available. Degree-0 data also uses the worker.

A rejected decode, worker error, or message error releases the slot and destroys its task processor.
A later request creates a new processor. Destruction drops a waiting loader without scheduling it.
An active decode finishes, and the destroyed loader ignores its result.
Workers remain available for later tilesets, as other shared Cesium task processors do.

The implementation preserves the existing snapshot policy. It adds no public setting.
The two-task limit bounds concurrency, not arbitrary input memory. The existing per-payload memory estimate remains in place.

## Measurement conditions

All work runs on 192.168.8.212, with 28 virtual CPUs and an NVIDIA RTX A4000 with 16 GB of memory.
The tests lock graphics and memory clocks to 1350 MHz and 7001 MHz.
The baseline is the merged PR #5 engine at `80eb285382`. Each case records the bundle and harness hashes.
The loading comparison uses three repetitions per asset and mode, with alternating order.
The tests use a fixed camera at 1920 by 1080 pixels. Timed GPU jobs run sequentially.

## Loading and visibility

Values are means of three runs, in milliseconds.

| Metric | Geo baseline | Geo pool | Bike baseline | Bike pool |
| --- | ---: | ---: | ---: | ---: |
| Tiles loaded | 5253 | 4926 | 1878 | 1883 |
| First visible splat count | 5156 | 1008 | 1894 | 633 |
| Frame with final splat count | 5638 | 5592 | 2256 | 2240 |
| Startup frame p95 | 174.6 | 44.0 | 48.5 | 27.5 |

The tile-loading timer ends when `tileset.tilesLoaded` becomes true. Texture generation and sorting can still be pending.
The visibility metrics start at the first sampled startup frame.
The last visibility metric requires loaded tiles, the final splat count, and no pending snapshot.
This is a sampled readiness metric. The final image comparison occurs after warmup and settlement.
All 12 final loading captures match exactly within each asset.

The initial production implementation takes 5432 ms for Geo and 1967 ms for Bike.
It records about 205000 busy retries for Geo. Multiple attribute consumers repeatedly process the same waiting SPZ loader.
The CPU profile assigns 648 ms inclusive time to repeated SH schema checks and 218 ms self time to SPZ metadata checks.
The final implementation caches glTF metadata and attempts admission once per frame.
Geo busy retries fall to about 13500. The regression test verifies one attempt across 20 attribute calls, followed by a retry next frame.

## Streaming and multiple tilesets

The pressure tests use a 32 MiB tile cache and a 64 MiB overflow allowance.
Each run measures 1080 camera-path frames after 90 warmup frames. Each mode has two repetitions.

| Asset | Baseline p95, ms | Pool p95, ms | Baseline p99, ms | Pool p99, ms |
| --- | --- | --- | --- | --- |
| Geo | 165.0, 163.5 | 50.7, 53.1 | 197.0, 192.4 | 123.2, 116.4 |
| Bike | 111.9, 112.7 | 46.3, 48.0 | 183.2, 187.0 | 98.9, 101.1 |

These runs unload 358 to 546 tiles each. They measure streaming responsiveness, not isolated shader speed.
Asynchronous readiness changes the intermediate selected content. Steady-state GPU rendering is not the optimization target.

The mixed-asset tests align Geo and Bike in one view and reverse their insertion order.
Both assets load in both orders. The tests establish progress for these finite workloads, not fairness under unlimited competing traffic.
The final camera-turn tests produce no blank samples across 6622 baseline frames and 6721 pool frames.
Both return to 496401 splats with identical final coverage.
Five destroy-during-decode cycles drain the pool. Malformed input also releases its slot, and a valid tileset loads afterward.

## Memory and compatibility

Both 24-cycle removal tests return the position cache to zero bytes and zero entries after every removal.
Live graphics resource counts remain constant. Renderer worker WebAssembly memory does not grow after warmup.
The pool adds two decoder workers with about 1.18 MB of JavaScript heap each after garbage collection.
An additional four-cycle probe measures a largest native decoder allocation of 26.0 MB in each worker for the tested view.
That value is a per-instance high-water mark, not retained memory or a bound for larger inputs.

In the 24-cycle test, the texture worker retains 52.8 MB of WebAssembly memory with the pool, versus 45.9 MB in the baseline.
Main-thread buffer storage is about 23.4 MB with the pool, versus 22.6 MB in the baseline.
This memory cost accompanies the earlier partial snapshots. It is a real tradeoff.
Small main-thread code-heap growth remains similar to the behavior documented in PR #5.

The final compatibility matrix has 12 cases across hardware Vulkan, hardware OpenGL, degree-3 SPZ, degree-0 SPZ, and packed or expanded loading.
All cases render 545605 splats without browser or WebGL errors. Vulkan captures match exactly within each degree.
OpenGL differences are at most two levels per 8-bit channel, including the minified build after settlement.
The pixel comparison data records these differences.

The minified build with debug checks removed passes on hardware OpenGL for both degrees.
It also passes malformed-input recovery and an injected error on an active worker, followed by a valid decode.
The minified global bundle passes the standard Vulkan harness and cancellation checks.
A separate standalone Vulkan test driver loses its context during startup, before splat decoding.
A bare WebGL control also loses its context in that driver. The failure logs remain available; the PR adds no renderer workaround.

## Validation and reproduction

The final suites pass: SpzDecoder 5, GltfSpzLoader 9, SplatLoading 13, Gltf 350, ResourceCache 163, and GaussianSplat 34.
The Gltf suite includes GltfSpzLoader, so these counts are not all distinct tests.
Normal commit hooks, including TypeScript checks, pass.
The shared-consumer test verifies that worker-packed data avoids repacking while expanded consumers can still read the original coefficients.

The final browser batch has 41 successful cases. The earlier implementation, profile, smoke, native-memory, and minified-global controls bring the standard-runner total to 80.
The separate minified OpenGL checks add two successful cases. Initial Vulkan-driver failures are preserved separately.

Download the [benchmark JSON archive](https://github.com/Construkted-Reality/cesium/releases/download/splat-decoder-pool-benchmarks-2026-09-07/decoder-pool-2026-09-07-json.tar.gz).
The archive contains all 12 configurations and result files removed from this pull request.
Its SHA-256 checksum is `fb1c63ecc4f5a66c6b7467d2ac541b85921f50a7015f108bf6dc8131864430a0`.
Extract the archive from the repository root to restore the files under this report directory.

Start `tools/splat-perf/serve.mjs` on port 8099 with the asset mappings configured.
Set `SPLAT_RESULTS` to the output directory and `SPLAT_BASELINE_BUNDLE` to the saved PR #5 global bundle.
Run `node tools/splat-perf/loading-run.mjs docs/splat-perf/decoder-pool-2026-09-07/final-validation.json` with the extracted configuration.
For OpenGL, start headless Weston and set `SPLAT_WAYLAND_RUNTIME` to its runtime directory.
Build the minified release with `npm run build -- --minify --removePragmas`.
Run `decoder-release-check.mjs` with `SPLAT_RELEASE_BACKEND=gl` and the same output and Wayland variables for the release checks.
Run `summarize-decoder-pool.py <output-directory> <report-directory>` to recreate the compact measurements.

Raw results remain under `/mnt/data2/cesium-splat-perf/decoder-pool-results` on the server.
The archive includes the artifact manifest, configurations, compact measurements, and retry profile summary.
The manifest records hashes for the full server artifacts. The archive does not include those full artifacts.
