# Splat performance: characterization

Date: 2026-08-21.
Hardware: NVIDIA RTX A4000, headless Chrome, ANGLE Vulkan backend.
Scene: `/mnt/data2/gs/oracle-run/geo-newdefault`, built from `richmond_hill.ply`, 235 tiles,
spherical harmonics degree 3.
Command: `bash tools/splat-perf/sweep-01-characterize.sh`.
Raw data: `docs/splat-perf/results/summary.csv`.

## Conclusion first

Two costs dominate, and they are separate problems.

1. **The graphics processor cost is fill rate, not splat count.** Splat count grew 17 times,
   from 169 thousand to 2.94 million, and graphics processor time grew 3.2 times, from 1.72 ms
   to 5.56 ms. Pixel count grew 2.25 times, from 720p to 1080p, and graphics processor time grew
   1.81 times at a fixed splat count. Cost tracks pixels much more closely than splats.
2. **The processor cost is the sort path, and only the sort path.** With the camera still, the
   processor spends 0.83 ms per frame on a 2.09 million splat scene. With the camera moving, the
   same scene costs 3.22 ms mean and 10.8 ms at the 95th percentile. The scene is identical. The
   difference is that a moving camera schedules re-sorts.

## How to read the numbers

The browser adds a fixed 6.0 ms of frame scheduling in headless mode. The control run with no
tileset measures 6.00 ms median frame time, 0.34 ms processor time and 0.12 ms graphics processor
time. So `frameMs` is not a clean metric here. Use `cpuMs` and `gpuMs`.

In this harness the processor and graphics processor times do not overlap. Frame time is close to
6.0 ms plus processor time plus graphics processor time.

## Splat count scaling, 1920x1080

| Screen space error | Splats | Graphics ms, median | Processor ms, mean | Processor ms, p95 |
| --- | --- | --- | --- | --- |
| 32 | 169,116 | 1.72 | 1.07 | 1.70 |
| 16 | 545,605 | 3.23 | 1.61 | 3.10 |
| 8 | 1,025,974 | 4.49 | 2.65 | 6.70 |
| 4 | 1,929,318 | 5.33 | 3.45 | 10.90 |
| 2 | 2,940,991 | 5.56 | 4.23 | 15.30 |

Graphics processor cost is strongly sublinear in splat count. Going from 1.03 million to 2.94
million splats, a factor of 2.9, adds only 1.07 ms. This is what fill rate limited behaviour looks
like. More splats at a finer level of detail cover the same screen area with smaller ellipses.

Processor cost, in contrast, keeps rising with splat count. The 95th percentile grows from 1.7 ms
to 15.3 ms. That is a dropped frame at 60 frames per second.

## Camera motion, screen space error 4, about 2 million splats

| Run | Sorts in 200 frames | Processor ms, mean | Processor ms, p95 | Graphics ms, median |
| --- | --- | --- | --- | --- |
| static, camera still | 0 | 0.83 | 1.00 | 4.09 |
| orbit, 0.1 degrees per frame | 32 | 3.22 | 10.80 | 5.16 |
| orbit, 1.5 degrees per frame | 33 | 3.35 | 10.70 | 5.21 |

Camera motion adds 2.4 ms of mean processor time and turns a flat 1.0 ms p95 into a 10.8 ms p95.
It also adds about 1.1 ms of graphics processor time, which is the index buffer upload that
follows each sort.

Slow rotation and fast rotation cost the same. The sort rate is capped at one request every three
frames by `DEFAULT_SORT_MIN_FRAME_INTERVAL`, and both speeds reach that cap.

## Pixel scaling

| Run | Splats | Pixels | Graphics ms, median |
| --- | --- | --- | --- |
| 1280x720 | 1,840,345 | 0.92 M | 2.95 |
| 1920x1080 | 1,929,318 | 2.07 M | 5.33 |
| 3840x2160 | 2,940,991 | 8.29 M | 17.83 |

The 2160p row selects more tiles because screen space error is measured in pixels, so it is not a
clean comparison. The 720p and 1080p rows have almost the same splat count. Pixels rise 2.25
times, graphics processor time rises 1.81 times.

Camera range confirms the same thing. At range factor 0.7 the splats cover more screen and cost
7.21 ms. At range factor 3.0 they cover less and cost 2.58 ms, with only a 2 times difference in
splat count.

## Where the processor time goes

Command:
`node tools/splat-perf/profile.mjs --tileset .../geo-newdefault/tileset.json --sse 4 --frames 300`

Window: 4724 ms, 28,206 samples, 1.93 million splats, 33 sort requests, 1 snapshot rebuild.

| Self time | Share | Function |
| --- | --- | --- |
| 3351 ms | 70.9% | `(program)`, that is native code outside JavaScript |
| 427 ms | 9.0% | `GaussianSplatPrimitive.update` |
| 163 ms | 3.4% | `worker.onmessage` |
| 98 ms | 2.1% | `processGeneratedSplatTextureData` |
| 41 ms | 0.9% | `bufferSubData` |
| 33 ms | 0.7% | `GaussianSplatPrimitive.generateSplatTexture` |
| 32 ms | 0.7% | `aggregateAttributeValues` |
| 31 ms | 0.6% | `aggregateShData` |

Two readings follow from this.

**The sort request costs about 13 ms of processor time each.** `GaussianSplatPrimitive.update`
holds 427 ms of self time across 300 frames, but only 33 frames schedule a sort. That gives about
13 ms per sort frame, which matches the 11 ms 95th percentile. The work inside `update` that is
large enough to explain this is `new Float32Array(this._positions)` at
`GaussianSplatPrimitive.js:2078` and `:2112`. At 1.93 million splats that array is 23 MB. The copy
exists because the buffer is transferred to the sort worker and would otherwise be lost.

**A snapshot rebuild costs about 200 ms of processor time.** The run performed exactly one
rebuild. The functions that only run during a rebuild add up to about 194 ms:
`processGeneratedSplatTextureData` 98 ms, `generateSplatTexture` 33 ms, `aggregateAttributeValues`
32 ms, `aggregateShData` 31 ms. A rebuild happens whenever the set of selected tiles changes,
which is every level of detail transition.

## What this means for the fix list

The earlier reading of the code guessed five candidates. The measurements change their order.

1. **Stop copying positions on the main thread for every sort.** Measured at about 13 ms per sort
   request. This is the largest single item and the easiest to verify.
2. **Stop rebuilding the whole snapshot when the selected tile set changes.** Measured at about
   200 ms per rebuild. Larger win but a much larger change.
3. **Reduce fill rate.** The graphics processor cost is 80 percent pixel bound. Tighter quad
   bounds, an earlier alpha cutoff, or a coarser first pass would work here. Splat count reduction
   would not.
4. **The four times redundant vertex shader work matters less than expected.** Graphics processor
   cost barely moves with splat count, so vertex work is not the limit at this scale. It may still
   matter for scenes with many small splats far from the camera.

Item 4 is a correction to the earlier guess. The vertex shader does repeat the spherical harmonics
evaluation four times per splat, but the measurements say that is not what limits this scene.
