# Local tile response cache

This opt-in package retains encoded HTTP responses in worker RAM and browser
Cache Storage. It does not modify Cesium's GPU cache or loader lifetimes.
Workbox owns the fetch lifecycle, `idb` provides the metadata database, and
`lru-cache` enforces the RAM byte budget. All three dependency versions are pinned.

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
  memoryBytes: 128 * 1024 * 1024,
  maximumEntryBytes: 16 * 1024 * 1024,
});

console.log(await cache.stats());
await cache.clearMemory();
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

RAM is owned by the Service Worker. Browsers can terminate an idle worker, so
RAM retention is opportunistic; committed disk entries survive worker termination.
Each returned RAM response uses a copy so a decoder cannot detach the cached
buffer. Copies, response buffering, and concurrent in-flight requests consume
memory beyond the retained-byte budget. `maximumEntryBytes` bounds admission
per response. The budget is per account/version/prefix namespace, not a global
origin quota. Remove obsolete namespaces through application storage management.

Metadata is committed after response storage. Startup removes uncommitted cache
responses and missing-body records. Web Locks serialize disk operations where
available. Consuming a response does not wait for its cache write; `stats()` waits
for pending writes and provides a measurement barrier.

The default eviction policy is `lru`. The experimental `revisited` policy protects
entries that have had a cache hit before evicting entries encountered only once.
It applies to disk retention. RAM uses the established library's LRU policy.

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

Build Cesium with `npx gulp build`, then run:

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
  textures: true,
});
```

Install it before loading the tileset. Use one controller and one viewer context
per Cesium ResourceCache. Do not combine it with the older harness-only decoded
image adapter. The prefix must identify an immutable asset directory. Changing
content must use new URLs. This adapter reuses Cesium's existing resource keys;
it does not add an independent asset-version or texture-format namespace.
Destroy the controller before replacing the viewer or changing GPU capabilities.

Geometry entries keep triangle indices, vertex attribute arrays, and quantization
metadata. Texture entries keep KTX2/Basis transcoder output, its GPU-compatible
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
`uniquePayloadBytes`, deduplicated across entries. Ordinary image objects use a
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

For the Palace A/B workload, the first combined-cache preview retained about
282 MiB of payload: 80 MiB of geometry and 202 MiB of texture blocks. This is
additional system RAM and can overlap data already uploaded to the GPU. The
benefit and appropriate budget depend on the revisited working set.
