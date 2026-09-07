"""Validate and summarize the streaming/GPU experiments. Run on the GPU server."""
import hashlib
import json
from pathlib import Path

ROOT = Path("/mnt/data2/cesium-splat-perf/streaming-gpu-results")
DEST = Path(__file__).resolve().parents[2] / "docs/splat-perf/streaming-gpu-2026-09-07"

def read(name):
    data = json.loads((ROOT / (name + ".json")).read_text())
    assert not data["errors"], (name, data["errors"])
    assert data.get("glError", 0) == 0, name
    assert data["after"].startswith("1350 MHz, 7001 MHz"), name
    for worker in data["worker"]:
        assert worker["peak"] <= worker["budget"], name
    return data

def metrics(data):
    bench, telemetry = data["bench"], data["telemetry"]
    return {"frameMs": bench["frameMs"], "cpuMs": bench["cpuMs"], "gpuMs": bench["gpuMs"],
            "splats": bench["splats"], "worker": data["worker"],
            "tileLoads": telemetry["tileLoads"], "tileUnloads": telemetry["tileUnloads"],
            "primitiveCounters": bench["primitiveCounters"]}

def image_hash(name):
    data = (ROOT / (name + ".raw")).read_bytes()
    assert any(data[i] for i in range(0, len(data), 4)), name
    return hashlib.sha256(data).hexdigest()

summary = {"baseline": "826734d9158ca6f9515f43eb213ffac89505e697"}
for group, names in {
    "streamingPressure": ["streaming-0", "streaming-1"],
    "streamingDefault": ["streaming-default-0", "streaming-default-1"],
    "gpuControls": [f"profile-{p}-{i}" for p in ["base", "nospherical", "flatfragment", "tiny", "nodraw"] for i in range(2)],
}.items():
    summary[group] = {name: metrics(read(name)) for name in names}

visibility = read("streaming-visibility")["telemetry"]["frames"]
summary["visibility"] = {"width": 640, "height": 360, "frames": len(visibility),
                         "blankFrames": sum(f["visiblePixels"] == 0 for f in visibility),
                         "minimumVisiblePixels": min(f["visiblePixels"] for f in visibility)}
life = read("lifecycle-six")
summary["lifecycle"] = life["lifecycle"]
for step in life["lifecycle"]:
    for worker in step["worker"]:
        assert worker["peak"] <= worker["budget"]
        if step["stage"] == "removed":
            assert worker["bytes"] == 0 and worker["keys"] == 0

summary["immutable"] = {}
for i in range(3):
    hashes = []
    for probe in ["base", "immutable"]:
        name = f"upload-{probe}-{i}"
        data = read(name)
        assert data["bench"]["splats"]["dataGenerationsDuringRun"] == 8
        assert data["bench"]["splats"]["numSplats"] == 2087136
        hashes.append(image_hash(name))
        summary["immutable"][name] = {**metrics(data), "imageHash": hashes[-1]}
    assert hashes[0] == hashes[1]

summary["cacheBudget"] = {}
all_vectors = set()
for i in range(2):
    hashes = []
    for probe in ["base", "cache256"]:
        name = f"cache-{probe}-{i}"
        data = read(name)
        telemetry = data["telemetry"]
        vectors = {tuple(t["count"] for t in f["tiles"]) for f in telemetry["frames"]}
        assert len(vectors) == 1
        all_vectors.update(vectors)
        hashes.append(image_hash(name))
        summary["cacheBudget"][name] = {**metrics(data), "imageHash": hashes[-1],
            "steadyCounters": {k: telemetry[k] - telemetry["before"][k] for k in ["sorts", "misses", "bytesSent"]}}
    assert hashes[0] == hashes[1]
assert len(all_vectors) == 1
summary["cacheCountVector"] = list(next(iter(all_vectors)))

profile = json.loads((ROOT / "streaming-attribution-retry.cpuprofile").read_text())
nodes = {n["id"]: n for n in profile["nodes"]}
cost = {}
for node_id, dt in zip(profile["samples"], profile["timeDeltas"]):
    frame = nodes[node_id]["callFrame"]
    key = (frame["functionName"], frame["url"].split("/")[-1], frame["lineNumber"])
    cost[key] = cost.get(key, 0) + dt / 1000
summary["cpuSelfTimeTop"] = [{"function": k[0], "file": k[1], "line": k[2]+1, "sampledMs": v}
    for k, v in sorted(cost.items(), key=lambda x: -x[1])[:25]]
summary["failedAttempts"] = sorted(p.name for p in ROOT.glob("*-failed-*.json"))
DEST.mkdir(parents=True, exist_ok=True)
(DEST / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({"visibility": summary["visibility"], "cacheCountVector": summary["cacheCountVector"], "cpuSelfTimeTop": summary["cpuSelfTimeTop"][:12]}, indent=2))
