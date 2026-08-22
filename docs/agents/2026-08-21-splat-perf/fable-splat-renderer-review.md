# CesiumJS Gaussian splat renderer performance review

- Date: 2026-08-21
- Role: performance review agent for the Construkted Reality CesiumJS fork (branch feature/splat-perf, base 1.144.0, commit 9fda7ab)
- Question: where does splat rendering time go, and what concrete changes to the renderer, worker pipeline, WASM crate, and shaders are worth making
- Model: Fable 5
- Scope: read the full splat pipeline in this repo plus the wasm-splats Rust source fetched from github.com/CesiumGS/cesium-wasm-utils (main branch, files `wasm-splats/src/radix.rs`, `lib.rs`, `texture_gen.rs`)

All paths below are absolute under `/home/outsider/Projects/Construkted_Reality/code/cesiumjs/` unless marked as remote (the Rust crate).

---

## 1. Verification of the five observations

### Observation 1: 4 vertices per splat run the whole vertex shader, including SH. CONFIRMED

`packages/engine/Source/Scene/GaussianSplatPrimitive.js:1574-1579` sets `count = 4`, `primitiveType = TRIANGLE_STRIP`, `instanceCount = numSplats`. Line 1607 sets `instanceDivisor = 1` on the splat index attribute. In `packages/engine/Source/Shaders/PrimitiveGaussianSplatVS.glsl`, everything except line 182 (`corner` from `gl_VertexID`) is per-instance-constant: the two attribute `texelFetch` calls (lines 153, 166), the full covariance projection and 2x2 eigen solve (`calcCovVectors`, lines 105-139), and at SH degree 3 the 15 `texelFetch` calls plus arithmetic in `evaluateSH` (lines 51-100). GPUs do not share vertex shader results across the 4 vertices of an instance, so all of this runs 4 times per splat. At 1.126M splats and degree 3 that is 4.5M vertex invocations doing 17 integer texel fetches each, about 76M fetches per frame just in the vertex stage.

Bonus finding: `loadSHCoeff` (VS lines 32-39) calls `textureSize()` per coefficient fetch, so 15 `textureSize` calls per vertex, 60 per splat. That should be a uniform.

### Observation 2: full positions copy on the main thread per sort request. CONFIRMED, and it is worse than stated

`new Float32Array(this._positions)` at `GaussianSplatPrimitive.js:2077` (steady sort), `:2110` (WAITING retry), and `:2018` (pending snapshot sort). 1.126M splats × 12 bytes = 13.5 MB allocated and copied on the main thread, then transferred (`GaussianSplatSorter.js:68-70`), so the copy cannot be reused; the next sort allocates a fresh 13.5 MB. The chain continues off the main thread: the wasm-bindgen wrapper copies the positions again into WASM linear memory (`lib.rs`, `positions_arr.to_vec()`), and the result `Uint32Array` is copied out of WASM memory, then structured-cloned back to the main thread because the worker never adds it to `transferableObjects` (`packages/engine/Source/Workers/gaussianSplatSorter.js:16-32` ignores the `transferableObjects` parameter; `createTaskProcessorWorker.js:59` posts with an empty transfer list). Main-thread cost per sort: 13.5 MB alloc + copy, 4.5 MB structured-clone deserialize, plus GC of both. At 25 sorts per 120 frames this is the shape of the spiky processor profile (1.00 ms median vs 6.90 ms p95).

### Observation 3: any selected-tile change rebuilds everything. CONFIRMED

`GaussianSplatPrimitive.js:1761-1979`. On any change in the selected set (`haveSelectedTilesChanged`, lines 248-261, after a 2-frame stability window, lines 147-152): re-transform any tiles whose cached transform is stale (cheap, cached via `_lastSplatTransform`, lines 1262-1269), re-aggregate positions/scales/rotations/colors of every selected tile (lines 1915-1944), re-copy all SH data (lines 1861-1913), then `generateSplatTexture` makes fresh copies of all four attribute arrays again (lines 1439-1447, another ~50 MB at this scale) and ships them to the WASM texture generator, which recomputes covariance for every splat (`texture_gen.rs`) even though per-splat covariance is view-independent and unchanged for tiles that stayed selected. The result comes back as a copy of a copy (`wasm_splats.js:117-118` does `.slice()` on the texture data, then structured clone). Then the full 36 MB attribute texture is re-uploaded (lines 553-576), the SH data is re-packed into a fresh `Uint32Array(width * shHeight * 2)` which at degree 3 and 1.126M splats is a 135 MB allocation plus row-chunk copy loop on the main thread (lines 603-612), and a 135 MB SH texture is created (line 613). Finally the whole set is re-sorted (lines 2004-2040).

