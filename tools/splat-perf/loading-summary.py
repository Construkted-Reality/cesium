"""Validate completed loading experiments and save compact evidence."""
import hashlib
import json
from pathlib import Path

ROOT = Path("/mnt/data2/cesium-splat-perf/loading-experiment-results")
OUT = Path("docs/splat-perf/loading-experiments-2026-09-07/summary.json")
summary = {"streaming": [], "fixed": [], "memory": []}

def read(name):
    data = json.loads((ROOT / (name + ".json")).read_text())
    assert not data.get("errors"), name
    assert data.get("glError", 0) == 0, name
    return data

for asset in ["geo-newdefault", "bike-newdefault"]:
    hashes = set()
    counts = set()
    for mode in ["base", "direct", "worker"]:
        for repeat in range(2):
            name = f"stream-{asset}-{mode}-{repeat}"
            d = read(name)
            summary["streaming"].append({"name": name, "p95": d["bench"]["frameMs"]["p95"], "loads": d["telemetry"]["tileLoads"], "unloads": d["telemetry"]["tileUnloads"], "builds": d["telemetry"]["builds"], "backingBytes": d["heap"]["backingStorageSize"]})
            name = f"image-{asset}-{mode}" if repeat == 0 else f"load-{asset}-{mode}-repeat"
            d = read(name)
            count = d["bench"]["splats"]["numSplats"]
            events = d["loading"]["startup"]
            ready = next(e for e in events if all(t["count"] == count and t["loaded"] and not t["pending"] for t in e["tiles"]))
            digest = hashlib.sha256((ROOT / (name + ".raw")).read_bytes()).hexdigest()
            hashes.add(digest)
            counts.add(count)
            summary["fixed"].append({"name": name, "count": count, "sha256": digest, "readyMs": ready["t"] - events[0]["t"], "maxGapMs": max(e["dt"] for e in events), "builds": d["telemetry"]["builds"], "backingBytes": d["heap"]["backingStorageSize"]})
    assert len(hashes) == len(counts) == 1, asset
for prefix, modes in [("software", ["base", "worker"]), ("degree0", ["base", "direct", "worker"])]:
    rows = []
    for mode in modes:
        name = f"{prefix}-{mode}"
        d = read(name)
        rows.append({"name": name, "splats": d["bench"]["splats"], "renderer": d["bench"]["renderer"], "sha256": hashlib.sha256((ROOT / (name + ".raw")).read_bytes()).hexdigest()})
    assert len({r["sha256"] for r in rows}) == 1
    summary[prefix] = rows
for name in ["soak-geo-newdefault-base", "soak-geo-newdefault-worker", "soak-bike-newdefault-worker", "wasm-soak-base", "wasm-soak-worker"]:
    d = read(name)
    removed = [r for r in d["lifecycle"] if r["stage"] == "removed"]
    assert len(removed) == (8 if name.startswith("wasm") else 24)
    if name.startswith("wasm"):
        memories = [[w.get("memory") for w in r["workerHeaps"]] for r in removed]
        assert all(m == memories[0] for m in memories), name
    gl_counts = []
    for r in removed:
        assert all(w["bytes"] == w["keys"] == 0 for w in r["worker"])
        assert all("error" not in w for w in r["workerHeaps"])
        gl = r["state"]["gl"]
        gl_counts.append({k: v - gl.get(k.replace("create", "delete", 1), 0) for k, v in gl.items() if k.startswith("create")})
    assert all(g == gl_counts[0] for g in gl_counts), name
    summary["memory"].append({"name": name, "cycles": len(removed), "glLive": gl_counts[0], "checkpoints": [{"cycle": r["cycle"], "heap": r["heap"], "workerHeaps": r["workerHeaps"]} for r in [removed[0], removed[len(removed)//2], removed[-1]]]})
d = read("runtime-budget")
assert all(d["budgetValidation"]["rejected"])
assert all(w["budget"] == w["bytes"] == w["keys"] == 0 for w in d["disabledWorker"])
summary["budget"] = {k: d[k] for k in ["budgetValidation", "disabledWorker"]}
d = read("worker-cancellation")["cancellation"]
assert len(d["records"]) == 5 and d["invalidRejected"] and d["recoveredCount"] > 0
assert all(r["destroyed"] and not r["queue"]["active"] and r["queue"]["queued"] == 0 for r in d["records"])
summary["cancellation"] = d
OUT.write_text(json.dumps(summary, indent=2) + "\n")
print("Validated streaming, fixed images, memory, budget, and recovery results.")
