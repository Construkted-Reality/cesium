# Deferred upload findings, 2026-09-12

Baseline c5e50f8eb0 includes PR 27. Adrian approves the resource lifecycle experiment and implementation if validation supports it.

The first 64 MiB prototype peaks at 80.28 MiB, versus 213.81 MiB for the baseline. Both have a 17.3 ms p95 frame interval. Their budget controllers choose different final detail during loading, so this comparison cannot alone prove equal-detail savings.

The fixed-detail sequence 4 -> 8 -> 4 -> 12 -> 4 removes that confounder. The first pair has exactly matching counts: 1,301,102 at error 8, 2,087,136 at error 4, and 724,860 at error 12. Baseline peaks are 422.4 or 352.1 MiB during replacements; candidate peaks are 263.2 MiB. Paired reruns and image checks remain in progress.

Six focused specs initially fail with a maximum texture size of zero. The spec imports GaussianSplatPrimitive directly from its source file. The test bundle maps index imports to the loaded Cesium bundle but compiles direct imports independently. Thus the fixture scene initializes one ContextLimits object while the directly imported primitive uses another. Importing the primitive and worker helpers from the index makes the spies and textures use the same renderer instance.

The implementation prepares explicit CPU upload payloads, sorts, then uses the scene afterRender callback. It deletes old textures before uploading new textures. A replacement failure must discard partial resources and the old draw command, because the old GPU view cannot survive deletion. The next update retries from tile content. Unit and browser fault injection will validate that path.

The paired Geo runs retain the allocation benefit but show a transient refinement cost. Candidate refinement p95 intervals reach 22.0 to 22.6 ms, versus 17.5 to 20.1 ms in the paired baseline runs. Largest intervals remain about 102 to 104 ms on candidate and 101 to 113 ms on baseline. Steady tail p95 remains about 17 to 18 ms. Immediate upload on asynchronous sort arrival still reaches 22.4 to 23.3 ms on the last refinement, so that variant does not remove the cost. Keep the explicit frame boundary.

Idle-mode validation finds a pre-existing missing wake-up. Both baseline and the first candidate stop with selected tiles loaded, a rebuild pending, zero stable frames, and no render requested. The correction requests frames for synchronous snapshot preparation and selection stabilization, while worker completion requests the next phase. The revised candidate passes cold idle loading, detail replacement, and full recovery. The baseline remains stuck at 1,818,527 splats after 45 seconds, instead of the required 2,087,136.

At two million splats, deferred upload retains a 64 MiB generated attribute buffer during sorting. That buffer is released after upload. Packed harmonics use existing snapshot storage. This exchanges temporary CPU retention for lower GPU overlap.

Image differences across baseline and candidate are comparable to baseline reruns: mean absolute channel differences below 0.001 on a 0 to 255 scale. No pixel differs by more than 8 in the measured Geo pairs.
