# Splat budget stability and CPU retention

Date: 2026-09-12. Server: 192.168.8.212. GPU: NVIDIA RTX A4000.
Baseline: da8e99149e, the construkted trunk with the previous optimization series.
Browser: Chromium 151, OpenGL through headless Weston. Viewport: 1920 by 1080.
GPU jobs run sequentially. GPU clocks are not locked. These tests measure loading churn and memory, not a general frame-rate gain.

## Low-budget loading

The baseline changes memory-adjusted screen-space error while an asynchronous splat snapshot is incomplete or overlaps its predecessor. It refines again as soon as usage drops below the cache budget. This produces repeated loads and unloads at a stationary camera.

The change waits for pending snapshots, rebuilds, and retired textures to settle before changing detail. Refinement requires no processing tiles and usage below 75 percent of cacheBytes. Coarsening still starts above cacheBytes plus maximumCacheOverflowBytes. A budget increase retries the requested screen-space error.

The table uses 40-second cold-load runs with zero overflow. Late events are loads plus unloads during the final 10 seconds.

| Dataset and budget | Version | Loads | Unloads | Late events | Final GPU estimate |
| --- | --- | ---: | ---: | ---: | ---: |
| Geo, 64 MiB | Baseline | 862 | 801 | 420 | 116.6 MiB |
| Geo, 64 MiB | Candidate | 139 | 114 | 0 | 58.8 MiB |
| Geo, 128 MiB | Baseline | 941 | 892 | 462 | 174.5 MiB |
| Geo, 128 MiB | Candidate | 139 | 81 | 0 | 125.7 MiB |
| Bike, 16 MiB | Baseline | 564 | 538 | 256 | 15.1 MiB |
| Bike, 16 MiB | Candidate | 72 | 58 | 0 | 14.9 MiB |

Geo loads decrease by 83.9 percent at 64 MiB and 85.2 percent at 128 MiB. Bike loads decrease by 87.2 percent. The accepted records are source64.json, source128.json, and bike-final.json. The candidates have zero processing tiles at the end.

The Geo candidate holds 450,876 splats at 64 MiB and 985,655 splats at 128 MiB. The Bike candidate holds 109,200 splats. The baseline repeatedly changes detail. This is a stable choice of coarser detail within the budget, not storage compression at the same detail.

Restoring the normal budget loads all 2,087,136 Geo splats in 4.31 and 3.78 seconds. The baseline takes 3.63 and 2.78 seconds. These runs start from different detail and cache states, so they do not isolate recovery throughput. Bike restores 705,883 splats in 1.73 seconds, versus 1.51 seconds for baseline.

An earlier candidate without the budget-increase retry takes 19 to 29 seconds to restore Geo detail. That version is rejected. A 32 MiB experiment settles at 30.2 MiB with no late churn. Repeated 64 MiB experiments also settle, with some variation in the final selected detail due to load order.

### Limits

The budget is not a strict allocation ceiling. Snapshot replacement still has transient overlap. The final source runs peak at 213.8 MiB for the 64 MiB budget and 301.4 MiB for the 128 MiB budget. The baseline peaks at 313.5 and 338.1 MiB. These are logical GPU allocation estimates, not driver residency measurements.

Zero cache and zero overflow cannot hold a useful snapshot in the tested scene. Both the baseline and the first candidate keep a 22,692,624-byte old snapshot, zero ready tiles, and more than 120 processing tiles after 40 seconds. Screen-space error continues to grow. The current change does not resolve this pre-existing starvation case. The 75 percent refinement threshold is validated on these datasets; it does not prove convergence for every possible tile hierarchy.

The first Bike candidate recovery check could accept the old selection immediately after the screen-space error reset. Its low-budget trace is valid, but its recovery timing is invalid. bike-final.json requires all 72 tiles, 705,883 splats, and a matching committed selection.

## Decoded CPU memory accounting and retention

