# The splat performance branch

This branch is a fork of CesiumJS that changes how the Gaussian splat renderer
behaves. Read this file first. The numbered files in this directory are the
record of the investigation, not instructions.

- Fork base: `9fda7ab97a`, CesiumJS version 1.144.0.
- Base branch: `feature/splat-perf`.
- Upstream remote: `origin`, `https://github.com/CesiumGS/cesium.git`.

The public fork is [Construkted-Reality/cesium](https://github.com/Construkted-Reality/cesium).
[PR #1](https://github.com/Construkted-Reality/cesium/pull/1) adds recovery and
resource-lifetime fixes. The [rendering performance follow-up](render-performance/RESULTS.md)
adds exact sort suppression, command reuse, a byte-budgeted worker cache, and
dense harmonics packing.

The [streaming and GPU tests](streaming-gpu-2026-09-07/RESULTS.md) validate PR #2
under cache pressure and identify the next optimization targets.
The [loading experiments](loading-experiments-2026-09-07/RESULTS.md) measure direct packing,
worker decoding, runtime cache budgets, and longer memory tests.
The [production loading follow-up](production-loading-2026-09-07/RESULTS.md) integrates direct packing
and documents the application-wide `GaussianSplatPrimitive.maximumCacheByteLength` option.

The remaining sections record the original optimization round. Their file
counts, cache policy, and test status refer to that historical baseline. Read
the follow-up results for the current changes and validation.

## What changes in the product code

Five files change. The public API does not change. An application that uses
this fork needs no code change and no new option.

| File | What it does |
| --- | --- |
| `Scene/GaussianSplatPrimitive.js` | The snapshot gate, the sort position cache, the timing counters, the pick pass fix |
| `Scene/GaussianSplatSorter.js` | Sends splat positions to the sort worker one time instead of every sort |
| `Workers/gaussianSplatSorter.js` | Holds the positions between sorts and returns results as transferable objects |
| `Workers/gaussianSplatTextureGenerator.js` | Returns the texture buffer as a transferable object instead of a copy |
| `Shaders/PrimitiveGaussianSplatFS.glsl` | Removes a `discard` that can never run |

### Changes that a user sees

1. **Splats no longer write into the pick framebuffer.** Splats carry no pick
   identifier, so `Scene` used the base draw command in the pick pass and a
   reader decoded splat colours as a pick identifier. The primitive now returns
   early in the pick pass. This is a correctness fix. See commit `75dbe09748`.

2. **The renderer shows geometry when the camera turns away from the
   snapshot.** The primitive draws one aggregate snapshot with one draw
   command, and it rebuilt that snapshot only after the selected tiles settled.
   A camera that turned in place saw a blank screen for 1252 ms. The blank
   period is now 844 ms. See `05-the-blank-turn.md` and commit `39f711796d`.

### Changes that a user does not see

1. The sort worker keeps the splat positions between sorts. This cuts the copy
   on each sort from 8.67 ms to 0.17 ms. See commit `e8a67102f2`.

2. The spherical harmonics texture is built without a repack. This cuts the
   texture build from 127.2 ms to 49.3 ms per rebuild. See commit `b11c3e4869`.

Graphics time does not change. Every improvement above is processor time. The
renderer is fill bound, and `02-attribution.md` gives the measurements.

## The tuning constants

All six sit at the top of `GaussianSplatPrimitive.js`. Change them only with a
measurement.

| Constant | Value | What it controls |
| --- | --- | --- |
| `DEFAULT_STABLE_FRAMES` | 2 | Frames the selection must hold still before a rebuild |
| `DEFAULT_MAX_SNAPSHOT_STALL_FRAMES` | 30 | Frames before a rebuild is forced |
| `DEFAULT_MIN_SNAPSHOT_RETENTION` | 0.15 | Below this share of retained tiles, rebuild at once |
| `DEFAULT_SORT_MIN_FRAME_INTERVAL` | 3 | Frames between re-sorts while the camera moves |
| `DEFAULT_SORT_MIN_ANGLE_RADIANS` | 0.0087 | Camera rotation that triggers a re-sort |
| `DEFAULT_SORT_MIN_POSITION_DELTA` | 1.0 | Camera movement in metres that triggers a re-sort |

`DEFAULT_STABLE_FRAMES` does not do what its name says. The stability test
compares the selection against the last committed snapshot, not against the
previous frame, so it never fires after the camera changes the view. A fix that
makes it fire raised the orbit frame p95 from 12.70 ms to 17.10 ms, because the
primitive then rebuilt four times per orbit instead of one. The retention gate
covers the case that matters instead. Do not "fix" this without repeating that
measurement.

## Build the fork

```sh
npm install
npm run build
```

The build writes `Build/CesiumUnminified/Cesium.js`. An application loads that
file the same way it loads a released build.

## Turn on the timing counters

The counters cost nothing when they are off, and they are off by default.

```js
GaussianSplatPrimitive.profiling.enabled = true;
// ... run the scene ...
console.log(GaussianSplatPrimitive.profiling.counters);
```

The counters report total time, call count and maximum for
`snapshotAggregate`, `textureProcess`, `shTextureBuild`, `drawCommandBuild`,
`sortPositionCopy` and `sortSchedule`.

## Run the measurement tools

The tools in `tools/splat-perf/` are for this investigation. They are not part
of the library.

**CAUTION:** The tools carry paths from the machine that produced the
measurements. `serve.mjs` serves `/mnt/data2/gs` and `probe-turn.mjs` writes to
`/mnt/data2/cesium-splat-perf/turn`. `bench.mjs` asks for the tileset
`/splat-data/oracle-run/geo-newdefault/tileset.json`. Give your own paths, or
the tools fail.

1. Serve the tile data and the harness.

   ```sh
   node tools/splat-perf/serve.mjs --data /path/to/your/tilesets --port 8099
   ```

2. Run the benchmark.

   ```sh
   node tools/splat-perf/bench.mjs --mode orbit --frames 400 --warmup 60 \
     --sse 4 --tileset /splat-data/<name>/tileset.json --label my-run
   ```

3. Reproduce the blank turn.

   ```sh
   node tools/splat-perf/probe-turn.mjs --range 0.15 --pitch -5 --turn 150 \
     --turnMs 300 --out /path/to/output
   ```

**CAUTION:** Lock the graphics clock before you measure. An unlocked clock
produced errors of up to 14 times in this work. Read the clock section of
`00-environment.md`. The test machine also throttles over a long session, so
compare two builds in interleaved pairs and never in sequence.

## Known gaps

Complete these before this branch goes upstream.

1. The specification suite has no baseline. 39 of 15397 specifications fail on
   this branch. Nobody has shown that they fail on the fork base as well.
2. The pick pass fix has no specification.
3. Every measurement comes from one tileset, one graphics processor and one
   operating system. Windows and macOS are untested.
4. The sort position cache holds about 70 MB across threads. The retention count
   of three is a magic number with no measurement behind it.
5. Nobody has signed the Contributor License Agreement.

`04-synthesis.md` holds the full list of remaining work and the order to do it
in.

## The investigation record

| File | Subject |
| --- | --- |
| `00-environment.md` | Hardware, toolchain, and how to lock the graphics clock |
| `01-characterization.md` | The first sweep and the processor profile |
| `02-attribution.md` | Where the graphics time goes. The renderer is fill bound |
| `03-the-floor.md` | A retraction. The floor that an earlier file claimed does not exist |
| `04-synthesis.md` | The budget, the ideas, and the order of the remaining work |
| `05-the-blank-turn.md` | The blank screen after the camera turns, and the fix |

Two agent reviews sit in `docs/agents/`. `04-synthesis.md` supersedes them
wherever a measurement contradicts them.
