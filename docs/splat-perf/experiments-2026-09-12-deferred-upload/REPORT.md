# Deferred Gaussian splat upload

Date: 2026-09-12. All implementation and tests run on 192.168.8.212.
Hardware: NVIDIA RTX A4000. Driver: 595.71.05. Browser: Chromium 151.
Baseline: c5e50f8eb0, which includes PR 27. Candidate: 36ba74fee6.

## Result

The candidate prepares texture data and sorts before it uploads replacement textures. A scene afterRender callback releases the old textures before the replacement upload. The callback checks the current generation and does not retain a discarded snapshot.

This reduces both Cesium allocation peaks and NVIDIA-reported memory growth at matching detail. It has a temporary CPU memory cost and a transient refinement timing cost. It is a memory improvement, not a frame-rate improvement.

## Fixed-detail allocation measurements

The camera remains fixed at 1920 by 1080. The cache allows 1 GiB, with the default overflow allowance. The maximum screen-space error sequence is 4, 8, 4, 12, 4. Each stage waits for loaded tiles, a committed matching selection, and one additional second.

| Dataset | Baseline peak | Candidate peak | Reduction |
| --- | ---: | ---: | ---: |
| Geo | 422.39 MiB | 263.17 MiB | 37.7% |
| Bike | 128.92 MiB | 89.43 MiB | 30.6% |

Geo uses two baseline and two candidate runs in baseline, candidate, candidate, baseline order. Bike uses one paired run.

Geo counts match at every stage: 1,301,102 splats at error 8, 2,087,136 at error 4, and 724,860 at error 12. Bike counts also match: 321,102, 705,883, and 226,117 respectively.

The ledger records memory during primitive updates and immediately before and after draw-command construction. Thus it includes retired draw buffers before the frame-completion callback releases them.

## Driver memory

A separate paired test samples NVIDIA Management Library memory every 20 ms. The table subtracts board memory measured immediately before each browser launch. Weston is the only graphics process before those launches. This measurement includes browser and driver allocations, not only Cesium textures.

| Run | Baseline peak growth above idle | Candidate peak growth above idle |
| --- | ---: | ---: |
| First pair | 1,153.94 MiB | 942.56 MiB |
| Second pair | 1,108.94 MiB | 903.75 MiB |

The paired mean falls from 1,131.44 MiB to 923.16 MiB, an 18.4% reduction. Each run returns to its initial board memory after the browser closes. The raw records retain absolute samples, initial memory, and the process table.

## Timing and CPU tradeoffs

During Geo refinement, candidate stage p95 frame intervals reach 22.0 to 22.6 ms. The paired baseline refinement values range from 17.5 to 20.1 ms. Candidate maximum intervals remain approximately 102 to 105 ms, compared with 101 to 113 ms for the baseline. The final 25 intervals of each settled stage have p95 values around 17 to 18 ms.

At two million splats, the candidate retains an additional 64 MiB generated attribute buffer while sorting. Upload completion clears that payload. Packed harmonics reuse existing snapshot storage. After garbage collection, settled backing-storage measurements vary by a few MiB between runs; the extra 64 MiB does not remain.

These are short transition tests. They establish a memory reduction and expose a transient timing cost. They do not establish a general frame-rate improvement.

The immediate-upload-on-sort-arrival variant keeps the same allocation savings but still reaches 22.4 to 23.3 ms p95 on the last refinement. It does not consistently remove the timing cost. The implementation retains the explicit frame boundary.

## Images

The paired runs preserve splat counts. Geo image mean absolute channel differences are below 0.001 on a 0 to 255 scale. Baseline reruns have differences of the same magnitude. No measured paired Geo pixel differs by more than 8 in any channel. See image-comparison.json for every comparison and image hashes.

Original PNG files remain in the server experiment directory. The public research archive contains comparison data, not dataset images.

## Correctness and compatibility

- Fifty Gaussian splat tests pass, including five new regression tests.
- The full functional suite at f44235c1da has 15,816 passes and the same 16 failure names as the PR 27 baseline with 15,811 passes.
- The final profiling-only change passes the fifty focused tests, lint, formatting, TypeScript checks, and commit hooks.
- Cold request-render-mode loading, detail replacement, and full recovery pass.
- After settling, the idle-mode check observes zero additional frames during one second.
- Injected replacement-command failure releases the uploaded texture, then rebuilds and recovers full detail.
- Queued uploads ignore destroyed primitives and replaced generations.
- Existing transformed-instance, harmonics, visibility, and picking tests pass.

Idle-mode testing exposes a pre-existing missing wake-up: baseline loading stops with a rebuild pending, zero stable frames, and no render requested. It remains at 1,818,527 splats after 45 seconds. The candidate requests frames for synchronous preparation, retry, and selection stabilization. Worker completion advances the asynchronous phases.

Forced context loss produces the same existing zero-width framebuffer error on baseline and candidate. Both dispose of the tileset and primitive and reduce counted splat texture and geometry bytes to zero. This change does not add automatic context restoration.

## Reproduction

Run dependency installation, npx gulp prepare, and npm run build in a checkout of the desired commit. The fixed-cpu.mjs script routes the harness to the named browser bundle. driver-memory.py samples memory while that script runs. lifecycle-debug.mjs covers cold loading, warm idle replacement, and injected failures.

The scripts use the server datasets at /mnt/data2/gs/oracle-run/geo-newdefault and bike-newdefault. Start the repository performance server on port 8099 and the NVIDIA-backed headless Weston compositor. The scripts record all settings and paths.

raw-data.tar.gz contains JSON traces, test logs, scripts, and completion markers. SHA256SUMS verifies the archive. Prototype patches remain research artifacts. Production changes contain no research JSON or dataset images.

## Review order

Merge PR 27 before the lifecycle PR. The lifecycle branch contains three additional commits for implementation, queued-work handling, and profiling. Both changes can then be reviewed as separate upstream-portable units.
