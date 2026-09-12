# Deferred GPU snapshot upload, 2026-09-12

Status: design only. Adrian's approval for the resource lifecycle change is pending.

## Evidence

The accepted starvation fix does not limit replacement allocation peaks. The Geo source run reaches 159.55 MiB with a 64 MiB cache budget. A simple allocation admission prototype reduces the peak to 49.64 MiB after reserving half the refinement headroom. That version renders 226,651 splats instead of 499,376 and retains all 139 decoded tiles instead of 29. These are material costs. Do not present this prototype as a general memory improvement.

## Proposed experiment

Prepare the replacement attribute data and sorted indices before allocating its graphics processing unit (GPU) textures. Continue drawing the old snapshot while the workers run. After the old frame completes, release its resources and upload the prepared replacement.

The current update method queues the old draw command before committing a replacement. Deleting old textures at the existing commit location can invalidate commands that have not executed. The experiment must use an explicit frame completion boundary.

## Required validation

1. Count active, pending, and retired texture and buffer bytes during each replacement.
2. Compare equal camera paths and equal selected detail against the accepted starvation fix.
3. Record frame times and CPU memory. Deferred uploads may exchange GPU overlap for retained CPU data or upload stalls.
4. Test request-render scenes, camera changes during sorting, stale worker results, and primitive destruction.
5. Test failed uploads and context loss. Once the old resources are deleted, an upload failure cannot preserve the old GPU view.
6. Test multiple scene passes and multiple tilesets. Frame completion must cover every command that uses the old resources.
7. Record driver memory separately where available. Deleting a WebGL resource does not prove immediate physical VRAM reclamation.

Do not introduce a state machine or new public option before the prototype demonstrates an acceptable benefit.
