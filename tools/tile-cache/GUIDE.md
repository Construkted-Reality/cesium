# Tile cache harness

Run `npm install --ignore-scripts`, `npx husky`, and `npx gulp build` first.

Run the controlled baseline:

```sh
node tools/tile-cache/run.mjs --output=/tmp/tile-cache/baseline.json
```

The default requires hardware WebGL. For functional tests on a machine without
a rendering GPU, add `--software=true`. Results record the actual renderer.
Software results are not hardware GPU benchmarks.

The fixture has 8 separated tiles with deterministic textures and external glTF
buffers and images. It introduces 100 ms server latency per request by default.
This reproduces eviction and requests; it is not a real photogrammetry benchmark.
Use `--latency=0`, `--textureSize=1024`, or `--repetitions=5` to vary the inputs.

Each independent repetition creates a fresh browser profile and visits A, B, A.
The runner checks visible tile identity, eviction, reloads, identical return-view
pixels, and actual server requests. Conditions disable or enable the HTTP cache,
or increase resident memory enough to retain both views. A tile load is never
classified as a network transfer without server evidence.

The JSON records configuration, commit, browser, host, renderer, frame intervals,
resource timing, resident bytes, tile events, and server request bytes and status.
The runner saves completed runs and any failure before exiting. The settle metric
includes 4 stable rendered frames. Fetch timing does not independently attribute
decode or GPU upload time. Resource Timing alone does not prove a disk cache hit.

The server binds only to loopback. It serves the build, harness, dependencies, and
generated fixture. No internet dataset or account token is required.

## Work sequence

1. Verify the harness and baseline.
2. Prototype Workbox Cache Storage and an explicit byte budget.
3. Add bounded RAM storage with established LRU components.
4. Test persistence, offline revisits, identity, cancellation, and storage failure.
5. Compare retention policies and decoded-resource retention.
6. Evaluate alternate disk storage only if the measurements show a limitation.

## Extended verification

Build the optional cache and experiment modules with
`node tools/tile-cache/build.mjs`.

```sh
node tools/tile-cache/contracts.mjs /tmp/tile-cache/contracts.json
node tools/tile-cache/integration.mjs /tmp/tile-cache/integration.json
node tools/tile-cache/run.mjs --phase=cache --output=/tmp/tile-cache/cache.json
node tools/tile-cache/run.mjs --phase=retention --output=/tmp/tile-cache/retention.json
node tools/tile-cache/run.mjs --phase=decoded --output=/tmp/tile-cache/decoded.json
node tools/tile-cache/run.mjs --phase=cache --idleMs=60000 --repetitions=1 --output=/tmp/tile-cache/idle.json
```

The storage contracts test byte limits, concurrent writes, transferred buffers,
admission, interrupted writes, injected quota failure, and resource identity.
The integration test uses the actual Service Worker to check cross-tab account
and version isolation, request-header identity, range/no-store bypass, cancellation,
RAM eviction, disk reuse, and explicit purge.

The retention phase gives the disk cache 2 MiB and visits A, B, A, C through H,
then A again. It checks whether a repeat visit protects A through the journey.
This phase does not promise offline restart: budget eviction can remove hierarchy
resources even when some tile content survives.

The decoded phase is a harness-only experiment. It holds references to ordinary
decoded image loaders within a 16 MiB RGBA pixel estimate. It does not retain GPU
textures, compressed images, or decoded geometry. The runner checks image reuse,
identical pixels, and zero loader references after teardown. Browser allocation
overhead is not included in this estimate. It is not a supported production hook.
An ImageBitmap's backing storage is browser-managed; this experiment does not
prove that every retained decoded byte resides exclusively in system RAM.

The idle test allows a Service Worker to lose its RAM state. Disk hits are valid
after the wait. Each cache phase also restarts the entire browser and verifies A
with the tile endpoint unavailable and the HTTP cache disabled. Source hashes in
the output identify the exact engine bundle, worker, fixture, and harness code.