So one LOD transition costs, at this scene size: ~100 MB of main-thread typed-array traffic, a 135 MB main-thread alloc+copy, ~170 MB of GPU texture upload, one full covariance regeneration, and one full sort. The team's real assets are larger; this scales linearly and is the biggest single problem in the pipeline for large scenes.

### Observation 4: CPU radix sort in WASM over all splats. CONFIRMED, with specifics

Remote `wasm-splats/src/radix.rs`: depth = dot of position with the modelView third column, quantized at ×4096 fixed point (0.25 mm buckets), then an unconditional 4-pass 8-bit LSD radix sort over 32-bit keys, moving both the key array and the index array on every pass. It computes `min_depth`/`max_depth` in the first loop but only uses `min` for the sign offset; the range is never used to skip passes. Single-threaded. Also: `GaussianSplatSorter._maxSortingConcurrency` (`GaussianSplatSorter.js:13-16`) looks like a worker pool but is not; `TaskProcessor` owns exactly one Web Worker (`packages/engine/Source/Core/TaskProcessor.js:293-301`) and the number only caps queued tasks. All sorts serialize on one thread.

### Observation 5: fill rate unmeasured. CONFIRMED, but bounded

The quad extends to `sqrt(2*lambda)` pixels per axis (VS lines 136-137), i.e. about 1.41 sigma. That is a tight truncation (most splat renderers draw to 2-3 sigma), so fill is already economized at the cost of clipping the Gaussian at ~1.8% of peak alpha. The FS (`PrimitiveGaussianSplatFS.glsl`) is 5 ALU ops plus a blend. Fill is unlikely to dominate at 1080p with this truncation, but the SSE8 vs SSE16 delta (4.42 vs 3.25 ms for 2x splats) shows ~2.1 ms/M splats marginal cost of unknown split between vertex and fill. Measure before optimizing either (item P1).

---

## 2. Additional findings not in the observation list

1. **The draw command, shader source, render state, and uniform closures are rebuilt after every sort.** `buildGSplatDrawCommand` (`GaussianSplatPrimitive.js:1470-1671`) is called from the SORTED state every ~5 frames while moving (line 2135) and on every snapshot commit (line 679). Each call builds a new `GaussianSplatRenderResources`/`ShaderBuilder`, regenerates the full shader source strings, does a shader cache lookup, clones the render state, and allocates a fresh `DrawCommand` and closures. Only the index-buffer upload (line 1637) is real work; the rest is churn. The cached shader program means no recompile, but string building plus cache hash over a multi-KB source is real main-thread time at sort frequency, and each rebuild invalidates `derivedCommands` (log depth), forcing Scene to re-derive.
2. **The sorted-index VBO upload is unavoidable but the array behind it is a fresh structured-clone allocation each time** (see observation 2 chain). 4.5 MB per sort.
3. **Splats render during pick passes.** `update()` pushes `_drawCommand` (lines 1692-1694) before the `frameState.passes.pick` early-return (line 1702). `executeCommand` (`Scene.js:2272-2345`) falls through to executing the base command when a command has no `derivedCommands.picking`. So every `scene.pick` renders 4.5M vertices with the full SH shader into the pick framebuffer. Irrelevant if you never pick, a full extra splat draw per frame if you hover-pick.
4. **Dead code in the FS:** `if (A < -4.) discard;` (`PrimitiveGaussianSplatFS.glsl:11-14`) can never fire: `v_vertPos` is the quad corner in [-1,1]^2 (VS lines 182, 187), so `A = -dot(v_vertPos, v_vertPos) >= -2`. The split-direction discards (FS lines 8-9) run on every fragment even when splitting is off.
5. **`u_splatScale` is declared (`GaussianSplatPrimitive.js:1506`) but never set in the uniform map and never referenced by the shader.** Dead.
6. **`uniformMap.u_cameraPositionWC` allocates a new `Cartesian3` per call** (line 1558, `Cartesian3.clone` without a result target). Trivial but free to fix.
7. **The SH texture layout forces the 135 MB repack.** Width is fixed at `maximumTextureSize` (line 582); with degree 3, `dims = 15` texels per splat and `floor(16384/15) = 1092` splats per row leaves 4 texels of per-row padding, so the packed aggregate cannot be uploaded directly and the row-by-row copy at lines 603-612 exists solely to insert that padding.
8. **SPZ decode runs on the main thread** (`packages/engine/Source/Scene/GltfSpzLoader.js:237`, `loadSpz` called in `process`). Load-time jank per tile, not steady-state. Same for the per-tile JS `float32ToFloat16` SH packing loop (`GaussianSplat3DTileContent.js:727-776`).
9. `resolveSteadySort`/`resolvePendingSnapshotSort` contain vestigial dead checks (`expectedCount !== currentCount` where `currentCount = expectedCount`, lines 660-663 and 713-716). Not perf, just noise.
10. Pass ordering is sound: `Pass.GAUSSIAN_SPLATS = 12` executes after OPAQUE and before TRANSLUCENT (`Scene.js:3079-3092`), depth test LEQUAL with `depthMask false` (`GaussianSplatRenderResources.js:41-48`, `GaussianSplatPrimitive.js:1479-1481`), premultiplied blend (`BlendingState.js:49-57`) matching the premultiplied FS output. No correctness issue there.

