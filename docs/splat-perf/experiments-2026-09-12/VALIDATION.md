# Validation results, 2026-09-12

## Source and test scope

The final source commit is `21410f2c14` on `feature/reuse-committed-splat-scratch`. Its base is `feature/splat-perf`. The diff contains one production file and one test file.

The full-suite comparison tests the combined texture-sharing baseline and scratch candidate. The baseline commit is `aee7afc9b6`. The Gaussian splat source and existing tests are identical across that baseline and the direct PR base. The final standalone branch also passes its focused suite.

| Check | Baseline | Candidate |
| --- | ---: | ---: |
| Hardware OpenGL full suite | 15,717 pass, 81 fail | 15,718 pass, 81 fail |
| Vulkan full suite | 15,794 pass, 4 fail | 15,795 pass, 4 fail |
| Final standalone Gaussian splat suite | Not applicable | 37 pass |
| Restored texture-sharing ResourceCache suite | 169 pass | Not applicable |
| New scratch-ownership regression | Fails | Passes |

The full suites skip 67 tests. Both backends have identical failure multisets between baseline and candidate. There are no additional candidate failures. The new regression adds one passing test.

The four Vulkan failures are the overlay pass uniform test and three environment-lighting tests. OpenGL also reports failures in shadows, pixel comparisons, picking, and framebuffer attachment limits. These failures also occur on the prepared baseline. The suite is not fully green. This change does not repair those failures.

The build, lint, formatting, and type checks pass. The focused suite runs after the final branch is rebased directly onto the performance branch.

## Corrections to preliminary runs

The first extra worktrees resolve engine imports through the main checkout. Those results are invalid. Each worktree now resolves its own engine and widget packages.

The first isolated baseline also lacks generated decoder runtime files. Those files cause 41 extra failures. The corrected run executes `gulp prepare` before building. The Draco, splat, and ZIP WebAssembly files have identical SHA-256 hashes in the two checkouts. Only the corrected baseline counts appear in the table.

The first standalone focused run uses a stale generated engine index after the branch changes. Rebuilding regenerates the index. The subsequent focused run passes all 37 tests.

The uncapped rebuild timing batch has mismatched splat counts and incomplete worker jobs. It is excluded. Accepted timing runs have matching counts and six completed rebuilds.

## Browser coverage

Chromium 151 runs the full suites on OpenGL and Vulkan. Firefox through Wayland runs the point-cloud fixture through all four style states with hardware WebGL 2. Firefox headless fails the WebGL initialization control on this server. Safari and mobile devices are not tested.

The point-cloud dependency prototype uses a fixture-specific dependency list. It is not a browser-wide compatibility result for automatic dependency analysis. Decoder reuse modifies a copy of the dependency and requires a supported API before production integration.
