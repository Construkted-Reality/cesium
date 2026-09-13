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