Add `--instrument=true` to record image bitmap decode durations and synchronous
WebGL texture/buffer submission calls. These probes add overhead and are optional.
WebGL call durations are not GPU completion times. The probe does not measure
Draco, meshopt, SPZ, or KTX2 decoding. Keep instrumented runs separate from the
unmodified baseline when reporting timings.

Add `--crossOrigin=true` to serve the tileset and all of its resources from a
second origin with CORS enabled. The same return and offline-restart assertions
then check cross-origin response caching, including external glTF images.

Keep raw measurements and investigation notes on `research/tile-cache-results`.
Keep implementation on `feature/tile-cache-harness`. Do not push without approval.

For a headless NVIDIA host, pass `--backend=vulkan`. The report records the
backend and browser launch arguments. The renderer check still rejects software
rendering unless `--software=true` is explicitly supplied. Probe the host with
`node tools/splat-perf/gpu-probe.mjs` before choosing a backend.

If Vulkan loses its context in Cesium, use `--backend=gl --wayland=true`
with a running Wayland compositor. Set `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`,
and the host's `__EGL_VENDOR_LIBRARY_FILENAMES` before running the command.
This launches headed Chromium inside the compositor. On the A4000 test host,
headless Weston with its GL renderer provides hardware OpenGL rendering.
A missing renderer also fails the GPU check.

## Real Wasabi dataset

Run `npx gulp prepare` before `npx gulp build` to install the decoder assets.
Then run `node tools/tile-cache/build.mjs`. The real runner checks and hashes
the Draco and Basis WebAssembly files before opening the test server.

With the GPU Wayland environment configured, run:

```sh
node tools/tile-cache/real-run.mjs --repetitions=5 --output=/tmp/palace/results.json
```

`tools/tile-cache/palace.json` contains the public Wasabi URL, budgets and two
explicit camera poses. Pose A uses the asset page's saved camera. Pose B views
the opposite side. Each scenario follows A, B, A. The asset uses local coordinates,
so the runner places its local origin at longitude 0, latitude 0 with an east,
north, up transform. It freezes the clock and uses a 1280 by 720 viewport.

The real runner fetches Wasabi directly without injected latency. It compares
uncached, HTTP cache, larger Cesium residency, disk, and RAM/disk conditions.
Use `--conditions=uncached,disk` for a short diagnostic run. Every settled visit
saves a PNG and the exact pose, selected tiles, load/unload events, cache counters
and CDP network records. Cached conditions also restart the browser with actual
Wasabi requests blocked. Failed runs retain diagnostics and failure screenshots.

Network instrumentation observes both page and Service Worker sessions, excluding
worker-supplied page responses and browser-cache responses from upstream totals.
Run `node tools/tile-cache/network-check.mjs` to verify the counters against the
controlled server. Encoded transfer bytes include HTTP overhead and exclude
unknown bytes from cancelled transfers. All timings include tile selection,
decoding, upload and four stable frames. They are not isolated decoder timings.

Add `--idleMs=60000` to wait one minute before returning to A. To build a local
screenshot gallery and summary table from a completed run, use:

```sh
node tools/tile-cache/real-report.mjs /tmp/palace/results.json
```

Open the resulting `gallery.html`. It includes each camera screenshot, the exact
pose, selected tile URLs and transferred bytes. `summary.json` contains the
per-condition timing distributions. The runner saves JSON through an atomic
rename so readers can copy completed snapshots while measurements continue.

## Eight-view route

Use `--config=tools/tile-cache/palace-route.json` for eight poses repeated twice.
The route keeps the original front and back views and adds three intermediate
views plus three facade detail views. Close cameras use local `position` and
`target` coordinates in metres. Other poses use longitude, latitude and height.
An optional `route` array specifies pose indices; the default remains `[0, 1, 0]`.

