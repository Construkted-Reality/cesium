# Memory and rendering experiments, 2026-09-12, round 3

## Baseline and scope

All experiments run on 192.168.8.212 with an NVIDIA RTX A4000. The Cesium baseline is `c7e8148fe9`, after PR16 merges into `feature/splat-perf`. PR15 remains separate. These changes do not move the performance branch to the independently updated main branch.

| Change | Result | Review |
| --- | --- | --- |
| Align shader pass constants | Fix overlay and direct-edge pass values | [PR17](https://github.com/Construkted-Reality/cesium/pull/17) |
| Keep framebuffer limits per context | Resolve 65 existing OpenGL failures | [PR18](https://github.com/Construkted-Reality/cesium/pull/18) |
| Defer unused transparency targets | Save 63.3 MiB at 1080p; reduce GPU time 2.9% to 7.4% | [PR19](https://github.com/Construkted-Reality/cesium/pull/19) |
| Defer unused PNTS properties | Reduce initial vertex buffers from 11 MiB to 3 MiB | [PR20](https://github.com/Construkted-Reality/cesium/pull/20) |
| Trim unused splat staging on request | Reclaim about 276 MiB of CPU buffers, with a reentry cost | [PR21](https://github.com/Construkted-Reality/cesium/pull/21) |
| Reuse an SPZ decoder module | Decode 27.3% faster than the published package | Separate dependency patch |

Each Cesium code branch starts from the merged PR16 baseline. The production pull requests contain code and tests. Raw measurements remain outside their diffs.

## Transparency targets

A WebGL allocation ledger records exactly 66,355,200 fewer bytes in each 1920 x 1080 opaque scene: Geo splats, Bike splats, and BatchedTextured mesh. The ledger measures allocated WebGL resources, excluding driver overhead and browser backbuffers.

The multiple-render-target path now allocates transparency targets when translucent commands first appear. Initialization precedes derived shader construction. It preserves opaque pixels and configures composition for the full view. Multipass and translucent invert-classification initialization retain their existing behavior. Once allocated, targets remain available across visibility changes.

| Scene | Baseline GPU median | Candidate GPU median | Reduction |
| --- | --- | --- | --- |
| Geo, 2,087,136 splats | 6.061 ms | 5.883 ms | 2.9% |
| Bike, 705,883 splats | 2.183 ms | 2.022 ms | 7.4% |

The timing comparison uses baseline/candidate/candidate/baseline order, 240 measured frames per run, fixed GPU clocks of 1350 MHz and memory clocks of 7001 MHz, and a frozen tile selection. Both scenes remain at the 60 Hz frame cap. GPU time uses timer queries. These results do not imply an increase in displayed frames per second.

Rendering comparisons cover first-frame visibility transitions, high dynamic range, resize, single-sample rendering, invert classification, 2D, and stereo. A dateline test catches a prototype error: first use in a wrapped viewport configures half-width composition. The bad frame differs in 32,768 channels, with maximum channel error 191. After the viewport fix, all four dateline transitions match baseline exactly.

The initial forced-multipass fixture changes flags after framebuffer managers already exist. It produces invalid configurations and swallows render errors. Those captures are rejected. Correct construction with render errors enabled exposes a baseline multipass shader error (`out_FragColor` is undeclared). The production optimization preserves eager multipass setup.

The saving lasts until transparency becomes necessary. This change does not free previously allocated OIT targets when translucent content disappears.

## PNTS property dependencies

The earlier experiment uses a hand-written dependency list. This implementation uses Cesium style variables and custom shader attribute and metadata dependency sets. A style expression that does not expose dependencies takes a conservative path.

The 262,144-point fixture has eight scalar properties. Initial vertex buffers decrease from 11 MiB to 3 MiB. One required property produces 4 MiB. Each newly required scalar property adds 1 MiB. Once all properties have been used, buffers return to 11 MiB and remain allocated.

Nine phases exercise style changes, style defines, vertex and fragment custom shaders, direct attribute access, and metadata access. All pixel hashes match baseline in Chromium and Firefox. Integration tests also cover sanitized identifiers, independent property backing arrays, and buffer destruction.

Unused properties remain in CPU arrays. This is a VRAM reduction, not an equal reduction in total application memory. Model geometry accounting includes the retained arrays and remains 11 MiB in this fixture. Uploaded arrays leave CPU storage. Buffers stay owned by the loader until model destruction.

`getMetadataProperty` currently supports property textures and explicitly returns undefined for arbitrary property attributes. This change preserves the supported picking path. Future property-attribute picking must participate in dependency tracking.

## Explicit splat staging trim

At SSE 1e9 followed by `trimLoadedTiles`, the Geo fixture unloads all 139 cached tiles. It selects zero tiles, reports no pending requests or processing, and still draws the committed 2,087,136-splat snapshot. Restoring SSE 4 reloads the tiles successfully.

The initial automatic-release probe reclaims substantial CPU storage but increases reentry frame time. The production change attaches scratch release to the application's explicit `trimLoadedTiles()` request. Active and pending snapshot buffers remain protected by backing-buffer identity, including subarray views. GPU allocations and the committed snapshot remain intact.

| Run | Retained ArrayBuffer bytes after trim | Reentry p99 | Reentry maximum |
| --- | --- | --- | --- |
| Baseline 0 | 365,626,459 | 129.7 ms | 167.5 ms |
| Candidate 1 | 76,244,968 | 158.7 ms | 204.5 ms |
| Candidate 2 | 76,244,894 | 159.8 ms | 200.0 ms |
| Baseline 3 | 366,147,611 | 141.6 ms | 144.6 ms |

The average reduction is about 276 MiB. Reentry p99 increases from about 136 ms to 159 ms in the five-second reload fixture. All runs return to the original splat count. Memory measurements use Chromium's main-thread ArrayBuffer backing-storage counter after collection; they do not measure GPU memory or all process memory.

Applications that do not explicitly trim retain the current scratch reuse behavior. This is an intentional memory-versus-rebuild-cost tradeoff.

## Compatibility fixes

JavaScript assigns overlay pass 14 and direct-edge pass 13. The corresponding shader constants are 13 and 12. Correcting them fixes the existing overlay comparison. Seven additional pass-rendering tests cover previously untested constants. All 95 automatic-uniform tests pass.

A second probe creates a WebGL2 context with eight color attachments, then a WebGL1 context without draw-buffer support. The global attachment limit becomes one. Baseline framebuffer validation incorrectly rejects a valid two-attachment framebuffer on the first context. Storing the limit on its owning context fixes the reproduction. All 71 framebuffer tests pass. The full OpenGL suite drops from 81 failures to 16, with no new failures.

## Separate reusable decoder API

The dependency checkout is `drumath2237/spz-loader` at `336b5e7`, version 0.3.1. The prepared API adds `createSpzDecoder()` with serialized `loadSpz()` calls and explicit `release()`. Initialization and decode failures discard the cached module before the next request. Returned arrays remain valid after release. Existing one-shot calls keep their allocation policy.

The dependency patch also releases native vector handles in a finally block. It preserves the generated Node.js module import during bundling. It includes eight native tests, including initialization failure, queued recovery, release during initialization, options, input views, independent instances, and 2,000 repeated decodes.

| Browser mode | 80-file run 1 | 80-file run 2 |
| --- | --- | --- |
| Published one-shot | 1223.7 ms | 1222.9 ms |
| New one-shot | 1260.5 ms | 1227.2 ms |
| New reusable decoder | 892.4 ms | 886.2 ms |

Reusable decoding is 27.3% faster than the published package and 28.5% faster than the matching new one-shot implementation. Every decoded-array hash matches for 80 real Geo and Bike files. Each run also rejects 12 malformed inputs and correctly decodes a valid input after each rejection.

Two additional 400-job reuse runs retain a stable 30,998,528-byte WebAssembly heap. Explicit release clears module and buffer weak references after collection and reduces renderer resident memory by about 26.1 MiB. The next decode succeeds. WebAssembly memory is not included in Chromium's ArrayBuffer backing-storage counter.

Cesium integration remains pending a supported dependency release. This is a decoding-time improvement with bounded idle retention, not a VRAM optimization.

## Remaining issue: splat cache accounting

The trim experiment exposes an independent accounting bug. After every cached splat tile unloads, reported memory becomes approximately negative 10.7 MiB. Reentry reports a much larger value than the initial load.

`GaussianSplat3DTileContent.texturesByteLength` divides the current shared primitive texture size by the current selected tile count. Tile statistics add one getter value on load and subtract a different value on unload. The shared allocation should have one owner; a changing per-tile fraction is not a valid accounting unit.

This issue is documented but not patched in this round. A follow-up must separate shared snapshot allocations from per-tile storage and verify cache eviction and statistics together. Empty-selection behavior also deserves further work before releasing the committed GPU snapshot.

## Evidence

[Download scripts, measurements, logs, and patches](https://github.com/Construkted-Reality/cesium/releases/download/memory-benchmarks-2026-09-07/performance-experiments-2026-09-12-round3.tar.gz).

Full raw captures remain on the server in `/mnt/data2/cesium-splat-perf/experiments-2026-09-12-round3`. The published archive excludes datasets, copied bundles, raw framebuffer captures, sockets, and process identifiers. A manifest records archive-entry hashes.
