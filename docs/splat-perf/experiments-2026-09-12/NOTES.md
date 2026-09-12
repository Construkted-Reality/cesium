# Second memory and rendering experiment round

Date: 2026-09-12
Baseline: aee7afc9b6, the 1.144 performance branch with reviewed texture sharing restored. Its tracked tree matches the previously validated 9ad8758499 integration. The separate 1.145 main branch contains PR14 and is not the baseline for this round.

## Experiment ledger

1. Whole-scene allocation accounting: track unique WebGL buffers, texture levels and renderbuffers, plus CPU backing storage, through load/remove cycles. Include textured mesh, modern point cloud and splats. Counts exclude driver overhead and browser backbuffers.
2. Modern point-cloud properties: inspect linked shaders and test a shader intervention before assuming deferred uploads cannot work. Check later style use and output hashes.
3. Decoder memory: measure WASM lifecycle and test module reuse or retirement with real SPZ data, output hashes and subsequent-load cost.
4. Snapshots: measure retained aggregate arrays after successful upload. Test whether releasing staging arrays reduces CPU retention without breaking sorting, rebuilding or images.
5. Overdraw: measure screen-space overlap and compare MSAA/sample/coverage interventions with explicit image-quality checks. Diagnostic image-changing experiments are not production defaults.
6. Compatibility: reproduce baseline test failures on hardware OpenGL and Vulkan, preserve additional lifetime probes as tests where useful, and report unavailable platforms explicitly.

All heavy work runs on 192.168.8.212. Raw evidence is outside source PRs in /mnt/data2/cesium-splat-perf/experiments-2026-09-12. Timed GPU comparisons run sequentially. Each idea gets an observed result before acceptance or rejection.

## Initial measurements

- PR #15 carries the missed PR #10 merge into the performance branch. All 169 cache tests pass. Its tree matches the previous validated integration.
- Snapshot retention probe finds 267,415,552 bytes (Geo) and 90,615,168 bytes (Bike) in aggregate rotation, scale, color, and spherical harmonic arrays after upload. Releasing these references allows navigation and rebuild without exceptions. Pixel validation remains open: the initial capture also differs between two unchanged control frames. These are retained-reference measurements, not proven process memory savings.
- A decoder microbenchmark alternates real Geo and Bike root tiles for 24 jobs per run, in base/reuse/reuse/base order. Mean decode times are 30.26/21.14/20.78/28.84 ms. The prototype reuses the dependency module. Node also requires a module-import shim because the packaged Node path is broken. This is a microbenchmark, not browser scene validation or a production change.
- Raw inputs, scripts, and outputs reside in `/mnt/data2/cesium-splat-perf/experiments-2026-09-12`.
