# Cache accounting and empty snapshots, 2026-09-12

Baseline f20a5d1f1b, Geo fixture, 2,087,136 splats.
Shared GPU allocations stay at 267,600,064 texture bytes plus 8,348,576 buffer bytes. Reported cache bytes drift from 77,947,550 to -10,891,803 to 207,580,882 over one unload/reload cycle. Zero cached tiles and zero selected tiles still submit the previous snapshot.

Hypothesis confirmed: tile-level texture shares change between incrementLoadCounts and decrementLoadCounts. Count primitive-owned resources once, including pending and retired resources. Preserve existing GPU accounting scope; decoded CPU arrays and worker heaps are outside this fix.

Aggressive release on zero selected tiles causes 16 blank frames (289.8 ms) on cached return. Retention causes zero blank frames. Reject this policy. The conservative policy requires empty cache, no requests, no processing, and tilesLoaded.

Timing harness correction: the retained old snapshot can satisfy the full-count condition before fresh tiles load. Require 139 ready tiles, 105 selected tiles, and committed selection identity, plus no pending snapshot. Earlier final-* reload timing is invalid; unloaded allocation measurements remain valid.

Optional --webglValidation aborts the full baseline and candidate suites during renderer initialization (WebGL 1 INVALID_ENUM on OpenGL, WebGL initialization failure on Vulkan). These are invalid full-suite comparisons. Targeted splat tests with validation pass. Rerun the standard full suites with the same flags used for round 3. Preserve aborted logs.

The first targeted test command included --webglStub=false. The CLI parses this as a truthy string and enables the stub. Do not use that run as GPU evidence. The standard full OpenGL suite and subsequent targeted OpenGL run omit this flag.

Firefox diagnostic: unchanged baseline reaches only frame 2 in 20 seconds, with no render errors, and accounting reaches only frame 5. The compositor-driven animation loop does not advance reliably in this headless Weston setup. Try a timer-paced animation loop for compatibility checks, without using its frame times as benchmark evidence.
