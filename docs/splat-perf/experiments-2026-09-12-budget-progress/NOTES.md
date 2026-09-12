# Snapshot budget progress, 2026-09-12

Baseline: f23db5f9b2, after PRs 25 and 26. All work runs on 192.168.8.212.

At zero cache and overflow, the baseline reaches a valid root view with 42,279 splats and 6,442,640 GPU bytes. Its root screen-space error is 56.85. Memory pressure still increases the adjusted error until it exceeds the root rejection threshold of 3,021.95. Traversal then selects nothing. At 25 seconds the adjusted error exceeds 13 trillion and 127 stale processing tiles remain queued.

The first experiment caps the adjusted error at the root level, drops obsolete processing content under pressure, and permits needed splat decoding despite the old GPU snapshot. It clears processing but raises the GPU peak to 508.4 MiB at both zero and 64 MiB budgets. Reject this version alone. Its cold decoding finishes too much fine detail before a replacement allocation can enforce the budget.

The next experiment estimates texture dimensions, spherical-harmonic storage, and draw-buffer growth before creating a snapshot texture. It coarsens traversal before admission when the replacement cannot fit beside retained resources. The coarsest visible representation remains a best-effort fallback when no representation can fit the configured budget. This prototype is under test.

Raw files remain in /mnt/data2/cesium-splat-perf/experiments-2026-09-12-budget-progress. No implementation is accepted yet.
