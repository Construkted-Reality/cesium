# Cesium performance experiments, 2026-09-12

## Scope and method

These experiments use the optimized 1.144.0 performance line. The baseline is `aee7afc9b6`. Its tracked tree matches the previously validated integration `9ad8758499`. The separate 1.145.0 work on `main` is outside these comparisons.

All experiments run on 192.168.8.212 with an NVIDIA RTX A4000. Timed comparisons use Chromium 151, hardware OpenGL through Wayland, 1920 by 1080 pixels, and fixed clocks of 1350 MHz and 7001 MHz. Each comparison uses reverse run order. The Geo view contains 2,087,136 splats. The Bike view contains 705,883 splats. Each staging run completes six rebuilds.

GPU figures count allocated WebGL buffers, texture levels, and renderbuffers. They include scene framebuffers. They exclude driver overhead and browser backbuffers. The ledger passes an allocation and deletion control. It reports no unknown formats in the measured fixtures. CPU backing-storage figures come from Chrome after garbage collection. They exclude WebAssembly linear memory. Decoder heap sizes are measured separately.

The first uncapped rebuild batch is invalid. Its animation frames advance before worker jobs finish, and its final splat counts differ. The accepted batch uses paced frames, a longer warmup, and a frozen selection. Its splat counts match in all comparisons.

## 1. Scene allocation census

| Workload | Loaded GPU bytes | After content removal |
| --- | ---: | ---: |
| Geo splats | 441,967,808 | 165,888,104 |
| Bike splats | 259,790,124 | 165,888,104 |
| Textured mesh fixture | 166,356,214 | 166,150,254 |
| Point-cloud fixture, 256 by 256 pixels | 17,170,726 | See the detailed ledger |

The mesh is the repository's `BatchedTextured` fixture. It is not a production mesh workload. The point cloud contains 262,144 points and eight scalar properties. Destroying the point-cloud scene reduces all three tracked allocation categories to zero.

A large part of the allocation that remains after splat removal belongs to scene render targets. It does not belong to retained splat textures.

## 2. Unused modern point-cloud attributes

Shader reflection alone saves zero bytes. Replacing unused vertex-to-fragment assignments also saves zero bytes. Replacing unused attribute reads makes the inputs inactive, but buffers have already been uploaded.

A combined prototype uses deferred buffers and an explicit dependency list for each fixture style. It produces these allocations:

| Style | Vertex-buffer bytes | CPU property-array bytes |
| --- | ---: | ---: |
| No properties | 3,145,728 | 8,388,608 |
| Uses property p0 | 4,194,304 | 7,340,032 |
| Uses all eight properties | 11,534,336 | 0 |
| Removes the style after using all properties | 11,534,336 | 0 |

All four image hashes match the baseline. The initial GPU saving is 8 MiB, or 72.7% of vertex-buffer storage. The prototype retains the unused property arrays on the CPU. It does not evict buffers after a style has used them.

This is a viable direction, not a production implementation. The dependency list is an experimental oracle for this fixture. A production change must cover arbitrary styles, custom shaders, metadata picking, and later style changes. The five-file deferred-buffer prototype remains on `feature/pnts-unused-attribute-probe`.

The first combined run is invalid because its worktree resolves the engine package from the main checkout. Both experimental worktrees now have separate engine and widget package links. The accepted run verifies that deferred loading is enabled.

## 3. Decoder module reuse

The browser test decodes 80 real tiles from Geo and Bike. It uses the installed `@spz-loader/core` version 0.3.1. Total decode time in base/reuse/reuse/base order is 1238.3, 890.2, 883.4, and 1242.7 ms. Reuse reduces the average total from 1240.5 to 886.8 ms, or 28.5%.

All decoded array hashes match. All 12 malformed-input tests reject the input and then decode a valid tile with the expected hash. The reused module's linear memory remains at 30,998,528 bytes through another 400 jobs.

Reuse retains about 29.6 MiB of WebAssembly memory per warm decoder. This is a speed and memory tradeoff. The current dependency does not expose its module factory as a supported API. The experiment modifies a copy of the dependency. It does not modify the installed package or ship a vendor patch.

An idle-release probe removes the cached module reference and runs garbage collection. Weak references confirm that the module and its linear-memory buffer are collected. Renderer resident memory falls from 213,368 to 184,392 KiB, a reduction of 28.3 MiB in this sample. A later decode succeeds with a new module. The browser backing-storage counter alone does not expose this WebAssembly allocation.

A separate Node root-tile microbenchmark measures a similar 29% improvement. That test needs a Node import shim because the package's Node path fails without it. The browser result is the relevant result for Cesium.

## 4. Snapshot staging ownership

