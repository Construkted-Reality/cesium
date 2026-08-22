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
