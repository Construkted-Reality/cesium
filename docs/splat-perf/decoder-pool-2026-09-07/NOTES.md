# Production decoder pool, 2026-09-07

PR #5 is merged at 80eb285382. Its two-worker experiment supports production integration.
The implementation uses at most two TaskProcessor workers, with one active job per worker.
Busy loaders retry through process(). The pool retains no additional queue and copies input only after admission.
The original SH coefficients remain available to consumers of the shared SPZ loader. Packed coefficients use a separate field.
Snapshot scheduling does not change. Test production loading against the saved PR #5 bundle under the same browser and clocks.
Validate failures, destroyed loaders, mixed assets, cache pressure, degree 0, hardware OpenGL, and repeated removal.
