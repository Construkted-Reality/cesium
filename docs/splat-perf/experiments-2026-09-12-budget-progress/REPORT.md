# Gaussian splat budget progress

Date: 2026-09-12. Server: 192.168.8.212. GPU: NVIDIA RTX A4000. Browser: Chromium 151.
Baseline: f23db5f9b2, after merged pull requests 25 and 26.
Candidate: feature/splat-budget-progress.

## Problem and change

At zero cache and overflow budget, the baseline keeps increasing the memory-adjusted screen-space error beyond the root rejection threshold. Traversal selects no tiles and leaves stale decoding work queued. The candidate bounds coarsening at the root level, keeps the root eligible under memory pressure, discards obsolete unready Gaussian decoding work, and permits needed fallback decoding at the coarsest level.

The user maximum screen-space error still controls explicit root rejection. Mesh and point-cloud decoding keep their existing budget admission rules. Mixed tilesets share the tileset detail controller. Expired content with a cache entry retains its existing lifecycle.

## Source measurements

Static camera, 1920 by 1080, maximum screen-space error 4, no cache overflow. Geo runs last 25 seconds; Bike runs last 30 seconds. After each limited-budget run, the probe restores 512 MiB cache and 512 MiB overflow and checks full detail.

| Dataset and budget | Selected splats | Ready tiles | Processing | Final GPU MiB | Peak GPU MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Geo baseline, 0 MiB | 42,279 in old snapshot, no selected tiles | 0 | 127 | 6.14 | 27.14 |
| Geo candidate, 0 MiB | 42,279 | 1 | 0 | 6.14 | 42.64 |
| Geo baseline, 64 MiB | 499,376 | 29 | 0 | 63.60 | 145.08 |
| Geo candidate, 64 MiB | 499,376 | 29 | 0 | 63.82 | 159.55 |
| Bike candidate, 0 MiB | 14,194 | 1 | 0 | 2.05 | 4.05 |
| Bike candidate, 16 MiB | 109,200 | 14 | 0 | 14.90 | 91.88 |

All four source runs recover full detail without browser errors. Geo recovers 2,087,136 splats and 139 ready tiles. Bike recovers 705,883 splats and 72 ready tiles.

The Geo zero-budget adjusted error ends at 56.85 instead of more than 13 trillion. GPU figures count Cesium-owned allocations, not total driver VRAM. Peaks depend on asynchronous loading order. These single runs establish behavior, not a statistically established performance improvement. The candidate does not solve temporary replacement allocation peaks.

## Rejected experiments

- Decode all currently needed splat tiles above budget: clears the stall, but reaches 508.4 MiB at both zero and 64 MiB budgets.
- Admit replacement textures only when they fit beside the old snapshot: lowers peaks but repeatedly rejects refinement.
- Add a larger refinement reserve: settles below 50 MiB at a 64 MiB budget, but renders 226,651 splats and retains 139 decoded tiles.

See LIFECYCLE-DESIGN.md for the proposed next experiment. Its implementation requires the pending lifecycle approval.

## Validation

The first source checks pass 319 tileset-related specs and 45 Gaussian splat specs. Formatting, lint, TypeScript checks, and commit hooks pass. The camera test releases counted splat GPU bytes to zero when the view turns away. Returning restores the root view. Increasing the budget then restores full detail. A modified dataset with equal root and tileset geometric error also preserves the fallback and recovers full detail. Neither edge run reports browser errors.

The candidate full suite completes with 15,811 passing specs and 16 failing specs. The corrected baseline completes with 15,807 passing specs and the same 16 failing spec names. The candidate adds four passing specs. See test-comparison.json.

The first baseline invocation fails before tests because the new worktree lacks generated package indexes. A second invocation lacks decoder files and is stopped with exit code 137. Running gulp prepare supplies those files before the final baseline comparison. These setup failures remain in the raw logs.

## Reproduction and data

The probe scripts route the browser bundle to the named baseline or candidate. The baseline is built from f23db5f9b2. The source candidate is built from this feature branch. Prototype bundles are experimental string patches of the baseline.

Run npm dependencies, npx gulp prepare, and npm run build before testing a fresh checkout.

raw-data.tar.gz contains the trace records, probe scripts, job scripts, and validation logs. The prototype patches apply to the baseline compiled bundle. Raw records and logs are also stored on the server at /mnt/data2/cesium-splat-perf/experiments-2026-09-12-budget-progress. Research artifacts stay on the research branch and do not enter the production pull request.