---

## 3. Cost model at the measured scene (1.126M splats, SH degree 3)

| Buffer | Size |
| --- | --- |
| positions | 13.5 MB |
| rotations | 18.0 MB |
| scales | 13.5 MB |
| colors | 4.5 MB |
| sorted indexes | 4.5 MB |
| attribute texture (RGBA32UI, 2 texels/splat) | 36 MB |
| SH packed data / SH texture (RG32UI, 15 texels/splat) | 135 MB each |

Per steady sort: ~18 MB main-thread copy traffic + GC. Per snapshot rebuild: ~100 MB main-thread copies, 135 MB alloc+copy, ~170 MB texture upload, full covariance regen, full sort. Derived from the SSE8/SSE16 GPU numbers: marginal GPU cost ~2.1 ms per million splats, fixed non-splat scene cost ~2.1 ms. At the platform's larger real assets the marginal terms dominate everything.

---

## 4. Prioritized change list

Ordering follows: (a) unblocks other work, (b) ease of verifying correctness, (c) risk of subtle bugs, (d) blast radius.

### P1. Instrumentation and attribution toggles (unblocks every GPU decision)

**What:** Three switches plus four counters, all temporary.

- Toggle A: force `sphericalHarmonicsDegree = 0` on the snapshot (one line in the aggregation at `GaussianSplatPrimitive.js:1946-1951`) and compare GPU time. Isolates SH cost.
- Toggle B: render at 0.5 `resolutionScale`. Change in GPU time attributes fill; unchanged GPU time attributes vertex work.
- Toggle C: replace `covVectors` with a constant 1-pixel vector in the VS. Removes nearly all fill while keeping vertex work; the complement of B.
- Counters: `performance.measure` around the rebuild block (lines 1761-1979), around each `new Float32Array` copy site, sort round-trip latency (request to `resolveSteadySort`), and rebuild count per minute.

**Why:** The split between vertex, fill, and fixed cost is currently a guess. P7 (per-splat pre-pass) is a real project; it should be sized against Toggle A/C numbers, not theory. This follows the instrument-before-fix rule.
**Win:** none directly; it prices P7, P8, P10.
**Measure:** the toggles are the measurement.
**Risk:** none, throwaway code.

### P2. Stop rebuilding the draw command per sort; keep one persistent command

**What:** Split `buildGSplatDrawCommand` (`GaussianSplatPrimitive.js:1470-1671`) into build-once (shader, render state, uniform map, command object; on first build and on snapshot commit when SH degree or texture identity changes) and per-sort update (upload `_indexes` via the existing `copyFromArrayView` path at line 1637, set `command.instanceCount`). Make `u_splatAttributeTexture` return `primitive.gaussianSplatTexture` live instead of the build-time capture at lines 1527-1530. Delete `u_splatScale` (line 1506). Fix the `Cartesian3.clone` allocation (line 1558).

**Why:** removes per-sort ShaderBuilder/source-string/RenderState/DrawCommand churn and repeated `derivedCommands` re-derivation. Mechanism: allocation and hashing on the main thread at sort frequency.
**Win:** small: a few tenths of a ms on sort frames plus GC pressure (guess). Do it first anyway because every later item (P5, P6, P9) touches this function, and a stable command makes their diffs and their verification clean. This is the unblocker.
**Measure:** processor time on frames where SORTED fires; count of `DrawCommand` constructions (should be ~1 per snapshot).
**Risk:** stale-uniform bugs (texture captured at build time is the existing pattern to remove; keep everything live-read). Visual artifact if instanceCount and buffer length ever disagree: garbage splats. Easy to spot.

