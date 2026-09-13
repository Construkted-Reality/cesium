# Gaussian splat follow-up validation

Date: 2026-09-12.

## Scope and baseline

This work follows merged pull requests 27 and 28. The baseline is `e33bc03d0a` on `construkted`.

All builds, browser experiments, and tests run on `192.168.8.212`. The server has an NVIDIA RTX A4000 with 16 GiB of graphics memory. The driver is 595.71.05. The virtual machine exposes 28 AMD EPYC 7F52 CPUs. Chrome 151 uses ANGLE OpenGL through a headless Weston compositor. Browser viewports are 1920 by 1080.

The Geo and Bike datasets remain on the server. The archive contains scripts, traces, measurements, and logs. It does not contain dataset images or production bundles. The public Cesium test fixtures support the regression tests.

## 2. Refinement stalls

The profile separates aggregation, CPU texture preparation, sorting, and texture upload. At 2,087,136 Geo splats, aggregation takes approximately 50 ms. Spherical harmonics upload takes approximately 34–35 ms. Index-buffer updates take approximately 3 ms.

The worker returns a 63.7 MiB attribute buffer. The renderer pads it to 64 MiB. This main-thread copy takes 26.2–27.6 ms in the measured refinements.

Pull request 29 moves padding to the worker. The renderer retains a view of the transferred buffer.

| Measurement | Baseline | Worker padding |
| --- | ---: | ---: |
| Geo attribute preparation | 26.2–27.6 ms | 0–0.1 ms |
| Bike attribute preparation | 9.1–9.8 ms | 0–0.1 ms |
| First Geo refinement frame p95 | 22.9 ms | 17.6–18.0 ms |
| Last Geo refinement frame p95 | 23.4 ms | 23.6–23.8 ms |
| Geo maximum refinement frame | Approximately 103 ms | Approximately 102 ms |

The first Geo refinement improves. The last refinement does not improve its p95. This change does not remove aggregation or graphics upload stalls.

Each timing window includes the detail transition and one second after settlement. The p95 values describe these windows, not a whole application session. Runs execute sequentially.

Counts match at screen-space errors 8, 4, 12, and 4. Geo counts are 1,301,102; 2,087,136; 724,860; and 2,087,136. Bike counts are 321,102; 705,883; 226,117; and 705,883.

Image mean absolute error remains below 0.001 on a 0–255 channel scale. The maximum channel difference is 2. The pixel comparison file contains each result.

## 3. CPU staging and worker retention

Three experiments test different memory policies.

### Release scratch arrays after each upload

Calling the existing scratch-trim method after commit saves approximately 280 MiB of main-context backing storage on Geo. However, maximum refinement frames increase from approximately 102 ms to 155 ms. The next aggregation must allocate arrays again.

This policy is not included in production. Applications can still use the existing explicit trim operation when memory takes priority over refinement latency.

### Start sorting before texture completion

A benchmark wrapper starts sorting early for an unchanged camera. The measured Geo maximum refinement frame increases to 115–116 ms. Settled main-context backing storage remains approximately unchanged. The experiment does not establish a peak-memory saving.

This wrapper is a fixed-camera experiment. It is not production code. Its result does not justify a renderer scheduling change.

### Release the texture worker

Releasing the texture worker after every snapshot reduces process memory. However, the first Geo refinement p95 increases from approximately 22 ms to approximately 43 ms. Repeated worker initialization is unsuitable for this default path.

The implementation instead retains the worker while any Gaussian splat primitive remains alive. After the last primitive is destroyed, it waits for initialization and admitted tasks to finish. It then destroys the worker. A new primitive cancels a pending release.

Pull request 31 contains this cleanup. Two matched comparisons against the merged baseline give these results:

| Run | Baseline private process memory | Cleanup | Saving |
| --- | ---: | ---: | ---: |
| 1 | 894.75 MiB | 677.23 MiB | 217.52 MiB |
| 2 | 932.50 MiB | 699.66 MiB | 232.84 MiB |

These values sum Linux `Private_Dirty` across the browser processes after content removal and main-context garbage collection. They measure host memory, not video memory. Allocator behavior affects the exact result. Earlier exploratory runs also included worker padding and are not the final matched estimate.

The matched unload and reload test verifies zero worker references after disposal. A new tileset recreates the worker and restores 2,087,136 splats in request-render mode.

The 64 MiB prepared attribute buffer still exists during an active snapshot replacement. This work does not claim to eliminate that buffer. The useful saving is the worker memory that previously remained after all splats were removed.

## 4. Mixed-content stress

