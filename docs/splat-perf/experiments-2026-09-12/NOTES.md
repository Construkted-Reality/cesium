# Memory experiments, 2026-09-12

The [report](REPORT.md) records all six research areas. The [validation record](VALIDATION.md) distinguishes accepted checks from invalid setup runs. Raw evidence is outside the source PR at `/mnt/data2/cesium-splat-perf/experiments-2026-09-12`.

## Decisions from the measurements

- Retain scratch pools and release snapshot ownership after upload. Controlled rebuilds save 63.7 MiB for Geo and 21.5 MiB for Bike. Rebuild CPU time at the 99th percentile increases by about 2.5–2.7%.
- Reject releasing every scratch array as the default. Geo frame time at the 99th percentile increases from 102.85 to 151.25 ms.
- Continue modern point-cloud dependency handling. The combined fixture prototype saves 8 MiB of GPU storage before any property is used. Shader reflection alone saves zero bytes.
- Continue decoder module reuse with an idle-release policy. Browser decode time falls by 28.5%. A warm module retains 29.6 MiB of linear memory. The idle probe recovers 28.3 MiB of renderer resident memory.
- Continue lazy transparency-target allocation. Disabling those targets saves 63.3 MiB at 1920 by 1080 pixels in opaque scenes. Global disabling changes the mixed-transparency fixture and is rejected.
- Keep multisample anti-aliasing as a quality choice. Two samples save 31.6 MiB and reduce GPU time by 11.3–14.9%, with measurable image changes.

## Findings that changed the investigation

The initial staging probe finds 255 MiB of referenced arrays in Geo. Releasing those references does not free 255 MiB because the scratch pools also own the arrays. The accepted reduction comes from reusing one set of arrays across committed snapshots.

Chrome's backing-storage counter does not include the decoder's WebAssembly linear memory. The idle-release experiment therefore also checks weak references and renderer resident memory. The module and its buffer are collected.

A high screen-space error limit produces an empty selection in the Geo fixture. It does not produce the intended coarse level of detail. The previous snapshot remains active. This is a follow-up retention question, not a validated cache policy.

## Branch and publication scope

The experiments use the optimized 1.144.0 performance line. The separate 1.145.0 work on `main` is outside the comparison.

Pull request #15 carries the previously reviewed texture-sharing merge to the performance branch. The scratch-ownership change is commit `21410f2c14` on `feature/reuse-committed-splat-scratch`. It targets the performance branch directly. The point-cloud prototype remains on `feature/pnts-unused-attribute-probe` and is not ready for production.

The source PR contains no research JSON, copied bundles, or raw images. The report and research notes remain on this research branch.
