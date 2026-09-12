# Budget and CPU retention investigation, 2026-09-12

Baseline: da8e99149e. Server: 192.168.8.212, NVIDIA RTX A4000. The Geo fixture uses SSE 4 and a stationary 1920 by 1080 camera. These are exploratory runs, not repeated benchmark conclusions.

At 64 MiB with zero overflow, the baseline records 862 loads and 801 unloads over 40 seconds. At 128 MiB it records 941 loads and 892 unloads. Screen-space error repeatedly rises and falls while asynchronous snapshots are pending.

The first candidate waits for snapshot replacement and retirement before changing screen-space error. It also requires 25 percent headroom and no processing work before refining. Its 64 MiB run reaches 139 loads and 114 unloads, then stops changing by 15 seconds. It holds 61,756,892 GPU bytes and 450,876 splats. Recovery and broader validation are still pending.

After normal-budget recovery, the baseline retains 573,118,688 unique bytes reachable from tile decode data and loaders. Source GLB buffers account for about 71.28 MiB. The splat loader explicitly disables the existing releaseGltfJson option. A paired release-option experiment is queued. The GPU accounting API documents GPU memory, so CPU estimates must remain separate.

Raw scripts and traces are in the server folder /mnt/data2/cesium-splat-perf/experiments-2026-09-12-budget-cpu. No candidate is accepted yet.

The wait-for-settlement candidate also settles at 32 and 128 MiB. A second 64 MiB run has no load/unload events in its final 10 seconds. However, restoring the normal budget takes 26.2 to 29.1 seconds because every refinement step waits for replacement. Retrying the requested detail when the user increases a budget reduces recovery to 4.27 seconds at 64 MiB and 3.57 seconds at 128 MiB. Those are exploratory single runs.

The zero-budget baseline and candidate both retain a 22,692,624-byte old snapshot, have zero ready tiles, and keep more than 120 processing tiles after 40 seconds. Their screen-space error grows without bound. This is a pre-existing starvation case when the budget cannot hold a snapshot. The controller candidate does not resolve it.

Enabling releaseGltfJson removes exactly 74,743,148 retained bytes in the paired tile-buffer audit. The loaded tile storage changes from 573,118,688 to 498,375,540 bytes. After destroying the tileset while retaining content references, both versions retain 498,375,540 bytes. Releasing those references frees the buffers. The CPU retention branch now clears its array and primitive references during content destruction; validation is pending.
