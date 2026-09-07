# Worker loading validation

All measurements run on 192.168.8.212 after PR #4 merges into `feature/splat-perf`.
The server has 28 virtual CPUs and an NVIDIA RTX A4000 with 16 GB of memory.
The tests lock graphics and memory clocks to 1350 MHz and 7001 MHz.
Chromium uses NVIDIA driver 595.71.05. The OpenGL tests use Weston 15.0.1 with a headless hardware renderer.

## Decision

The two-worker loader warrants production integration work. The fixed snapshot delay does not yet warrant a production default.
This change adds experiment tools and evidence. It does not change the engine or enable the prototype for applications.
The prototype intercepts the built loader in the test browser. A production implementation needs the normal worker lifecycle and build integration.

The results below apply to this hardware, these assets, and the specified camera paths.
Each loading comparison has two repetitions. These repetitions establish a useful signal but do not establish a cross-device guarantee.

## 1. Cache pressure, cancellation, camera turns, and fairness

The pressure tests use a 32 MiB tile cache and a 64 MiB overflow allowance.
Each run measures 1080 frames after 90 warmup frames at 1920 by 1080 pixels.
The table compares one decoder worker with its original snapshot scheduling against the same worker with a 1000 ms minimum snapshot interval.
Bootstrap, stale snapshots, and completed tile loading bypass this interval.

| Asset | Original p95, ms | Coalesced p95, ms | Original p99, ms | Coalesced p99, ms |
| --- | --- | --- | --- | --- |
| Geo | 82.0, 81.9 | 53.9, 53.7 | 154.3, 179.9 | 173.0, 171.6 |
| Bike | 55.2, 52.1 | 30.6, 30.4 | 83.9, 85.6 | 74.2, 68.9 |

Each run unloads 400 to 465 tiles. This confirms that the tests exercise eviction.
The Geo p99 result is mixed. The three-identical-tileset test also exposes a tail regression: p95 improves from 80.2 to 52.5 ms, but p99 increases from 112.1 to 142.4 ms.
Its maximum frame time increases from 171.8 to 310.4 ms. Lower snapshot frequency can concentrate work into larger updates.
The timing data shows that regression; it does not isolate the cause of each long frame.

Two quiet 20-second camera tests turn 180 degrees, hold, return, and hold again.
The test reads the full 480 by 270 drawing buffer after each render. Neither run has a blank sample.
Both runs return to 496401 splats and the same final pixel coverage. Intermediate coverage differs during loading.
This test excludes a complete blank view on this path. It does not prove that all partial-view errors are absent.

Both the one-worker and two-worker tests destroy tilesets during five active-and-queued decode cycles.
All queues drain. Both tests reject malformed compressed input and then load a valid tileset with 169116 splats.
An active decode finishes before its resources can be reclaimed. The prototype drops queued work for destroyed loaders.

The mixed-asset tests align Geo and Bike in one view and reverse their insertion order.
All four runs complete 33 Geo jobs and 19 Bike jobs. Both assets appear in the first 30 completed jobs.
Full loading changes from 2018 to 1289 ms in one order, and from 2182 to 1496 ms in the other order.
Both assets become visible in every run. This finite workload does not prove fairness under continuous large-asset traffic.
The prototype uses a shared first-in, first-out queue. It has no per-tileset admission limit or priority policy.

## 2. Tile-load invalidation

Instrumentation compares tile-load events with the selected tile identities.
In the first Geo pressure run, all 548 load events refer to tiles outside both the stored selection and the current selection.
The experiment skips those invalidations and clears obsolete rebuild requests when the selection returns to its previous state.

| Variant | Geo full load, ms | Bike full load, ms |
| --- | ---: | ---: |
| One worker, original invalidation | 7631 | 2578 |
| One worker, changed invalidation | 7485 | 2541 |
| One worker, coalescing | 6605 | 2343 |
| Two workers, coalescing | 3989 | 1500 |
| Two workers, coalescing and changed invalidation | 4044 | 1599 |

Each value is the mean of two controlled runs. All 20 final images match exactly within each asset.
Changed invalidation reduces Geo snapshot builds from 14-16 to 10-11 and Bike builds from 11-13 to 6.
The loading benefit is small and inconsistent. We do not promote this change to engine code.
Selected-tile reloads and dirty state during pending snapshots need explicit regression tests before any later production change.

An earlier batch overlaps an unrelated Rust process that uses about 25 of 28 CPUs.
We preserve that batch and exclude its times. The controlled reruns record about 8 percent aggregate CPU use.
The runner freezes source files at batch start and records their hashes to prevent mid-batch changes.

## 3. Decoder initialization and a small worker pool

| Decoder phase | Geo, 139 jobs, ms | Bike, 72 jobs, ms |
| --- | ---: | ---: |
| Module initialization | 318.5 | 154.7 |
| Input allocation and copy | 34.6 | 11.3 |
| Native decode | 1861.8 | 657.8 |
| Output copy and conversion | 701.3 | 252.4 |
| Cleanup | 1.6 | 0.6 |

Initialization accounts for about 11 percent of the measured wrapper time. Dense SH packing adds further work outside this table.
The experiment therefore tests two decoder workers to overlap decode and packing.
It does not reuse a native module instance. The dependency does not expose its module factory as a supported public API.

The next comparison uses the merged production loader as the baseline, rather than the one-worker prototype.
Both runs use the same built engine and fixed camera. The prototype has two workers and 1000 ms coalescing.

