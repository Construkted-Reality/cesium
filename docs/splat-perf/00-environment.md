# Splat performance work: environment

Date started: 2026-08-21.
Repository: fork of CesiumGS/cesium at `9fda7ab` (version 1.144.0), branch `feature/splat-perf`.
Location: `/mnt/data2/cesium-splat-perf/cesiumjs` on host 192.168.8.212.

## Hardware

| Item | Value |
| --- | --- |
| Operating system | Fedora Linux 44 Server Edition |
| Processor cores | 28 |
| Memory | 94 GB |
| Graphics processor | NVIDIA RTX A4000, 16376 MiB |
| Graphics driver | 595.71.05 |
| Disk free on /mnt/data2 | 977 GB |

The server is headless. It runs no display server.

## The graphics clock must be locked

**CAUTION:** Lock the graphics clock before any measurement. If you do not, every
number is wrong.

The RTX A4000 idles at 210 MHz and boosts to 1875 MHz. The driver picks the clock
from the load. A benchmark arm that does less work runs at a lower clock, so it
reads slower than it is. A light arm can read 14 times its true cost.

This invalidated a whole day of results on 2026-08-22. See `03-the-floor.md`.

Lock the clock with these three commands. They need `sudo`.

```bash
sudo nvidia-smi -pm 1
sudo nvidia-smi -lgc 1900,1900
sudo nvidia-smi -lmc 7001,7001
```

The driver snaps 1900 to the nearest supported step, which is 1875 MHz. That is
the clock the graphics processor reaches under full load anyway, so heavy arms
give the same number locked or unlocked.

The lock does not survive a reboot. Check it before every session:

```bash
nvidia-smi --query-gpu=clocks.gr,clocks.mem,persistence_mode --format=csv
```

The value only reads 1875 while work runs. An idle graphics processor reports a
lower number even when the lock is set.

Every benchmark script must print the clock, the temperature and the throttle
reasons after each arm:

```bash
nvidia-smi --query-gpu=clocks.gr,temperature.gpu,clocks_throttle_reasons.active \
  --format=csv,noheader
```

At 1875 MHz this machine settles at 80 to 85 degrees and 71 W of a 140 W limit,
with no throttle reason active. A run that reports 1860 MHz instead of 1875 is
still usable. A run that reports a non zero throttle reason is not.

## Chromium fails to launch at random

About one launch in six fails, either with `Target page, context or browser has
been closed` or with a launch timeout. The host is not short of memory, disk or
graphics memory when it happens. Retry three times with a pause of 8 seconds
before each attempt, and print a clear marker when an arm never succeeds. A
missing arm must never look like a result.

## Toolchain

- Node.js v22.22.2, npm 10.9.7.
- `npm install` reports an error at the end. The error comes from `playwright install --with-deps`,
  which calls `apt-get`. Fedora has no `apt-get`. All packages install correctly.
  Install the browser separately with `npx playwright install chromium`.
- `npm run build` passes in about 4 seconds.

## How to reach the graphics processor from headless Chrome

The default Playwright browser is the headless shell. It falls back to SwiftShader, a software
rasterizer. Software rasterization gives useless numbers for render performance.

Use the full Chromium build with new headless mode and the ANGLE Vulkan backend:

```js
chromium.launch({
  headless: true,
  channel: "chromium",
  args: [
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    "--enable-gpu-rasterization",
  ],
});
```

### Probe results

`tools/splat-perf/gpu-probe.mjs` tests five configurations. Only one reaches the graphics
processor.

| Configuration | Renderer | Max texture | Timer query |
| --- | --- | --- | --- |
| headless shell, default | SwiftShader | 8192 | no |
| headless shell, swiftshader flags | SwiftShader | 8192 | yes |
| **chromium, new headless, ANGLE Vulkan** | **NVIDIA RTX A4000** | **32768** | **yes** |
| chromium, new headless, ANGLE GL | SwiftShader | 8192 | no |
| chromium, new headless, EGL | SwiftShader | 8192 | no |

`EXT_disjoint_timer_query_webgl2` is available on the hardware path. This allows real
graphics processor timing.

## Test data on the server

`/mnt/data2/gs-corpus` holds source splat data. `/mnt/data2/gs` holds 3D Tiles tilesets that
Adrian built earlier. The tilesets use `KHR_gaussian_splatting` and
`KHR_gaussian_splatting_compression_spz_2`, which is what CesiumJS reads.

Candidate tilesets:

| Path | Size | Source |
| --- | --- | --- |
| `/mnt/data2/gs/oracle-run/geo-newdefault` | 105 MB | richmond_hill.ply |
| `/mnt/data2/gs/oracle-run/bike-newdefault` | 199 MB | bicycle |
| `/mnt/data2/gs/oracle-run/bike-k050` | 289 MB | bicycle |
