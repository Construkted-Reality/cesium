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

Keep raw measurements and investigation notes on `research/tile-cache-results`.
Keep implementation on `feature/tile-cache-harness`. Do not push without approval.
