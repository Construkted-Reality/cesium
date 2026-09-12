# Validation, 2026-09-12

- Baseline: f20a5d1f1b.
- Accounting PR #22: 457c41286a.
- Release PR #23: 25747ae716. Both PRs target feature/splat-perf; merge #22 first.
- Full OpenGL baseline: 15,799 pass, 15 existing failures, 67 skipped.
- Full OpenGL combined changes: 15,804 pass, the same 15 existing failures, 67 skipped.
- Accounting branch, targeted real OpenGL: all 41 Gaussian splat tests pass.
- All five added tests pass in the full combined OpenGL suite.
- Build, lint, formatting, and type checks pass through the repository hooks.
- Two accounting unload/reload cycles match live GPU resource sizes exactly.
- Cache budget recovery returns all 139 tiles and 2,087,136 splats on both revisions.
- Four alternating Chromium runs show no missing-splat frames on cached return. Full unload releases 263.2 MiB GPU storage.
- Pixel differences match repeated-control variation. Visible coverage matches exactly outside the deliberate full unload.
- Timer-paced Firefox compatibility restores all splats with no browser errors. Native animation callbacks stall on the original baseline under headless Weston.
- Vulkan Karma tests fail during WebGL initialization on both revisions, including an NVIDIA-only retry. Standalone Vulkan context creation succeeds. No valid Vulkan full-suite comparison is available for this round.

The full suite runs before the release branch is rebased onto a documentation-only accounting commit. The production logic and all five added tests match the validated source. The rebase adds the public memory-accounting documentation line and changes commit identifiers only.

Raw logs include invalid or superseded runs. REPRODUCE.md identifies accepted artifacts and limitations. Do not treat the early WebGL stub run or initialization-aborted runs as GPU correctness evidence.
