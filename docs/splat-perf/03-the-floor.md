# Retraction: the floor does not exist

Date: 2026-08-22.

## What this file said

An earlier version of this file said that a scene holding a splat tileset costs
1.50 ms of graphics time at 1920 by 1080 even when the splat primitive draws
nothing. It called that cost a floor, said it was 36% of the frame, and said it
set a hard limit on what splat optimization can achieve.

All of that is wrong.

## The measurement

The same build, with the splat draw command removed, measured at a locked
graphics clock.

| Build, no splat draw | Unlocked clock | Locked 1875 MHz |
| --- | --- | --- |
| 1280x720, 4 samples | 0.80 ms | 0.06 ms |
| 1280x720, 1 sample | 0.61 ms | 0.03 ms |
| 1920x1080, 4 samples | 1.56 ms | 0.11 ms |
| 1920x1080, 1 sample | 1.16 ms | 0.06 ms |
| 2560x1440, 4 samples | 2.82 ms | 0.20 ms |
| 2560x1440, 1 sample | 1.85 ms | 0.11 ms |

The real cost at 1080p is 0.11 ms, which is 3% of the frame. There is no floor.

## Why the first measurement was wrong

The graphics processor changes its clock with the load. This machine idles at
210 MHz and boosts to 1875 MHz. A build that draws no splats gives the graphics
processor almost nothing to do, so the driver drops the clock. The same work
then takes about 14 times longer to finish.

The ratio matches. The graphics clock spans 8.9 times and the memory clock spans
17.3 times. A cost that is part arithmetic and part memory traffic lands between
those two numbers, and 1.56 divided by 0.11 is 14.2.

`00-environment.md` now carries the commands that lock the clock, and every
benchmark script prints the clock after each arm.

## What else this invalidated

Any arm that did less work than the base scene ran at a lower clock and read too
slow. That covers:

- The whole draw structure table in the first version of `02-attribution.md`.
  It was already retracted for a different reason, a draw count clamp in
  `Context.js`.
- Every vertex shader variant in `02-attribution.md`. All of them are now
  re-measured at a locked clock, and the conclusion changed. Spherical harmonics
  are not free. They cost 1.23 ms.
- The first splat count sweep. Its 10% arm cost more than its 25% arm, which is
  impossible. At a locked clock the curve is a straight line.
- The saving from turning multisampling off. It read 0.47 ms and it is 1.03 ms.

Arms that ran at full load are unaffected, because they always boosted to
1875 MHz. The base frame of 4.2 ms reads the same locked or unlocked.

## What replaces this file

`02-attribution.md` holds the corrected decomposition.
`04-synthesis.md` holds the corrected budget and the run order.

## The lesson

Lock the clock before the first measurement, not after the tenth. The failure is
silent: every number looks plausible, every run repeats itself within a few
percent, and only a comparison between a heavy arm and a light arm exposes it.
The tell was a curve that was not monotonic. Fewer splats read as more time.
