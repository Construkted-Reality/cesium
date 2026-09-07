# Gaussian splat rendering performance

These changes extend merged [PR #1](https://github.com/Construkted-Reality/cesium/pull/1).
The comparison baseline is `e9409954f68c7843998960bf07a3ddaf3fb92ffa`.
The candidate contains four production changes. Applications need no new option.

## Changes

1. The primitive skips a steady sort when the effective float32 depth direction and splat generation match the last accepted sort.
   Translation alone does not change relative depth order. Cache-miss recovery still runs.
2. The primitive reuses draw commands and index-buffer capacity when the shader variant and capacity permit reuse.
   It rebuilds commands for incompatible changes. Texture uniforms read the current texture.
3. The worker caches positions under a 128 MiB limit instead of a three-entry limit.
   It evicts the least recently used entry and processes explicit release requests.
   Oversized inputs sort without cache retention. Accounting includes the full backing buffer of each array.
4. The tile loader packs spherical harmonics (SH) into the dense layout during the original packing step.
   Degree 1 uses 24 bytes per splat. Degrees 2 and 3 use 48 and 96 bytes, previously 64 and 120.
   Half-precision values remain unchanged. Mixed degrees receive zero padding.

## Measurements

All measurements run on the GPU server with an NVIDIA RTX A4000 and Linux ANGLE Vulkan.
Graphics and memory clocks remain fixed at 1350 and 7001 MHz during measurement.
The benchmark uses two interleaved baseline/candidate pairs per workload, with no concurrent GPU tests.
Single-tileset runs capture 400 frames. Four-tileset runs capture 300 frames.
Tile selection remains fixed after settling. Every compared frame has the same splat-count vector.
Multisample anti-aliasing remains at four samples. Opacity trimming remains disabled.

Values below average the two per-run statistics. The 95th percentile is abbreviated p95.
Central processing unit (CPU) time measures the instrumented rendering span, not all asynchronous work.
Graphics processing unit (GPU) time comes from timer queries.

| Workload and metric | PR #1 baseline | Candidate |
| --- | ---: | ---: |
| Dolly, 1,840,345 splats, median frame | 15.05 ms | 14.35 ms |
| Dolly, mean CPU span | 0.865 ms | 0.620 ms |
| Dolly, sorts per run | 61 / 57 | 25 / 25 |
| Orbit, 2,010,001 splats, median frame | 14.30 ms | 14.20 ms |
| Orbit, median GPU time | 5.731 ms | 5.726 ms |
| Four tilesets, 8,040,004 splats, median frame | 33.75 ms | 33.50 ms |
| Four tilesets, frame p95 | 45.70 ms | 35.65 ms |
| Four tilesets, CPU span p95 | 15.55 ms | 4.95 ms |
| Four tilesets, median GPU time | 22.092 ms | 22.085 ms |
| Four tilesets, cache misses per run | 49 / 52 | 0 / 0 |
| Four tilesets, positions resent per run | 1.18 / 1.25 GB | 0 / 0 GB |

Dolly median frame time falls by 4.7%, and its mean CPU span falls by 28.4%.
Four-tileset frame p95 falls by 22.0%, and CPU span p95 falls by 68.2%.
Median orbit and GPU times show no material improvement.
These are combined production results. They do not isolate the contribution of each change.

The orbit fixture reduces its SH texture from 241,375,680 to 193,152,960 bytes per tileset, approximately 20%.
Steady orbit command builds fall from 57 / 62 to zero. The candidate reuses commands 57 / 58 times.
The four-tileset fixture tests cache contention with four copies of the asset.
It does not validate global depth ordering between overlapping primitives.

An isolated Node packing test compares every half value for 262,144 splats at each SH degree.
All values match. Four interleaved pairs give these median packing times:

| SH degree | Baseline | Candidate | Packed storage reduction |
| --- | ---: | ---: | ---: |
| 1 | 20.2 ms | 19.7 ms | 0% |
| 2 | 57.7 ms | 32.4 ms | 25% |
| 3 | 75.8 ms | 69.9 ms | 20% |

Packing times do not measure total loading time or browser peak memory.

## Validation

The full GPU-enabled specification suite reports 15,749 passes and six failures.
The baseline reports 15,737 passes with the same six failures. All 12 added specifications pass.
The failures concern automatic uniforms, translucent tile styling, three environment-map cases, and point-cloud picking.
The exact names appear in [spec-comparison.json](spec-comparison.json).

Three camera-pose image pairs match byte for byte.
Eight additional transition image pairs also match, with nonzero color output and no graphics errors.
The transitions cover high dynamic range, logarithmic depth, viewport size, camera movement, rotation, and model translation.
The unit tests also cover command capacity growth, shrink/reuse, SH degree changes, and mixed-degree packing.

The actual worker handler and WebAssembly sorter pass cache-miss, release, and oversized-input checks.
A cache regression test confirms that a small array view cannot retain an oversized backing buffer within the budget.
Commit hooks run formatting, lint, and type checks.

## Limits and evidence

The 128 MiB limit applies to retained position arrays in each worker, not total renderer memory.
It can retain more memory than the previous three-entry policy for small and medium inputs.
Inputs larger than the limit require position transfers for subsequent sorts.
Release requests can wait for worker capacity; the byte limit still bounds retained cache entries.

The results cover one GPU, one operating system, and the tested asset and camera paths.
Fixed tile selection measures steady rendering and does not establish a loading or streaming speedup.
Other GPUs can have different costs for dense shader decoding.
No anti-aliasing or opacity-quality change is included.

[summary.json](summary.json) contains per-workload statistics and image hashes.
[runs.json](runs.json) records the final run sequence.
[pack-check.json](pack-check.json) and [worker-check.json](worker-check.json) retain the focused probe results.
The two transition JSON files retain state and image-capture checks.
Raw frames, logs, and probe scripts remain on the GPU server under
`/mnt/data2/cesium-splat-perf/performance-results/` and the performance worktree.
[NOTES.md](NOTES.md) records rejected pilots and corrected verification errors.