The browser test loads two Geo splat tilesets, one batched mesh tileset, one point cloud tileset, and a checkerboard polygon.

It runs three cycles of 120 moving-camera frames. It switches splat budgets between zero, 32 MiB, and 1 GiB. It also changes detail error and request-render mode.

The merged baseline, worker-padding candidate, and worker-lifetime candidate recover after all cycles. No render errors occur. Both splat primitives finish disposal with zero counted texture and geometry bytes.

Pull request 30 adds a public-fixture regression test. It exercises multiple splat primitives, meshes, point clouds, camera changes, zero budgets, recovery, and independent destruction.

The first test attempt used a one-pixel default canvas. That canvas produced no selected tiles. A 512 by 512 test canvas fixes the fixture. This was a test setup error, not a renderer failure.

## 5. Context-loss recovery

The test forces loss with `WEBGL_lose_context`. An event listener permits restoration. The test then requests restoration and resumes rendering.

Continuous rendering fails during loss in `FramebufferManager.update`, through `GlobeDepth.update`. The error reports a zero texture width. CesiumWidget stops its default render loop.

Skipping rendering while the context is lost prevents that exception. It does not restore the resources. After restoration, the guarded Geo scene has zero nonzero RGB channels and reports `INVALID_OPERATION`. The tileset still reports 2,087,136 splats. That count does not prove rendering works.

The mesh and point cloud scene also fails. It has 217,393 nonzero RGB channels before loss and zero afterward. Therefore this problem is not specific to Gaussian splats.

A page reload reconstructs the viewer and its resources. The final recovery trace records 2,087,136 splats and 1,636,214 nonzero RGB channels after reload.

The [WebGL specification](https://registry.khronos.org/webgl/specs/latest/1.0/#5.14.15) invalidates graphics objects on context loss. Restoring the drawing buffer does not restore those objects. The experiment agrees with that requirement.

### Recovery design and limits

A safe application-level recovery path must preserve application-owned state, destroy the old viewer, create a new viewer, and reload content. The application must supply its camera, layers, tilesets, selections, and custom primitive state. The page-reload experiment validates full reconstruction, not an in-place viewer replacement implementation.

Transparent engine recovery requires a separate architectural decision. Context caches, extensions, shaders, buffers, textures, framebuffers, and content loaders must agree on a new context generation. Late asynchronous results must not commit resources from the lost generation.

Some buffers and procedural geometry no longer have retained CPU source data. Retaining all source data for restoration conflicts with the memory reductions under investigation. An engine recovery contract therefore needs resource reload callbacks or explicit failure for resources that cannot be reconstructed.

No partial context-loss guard is proposed for production. It hides the first error while leaving the scene black. The research pull request records the failure, the rejected guard, and the recovery design for review.

## Review boundaries

The production commits are:

- `40c5f169d5`: worker padding, pull request 29.
- `ab30d16a33`: mixed-content regression coverage, pull request 30.
- `48034bc609`: worker lifetime cleanup, pull request 31.

Production pull requests target `construkted` and remain separate by topic. This research pull request targets `research/splat-deferred-upload`. Its scripts and raw results do not belong in the production branch.

## Validation

The worker-padding branch passes 53 splat tests. The worker-lifetime branch passes 56 splat tests. The mixed-content integration test passes independently.

A fresh full-suite baseline passes 15,816 tests and fails 16 rendering tests. The combined full suite passes 15,826 tests and fails the same 16 tests. The failure-name comparison contains no added or removed failures. All 60 Gaussian splat tests pass in that run.

The worker-lifetime branch head is `c557f75632`. Its second commit moves the fork changelog entry so it merges independently with worker padding. The source change remains `48034bc609`.

The local integration commit is `119f81a3a0`. It combines the three production topics for full-suite validation. It is not a production pull request.

The final combined browser check preserves 1,301,102 and 2,087,136 splats at the two detail stages. Disposal leaves zero worker references and no texture worker. The same idle scene then recreates the worker and reloads 2,087,136 splats.

## Reproduction

The scripts use the server experiment directory and its existing Geo and Bike datasets. Build the listed commits in a clean checkout. Save each Cesium bundle as `<variant>-Cesium.js` and its worker directory as `<variant>-Workers` in the experiment directory. The scripts route both resources so worker code matches the selected variant.

Run `profile.mjs` for detail transitions, `reentry-memory.mjs` for unload and reload, `stress.mjs` for mixed content, and `context-recovery.mjs` for forced context loss. Each script records JSON results. The archive also contains the launch scripts and completion markers.