A committed snapshot keeps rotation, scale, color, and spherical harmonic arrays after their texture uploads. Scratch pools also own these arrays. Clearing snapshot references therefore does not release all of the apparent retained bytes.

The production candidate releases snapshot ownership after a successful commit. It keeps positions for later sorting and keeps scratch pools for later rebuilds. The next rebuild can reuse the uploaded scale, rotation, and color arrays.

| Workload | Baseline backing storage | Candidate backing storage | Reduction |
| --- | ---: | ---: | ---: |
| Geo | 961.89 MiB | 898.20 MiB | 63.69 MiB |
| Bike | 345.43 MiB | 323.88 MiB | 21.54 MiB |

These are main-thread backing-storage measurements after six rebuilds and garbage collection. GPU allocation is unchanged. Both reverse-order runs give the same reduction within a few hundred bytes.

Geo rebuild CPU time at the 99th percentile changes from 86.6 to 88.9 ms. Bike changes from 29.55 to 30.3 ms. These are increases of about 2.7% and 2.5%. The captured images differ by no more than the unchanged controls: two color levels for Geo and one for Bike.

The alternative that releases every scratch buffer saves more CPU memory but causes allocation stalls. Geo frame time at the 99th percentile increases from 102.85 to 151.25 ms. Bike increases from 46.0 to 63.5 ms. That alternative is rejected as the default behavior.

The regression test fails on the baseline and checks buffer reuse after a successful upload. It also checks that the active snapshot keeps its positions while a replacement is pending. The production change and its test are separate from the research files.

## 5. Render targets and image quality

| Workload | 4-sample GPU median | 2-sample GPU median | 1-sample GPU median |
| --- | ---: | ---: | ---: |
| Geo | 6.031 ms | 5.135 ms | 4.343 ms |
| Bike | 2.184 ms | 1.938 ms | 1.726 ms |

Two-sample multisample anti-aliasing reduces GPU time by 14.9% for Geo and 11.3% for Bike. It saves 33,177,600 GPU bytes, or 31.6 MiB, at this resolution. One sample saves 63.3 MiB and reduces GPU time by about 28.0% and 21.0%.

These settings change image quality. In Geo, two samples change 64,921 pixels by more than three color levels. The unchanged control changes zero pixels by that amount. The default is not changed by this experiment.

Disabling order-independent transparency saves 66,355,200 GPU bytes, or 63.3 MiB. The largest image difference is two color levels for Geo and one for Bike and the mesh. The splat differences match their unchanged controls. The mesh result does not establish bit-exact equivalence. Those fixtures have no translucent draw commands. The current renderer still allocates and clears the transparency targets.

A mixed-scene test alternates between no objects and two overlapping translucent boxes. Disabling transparency targets changes 9,001 color channels by more than three levels when the boxes appear. The largest change is 87 levels. Global disabling is therefore rejected.

Lazy allocation remains a candidate. It must initialize the transparency resources before the first translucent draw. The renderer currently prepares framebuffers before it collects primitive commands. A production change must account for that order, classification, picking, multiple viewports, and translucent content that appears later.

## 6. Compatibility and regression validation

The candidate full suite runs on both hardware OpenGL and Vulkan. Isolated baseline comparisons and the final focused suite are recorded in `VALIDATION.md`.

Firefox cannot initialize WebGL in headless mode on this server. Firefox through Wayland initializes hardware WebGL 2 and runs the point-cloud style fixture. This does not establish Safari or mobile compatibility.

The complete source tree for the restored texture-sharing baseline passes all 169 ResourceCache tests. Pull request #15 carries the previously reviewed texture changes to the intended performance branch. Pull request #10 had merged into an already-merged branch.

## Additional capacity probe

Raising the screen-space error limit to one billion produces an empty tile selection in the Geo dataset. It does not produce the intended coarse level of detail. The previous 2,087,136-splat snapshot remains active. Clearing its non-position staging caches reduces main-thread backing storage by about 310.5 MiB in this diagnostic.

This result does not validate a coarse-level cache policy or an empty-selection fix. The retained snapshot can be part of the fallback during selection changes. A follow-up must distinguish a loading gap from a persistent empty selection and test re-entry. The raw capacity records preserve the observed selection and buffer sizes.

## Evidence and limits

The source PR contains production code and its regression test. Research JSON, image captures, copied bundles, and prototypes remain outside the production diff. The evidence archive includes scripts, metrics, logs, and this report. Dataset files and raw image captures remain on the server.

Absolute paths in the experimental scripts describe this server. The scripts require the named datasets and the existing benchmark harness. The point-cloud dependency oracle and dependency-module patches are prototypes. They must not be used as production implementations.
