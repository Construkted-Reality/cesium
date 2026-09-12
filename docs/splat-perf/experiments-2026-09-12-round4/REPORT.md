# Gaussian splat cache accounting and snapshot release

Date: 2026-09-12. Server: 192.168.8.212. GPU: NVIDIA RTX A4000.
Baseline: f20a5d1f1b, CesiumJS 1.144.0 with the previously merged optimization work.

## Cache accounting

The Geo fixture renders 2,087,136 splats from 105 selected tiles, with 139 cached tiles. Its shared resources contain 267,600,064 texture bytes and 8,348,576 vertex buffer bytes. Total: 275,948,640 bytes (263.2 MiB).

The baseline reports 77,947,550 bytes after loading. It reports -10,891,803 bytes after unloading and 207,580,882 bytes after reloading. The GPU allocations do not change during this cycle. Instrumentation records 270 tile load/unload pairs with different texture byte counts across two cycles.

Each tile reports a changing fraction of the shared attribute texture. The statistics add this value on load and subtract a different value on unload. The baseline also omits shared spherical harmonics textures and draw buffer capacity.

The fix makes each tile report zero shared texture bytes. The primitive counts its active, pending, and retired GPU resources once. It updates the existing tileset statistics during frame updates, asynchronous completion, and destruction. Two unload/reload cycles report exactly 275,948,640 bytes at every settled stage. Other content memory counts remain intact.

This corrects an estimate. It does not reduce allocations at the same level of detail. The estimate does not include all decoded CPU arrays, staging arrays, or worker heaps.

### Cache budget behavior

At a 64 MiB cache budget with zero overflow, the baseline holds approximately 468 MiB of shared GPU resources after 20 seconds. It reports approximately 64 MiB. The candidate holds approximately 90 MiB and reports the same amount. It selects coarser tiles because the estimate includes the real allocations.

Neither implementation enforces a strict GPU allocation ceiling during snapshot replacement. Both return to all 2,087,136 splats with no outstanding requests or processing after restoring the default budget. Low-budget level-of-detail oscillation remains outside this accounting fix.

## Empty snapshot experiment

Releasing whenever the selected tile list becomes empty causes 16 blank frames (289.8 ms) on return to cached tiles. The retained snapshot produces zero blank frames. Reject this policy.

The implemented policy releases the shared primitive after all rendering passes only when selection and the entire tile cache are empty, and traversal has no requests, processing, or attempted requests. Cached camera excursions and loading gaps retain the snapshot. New content creates a new primitive after a full unload.

The measured full unload releases 275,948,640 GPU bytes (263.2 MiB). Total instrumented scene allocations fall from 375,612,608 to 99,663,968 bytes. Main-thread ArrayBuffer backing storage falls by approximately 39.8 MiB compared with explicit scratch trimming alone.

The allocation ledger measures logical WebGL buffer, texture, and renderbuffer storage. It does not measure driver allocation granularity or all renderer memory. Mixed tilesets retain the shared primitive until their entire cache is empty.

### Reload measurements

Four alternating Chromium runs compare retention with release. A 750 ms delay applies to each returning tile request. Both versions reload all 139 tiles in approximately 6.8 to 7.2 seconds. The release runs first draw splats after 1,088 and 1,066 ms. Retention keeps the old image visible throughout. Cached return has zero frames without splats in all four runs.

The return frame-time 99th percentiles are 115.4 and 122.7 ms with retention, and 122.4 and 125.1 ms with release. These are two runs per mode, not a general frame-rate claim. The scene runs at a paced 60 Hz. GPU clocks are not locked in this memory experiment.

### Rendering and compatibility

The OpenGL pixel comparison preserves 547,579 colored pixels before unloading, during cached excursions, and after reload. Channel differences are at most 2/255, with approximately 0.0003 mean absolute difference across all channels. Repeated control frames show the same maximum and mean variation. A full unload deliberately removes the old image.

The native Firefox animation loop stalls on the untouched baseline as well as the candidate under headless Weston. A timer-paced requestAnimationFrame substitute allows the compatibility test to complete. Both versions restore all splats without browser errors. The release version reports zero splat GPU bytes after full unload, compared with 275,948,640 bytes for retention. Firefox timing is not benchmark evidence.

## Validation

The standard complete OpenGL suite has 15,799 baseline passes and 15 existing failures. Both changes together have 15,804 passes and the same 15 failures. All five added tests pass. The accounting branch also passes all 41 targeted Gaussian splat tests on real OpenGL. The exact failure lists are in the evidence archive.

Tests cover shared resources, spherical harmonics, pending and retired resources, outstanding loading work, non-render passes, unload/reload, and late asynchronous texture completion. Build, lint, formatting, and type checks pass.

The Vulkan Karma launcher fails WebGL initialization on both revisions, including a retry with the NVIDIA driver selected explicitly. A standalone browser probe creates a Vulkan context, so this limitation is specific to the current test setup. Its aborted runs are not a valid full-suite comparison.

## Pull requests

- [PR #22: shared GPU accounting](https://github.com/Construkted-Reality/cesium/pull/22), based on feature/splat-perf.
- [PR #23: release after full unload](https://github.com/Construkted-Reality/cesium/pull/23), targets feature/splat-perf and depends on PR #22.

Merge PR #22 first, then PR #23. Both target feature/splat-perf. PR #23 includes the accounting commits until PR #22 merges. Keep these changes separate for upstream review.

## Reproduction

Use the dated evidence archive for scripts, raw measurements, and complete logs. The archive excludes datasets and copied build bundles. Scripts refer to the server paths used for this experiment. Substitute equivalent paths and build the recorded revisions before running them.

Run GPU jobs sequentially. The timing tests use a paced 60 Hz scene and insert a 750 ms delay for returning tile requests. A retained old snapshot must not satisfy the reload completion condition. Require ready tile counts, committed selection identity, and no pending snapshot.
