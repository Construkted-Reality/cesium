"""Create reviewable measurements from the five worker validation experiments."""
import hashlib
import json
import pathlib
import statistics
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
    row = {"label": path.stem, "run": value["run"],
           "totalLoadMs": bench["totalLoadMs"], "frameMs": bench["frameMs"],
           "gpuMs": bench["gpuMs"], "splats": bench["splats"],
           "renderer": bench["renderer"], "errors": value["errors"],
           "glError": value.get("glError"), "sourceHashes": value.get("sourceHashes"),
           "snapshotBuilds": len(value.get("snapshotTrace", [])),
           "tileLoads": value["telemetry"].get("tileLoads"),
           "tileUnloads": value["telemetry"].get("tileUnloads"),
           "heap": value["heap"], "worker": value["worker"],
           "timingExcluded": path.stem.startswith(("invalidation-", "turn-"))}
    if "hostBefore" in value:
        delta = [b-a for a,b in zip(value["hostBefore"]["cpuTicks"], value["hostAfter"]["cpuTicks"])]
        row["hostBusyFraction"] = 1-(delta[3]+delta[4])/sum(delta[:8])
    raw = path.with_suffix(".raw")
    if raw.exists():
        row["pixelSha256"] = hashlib.sha256(raw.read_bytes()).hexdigest()
    if "cancellation" in value:
        row["cancellation"] = value["cancellation"]
    if "turn" in value:
        turn = value["turn"]
        row["turn"] = {"samples": len(turn), "blankSamples": sum(r["coverage"] == 0 for r in turn), "last": turn[-1]}
    startup = value["loading"].get("startup", [])
    if startup:
        row["startupFrameP95"] = sorted(r["dt"] for r in startup)[int(.95*(len(startup)-1))]
        row["firstVisibleFromFirstStartupSampleMs"] = [next((r["t"]-startup[0]["t"] for r in startup if len(r["tiles"])>i and r["tiles"][i]["count"]>0), None) for i in range(int(value["run"].get("multi",1)))]
    if "jobs" in value["loading"]:
        jobs=value["loading"]["jobs"]
        row["jobsByAsset"]={asset:{"count":sum(j.get("asset")==asset for j in jobs), "maximumQueueMs":max(j["queuedMs"] for j in jobs if j.get("asset")==asset)} for asset in sorted({j.get("asset", "unknown") for j in jobs})}
    if "lifecycle" in value:
        row["lifecycle"] = [{k:v for k,v in r.items() if k != "state"} | {"gl":r["state"]["gl"],"telemetryLengths":r["state"].get("telemetryLengths")} for r in value["lifecycle"]]
    profiles = [r for worker in value.get("decoderProfiles", []) for r in worker]
    if profiles:
        row["decoderProfile"]={k:sum(r[k] for r in profiles) for k in ["initMs","inputMs","nativeMs","convertMs","cleanupMs"]}
        row["decoderProfile"]["jobs"]=len(profiles)
    rows.append(row)
(output/"measurements.json").write_text(json.dumps(rows,indent=2)+"\n")
for asset in ["geo-newdefault","bike-newdefault"]:
    for variant in ["candidate","worker"]:
        selected=[r for r in rows if r["label"].startswith(f"production-pool-{asset}-{variant}-")]
        if selected:
            print(asset,variant,"load",statistics.mean(r["totalLoadMs"] for r in selected),"startup p95",[r.get("startupFrameP95") for r in selected])
