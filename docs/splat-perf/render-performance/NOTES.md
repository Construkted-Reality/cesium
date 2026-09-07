# Rendering performance follow-up

Baseline: e9409954f6, merged PR #1. All work runs on the GPU server.

Promote the measured direction gate, command reuse, bounded position cache,
and dense SH packing. Validate transitions and mixed SH degrees as well as
steady performance. Raw experiment artifacts remain outside the PR.

First build passes 32 specifications. Actual packer comparisons preserve every
half value, but the generic channel loop costs 125 ms versus 82 ms at degree 3
for 262,144 splats. Replace its per-channel indexing with two word writes per
coefficient, then repeat the comparison in isolation. Initial GPU runs are
pilots: the packing probe overlapped them, and the translation gate is refined
before final measurement. Preserve pilots separately from final results.

The revised direct packer measures 69.9 ms versus 75.8 ms for baseline at degree
3, 32.4 versus 57.7 ms at degree 2, and 19.7 versus 20.2 ms at degree 1 in an
isolated Node run. Every half value matches. These are packing measurements,
not total tile-loading timings. The actual worker handler passes eviction,
release, and oversized-input checks with a 32-byte test budget.

All 33 focused specifications pass. The expanded live-command test initially
used the separately bundled source constructor, which had uninitialized context
limits. Calling the live primitive's constructor corrects the test setup; no
renderer change was required.