```sh
node tools/tile-cache/real-run.mjs --config=tools/tile-cache/palace-route.json --conditions=disk --decoded=both --repetitions=3 --output=/tmp/palace-route/results.json
node tools/tile-cache/real-report.mjs /tmp/palace-route/results.json
```

The first lap populates the caches. The second lap measures every pose again.
The runner verifies matching pixels and tile IDs for each repeated pose. It also
checks that repeated poses make no upstream requests in local-cache conditions.
Results include every revisit and per-pose distributions in the generated summary.

This route increases the rendering overflow allowance to 1 GiB while retaining
the one-byte unused-tile target. The old 256 MiB allowance reduced detail at close
positions. `requireFullDetail` rejects any visit whose memory-adjusted screen-space
error differs from the requested error. The decoded RAM budget is separate.

Each visit records tile levels, geometric errors, triangle counts and terminal
nodes of the expanded tile tree. Post-timing depth-buffer samples record surface
positions and camera distances on a 3 by 3 screen grid. These samples verify the
close views but do not measure collision clearance in every direction. They and
screenshots occur after the settled-view timer stops.

## Pipeline attribution

Add `--pipeline=true` to `real-run.mjs` for diagnostic probes. Run the same
conditions without that flag to measure probe overhead. Each fresh profile gives
a cold first A view, followed by B and a return to A. `setupMs` records page,
viewer and manifest setup before the first pose; `settleMs` starts at the pose.

The probes leave engine source unchanged. They wrap loader processing, resource
body promises, resource jobs, WebGL calls and the original decoder workers.
Worker records distinguish queue time, receive-to-post execution and main-thread
result delivery. They support this fork's embedded worker build. GPU elapsed
queries cover rendered frames; they are separate from CPU submission timings.
The diagnostic Service Worker adds a cache-lookup duration header to hits. The
normal Service Worker remains unchanged. Build both with `build.mjs`.

Intervals overlap. Do not sum body, worker, main-frame and GPU durations into a
single elapsed-time total. Resource promises can be cancelled by Cesium before
any network request; use CDP records for actual transfers. Early `tilesLoaded`
signals can describe provisional selection immediately after a camera change.
The stable final selection and screenshot equality checks determine completion.

## Draco stage and worker experiments

Build optional diagnostic workers with `node tools/tile-cache/draco-build.mjs`.
This generates copies of the current engine worker and fails if the expected
source patterns change. It does not edit production engine sources.

```sh
node tools/tile-cache/real-run.mjs --conditions=disk --repetitions=3 --draco=legacy --workers=1 --pipeline=true --output=/tmp/draco-legacy/results.json
node tools/tile-cache/real-run.mjs --conditions=disk --repetitions=1 --draco=bulk --workers=4 --verify=true --pipeline=true --output=/tmp/draco-verify/results.json
```

`--draco=legacy` retains the existing extraction APIs. `--draco=bulk` uses Draco's
bulk array APIs and copies the result out of WebAssembly memory before freeing
its temporary allocation. Both variants use the same diagnostic build and
scheduler. `--workers=1`, `2`, `4`, `8`, or `16` selects a pool size. The pool preserves the
original total outstanding-task limit, initializes lazily, and destroys its
workers during harness cleanup. It applies to mesh buffer views, not point clouds.

`--pipeline=true` adds codec, attribute, index, and total task timings. It also
records decoded array bytes and each worker's WebAssembly heap size. Heap size
is allocated WebAssembly linear memory, not total browser memory. Multiple
worker execution spans overlap. Their summed durations are work, not elapsed
camera time. Queuing and message delivery remain in the pipeline records.

`--verify=true` compares the bulk output type, length, and every byte against the
legacy extraction for each decoded mesh. Use it with the bulk variant and pipeline
flag, and exclude verification runs from performance comparisons. Run the same
matrix without pipeline probes to measure camera performance. Omit `--draco` for
a stock-engine control. All variants retain the normal pose, pixel, tile-selection,
network, offline restart, and loader-cleanup checks.

## Decoded resource cache measurements

