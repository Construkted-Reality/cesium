"""Validate worker snapshot experiments and retain compact measurements."""
import hashlib
import json
from collections import Counter
from pathlib import Path

root = Path("/mnt/data2/cesium-splat-perf/worker-coalescing-results")
out = Path("docs/splat-perf/worker-coalescing-2026-09-07")
summary = {"static": [], "stress": []}
for group in ["attribution", "first-coalescing", "repeats", "stress"]:
    assert (root / (group + ".done")).read_text().strip() == "0", group
    for config in json.loads((root / (group + ".json")).read_text()):
        name = config["label"]
        d = json.loads((root / (name + ".json")).read_text())
        assert not d["errors"] and d["glError"] == 0, name
        assert "NVIDIA" in d["bench"]["renderer"], name
        for clock in [d["before"], d["after"]]:
            assert "1350" in clock and "7001" in clock
        trace = d["snapshotTrace"]
        row = {"name": name, "count": d["bench"]["splats"]["numSplats"], "builds": len(trace), "loads": d["telemetry"]["tileLoads"], "unloads": d["telemetry"]["tileUnloads"], "reasons": dict(Counter("bootstrap" if x["bootstrap"] else "stale" if x["stale"] else "stable" if x["stable"] else "timeout" for x in trace))}
        row["sameSelectionRebuilds"] = sum(set(x.get("tiles", [])) == set(trace[i-1].get("tiles", [])) for i, x in enumerate(trace) if i and "tiles" in x)
        if config["mode"] == "static":
            events = d["loading"]["startup"]
            ready = next(e for e in events if all(t["count"] == row["count"] and t["loaded"] and not t["pending"] for t in e["tiles"]))
            first = next(e for e in events if any(t["count"] > 0 for t in e["tiles"]))
            row.update(readyMs=ready["t"]-events[0]["t"], firstVisibleMs=first["t"]-events[0]["t"], maxStartupGapMs=max(e["dt"] for e in events), sha256=hashlib.sha256((root / (name+".raw")).read_bytes()).hexdigest(), decodeMs=d["loading"]["decodeMs"], packMs=d["loading"]["packMs"])
            summary["static"].append(row)
        else:
            row.update(frameMs=d["bench"]["frameMs"], staleIntervalsMs=[x["t"]-trace[i-1]["t"] for i, x in enumerate(trace) if i and x["stale"]])
            assert row["count"] > 0
            summary["stress"].append(row)
for asset in ["geo-newdefault", "bike-newdefault"]:
    rows = [r for r in summary["static"] if r["name"].startswith(f"repeat-{asset}-")]
    assert len(rows) == 6
    assert len({r["sha256"] for r in rows}) == 1
    assert len({r["count"] for r in rows}) == 1
    assert len({r["loads"] for r in rows}) == 1
    baseline = Path("/mnt/data2/cesium-splat-perf/production-loading-results") / f"fixed-{asset}-candidate-0.raw"
    assert rows[0]["sha256"] == hashlib.sha256(baseline.read_bytes()).hexdigest()
(out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print("Worker experiment completion, pixels, counts, loads, clocks, and errors verified.")
