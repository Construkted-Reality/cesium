# The blank turn

Date: 2026-08-23
Machine: gpubox, RTX A4000, graphics clock locked to 1875 MHz
Tileset: geo, 6 levels, REPLACE refinement, 235 tiles
Tool: `tools/splat-perf/probe-turn.mjs`

## Result

The report is correct and the behavior is not intended. When the camera turns in
place near the model, the screen goes fully black for 1.3 seconds. Then the new
geometry appears in one step.

The cause is not the network and it is not tile loading. Every tile that the
tileset selected for the new view was already loaded and ready before the screen
went black. The renderer had the data and did not draw it.

## Measured timeline

The camera turns 150 degrees in place over 300 ms. Time zero is the start of the
turn. `ready splats` counts the splats in tiles that the tileset selected and
that have finished loading. `drawn splats` counts the splats in the draw command.

| t (ms) | coverage | drawn splats | ready splats | stall frames | event |
| --- | --- | --- | --- | --- | --- |
| 12 | 100% | 874808 | 875731 | 1 | the turn starts |
| 217 | 92% | 874808 | 325017 | 1 | the new view is fully covered by ready tiles |
| 388 | 0% | 874808 | 337288 | 2 | the screen is black |
| 1308 | 0% | 874808 | 379056 | 6 | every tile has finished loading |
| 1508 | 0% | 874808 | 379056 | 29 | the stall counter is one frame from the limit |
| 1582 | 0% | 874808 | 379056 | 0 | the rebuild starts, generation 3 |
| 1681 | 100% | 379056 | 379056 | 0 | the new draw command is committed |

The screen holds one identical image from 606 ms to 1612 ms. The saved frames are
byte identical over that period.

## Cause

Three design choices combine to produce the delay.

1. The primitive draws one aggregate snapshot with one draw command. It cannot
   draw the tiles that the tileset selected. It can only draw the last snapshot
   that it built. Standard 3D Tiles content draws one command per tile, so a
   loaded tile appears on the next frame.

2. The stability test cannot pass after the view changes.
   `GaussianSplatPrimitive._selectedTileSet` holds the tiles of the last committed
   snapshot. The code writes it only inside the rebuild path, at
   `GaussianSplatPrimitive.js:2122`. After the camera turns, the current selection
   holds 19 tiles and the committed set holds 48, so `haveSelectedTilesChanged`
   returns true on every frame. `_selectedTilesStableFrames` stays at zero and
   `isStable` stays false. The measurement confirms this. The selection held 19
   tiles without a change for 274 ms and `stableFrames` never left zero.

   Therefore `isStable` and `_needsSnapshotRebuild` are mutually exclusive
   whenever a selection change sets the rebuild flag. The two frame fast path
   never runs. Only the stall counter opens the gate.

3. The stall limit counts frames, not milliseconds.
   `DEFAULT_MAX_SNAPSHOT_STALL_FRAMES` is 30. That is 300 ms at 100 frames per
   second. The frame rate drops to about 28 frames per second while the tileset
   processes the finer levels, so 30 frames became 1120 ms. The gate stretches
   at the exact moment that the machine is busy.

## What is not the cause

- The network. Pending requests reached zero at 580 ms and the screen stayed
  black for another 1100 ms.
- Tile processing. A complete set of ready, selected tiles covered the new view
  from 217 ms. The processing that ran until 1308 ms loaded the finer levels.
- The rebuild itself. The aggregate, the texture build, the sort and the commit
  together took 99 ms, from 1582 ms to 1681 ms.

## Reproduction

```sh
node tools/splat-perf/probe-turn.mjs --range 0.15 --pitch -5 --turn 150 \
  --turnMs 300 --out <directory>
```

The probe settles the scene for 30 quiet frames, anchors the camera position,
rotates the view direction in place, and records one row per frame for 5 seconds.
It changes no renderer code.

Raw data: `rows.json` and the saved frames in the output directory.