The probe counts each ArrayBuffer backing store once across content arrays, glTF attributes, and loader references. It records primitive buffers and worker heaps separately. totalMemoryUsageInBytes continues to describe GPU memory. The change does not add CPU bytes to that GPU budget or add a new public CPU-budget API.

The normal Geo view selects 2,087,136 splats and caches 139 tiles containing 2,768,753 splats. The tile storage has these components:

| Storage | Bytes |
| --- | ---: |
| Original positions, rotations, and scales | 110,750,120 |
| Transformed positions, rotations, and scales | 110,750,120 |
| Colors | 11,075,012 |
| Packed spherical harmonics | 265,800,288 |
| Source GLB buffers | 74,743,148 |
| Total before the change | 573,118,688 |

The transformed copies are intentional. Separate instances and later transform changes need the original coordinates. The existing tests verify that transformed data does not overwrite shared source attributes.

The splat loader explicitly disables the existing releaseGltfJson option. Enabling it releases source GLB storage after the dependent loaders finish. Tile storage falls to 498,375,540 bytes, a saving of 74,743,148 bytes, or 71.3 MiB. This is a 13.0 percent reduction in measured live tile storage.

Destroyed content objects also retain their attribute arrays and glTF primitive. Holding content references after removing the tileset retains 498,375,540 bytes, or 475.3 MiB. Clearing these references during destruction reduces the measured retained tile storage to zero. This saving applies when code still holds the destroyed content objects. Without those references, garbage collection already frees the storage.

Main-thread backing storage after destruction changes from 532,884,460 bytes to 34,514,240 bytes with retained content references. The worker backing-storage samples are about 33.0 MiB in both versions. The worker result does not establish total process memory or all WebAssembly allocator overhead.

The live GPU estimate stays at 275,948,640 bytes in both versions. These CPU fixes do not reduce VRAM at the same detail.

### Rendering and validation

Both CPU versions render 547,579 colored pixels. The maximum channel difference is 2 out of 255. The mean absolute difference is 0.000309. Two baseline runs have the same maximum difference and a mean difference of 0.000290.

The budget branch passes 286 targeted tileset tests. The full real-OpenGL suite has 15,806 passes on the candidate and 15,803 on baseline. Both have the same 16 failures, matched by test name and source location. failure-comparison.json records the exact lists. The first baseline full-suite attempt fails during setup because generated package entry points are missing. baseline-full-retry.log is the valid comparison.

The CPU branch passes all 45 targeted Gaussian-splat tests. They cover source data release, transformed data isolation, shared instances after destruction, snapshot lifecycle, and reload. Both changes together pass all 45 tests and settle at 64 MiB without late churn. The combined run retains 498,375,540 decoded tile bytes after full-detail recovery.

Build, changed-file ESLint, Prettier, and engine TypeScript checks pass. The budget commit also passes its pre-commit hooks. Chromium OpenGL is the browser configuration tested in this round.

## Reproduction and artifacts

The evidence archive is splat-budget-cpu-2026-09-12.tar.gz on the memory-benchmarks-2026-09-07 release. It includes scripts, raw traces, heap ledgers, pixel buffers, and validation logs. It excludes the datasets, browser profiles, dependencies, and generated Cesium bundles.

1. Build the baseline and each feature branch into separate worktrees. Run gulp prepare before the first build.
2. Save the matching Cesium.js bundles under the names used by the scripts. See heads.json for the source commits.
3. Start the static server on port 8099 with /mnt/data2/gs as its data root.
4. Start Weston as described by chrome-gl. The scripts use the dated server paths. Adjust those paths for another host.
5. Run probe.mjs for Geo and probe-bike.mjs for Bike. Keep GPU jobs sequential.
6. Run cpu-lifecycle.mjs for the CPU baseline and candidate. It requires 139 cached tiles and a committed 2,087,136-splat snapshot.
7. Run summarize.py to regenerate the loading summary.

The source GLB fixtures are at oracle-run/geo-newdefault and oracle-run/bike-newdefault. They are not included in the archive. The two feature PRs contain only source and spec changes. Research and integration commits remain on research/splat-budget-cpu.
