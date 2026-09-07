# Loading experiments, 2026-09-07

Baseline renderer: merged PR #2, 826734d915. Tests extend c153f20b8f from PR #3.
All experiments run on 192.168.8.212. Production engine source remains unchanged.

Four authorized experiments: runtime worker-cache budgets; direct decoder-to-dense harmonics packing;
a bounded worker queue for decoding and packing; longer memory runs, multiple assets, and a second graphics backend.

The direct-packing prototype uses metadata on empty SH attribute placeholders to avoid intermediate arrays.
This is restricted to the Gaussian tile harness. Production code needs an explicit loader/component field.
The worker prototype admits one compressed tile at a time. It drops queued jobs whose loader is destroyed.
Results retain the original loader destruction guard for already running jobs.
