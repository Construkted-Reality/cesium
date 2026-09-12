# Validation, 2026-09-12, round 3

The unchanged baseline is `c7e8148fe9`. The combined validation commit is `f347237f73`. Each production branch starts independently from the baseline.

| Complete suite | Baseline passes | Baseline failures | Combined passes | Combined failures |
| --- | --- | --- | --- | --- |
| Chromium ANGLE Vulkan | 15,793 | 4 | 15,809 | 3 |
| Chromium ANGLE OpenGL | 15,716 | 81 | 15,797 | 15 |

The failure comparison contains no new failures. The combined branch adds 15 tests, resolves one Vulkan failure, and resolves 66 OpenGL failures. Each run skips 67 tests.

Focused checks pass: 95 automatic-uniform tests, 71 framebuffer tests, three PNTS property integration tests, 21 GaussianSplatPrimitive tests, and 283 Cesium3DTileset tests. The final combined suites include the wrapped-viewport regression. Both Chromium and Firefox match all nine PNTS rendering phases. All four corrected OpenGL dateline transitions match baseline.

Code commits pass ESLint, Prettier, and TypeScript checks. Worktrees use their own Cesium workspace links. Each complete-suite worktree has prepared runtime assets. The first PNTS full-suite attempt lacks those assets; its missing-assets log is invalid and is not used in the comparison.

The separate dependency patch passes eight Node.js tests and browser tests on 80 real files. Each of six browser runs rejects 12 malformed inputs and correctly decodes the recovery input. All decoded-array hashes match. Two 400-job reuse runs keep the same WebAssembly heap size, and explicit release permits module and heap collection.

Known failed or invalid experiments remain in the archive:

- The first Scene command uses a category filter instead of a name filter and runs zero tests.
- The first combined trim name filter uses a regular expression where the runner expects a substring and runs zero tests.
- Forced multipass flag changes produce invalid framebuffer configurations. Correct construction exposes an existing shader compilation failure.
- The original lazy OIT prototype fails the first wrapped-viewport transition. The final fix passes it.
- An initial five-pixel unit fixture has an uncolored border pixel. The regression uses interior samples in the validated 256-pixel fixture.

The retained full-suite failures are baseline issues. They are not reported as successful tests.