### P3. Stop rendering splats in pick/depth-only passes

**What:** In `update()` move the `frameState.passes.pick` check (line 1702) above the `commandList.push` (line 1692), or gate the push on `!frameState.passes.pick && !frameState.passes.depth` if you rely on splats occluding for depth picking (they write no depth, so they contribute nothing there anyway).
**Why:** `executeCommand` runs the base command in pick passes when no picking derived command exists (`Scene.js:2305-2345`). Full 4.5M-vertex draw per pick.
**Win:** zero if you never pick; one full splat draw per pick call if you hover-pick every frame (up to ~2 ms GPU at this scene, derivation from marginal cost). Cheap insurance either way.
**Measure:** GPU frame time while continuously calling `scene.pick` under mouse move.
**Risk:** none visible; splats never had pick IDs or depth writes, so behavior of picking itself is unchanged.

### P4. Make the SH texture width a multiple of the per-splat texel count and upload the aggregate directly

**What:** In `processGeneratedSplatTextureData` (`GaussianSplatPrimitive.js:580-625`), set `width = splatsPerRow * dims` (e.g. 1092 × 15 = 16380 ≤ 16384) instead of `maximumTextureSize`. Rows then tile the packed aggregate contiguously: delete the `texBuf` allocation and repack loop (lines 603-612) and upload `snapshot.shData` directly, zero-padded to full rows. Update nothing in the shader: `loadSHCoeff` already computes `splatsPerRow = width / dims`, which becomes exact. Hoist `textureSize`/`splatsPerRow` to uniforms while there (VS lines 33-35).

**Why:** the repack exists only to insert 4 texels of padding per row. Removing it kills a 135 MB allocation plus copy on the main thread per snapshot rebuild at degree 3.
**Win:** derivation: ~135 MB alloc+copy at typical 5-10 GB/s effective single-thread memcpy plus GC is tens of ms per rebuild removed. One of the two biggest rebuild spikes.
**Measure:** the P1 rebuild-time counter, before and after, during forced LOD churn (orbit the camera).
**Risk:** low; a one-off addressing mistake shows up as globally scrambled SH color, instantly visible. Verify with a pixel diff of a still frame against the current build.

### P5. Transfer results back from the workers and reuse buffers

**What:** In `packages/engine/Source/Workers/gaussianSplatSorter.js:25-31`, push the result buffer into `transferableObjects` before returning. Same in `gaussianSplatTextureGenerator.js:24-36` for `result.data`. `createTaskProcessorWorker` already posts with the transfer list (line 59).
**Why:** structured clone of 4.5 MB (indexes, per sort) and ~36 MB (texture, per rebuild) becomes a pointer move. The deserialize side of a structured clone lands on the main thread.
**Win:** ~1 ms-scale per sort frame and several ms per rebuild (guess, memcpy-bound).
**Measure:** processor p95 over the 120-frame run; rebuild counter.
**Risk:** near zero. Transferred buffers are detached in the worker after post, which is fine since both workers are stateless per task today.

### P6. Make the sorter worker stateful: ship positions once per generation, not per sort

**What:** Protocol change across `GaussianSplatSorter.js`, the worker, and ideally the crate.

- On snapshot commit, send one `setPositions {generation, positions}` task, transferring the buffer (the primitive keeps `snapshot.positions` for the next aggregation, so send a copy exactly once per generation, not per sort).
- Steady sorts send `{generation, modelView}` (64 bytes). The worker looks up the cached positions; mismatched generation returns a sentinel and the primitive re-sends.
- Crate change (repo CesiumGS/cesium-wasm-utils, `wasm-splats/src/lib.rs`): add `register_positions(id, Float32Array)` that copies into WASM memory once, and `sort_registered(id, model_view)` that reuses it, so the per-sort `to_vec()` copy also disappears. Keep scratch vectors (`depth_values`, `temp_*`, `indices`) allocated per registered set instead of per call.

