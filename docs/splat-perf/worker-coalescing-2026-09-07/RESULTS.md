# Worker snapshot coalescing, 2026-09-07

PR #4 contains production direct packing and cache configuration at `b6065aa9fa`.
This follow-up changes the experiment harness only. Worker decoding and snapshot coalescing remain outside the production change.
All runs use 192.168.8.212, an NVIDIA RTX A4000, Vulkan, and locked 1350/7001 MHz clocks.

## Attribution

The first Geo trace records 15 worker snapshots: one initial snapshot, nine timeout rebuilds, and five stability rebuilds.
The direct main-thread path records two snapshots. Some worker rebuilds are approximately 100 ms apart.
The worker reaches its first visible splats at 1121 ms; the direct path reaches them at 5083 ms.
Full-view completion moves in the opposite direction: 8043 ms for the worker and 5598 ms for direct main-thread loading.

Later traces record tile identities and dirty flags. Some consecutive builds use the same tile identities.
The primitive marks itself dirty on every tile-load event, including events outside the current snapshot.
This is a further candidate for measurement. Equal tile identities alone do not justify ignoring a dirty flag.

## Intervention and repeated measurements

The experiment limits noncritical snapshot builds while tiles load.
Initial snapshots, stale snapshots, and fully loaded views bypass the new interval.
The existing rebuild conditions and pending-snapshot completion remain in force.

The first 250 ms and 500 ms probes reduce builds but worsen Geo completion to 9824 and 9088 ms.
Decoder durations also vary in those runs. They remain in the evidence and are not used as the final comparison.
The expanded test uses two interleaved repeats per setting and asset with identical instrumentation.

| Asset and worker interval | Complete view, ms | Snapshot builds | First visible splats, ms |
| --- | --- | --- | --- |
| Geo, existing scheduling | 8307, 8217 | 16, 15 | 1145, 1046 |
| Geo, 500 ms | 8141, 8584 | 12, 12 | 1068, 1081 |
| Geo, 1000 ms | 7239, 7154 | 7, 7 | 1103, 1064 |
| Bike, existing scheduling | 3122, 3011 | 17, 14 | 594, 592 |
| Bike, 500 ms | 2731, 2749 | 6, 6 | 585, 605 |
| Bike, 1000 ms | 2488, 2441 | 4, 4 | 578, 616 |

The 1000 ms setting reduces mean worker completion time by 12.9% on Geo and 19.6% on Bike.
Geo's largest startup frame gaps stay near 187 to 190 ms.
Bike's largest gaps increase from 82 to 99 ms to 103 to 111 ms.
The first-visible timings show no material delay at this sample size.
Partial-detail updates are less frequent by design; final image equality does not establish identical intermediate visual quality.

Every repeated fixed-view capture matches the production direct-packing image byte for byte.
Counts are 2,087,136 for Geo and 705,883 for Bike. Tile-load counts match within each asset.
Two repeats do not establish statistical confidence.

## Camera movement

Each motion run follows six headings and ranges twice over 1080 measured frames at 1920 by 1080 pixels.
These runs use the default tile-cache configuration. They do not repeat the earlier constrained-cache eviction tests.

| Asset | Existing worker frame p95, ms | 1000 ms worker frame p95, ms | Snapshot builds, existing to 1000 ms |
| --- | --- | --- | --- |
| Geo | 44.1 | 34.3 | 30 to 20 |
| Bike | 36.8 | 24.9 | 46 to 17 |

Geo loads 228 tiles in each run. Bike loads 229 in each run. No tiles unload in these motion runs.
No browser or WebGL errors occur. The Bike stale-view rebuild starts 203 ms after the previous build,
which exercises the bypass of the 1000 ms interval. This does not measure all blank-view cases.
These single motion pairs show observed responsiveness, not a general frame-rate guarantee.

## Decision and next tests

Keep the worker path experimental. Coalescing improves it, but Geo completion still takes about 7.2 seconds,
compared with about 5.7 seconds for production direct main-thread loading in PR #4.
Worker decoding provides much earlier partial content and smaller startup stalls.
That tradeoff needs an explicit product decision before production integration.

The next measurements should separate decoder module initialization from decode work and test redundant tile-load invalidation.
Before shipping coalescing, test constrained-cache eviction, long camera turns, worker cancellation, and fairness across several tilesets.
A one-second interval can leave partial detail unchanged longer, even while camera motion stays responsive.

## Evidence

The adjacent configurations and `summary.json` preserve the comparisons.
Raw results, pixel captures, traces, logs, and completion markers remain at
`/mnt/data2/cesium-splat-perf/worker-coalescing-results` on the GPU server.
Run `python3 tools/splat-perf/summarize-worker-coalescing.py` to verify results.
The harness requires `snapshotProbe=1` when `coalesceMs` is set.
