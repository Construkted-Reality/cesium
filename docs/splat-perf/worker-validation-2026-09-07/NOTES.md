# Worker validation and profiling, 2026-09-07

Scope: cache pressure, cancellation, long camera turns, multiple tilesets, redundant rebuild attribution,
decoder initialization, remaining heap growth, and hardware-backend plus degree-0 compatibility.
All work runs on 192.168.8.212. PR #4 is merged at d49e5558b7.
First instrument tile-load events against selected tile identities, then test any invalidation change.
Keep timing jobs sequential. Commit completed units and publish related validated work in separate PRs.