**Why:** removes the 13.5 MB main-thread alloc+copy per sort (observation 2) and the per-sort JS-to-WASM copy. Mechanism: the positions are immutable for a generation; only the 16-float matrix changes.
**Win:** main-thread per-sort cost drops from milliseconds to microseconds (derivation: remaining traffic is 64 bytes out, 4.5 MB transferred back). Sort round-trip latency also drops by both copies. This is the single biggest fix for the spiky processor time.
**Measure:** processor p95; sort latency counter from P1; expect p95 to approach the median.
**Risk:** generation races: a sort against stale positions after a rebuild. The plumbing to reject stale results already exists (`_splatDataGeneration`, `isActiveSort`, lines 272-278, 1766). Artifact if wrong: one frame of incorrect ordering, i.e. brief translucency popping. Blast radius contained to the sorter path.

### P7. Replace the 4-pass 32-bit radix with a single-pass 16-bit counting sort in the crate

**What:** In `wasm-splats/src/radix.rs`: first loop computes depths and min/max (already does); then scale depths to [0, 65535] with `(depth - min) * 65535 / (max - min)`; one histogram of 65536 u32 (256 KB), prefix sum, one stable scatter of indexes. Two data passes total instead of nine (1 depth + 4 × (histogram + scatter)). Drop the `temp_depths` copy entirely; keys are not needed after bucketing.
**Why:** the current code always does 4 passes over 32-bit keys at 0.25 mm resolution. Painter's-order blending needs relative order, not sub-millimeter absolute precision; 65k buckets across the visible depth range is far finer than any visible blending difference, and this is the standard approach in the fast web splat renderers (GaussianSplats3D and antimatter15/splat both use 16-bit or coarser bucket sorts).
**Win:** 3-4x on the sort kernel (derivation: pass count and memory traffic; typical 1M-splat 4-pass radix in WASM runs ~15-25 ms, expect ~5-8 ms). This lowers sort latency, which lowers ordering staleness while the camera moves; it does not change frame processor time much once P6 lands.
**Measure:** sort latency counter; also expect fewer visible popping events during fast orbits because results arrive fresher.
**Risk:** splats within one bucket keep their previous relative order (counting sort is stable), so no flicker. Worst case artifact: incorrect blend order between two splats closer than range/65536 in depth, invisible in practice. Validate with a golden-image diff against the 32-bit sort from several viewpoints; require no perceptible difference (the order can legally differ, so diff the image, not the index array).

### P8. Per-splat pre-pass: evaluate SH and project covariance once per splat, not four times (answers two of the specific questions)

**What:** Add a per-frame compute-style pass using Cesium's existing `ComputeCommand`/`ComputeEngine` (`packages/engine/Source/Renderer/ComputeCommand.js`, `ComputeEngine.js`; `Pass.COMPUTE = 1` executes before everything, `Scene.js:3216-3218, 3401`). One fullscreen-quad fragment pass over an RGBA32UI target with 2 texels per splat (same row addressing as the attribute texture):

- texel 0: `covVectors` as 4 × `floatBitsToUint` (exact f32, no precision loss);
- texel 1: final premultiplied-ready color: base color + SH evaluated with `viewDirModel` for the current camera, packed as you like (RGBA8 in one u32 leaves 3 spare channels; or 2 × f16 pairs for HDR headroom).

The fragment shader of the pre-pass does exactly what VS lines 105-139 and 189-193 do today, reading the existing attribute and SH textures. The main VS shrinks to: fetch position texel, transform, clip test, fetch 2 pre-pass texels, add corner offset. The SH texture and `evaluateSH` disappear from the per-vertex path entirely.

**Why the mechanism helps:** per-splat work runs 1x instead of 4x, and it runs in a fragment pass where adjacent invocations read adjacent texels (better cache behavior than instanced vertex fetch). Total SH fetch count drops from 60 to 15 per splat; covariance projection from 4x to 1x. This is also the correct place for a future antialiasing (opacity compensation) term.

**Why not the alternatives:**

- Transform feedback would also work (write per-instance attribute buffers, zero fetches in the VS) but Cesium has no TF plumbing at all, while ComputeCommand is established infrastructure with guaranteed pass ordering. Choose TF only if the RGBA32UI render target path hits a driver problem.
- Caching SH against a view-direction threshold: possible (gate the pre-pass on the same camera deltas as the sort, `GaussianSplatPrimitive.js:154-158`), but unnecessary. Covariance projection must refresh every frame anyway (J depends continuously on the view position, VS lines 107-115), so the pre-pass runs per frame regardless; SH rides along for free. Do not build the threshold machinery.
- Point sprites (one vertex per splat) die on `ALIASED_POINT_SIZE_RANGE`, which is 1.0 on ANGLE/D3D and driver-dependent elsewhere. Not portable. Correctly rejected.

