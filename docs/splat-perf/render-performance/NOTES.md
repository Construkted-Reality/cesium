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

A targeted backing-buffer test exposed an edge case in the new cache: an
8-byte view retained a 96-byte buffer under a 16-byte budget. Count backing
buffer bytes instead of view bytes. Normal worker transfers use exact-size
copies, so the performance fixtures have identical behavior under this change.
A regression specification covers the oversized view.

The first transition image probe read outside postRender and captured cleared
black buffers. All phase hashes were equal, which exposed the invalid check.
Exclude those captures. Capture synchronously in postRender and require
nonzero RGB output before comparing images. The normal benchmark captures
already contain nonzero geometry and are unaffected.

The corrected transition probe passes all eight image pairs with nonzero RGB
output. Camera and model changes produce distinct hashes. The full suite
passes 15,749 specifications with the same six baseline failures. Final paired
measurements and limits appear in RESULTS.md.
