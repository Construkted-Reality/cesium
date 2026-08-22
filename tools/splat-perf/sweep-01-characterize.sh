#!/usr/bin/env bash
# Characterization sweep for Gaussian splat rendering.
#
# Answers four questions:
#   1. Does the browser cap the animation frame rate in headless mode?
#   2. How does cost scale with the number of splats?
#   3. How much of the cost is camera motion, that is re-sorting?
#   4. How much of the cost is fill rate?
#
# Run detached:
#   setsid nohup bash tools/splat-perf/sweep-01-characterize.sh > sweep-01.log 2>&1 &
set -u

cd "$(dirname "$0")/../.." || exit 1
BENCH="node tools/splat-perf/bench.mjs"
GEO=/splat-data/oracle-run/geo-newdefault/tileset.json
BIKE=/splat-data/oracle-run/bike-newdefault/tileset.json
BIKE_K050=/splat-data/oracle-run/bike-k050/tileset.json

run() {
  echo "=============================================================="
  echo "RUN $*"
  echo "=============================================================="
  # shellcheck disable=SC2086
  $BENCH "$@" || echo "RUN FAILED: $*"
  echo
}

# 1. Frame cadence control. No tileset at all.
run --empty --label control-empty --frames 200 --warmup 60

# 2. Splat count scaling on the same scene, through screen space error.
run --tileset "$GEO" --label geo-sse32 --sse 32 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-sse16 --sse 16 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-sse8 --sse 8 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-sse4 --sse 4 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-sse2 --sse 2 --frames 200 --warmup 90

# 3. Camera motion. Static holds the camera still, so no re-sort should run.
run --tileset "$GEO" --label geo-static --sse 4 --mode static --frames 200 --warmup 90
run --tileset "$GEO" --label geo-orbit-slow --sse 4 --mode orbit --step 0.1 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-orbit-fast --sse 4 --mode orbit --step 1.5 --frames 200 --warmup 90

# 4. Fill rate. Same splats, four times the pixels.
run --tileset "$GEO" --label geo-sse4-2160p --sse 4 --width 3840 --height 2160 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-sse4-720p --sse 4 --width 1280 --height 720 --frames 200 --warmup 90

# 5. Camera distance. Close range raises overdraw for the same splat count.
run --tileset "$GEO" --label geo-sse4-close --sse 4 --range 0.7 --frames 200 --warmup 90
run --tileset "$GEO" --label geo-sse4-far --sse 4 --range 3.0 --frames 200 --warmup 90

# 6. A second, larger scene.
run --tileset "$BIKE" --label bike-sse16 --sse 16 --frames 200 --warmup 90
run --tileset "$BIKE" --label bike-sse4 --sse 4 --frames 200 --warmup 90
run --tileset "$BIKE_K050" --label bikek050-sse4 --sse 4 --frames 200 --warmup 90

echo "SWEEP COMPLETE"