`build.mjs` also builds `Build/TileCache/decoded-resources.js`. Add
`--decoded=geometry`, `--decoded=textures`, or `--decoded=both` to the real runner.
The default payload budget is 512 MiB; `--decodedBytes=67108864` selects 64 MiB.
Omit `--decoded` for the ordinary decoder baseline. The decoded cache is independent
of `--draco` and the compressed response-cache condition.

```sh
node tools/tile-cache/decoded-contracts.mjs /tmp/decoded-contracts.json
node tools/tile-cache/real-run.mjs --conditions=disk --repetitions=3 --decoded=both --pipeline=true --output=/tmp/decoded/results.json
node tools/tile-cache/real-run.mjs --conditions=disk --repetitions=3 --decoded=both --clearDecoded=true --pipeline=true --output=/tmp/decoded-clear/results.json
```

The lifetime contracts use actual Cesium loader classes with controlled payloads.
They verify reference ownership, LRU eviction, scope and type filtering, backing
buffer accounting, texture mip retention, context-loss notifications, and adapter
teardown. The real-model runs separately verify rendering and avoided worker jobs.

Each visit records decoded-cache statistics and checks the payload budget. Cleanup
must leave zero ResourceCache loaders and zero retained payload bytes. The optional
clear test adds B, clears the decoded cache, and revisits A to verify reconstruction
from ordinary cache misses. Browser restarts retain compressed disk responses but
start with an empty decoded RAM cache. Use `--idleMs=60000` to test a minute-away
return. Measure control runs without pipeline probes as well as traced runs.

## Live application measurements

`app-run.mjs` opens the public asset page from `palace-route.json` and instruments
its actual Cesium runtime. It does not substitute the fork engine or register a
response-cache service worker. Normal browser HTTP caching remains enabled.
Each run uses a fresh browser profile and follows the eight poses twice.

```sh
node tools/tile-cache/app-run.mjs --output=/tmp/app-http/results.json
node tools/tile-cache/app-run.mjs --decoded=geometry --decodedBytes=536870912 --output=/tmp/app-geometry/results.json
node tools/tile-cache/app-run.mjs --decoded=both --decodedBytes=2147483648 --output=/tmp/app-both/results.json
node tools/tile-cache/app-run.mjs --gpuBytes=1073741824 --output=/tmp/app-gpu/results.json
node tools/tile-cache/app-run.mjs --probe=true --recovery=native --output=/tmp/app-recovery/results.json
```

The runner requires the RTX A4000 Wayland test environment. It records live script
hashes, runtime tile budgets, final tile identities, canvas PNGs, HTTP transfers,
worker job counts, decoded payload bytes, and browser process-tree memory.
Proportional set size (PSS) accounts for shared process pages proportionally.
One-second samples include loading; their maximum is a sampled high-water value,
not a guarantee that no shorter peak occurred. GPU memory from `nvidia-smi` is
whole-device usage. Cesium's resident tile bytes are an estimate of tile resources,
not total GPU allocation. The decoded payload budget is not a browser RAM limit.

The timer starts at the camera change and waits for stable loaded selection after
the application's foveated delay. Screenshot and per-view memory reads occur after
timing. Revisit screenshots and selected tiles must match their first-lap versions.
The current application requests screen-space error 8; the runner rejects a result
that reduces this detail. A known Wordfence script response contains HTML and raises
one parser error before rendering. The runner records it and accepts only that
specific error with the matching response evidence.

`--recovery=native` triggers `WEBGL_lose_context`, requests restoration, observes the
result, then reloads the page and compares its first view. `--recovery=assisted` adds
only a one-shot `preventDefault` listener to permit browser context restoration.
It does not rebuild the viewer. This diagnostic case must not be described as the
application's unmodified recovery behavior. A completed report records failed
automatic recovery as data; `recoveredWithoutReload` must be inspected separately.
Reload must restore identical pixels. `--probe=true` uses only the first pose.
