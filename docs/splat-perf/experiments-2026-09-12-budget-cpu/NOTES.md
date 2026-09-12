# Budget and CPU retention investigation, 2026-09-12

Baseline: da8e99149e. Server: 192.168.8.212, NVIDIA RTX A4000. The Geo fixture uses SSE 4 and a stationary 1920 by 1080 camera. These are exploratory runs, not repeated benchmark conclusions.

At 64 MiB with zero overflow, the baseline records 862 loads and 801 unloads over 40 seconds. At 128 MiB it records 941 loads and 892 unloads. Screen-space error repeatedly rises and falls while asynchronous snapshots are pending.

The first candidate waits for snapshot replacement and retirement before changing screen-space error. It also requires 25 percent headroom and no processing work before refining. Its 64 MiB run reaches 139 loads and 114 unloads, then stops changing by 15 seconds. It holds 61,756,892 GPU bytes and 450,876 splats. Recovery and broader validation are still pending.

After normal-budget recovery, the baseline retains 573,118,688 unique bytes reachable from tile decode data and loaders. Source GLB buffers account for about 71.28 MiB. The splat loader explicitly disables the existing releaseGltfJson option. A paired release-option experiment is queued. The GPU accounting API documents GPU memory, so CPU estimates must remain separate.

Raw scripts and traces are in the server folder /mnt/data2/cesium-splat-perf/experiments-2026-09-12-budget-cpu. No candidate is accepted yet.
