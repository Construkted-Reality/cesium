# Production decoder pool, 2026-09-07

PR #5 is merged at 80eb285382. Its two-worker experiment supports production integration.
The implementation uses at most two TaskProcessor workers, with one active job per worker.
Busy loaders retry through process(). The pool retains no additional queue and copies input only after admission.
The original SH coefficients remain available to consumers of the shared SPZ loader. Packed coefficients use a separate field.
Snapshot scheduling does not change. Test production loading against the saved PR #5 bundle under the same browser and clocks.
Validate failures, destroyed loaders, mixed assets, cache pressure, degree 0, hardware OpenGL, and repeated removal.

## First production measurements

The initial implementation improves startup responsiveness but does not reproduce the prototype loading gain.
Geo takes 5342, 5597, and 5356 ms, compared with baseline 5234, 5234, and 5297 ms.
The production pool records 195073 to 218994 busy retries for Geo.
A CPU profile will attribute this cost before changing the retry path. Preserve these results as the first implementation baseline.

## Retry attribution

The startup CPU profile assigns 648 ms inclusive time to getPackedSphericalHarmonicsDegree.
getSpzInfoFromGltf has 218 ms self time, plus its regular expression work.
Shared attribute consumers repeatedly call the same waiting SPZ loader in each frame.
Cache immutable glTF metadata at construction and admit each waiting loader at most once per frame.
The new regression test calls process 20 times in one frame and confirms one admission attempt, followed by a retry in the next frame.
