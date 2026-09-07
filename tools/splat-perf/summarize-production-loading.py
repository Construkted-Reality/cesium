"""Check production loading evidence and save a compact report."""
import hashlib
import json
from pathlib import Path

root = Path("/mnt/data2/cesium-splat-perf/production-loading-results")
out = Path("docs/splat-perf/production-loading-2026-09-07")
summary = {"fixed": []}
def read(name):
    d = json.loads((root / (name + ".json")).read_text())
    assert not d["errors"] and d["glError"] == 0, name
    assert "NVIDIA" in d["bench"]["renderer"], name
    for clock in [d["before"], d["after"]]:
        assert "1350" in clock and "7001" in clock, (name, clock)
    return d
for asset in ["geo-newdefault", "bike-newdefault"]:
    hashes = set()
    counts = set()
    for mode in ["baseline", "candidate"]:
        for repeat in range(2):
            name = f"fixed-{asset}-{mode}-{repeat}"
            d = read(name)
            e = d["loading"]["startup"]
            count = d["bench"]["splats"]["numSplats"]
            ready = next(x for x in e if all(t["count"] == count and t["loaded"] and not t["pending"] for t in x["tiles"]))
            digest = hashlib.sha256((root / (name + ".raw")).read_bytes()).hexdigest()
            hashes.add(digest)
            counts.add(count)
            summary["fixed"].append({"name": name, "count": count, "sha256": digest, "readyMs": ready["t"] - e[0]["t"], "backingBytes": d["heap"]["backingStorageSize"], "gpuMs": d["bench"]["gpuMs"]})
    assert len(hashes) == len(counts) == 1
b = read("budget-production")
assert all(b["budgetValidation"]["rejected"])
assert all(w["bytes"] == w["keys"] == w["budget"] == 0 for w in b["disabledWorker"])
summary["budget"] = {k: b[k] for k in ["budgetValidation", "disabledWorker"]}
s = read("lifecycle-production")
removed = [r for r in s["lifecycle"] if r["stage"] == "removed"]
assert len(removed) == 12
live = []
for r in removed:
    assert all(w["bytes"] == w["keys"] == 0 for w in r["worker"])
    assert all("error" not in w for w in r["workerHeaps"])
    g = r["state"]["gl"]
    live.append({k: v - g.get(k.replace("create", "delete", 1), 0) for k, v in g.items() if k.startswith("create")})
assert all(g == live[0] for g in live)
summary["lifecycle"] = {"cycles": len(removed), "liveGraphics": live[0], "removed": [{"cycle": r["cycle"], "heap": r["heap"], "workerHeaps": r["workerHeaps"]} for r in removed]}
(out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print("Production pixels, GPU identity, clocks, budget, and lifecycle checks pass.")