**Win:** bounded by P1 Toggle A/C. If the splat draw's ~2.3 ms marginal GPU cost at 1.126M splats is mostly vertex-stage (likely, given the tight quad truncation), expect 1-1.5 ms back at this scale, scaling linearly with splat count; at 10M splats this is the difference between ~21 ms and ~8-10 ms for the splat draw. Guess informed by the fetch-count arithmetic; the pre-pass itself costs roughly one-quarter of the work it removes.
**Measure:** GPU processor time per frame, before/after, at SSE8 and at a 4x larger scene; pre-pass cost visible as the Pass.COMPUTE bump.
**Risk:** the largest of the shader-side items. Failure modes: row-addressing mismatch between pre-pass and VS (scrambled splats, instantly visible), integer-attachment framebuffer completeness on some drivers (test on ANGLE Vulkan, D3D, Metal), one-frame staleness if the pre-pass is accidentally ordered after the splat pass (guaranteed not to happen with Pass.COMPUTE). Verify with golden-image diffs at degree 0 and degree 3, plus a camera-orbit A/B video.

### P9. Incremental snapshot: per-tile residency instead of full rebuild (answers the snapshot question)

**What:** Replace the monolithic aggregate with per-tile blocks.

- Attribute texture: allocate row-aligned block ranges per tile (each tile's splats occupy whole rows). On selection change, upload only newly selected tiles with `texSubImage2D` (`Texture.copyFrom` with offsets), release rows of deselected tiles to a free list, and grow the texture geometrically when full.
- Covariance packing per tile happens once, at tile load or first selection, not per rebuild: `generate_splat_texture` output is a pure function of the tile's local attributes (remote `texture_gen.rs`), and the baked positions are stable because `_rootTransform` derives from `tileset.boundingSphere.center` (lines 1781-1783), which does not change per selection. Cache the packed block on the content, keyed by `_lastSplatTransform` (the cache at lines 1262-1269 already proves the invariant).
- SH texture: same block scheme.
- Sorting: keep per-tile position arrays resident in the sorter worker (extends P6: `registerTile(tileId, positions)` / `unregisterTile`), send the selected tile-id list + modelView, sort the union in WASM, return global indexes composed from per-tile base offsets. Base offsets change when blocks move, so ship the `tileId -> baseIndex` table with each sort request (tiny).

**What invariant forces the current full rebuild:** the sorted index buffer addresses one dense global index space 0..N-1 that must agree exactly with the packed attribute texture layout, and the WASM texture generator is all-or-nothing over one concatenated array. Change the index space to (per-tile base + local index) with row-aligned blocks and the invariant becomes per-tile, so selection changes touch only the delta.

**Why:** observation 3 costs are O(total splats) per LOD transition. This makes them O(newly visible splats). On a large asset where a small camera move swaps 3 tiles out of 200, that is a ~50x reduction in rebuild work, and rebuilds are the dominant spike source.
**Win:** large and load-dependent; derivation: rebuild cost becomes proportional to churn, and churn is typically a few percent of the scene per transition. Also removes the double-buffered 135 MB SH peaks.
**Measure:** rebuild-time counter during a scripted orbit at SSE8; p95 processor time; time-to-correct-LOD after a camera jump (should improve, since less work per transition).
**Risk:** the biggest blast radius in this list: free-list fragmentation, stale base-offset races between sort results and block moves (reuse the generation token per layout change), and partial-upload ordering. Failure artifacts: splats drawn with another tile's attributes (very visible garbage, easy to catch), or splats from evicted tiles lingering one frame. Do this after P4/P5/P6 have removed the cheap parts of the rebuild cost, and after P1 tells you how much rebuild pain remains. Note: this diverges permanently from upstream CesiumJS; expect merge friction on every upstream sync.

### P10. Small shader and state cleanups

**What:**

- Delete the dead `if (A < -4.) discard;` (FS lines 11-14).
- Compile out the split-direction discards behind a `HAS_SPLITTER` define set only when `splitDirection !== NONE` (FS lines 8-9; toggling rebuilds the shader, which P2 makes a clean one-shot).
- Hoist `textureSize`/`splatsPerRow`/`dims` to uniforms (VS lines 33-35), covered by P4 if done there.
- Optional, only if P1 Toggle B shows meaningful fill cost: add an FS early-out `if (B < 1.0/255.0) discard;`. On immediate-mode desktop GPUs this skips the ROP/blend for the quad corners (~21% of quad area lies outside the r=1 ellipse). Ambiguous win: discard can also inhibit some early-depth paths; measure, keep only if positive.

**Why/win:** each is sub-0.1 ms; they are here because they are free to verify and they keep the hot shaders honest.
**Risk:** negligible. The splitter define changes shader variants; verify the splitter still works in a Sandcastle.

### Explicitly rejected or deferred

- **GPU sort in WebGL2: rejected.** See question 4 below.
- **Packing positions as f16 to halve attribute texture size: deferred.** 1 cm error at ~65 m from the ENU origin (f16 ulp) is visible on the platform's real assets. Would need per-tile origins, which only makes sense after P9.
- **Web-worker pool for parallel MSD radix: deferred.** P6+P7 likely make the sort fast enough; a pool adds merge complexity for a latency win you may not need. Revisit if sort latency at 10M+ splats still exceeds ~30 ms.
- **Weighted/order-independent (sort-free) blending: rejected for now.** Changes the image, not just the speed; splat assets are tuned for sorted alpha compositing and WBOIT-style approximations visibly muddy them.

---

## 5. The specific questions

### Q1. Is per-splat sorting needed every camera move? Can it be hierarchical or approximate?

It is already temporally approximate: sorts are gated on 3 frames minimum, 0.5 degrees rotation, or 1 m translation (`GaussianSplatPrimitive.js:153-158, 177-213`), so the displayed order is stale most frames and nobody notices, because ordering error shows up only where splats with meaningfully different colors overlap at similar depths. Precision-wise it can be much coarser than today (see P7; 65k buckets suffice, 0.25 mm buckets are waste).

Hierarchical (sort tiles, then use precomputed per-tile orders): unsound in this architecture. The selected set mixes LOD levels whose bounding volumes overlap in depth, and tiles are merged into one primitive, so a tile-major order is wrong wherever tile depth ranges interleave, producing boundary halos exactly at tile seams, the most visible possible place. Per-tile precomputed orders for k canonical directions add popping on direction switches. Since P6+P7 make the exact global sort cost a few ms off the main thread, the exact sort is the better engineering position. What would break with a fully stale sort: back-to-front blending inverts locally, seen as dark/bright flicker and edge crawl when orbiting, worst on surfaces seen edge-on.

### Q2. Can SH move out of the per-vertex path?

Yes: P8, a per-splat ComputeCommand fragment pass, is the right mechanism in this codebase. Per-frame refresh is effectively free once the pass exists because covariance projection needs per-frame refresh anyway; do not build view-threshold caching. Transform feedback works but has no existing plumbing in Cesium. A load-time bake is impossible (SH is view-dependent by definition). CPU/WASM evaluation per sort is the wrong cadence (sorts are throttled; SH would visibly lag) and the wrong processor (1.1M × degree-3 eval per view change is tens of ms).

### Q3. Is the covariance projection redundant across the 4 vertices, and the cleanest fix?

Yes, provably: `calcCovVectors` (VS 105-139) is a function of `splatViewPos` and `Vrk` only, both per-instance values; `gl_VertexID` first influences anything at line 182. The cleanest fix is the same pre-pass as SH (P8), storing `covVectors` bit-exact as 4 × f32 in one RGBA32UI texel, which makes the change artifact-free by construction. Doing covariance alone without SH is not worth a separate pass; do both in one.

### Q4. GPU sort under WebGL2?

Not worth it. WebGL2 has no compute shaders and no scatter writes. A bitonic network over 2^21 elements needs log^2-ish stages, ~230 full passes of ping-pong fragment draws over a 4.5 MB key texture per sort, plus the index indirection; that is far more GPU time than the 1-2 ms you are trying to protect, and it competes with the splat draw itself for GPU. Transform feedback cannot scatter, so radix binning is impossible in the vertex stage. Coarse GPU bucketing plus CPU fine sort requires a GPU-to-CPU readback (`readPixels`/`getBufferSubData`), which stalls the pipeline for multiple ms and reintroduces the main-thread cost you are removing; strictly worse than P6+P7. The honest position: CPU-WASM sort with resident data (P6) and 16-bit counting (P7) at ~5-8 ms latency off-thread is the right design until a WebGPU backend exists, at which point a compute radix sort (and splat rasterization itself) becomes a different, better project.

### Q5. Is the snapshot rebuild strategy sound?

The atomic-commit state machine itself is sound and careful (generation tokens, deferred texture retirement, `commitSnapshot` at lines 406-461). What is unsound at scale is that the unit of rebuild is the whole scene. The invariant forcing that is the dense global index space shared by the packed attribute texture, the sort output, and the instance attribute, fed through an all-or-nothing WASM texture generator. P9 describes the incremental alternative (row-aligned per-tile blocks, per-tile covariance bake cached on content, resident per-tile positions in the sorter, base-offset indirection) and the artifacts to guard against. Interim relief before P9: P4 and P5 cut the constant factor of every rebuild roughly in half.

### Q6. Cheap wins in the fragment shader or blend state?

The FS is already near-minimal and the blend state is correct (premultiplied output, ONE / ONE_MINUS_SRC_ALPHA, no depth write, LEQUAL test). Cheap items: the dead discard, the splitter define, and the optional low-alpha discard, all in P10. The quad truncation at 1.41 sigma already trades a slight dimming artifact for fill savings; do not widen it. One correctness-adjacent note, not perf: the `+0.3` screen-space dilation (VS lines 124-126) has no opacity compensation, so far/small splats render slightly too opaque (the classic pre-Mip-Splatting artifact). If you ever fix that, the pre-pass from P8 is where the compensation term belongs.

---

## 6. Suggested measurement protocol for the whole effort

Same rig as the existing numbers (RTX A4000, headless Chrome, ANGLE Vulkan, 1920x1080, richmond_hill.ply at SSE8 and SSE16), plus one larger asset (5-10M splats) since that is the real target. Per change: 120-frame scripted orbit capturing GPU time median, processor time median/mean/p95, sort request count, sort round-trip latency, rebuild count and rebuild duration. Golden-image diffs from 4 fixed viewpoints for every shader or sort change. Accept a change when its target metric moves and no golden diff regresses.

## 7. Raw notes: key code locations

- Instanced draw setup: `GaussianSplatPrimitive.js:1574-1579, 1594-1640` (VAO, divisor 1 at 1607)
- Steady sort gating constants: `GaussianSplatPrimitive.js:147-158`; gate logic 177-213
- Per-sort positions copies: `GaussianSplatPrimitive.js:2018, 2077, 2110`
- Snapshot rebuild block: `GaussianSplatPrimitive.js:1761-1979`; SH aggregate 1861-1913; attribute aggregate helper 1817-1859
- Texture generation copies: `GaussianSplatPrimitive.js:1439-1447`; result processing 475-632; SH repack loop 603-612; hard cap 493-529
- Commit: `GaussianSplatPrimitive.js:406-461`; retirement 311-346
- Draw command rebuild: `GaussianSplatPrimitive.js:1470-1671`; called at 679 and 2135
- Pick-pass push: `GaussianSplatPrimitive.js:1692-1704`; fallthrough execution `Scene.js:2272-2345`
- Pass execution: `Scene.js:2494-2505` (mergeSort of 1 command, trivial), order at 3077-3092; Pass enum `Renderer/Pass.js`
- Blend/depth state: `GaussianSplatRenderResources.js:41-48`, `GaussianSplatPrimitive.js:1477-1482`, `BlendingState.js:49-57`
- TaskProcessor single worker: `Core/TaskProcessor.js:181-184, 293-301`
- Worker non-transfer of results: `Workers/gaussianSplatSorter.js:16-32`, `Workers/gaussianSplatTextureGenerator.js:17-37`, `Workers/createTaskProcessorWorker.js:30-59`
- WASM glue copies: `node_modules/@cesium/wasm-splats/wasm_splats.js` (`texturedata_data` `.slice()` at 117-118); crate `lib.rs` `to_vec()` per call; `radix.rs` 4x8-bit passes, x4096 quantization, min/max computed but unused for pass skipping; `texture_gen.rs` full covariance recompute, fixed `tex_width = 2048` re-interpreted by JS at any width
- VS: `Shaders/PrimitiveGaussianSplatVS.glsl` (SH 10-101, covariance 105-139, main 143-196); FS: `Shaders/PrimitiveGaussianSplatFS.glsl`
- ComputeCommand infra for P8: `Renderer/ComputeCommand.js`, `Renderer/ComputeEngine.js`, executed at `Scene.js:3216-3218, 3401`
- SPZ main-thread decode: `Scene/GltfSpzLoader.js:237`; per-tile SH packing `Scene/GaussianSplat3DTileContent.js:727-776`
