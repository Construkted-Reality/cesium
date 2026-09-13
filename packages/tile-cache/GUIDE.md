# Optional tile caching

Use `@construkted/tile-cache/decoded` for bounded decoded Draco geometry retention
in RAM. Geometry retention is enabled by default; texture retention requires an
explicit option. This entry point only needs `lru-cache` and the Cesium runtime.
It works with ordinary browser HTTP caching and does not register a Service Worker.

The separate response-cache entry point stores encoded tile files on browser disk
when the application needs controlled local retention. Workbox owns its fetch
lifecycle and `idb` provides its metadata database. There is no encoded-response
RAM tier. All three dependency versions are pinned.

## Build and enable

Run these commands from the repository root:

```sh
npm install --ignore-scripts
node tools/tile-cache/build.mjs
```

Serve `Build/TileCache/worker.js` at the application root, or provide the
`Service-Worker-Allowed: /` response header. Serve the client module too.
Use HTTPS or localhost. Enable the cache before creating a tileset:

```js
import { registerTileCache } from "/Build/TileCache/client.js";

const cache = await registerTileCache({
  workerUrl: "/Build/TileCache/worker.js",
  urlPrefix: "https://assets.example.com/project/revision-17/",
  scope: "account-42",
  version: "revision-17",
  diskBytes: 1024 * 1024 * 1024,
  maximumEntryBytes: 16 * 1024 * 1024,
});

console.log(await cache.stats());
await cache.clear();
```

Use a non-secret account identifier for `scope`. Only cache an immutable dataset
directory whose version is known. A version must change whenever its content
changes. The package does not revalidate a hit with the server. Cache clearing
does not revoke authorization; stop application requests before logout or purge.
The first cache fill still requires server authorization.

The exact URL, request headers, credentials mode, and request mode are hashed
into the cache key. Tokens are not stored in metadata. A token change currently
causes a miss even when the asset bytes have not changed. Cookies require the
application to use the correct account scope. External resources outside
`urlPrefix` continue through the network. Range requests, non-GET requests,
non-200 responses, `Vary: *`, and responses marked `no-store` or `no-cache`
are not cached. Use CORS-readable responses.

## Budgets and persistence

The disk budget counts stored decoded HTTP body bytes, not GPU bytes or browser
storage overhead. Writes evict entries before admission. IndexedDB metadata and
browser overhead are additional. Browser quota failures fall back to networking;
inspect the `errors` counter. Storage is subject to browser eviction and user
clearing. A cache hit does not guarantee permanent offline availability.

Committed disk entries survive worker termination. Response buffering and
concurrent in-flight requests still use transient RAM. `maximumEntryBytes` bounds
admission per response. The default disk cap is 256 MiB per account/version/prefix
namespace, not a global origin quota. Remove obsolete namespaces through application
storage management. Site-wide budgeting and a user-facing clear control belong to
the integrating application.

Metadata is committed after response storage. Startup removes uncommitted cache
responses and missing-body records. Web Locks serialize disk operations where
available. Consuming a response does not wait for its cache write; `stats()` waits
for pending writes and provides a measurement barrier.

The store evicts the least recently accessed entries before each write to fit its
byte budget. LRU is its only policy. The earlier prototype's `memoryBytes` and
`policy` options are rejected. Remove those options and calls to `clearMemory`;
use `clear()` to purge the configured disk namespace.

## Service Worker ownership

The worker may finish a download and cache write after its consumer aborts.
Tests verify consumer cancellation and complete cached bodies. They do not
promise immediate cancellation of the underlying network transfer.

The standalone registration refuses to replace a different root Service Worker.
Applications with an existing worker need an integration at that worker's routing
layer before using this package. All tabs sharing a namespace must configure the
same budgets. Updates use the versioned storage schema; changes to that schema
require a new storage prefix and an explicit migration or purge plan.

## Verification

Prepare decoder assets with `npx gulp prepare`, build Cesium with
`npx gulp build`, then run:

```sh
node tools/tile-cache/run.mjs --phase=cache --output=/tmp/tile-cache/cache.json
```

Add `--software=true` for functional tests without hardware WebGL. The runner
checks return pixels and verifies complete reloads after browser restart while
the tile endpoint is unavailable and the HTTP cache is disabled.

## Decoded geometry and texture RAM cache

The optional `@construkted/tile-cache/decoded` entry point retains completed
Draco geometry and decoded/transcoded image loaders after their rendering
consumers release them. It uses private Cesium APIs. Pin the tested fork commit
and run the cache tests when upgrading Cesium.

```js
import { retainDecodedResources } from "@construkted/tile-cache/decoded";

const decodedCache = retainDecodedResources(Cesium, {
  canvas: viewer.canvas,
  urlPrefix: "https://assets.example.com/immutable-version/tileset/",
  maximumBytes: 512 * 1024 * 1024,
  geometry: true,
  textures: false, // Default. Opt in only after measuring the RAM tradeoff.
});
```

Install it before loading the tileset. Use one controller and one viewer context
per Cesium ResourceCache. Do not combine it with the older harness-only decoded
image adapter. The prefix must identify an immutable asset directory. Changing
content must use new URLs. This adapter reuses Cesium's existing resource keys;
it does not add an independent asset-version or texture-format namespace.
Destroy the controller before replacing the viewer or changing GPU capabilities.

Geometry entries keep triangle indices, vertex attribute arrays, and quantization
metadata. Only Draco geometry loaders are retained. With `textures: true`, texture entries keep KTX2/Basis transcoder output, its GPU-compatible
compressed format, and mip levels. They remain ready for upload. Ordinary decoded
image objects are also supported. GPU buffers, textures, models, and draw commands
are not retained by this adapter.

On a cache hit, Cesium can reuse the CPU-side result and rebuild GPU resources.
It can still read and parse the compressed GLB through the response cache. On a
miss, ordinary loading and decoding continue. The RAM cache does not replace the
Service Worker response cache and does not survive a page reload. The response
cache can provide compressed bytes for offline reconstruction after a restart.

`maximumBytes` bounds retained payload charges. The cache counts full backing
ArrayBuffers and counts a shared buffer once within an entry. It conservatively
charges buffers shared by different entries more than once. `stats()` also reports
`uniquePayloadBytes`, computed on demand and deduplicated across retained entries. Ordinary image objects use a
width-times-height-times-four pixel estimate. Loader metadata, browser overhead,
WebAssembly heaps, and GPU allocations are excluded. Released resources remain
subject to ordinary garbage collection, so this is not a browser-process RAM cap.

`stats()` exposes entries, charged bytes, unique payload bytes, oversized bypasses,
and per-type admissions, hits, and evictions. Hits count ResourceCache lookups;
multiple geometry attributes can look up the same retained loader. Clearing and
destruction count as evictions. A payload larger than the budget is not retained.

```js
console.log(decodedCache.stats());
decodedCache.clear(); // Release cache references; keep live caller references.
decodedCache.destroy(); // Clear and remove this adapter. Safe to call twice.
```

A context-loss notification clears retained entries and suspends admission until
restoration. The viewer remains responsible for restoring rendering. Clearing the
cache cannot destroy data still referenced by an active consumer. Such data can
be admitted again when that consumer subsequently releases its reference.

Geometry reuse still needs the original encoded tile response for parsing and
loader setup. If both the ordinary HTTP cache and optional disk cache miss, that
response must be downloaded again. Texture decoding and GPU uploads can recur
when only geometry is retained. Select payload budgets for the target device and
working set; a larger combined cache is not automatically a better choice.
