# Worker snapshot investigation, 2026-09-07

Production PR #4 is open at b6065aa9fa. This investigation changes harness response interception only.
The worker sends prototype packed data to the explicit production loader field. Ordinary production decoding stays unchanged.

Initial Geo attribution: the direct main-thread path builds twice. The worker builds 15 times.
Of the 14 worker rebuilds after bootstrap, nine hit the 30-frame stall threshold and five use the stability condition.
Some stable builds are approximately 100 ms apart. Equal tile counts do not establish equal tile identities.
The next trace records tile identities and dirty flags.

Hypothesis: limiting noncritical rebuild frequency while tiles load reduces repeated aggregation and texture work.
Test 250 ms and 500 ms minimum intervals. Bootstrap, stale snapshots, and fully loaded views bypass the interval.
Measure complete-view time, first visible time, largest startup gap, partial-view progress, snapshot count, and exact final pixels.

The first coalescing results contradict the hoped-for gain. Geo completion is 8043 ms with 15 builds,
9824 ms at 250 ms with 13 builds, and 9088 ms at 500 ms with 11 builds. All 139 tile loads and final pixels match.
Worker decode plus packing also varies by approximately 300 to 500 ms. Repeat with identical instrumentation before attribution.
The worker shows its first splats at 1121 ms, compared with 5083 ms for main-thread decoding.
That first-view benefit matters even though full-detail completion is slower.

Repeated data supports a longer interval: 1000 ms reduces mean Geo worker completion 8262 to 7196 ms,
and Bike 3066 to 2465 ms. First-visible timing remains near 1.1 seconds and 0.6 seconds respectively.
The main-thread direct path still completes Geo sooner, around 5.7 seconds.
Camera-motion frame p95 improves 44.1 to 34.3 ms for Geo and 36.8 to 24.9 ms for Bike.
A stale Bike snapshot rebuild starts 203 ms after its predecessor, exercising the interval bypass.
These motion runs have no tile evictions. Do not treat them as constrained-cache validation.
