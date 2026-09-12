# Follow-up experiments, 2026-09-12

Baseline c7e8148fe9, merged PR16. PR15 remains open.

## Lazy OIT

Hypothesis: allocate order-independent translucency targets only when translucent commands first appear. Prior allocation instrumentation measured 66,355,200 unnecessary bytes at 1920x1080. Preserve initialized targets to avoid repeated allocation when visibility changes. Initialize before derived command creation so framebuffer fallback can affect shader choice. Preserve the opaque framebuffer, including prior viewports. Keep translucent invert classification on the existing initialization path.

Validate first-frame opaque/translucent transitions, picking, resize, HDR, MSAA, invert classification, 2D and stereo. Compare GPU allocation ledgers and pixels against the merged baseline.

## Measured updates

OIT: 66,355,200 bytes saved on each 1080p Geo, Bike, and BatchedTextured scene. First four simple visibility transitions match exactly. A forced multipass fixture initially changed flags after framebuffer-manager construction and silently swallowed render errors. Rejected those captures. Correct construction plus render-error propagation exposed a pre-existing multipass shader failure (out_FragColor undeclared). Preserve eager multipass setup and scope deferral to MRT.

PNTS: replacing the fixture dependency oracle with Cesium style getVariables and CustomShader attribute/metadata sets reproduces 3 MiB initial versus 11 MiB baseline. Nine phases including vertex/fragment attribute and metadata access and style defines match pixel hashes. CPU property arrays replace GPU buffers until needed; total accounted geometry bytes remain 11 MiB. Current pickMetadata supports property textures, not arbitrary property attributes; getMetadataProperty explicitly returns undefined for the latter.

Empty selection: 139 cached tiles unload to zero at SSE 1e9 plus trimLoadedTiles. Pending requests and processing are zero, tilesLoaded true, selected tiles zero. Old 2,087,136-splat snapshot still draws. Baseline backing storage 365,479,629 bytes. An independent release probe drops 366,147,981 to 76,241,753 bytes (276.48 MiB) by dropping unowned scratch. Initial reentry p99 127.8 vs 166.9 ms and maximum 161.7 vs 200 ms, one run each, insufficient for a default change.

Surprise: cache accounting becomes negative after unloading all splat tiles (about -10.7 MiB). GaussianSplat3DTileContent.texturesByteLength divides the current shared primitive texture by the current selected tile count. Statistics add this getter on load and subtract a different value on unload. Reentry gives about 260 MiB versus 74 MiB initial, so this is not a reliable cache-release signal. Shared allocation ownership needs a separate accounting fix.

Shader pass constants: measured overlay test fails because JS Pass.OVERLAY=14 versus GLSL=13. Audit also finds direct edges JS=13 versus GLSL=12. Correct both and add seven shader-rendering tests for untested pass constants. All 95 automatic-uniform tests pass on Vulkan.

OIT adversarial test catches a real prototype regression: at the dateline, initial translucent rendering configures the compositor from a half-width pass viewport. First transition differs in 32,768 channels with maximum error 191; later transitions match. Initialize against the full view viewport and restore the execution viewport. Add a regression checking pixels on both sides.

Final OIT dateline captures: all four transitions now match baseline exactly. Full Vulkan suite retains the same four baseline failures with three added tests passing. PNTS full Vulkan retains the same four baseline failures with three new tests passing; the first full PNTS run lacked runtime Draco/WASM assets and is retained as invalid missing-assets evidence. Corrected with gulp prepare. Nine PNTS phases also match in Firefox.

Context isolation: reproducer creates a WebGL2 context supporting eight attachments, then a WebGL1 context with WEBGL_draw_buffers disabled. Baseline rejects a valid two-attachment framebuffer in the first context because the global limit becomes one. A per-context cached attachment limit fixes it. All 71 framebuffer tests pass. Full OpenGL failures fall from 81 to 16; the 65 resolved failures account for cascading model initialization failures. No new failures.

Supported decoder API prototype: separate spz-loader source change with explicit createSpzDecoder/release and serialized recovery. Eight native tests pass. Eighty real browser files have identical decoded-array hashes in published, new one-shot, and new reusable modes. Published totals 1223.7/1222.9 ms; new one-shot 1260.5/1227.2 ms; reusable 892.4/886.2 ms. Reuse improves by 27.3% versus published and 28.5% versus matching new one-shot implementation. Two 400-job warm runs stay at 30,998,528 WASM bytes. release permits module/buffer weak references to clear, reduces renderer RSS by 26.1 MiB, and reload succeeds. Twelve malformed-input/recovery pairs pass in every run.

Final explicit-trim experiment: about 276 MiB main-thread backing storage reclaimed. Mean reentry p99 135.65 ms baseline versus 159.25 ms candidate. This remains an explicit application-request tradeoff, not automatic eviction. Twenty-one primitive tests and 283 tileset tests pass after correcting a name filter that initially selected zero tests.

Combined branch f347237f73: Vulkan 15,809 pass / 3 fail, OpenGL 15,797 pass / 15 fail. No new failure names or multiplicities. Baseline Vulkan 15,793 / 4; OpenGL 15,716 / 81. Fifteen added tests.
