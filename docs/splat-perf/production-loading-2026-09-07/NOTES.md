# Production loading integration notes, 2026-09-07

The implementation preserves shared SPZ coefficient arrays until decoder users release them.
The prototype deleted those arrays. Keeping them allows ordinary attribute loaders to coexist with dense Gaussian tile loading.
Separate vertex cache keys prevent the two output representations from colliding.
Only the first coefficient loader owns the dense array. Resource-cache statistics count it once.

The cache limit is application-wide because Gaussian primitives share one sorter worker.
The default stays at 128 MiB. Configuration does not start an unused worker.
Budget updates travel with sort tasks and with control tasks when the scene is idle.

The first focused test command used a regular-expression-looking filter that matched zero tests.
The repository uses substring filtering. Separate suite filters execute the intended tests.
The new cache-key fixture initially omitted frameState; adding the required fixture field fixes that test.

Production comparisons preserve exact pixels. Geo complete-view time improves 6047 to 5685 ms on average;
retained main-thread arrays decrease 1.422 to 0.923 GB. The production integration preserves the prototype benefit.
The first lifecycle configuration specified cycles but omitted lifecycle=1. The validator rejected the missing cycle data.
The corrected run enables lifecycle explicitly. The harness now rejects that incomplete configuration before launching.
