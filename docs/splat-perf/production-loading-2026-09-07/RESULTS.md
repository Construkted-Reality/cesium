# Production direct packing and cache configuration

The production changes extend merged PR #3, `186f15fd76`, in Construkted-Reality/cesium.
The earlier loading experiments provide the hypothesis. These measurements use the production implementation.
Worker decoding remains experimental and is not part of the production renderer change.

## Behavior

Gaussian tile loading packs SPZ spherical harmonics (SH) directly into the existing dense half-float layout.
An explicit attribute field carries the packed array. Separate cache keys distinguish packed and ordinary loaders.
Only complete degree-1 through degree-3 schemas use this path. Other schemas retain the existing path.
The decoder retains source coefficients until all decoder users release them, so ordinary loaders can share the decode.
Resource-cache statistics count the packed array once. Loader unload releases its reference.

Applications can set `Cesium.GaussianSplatPrimitive.maximumCacheByteLength` in bytes.
The default remains 134217728 bytes (128 MiB). The setting applies to all primitives that share the sorter worker.
Zero disables position retention. A smaller limit evicts least recently used entries.
The value must be a nonnegative safe integer. Active tasks and other renderer allocations can exceed this retention limit.
Setting the value does not start an unused worker. Changes apply through control tasks or the next accepted sort task.

```js
Cesium.GaussianSplatPrimitive.maximumCacheByteLength = 256 * 1024 * 1024;
```

## Production measurements

All runs use 192.168.8.212, an NVIDIA RTX A4000, and Chromium with Vulkan.
Graphics and memory clocks stay at 1350 and 7001 MHz. Fixed views use 1920 by 1080 pixels.
Each asset has two interleaved baseline/candidate pairs. The baseline disables only the new private packing option.
No prototype packing or budget implementation runs in these comparisons.

| Asset | Baseline complete view, ms | Production complete view, ms | Mean reduction |
| --- | --- | --- | --- |
| Geo, 2,087,136 splats | 6040.9, 6053.0 | 5660.3, 5709.8 | 6.0% |
| Bike, 705,883 splats | 2340.7, 2535.1 | 2326.0, 2165.9 | 7.9% |

Complete-view time starts at the first instrumented startup frame and ends at the final-count snapshot,
with tiles loaded and no pending snapshot. Two pairs show the observed effect; they do not establish statistical confidence.
All four captures per asset match byte for byte. Steady-state GPU time does not materially change.

After garbage collection, Geo main-thread array storage decreases from 1.422 to 0.923 decimal GB, approximately 35%.
Bike decreases from approximately 0.500 to 0.332 GB. These are retained array bytes, not peak browser-process memory.

The six-tileset configuration test changes the budget through 256, 64, 0, and 128 MiB.
Invalid inputs fail validation. Explicitly disabling retention leaves zero worker entries and zero position bytes.
This mixed-budget run validates behavior; it does not isolate a performance gain.
The earlier PR #3 cache-pressure experiment measures the benefit of a larger budget.

## Verification

The relevant glTF, resource-cache, and Gaussian-splat groups pass 542 tests.
The new loading group passes 11 tests, including cache separation, shared decoder use, packing, cleanup,
budget validation, capacity deferral, and changes during an active control task.
A separate exact comparison checks 262,144 splats per degree, degrees 0 through 3, against the existing packer.
Exceptional float values and padding match exactly.

The production lifecycle test exercises 12 load/remove cycles and verifies position-cache release and graphics-resource counts.
Removed main-thread array storage stays near 22.6 MB. JavaScript heap grows from 14.2 to 15.5 MB.
Texture-generator and sorter WebAssembly heaps remain at 45,940,736 and 19,267,584 bytes.
The accompanying summary records every removal checkpoint.
The previous 88-cycle experiments and software-backend comparison remain supporting evidence;
they are not substitutes for the production-path checks.

The second hardware backend remains untested. Small browser-heap growth in the earlier long tests remains unresolved.
The full engine suite is not repeated; the affected loader, resource-cache, and splat groups are the targeted regression scope.

## Reproduction

Start `tools/splat-perf/serve.mjs` on port 8099 with the existing dataset paths, then build Cesium.
Run `loading-run.mjs` with the adjacent `validation.json` and `SPLAT_RESULTS` set to the result directory.
Run `loading-kernel-check.mjs --production --verify-only` for the exact comparison.
Run `python3 tools/splat-perf/summarize-production-loading.py` to validate the saved browser evidence.

Raw files remain in `/mnt/data2/cesium-splat-perf/production-loading-results` on the GPU server.
The summary and configurations are committed. Normal commit hooks check source lint and formatting.