| Asset | Production full load, ms | Prototype full load, ms | Reduction | Production startup p95, ms | Prototype startup p95, ms |
| --- | --- | --- | ---: | --- | --- |
| Geo | 5300, 5267 | 3984, 3929 | 25.1% | 167.6, 174.2 | 36.8, 37.0 |
| Bike | 1908, 1947 | 1638, 1412 | 20.9% | 42.3, 44.5 | 21.4, 20.6 |

Final Vulkan captures match exactly. These gains describe loading and startup responsiveness, not steady-state rendering speed.
A separate two-worker comparison removes coalescing. Geo loads in 4180 and 4377 ms; Bike loads in 1611 and 1480 ms.
The corresponding coalesced runs take 4007 and 4094 ms for Geo, and 1604 and 1403 ms for Bike.
All eight captures match. Most of the loading benefit survives without a fixed snapshot delay.
Production integration should therefore start with the worker pool and preserve the current snapshot policy.
A second decoder worker adds another JavaScript heap and another possible native decoder allocation.
In the 24-cycle pool test, each decoder worker reaches a largest observed native memory allocation of about 26 MB.
That counter is a per-instance high-water mark, not retained memory after garbage collection or a bound for larger inputs.

## 4. Heap growth

The 24-cycle production, one-worker, and two-worker tests return the position cache to zero entries and zero bytes after every removal.
Renderer worker WebAssembly memory remains stable after warmup. Live GPU resource counts also remain stable.
Main-thread used heap grows about 1.6 MB between the first and last removals in each mode.

The production heap snapshot attributes the largest increase to generated code: instruction streams add 976704 bytes.
Network resource records add 225216 bytes, and network replay records add 137632 bytes.
A strong retaining path runs through `DevToolsSession`, `InspectorNetworkAgent`, and `NetworkResourcesData`.
This identifies inspector retention rather than an inference from object names alone.

The number of live `Cesium3DTile` objects remains 235 in both snapshots. One original tileset remains referenced by the benchmark harness.
There is no increase in these object counts across the 24 cycles. This does not constitute a general absence-of-leaks claim.
The 96-cycle control uses a direct Chrome DevTools Protocol connection and does not enable network inspection.
Its snapshots contain no network-inspector resource records. Tile-object counts remain unchanged.
Used heap rises from 13.33 MB at cycle 0 to 14.75 MB at cycle 23 and 15.20 MB at cycle 95.
Buffer storage changes by 358 bytes between the first and last removals. Live GPU resource counts remain constant.
From cycle 23 to cycle 95, instruction streams add 211328 bytes and code byte arrays add 104100 bytes.
The growth slows, but these results do not demonstrate a complete heap plateau.

A second 96-cycle control reuses the two lifecycle functions to test repeated driver evaluation as a possible cause.
Reusing these functions does not eliminate the growth: used heap reaches 15.21 MB after 96 cycles.
The remaining code growth needs further attribution before a production memory fix is justified.
The failed direct-driver setup attempts remain in the raw logs. They fail before any splat snapshot builds.
The working control matches the benchmark launch flags, waits for startup, and preserves the drawing buffer.

## 5. Hardware OpenGL and degree-0 SPZ

The compatibility matrix has 12 cases: two hardware backends, two SH degrees, and three loader paths.
The paths are expanded SH loading, merged dense SH loading, and the two-worker prototype.
All cases render 545605 splats without browser or WebGL errors. The decoded degree is 3 or 0 as configured.

Vulkan images match exactly within each degree. OpenGL image differences are at most two levels per 8-bit channel.
Unchanged OpenGL baseline repetitions show differences of the same magnitude.
The mean absolute error across RGBA channels is about 0.0006-0.0007 levels for both baseline repeats and loader comparisons.
These tests find no additional loader-dependent discrepancy. They do not establish pixel determinism on OpenGL.
Backend frame pacing differs, so we do not compare OpenGL and Vulkan frame times as an optimization result.

The degree-0 asset is derived from 235 real Geo SPZ tiles. It is not a separately captured degree-0 scene.
The generator removes SH coefficients, changes the SPZ degree, and removes glTF SH attributes.
It preserves all other packed bytes. Browser decoding of three sampled tiles confirms identical positions, scales, rotations, opacity, and base colors.
The generator records source and fixture hashes. Full geometry files are not part of this pull request.

## Reproduction and evidence

The JSON configurations in this directory define each batch. Start `tools/splat-perf/serve.mjs` on port 8099 with the asset mappings configured.
Run a batch with `SPLAT_RESULTS=<output> node tools/splat-perf/loading-run.mjs <configuration.json>`.
Run `summarize-worker-validation.py <output> <report-directory>` to produce the compact measurements.
Run `summarize-heap.py <first.heapsnapshot> <later.heapsnapshot>` to compare node groups and retaining paths.
Run `SPLAT_RESULTS=<output> node tools/splat-perf/heap-direct.mjs` for the 96-cycle control.
Set `SPLAT_HEAP_REUSE=1` and `SPLAT_HEAP_LABEL=heap-reused` for the function-reuse control.

Raw captures, heap snapshots, logs, and full telemetry remain under `/mnt/data2/cesium-splat-perf/worker-validation-results` on the server.
The artifact manifest records hashes. The compact measurements retain errors, configuration, timings, resource counts, and source hashes.
Run GPU batches sequentially. Restore graphics and memory clocks after measurements.

## Validation status

All completed browser cases report no browser errors and no WebGL errors.
Both 96-cycle controls and all three 24-cycle resource tests complete.
The fixture recheck reproduces all 235 hashes and passes the sampled browser field comparisons.
ESLint and Python syntax checks pass for the changed tools. Normal commit hooks pass.
Engine source files do not change, so this validation does not repeat the engine unit suite from PR #4.
