"""Summarize production pool measurements without retaining image payloads."""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
rows = []
for path in sorted(root.glob("*.json")):
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or "bench" not in value or "run" not in value:
        continue
    bench = value["bench"]
    row = {"label": path.stem, "run": value["run"], "bench": {k: v for k, v in bench.items() if k != "raw"},
           "errors": value["errors"], "glError": value["glError"],
           "sourceHashes": value.get("sourceHashes"), "heap": value["heap"],
           "worker": value["worker"], "poolValidation": value.get("poolValidation"),
           "loading": {k: v for k, v in value["loading"].items() if k != "startup"},
           "tileLoads": value["telemetry"].get("tileLoads"), "tileUnloads": value["telemetry"].get("tileUnloads")}
    startup = value["loading"].get("startup", [])
    if startup:
        count = bench["splats"]["numSplats"]
        origin = startup[0]["t"]
        row["startup"] = {"firstSampleMs": origin,
            "frameP95Ms": sorted(r["dt"] for r in startup)[int(.95*(len(startup)-1))],
            "firstVisibleMs": next((r["t"]-origin for r in startup if r["tiles"][0]["count"] > 0), None),
            "completeCountFrameMs": next((r["t"]-origin for r in startup if r["tiles"][0]["count"] == count and r["tiles"][0]["loaded"] and not r["tiles"][0]["pending"]), None),
            "firstVisibleByTilesetMs": [next((r["t"]-origin for r in startup if len(r["tiles"]) > i and r["tiles"][i]["count"] > 0), None) for i in range(int(value["run"].get("multi", 1)))]}
    if "hostBefore" in value:
        delta = [b-a for a,b in zip(value["hostBefore"]["cpuTicks"], value["hostAfter"]["cpuTicks"])]
        row["hostBusyFraction"] = 1-(delta[3]+delta[4])/sum(delta[:8])
    raw = path.with_suffix(".raw")
    if raw.exists():
        row["pixelSha256"] = hashlib.sha256(raw.read_bytes()).hexdigest()
    if "turn" in value:
        row["turn"] = {"samples":len(value["turn"]), "blankSamples":sum(r["coverage"] == 0 for r in value["turn"]), "last":value["turn"][-1]}
    if "lifecycle" in value:
        row["lifecycle"] = []
        for r in value["lifecycle"]:
            g = r["state"]["gl"]
            live = {k.removeprefix("create"):g[k]-g.get(k.replace("create", "delete"),0) for k in g if k.startswith("create")}
            if r["stage"] == "removed":
                assert all(w["keys"] == w["bytes"] == 0 for w in r["worker"])
            row["lifecycle"].append({k:v for k,v in r.items() if k != "state"} | {"liveGl":live})
        removed = [r for r in row["lifecycle"] if r["stage"] == "removed"]
        assert all(r["liveGl"] == removed[0]["liveGl"] for r in removed)
    assert not row["errors"] and row["glError"] == 0, path
    rows.append(row)
(output/"measurements.json").write_text(json.dumps(rows,indent=2)+"\n")
print(f"Summarized {len(rows)} successful browser cases")
