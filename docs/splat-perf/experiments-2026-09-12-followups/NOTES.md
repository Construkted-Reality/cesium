# Follow-up experiment notes, 2026-09-12

The main-thread padding branch copies 63.7 MiB to a 64 MiB allocation for 2,087,136 splats. It costs 26.2–27.6 ms. Moving padding to the worker reduces main-thread preparation to 0–0.1 ms. The last refinement still has a 23.6 ms p95 and a 102 ms maximum. This fixes one stall, not every stall. Spherical harmonics upload and aggregate copies remain substantial.

Aggressive scratch release looked attractive because commit already removes snapshot references to uploaded arrays. Calling the existing trim operation after each commit saves approximately 280 MiB of main-context backing storage on Geo. However, maximum refinement frames grow from approximately 102 ms to 155 ms. Aggregate allocation and copy time increases. This is not a free default memory optimization. The existing explicit trim operation remains available for a memory-first application.

An experimental sort prefetch moves sorting before texture completion on a fixed camera. Maximum Geo refinement frames increase to 115–116 ms. The main-context settled backing storage stays approximately unchanged, near 816 MiB. The experiment does not establish a peak-memory reduction. Do not promote this scheduling change without a better result and camera-change coverage.

The mixed workload test loads two Geo splat tilesets, a batched mesh tileset, a point cloud tileset, and a checkerboard polygon. It runs three cycles of 120 moving-camera frames and switches splat budgets between zero, 32 MiB, and 1 GiB. Both merged baseline and worker-padding candidate recover after all cycles and dispose both splat primitives with zero counted texture and geometry bytes. No render errors occur.

Context restoration without object reconstruction produces a black image and WebGL INVALID_OPERATION, even though the tileset still reports 2,087,136 splats. A page reload reconstructs resources and restores the full count. Additional continuous-render and guarded-render tests are in progress. A live object count is not evidence of successful graphics recovery.

The matched final worker cleanup compares only the lifetime change against merged code. It saves 217.52 and 232.84 MiB of private process memory in two runs. Earlier exploratory 319–336 MiB figures include a different padding variant and are not the matched estimate. Both final runs remove the worker at zero references and reload 2,087,136 splats in the same idle scene.

The final context test measures actual RGB recovery after a page reload: 1,636,214 nonzero channels. Before reload, the guarded restored scene has zero. The mesh and point cloud reproduction has 217,393 nonzero RGB channels before loss and zero after restoration. Do not ship the render guard as a recovery fix.
