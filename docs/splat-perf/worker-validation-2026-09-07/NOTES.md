# Worker validation and profiling, 2026-09-07

Scope: cache pressure, cancellation, long camera turns, multiple tilesets, redundant rebuild attribution,
decoder initialization, remaining heap growth, and hardware-backend plus degree-0 compatibility.
All work runs on 192.168.8.212. PR #4 is merged at d49e5558b7.
First instrument tile-load events against selected tile identities, then test any invalidation change.
Keep timing jobs sequential. Commit completed units and publish related validated work in separate PRs.

## Controlled worker and invalidation result

The first invalidation timing batch overlaps an unrelated Rust process that uses about 25 of 28 CPUs.
We preserve those files and exclude their times from performance conclusions. The job ends without our intervention.
The controlled batch records source hashes and host CPU ticks. Aggregate CPU use is about 8 percent.
Two repetitions per asset give these mean full-load times:

| Variant | Geo milliseconds | Bike milliseconds |
| --- | ---: | ---: |
| One worker | 7631 | 2578 |
| One worker, invalidation changes | 7485 | 2541 |
| One worker, 1000 ms coalescing | 6605 | 2343 |
| Two workers, 1000 ms coalescing | 3989 | 1500 |
| Two workers, both changes | 4044 | 1599 |

All 20 final captures match exactly within each asset. The invalidation change reduces rebuilds but does not establish a useful loading gain.
These comparisons use an experimental worker baseline, not the merged production loader. A separate production comparison is required.
Decoder initialization totals 318.5 ms for Geo and 154.7 ms for Bike. Native decode and output conversion cost much more.
A two-worker experiment targets those larger costs. Module reuse requires a dependency API change and is not implemented.

## Compatibility and adverse results

Weston with its headless OpenGL renderer allows Chromium to use NVIDIA hardware OpenGL on this server.
We install weston, weston-libs, and libseat. The test does not use SwiftShader.
The derived degree-0 fixture contains 235 tiles. Sampled original and derived tiles have identical non-SH decoded fields.
A Node decoder verification attempt fails because the dependency Node bridge is unavailable. Browser verification passes.
The 12 browser compatibility cases complete without browser or WebGL errors. Vulkan captures match exactly within each degree.
OpenGL captures differ by at most two color levels. Unchanged baseline repetitions will test rendering variation.
The quiet 20-second camera turns produce no blank frames and return to equal final counts and coverage.
The three-identical-tileset pressure case improves p95 from 80.2 to 52.5 ms but worsens p99 from 112.1 to 142.4 ms.
A fixed coalescing delay is therefore not ready for a production default.

## Heap attribution in progress

After 24 removal cycles, main-thread used heap grows about 1.6 MB in both production and worker runs.
Position cache entries return to zero. Worker WebAssembly memory sizes remain stable.
Initial heap comparisons show code generation and browser network records as the largest growing groups.
A 96-cycle direct Chrome DevTools Protocol run omits Playwright network tracking and never enables the Network domain.
This control will test whether those groups plateau or continue to accumulate.
