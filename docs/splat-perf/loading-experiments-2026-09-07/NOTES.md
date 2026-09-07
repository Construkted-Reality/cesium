# Loading experiments, 2026-09-07

Baseline renderer: merged PR #2, 826734d915. Tests extend c153f20b8f from PR #3.
All experiments run on 192.168.8.212. Production engine source remains unchanged.

Four authorized experiments: runtime worker-cache budgets; direct decoder-to-dense harmonics packing;
a bounded worker queue for decoding and packing; longer memory runs, multiple assets, and a second graphics backend.

The direct-packing prototype uses metadata on empty SH attribute placeholders to avoid intermediate arrays.
This is restricted to the Gaussian tile harness. Production code needs an explicit loader/component field.
The worker prototype admits one compressed tile at a time. It drops queued jobs whose loader is destroyed.
Results retain the original loader destruction guard for already running jobs.

## Findings recorded after the runs

The first direct prototype stored metadata on a typed-array view. GltfLoader creates a new view,
which lost the metadata and produced a blank capture. Buffer metadata fixes the harness;
a production implementation must use an explicit field. The failed capture remains in the raw results.

The degree-3 packing kernel improves 69.90 to 42.74 ms, but complete-view time improves only about 5% on Geo.
Worker decoding halves large startup gaps while delaying the complete view from about 6.0 to 8.3 seconds.
Geo snapshot builds increase from 2 to 15. Faster frame callbacks do not prove faster completion.

The OpenGL timeout is a software fallback. Renderer inspection confirms SwiftShader in all three GL probes.
A small software case validates pixels, not hardware OpenGL performance.
The extra asset named flat still reports SH degree 3; its degree0 run label is misleading.

Explicit WASM probes show retained linear memory that browser array-storage counters omit.
The SPZ dependency creates a module per decode. Module reuse needs measurement and lifetime validation.
