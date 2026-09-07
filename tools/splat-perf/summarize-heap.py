"""Summarize V8 node groups and representative strong retaining paths."""
import collections
import json
import pathlib
import sys


def summarize(path):
    data = json.loads(path.read_text())
    meta = data["snapshot"]["meta"]
    fields = meta["node_fields"]
    width = len(fields)
    nodes, strings = data["nodes"], data["strings"]
    types = meta["node_types"][0]
    groups = collections.defaultdict(lambda: [0, 0])
    labels = []
    targets = {}
    for index in range(0, len(nodes), width):
        kind = types[nodes[index + fields.index("type")]]
        name = strings[nodes[index + fields.index("name")]]
        groups[kind + ":" + name][0] += 1
        groups[kind + ":" + name][1] += nodes[index + fields.index("self_size")]
        labels.append(kind + ":" + name)
        if "NetworkResourcesData::ResourceData" in name:
            targets.setdefault(name, index // width)
    edge_fields = meta["edge_fields"]
    edge_width = len(edge_fields)
    edge_types = meta["edge_types"][0]
    edges = data["edges"]
    offsets = [0]
    for index in range(0, len(nodes), width):
        offsets.append(offsets[-1] + nodes[index + fields.index("edge_count")] * edge_width)
    parents = {0: None}
    queue = collections.deque([0])
    remaining = set(targets.values())
    while queue and remaining:
        source = queue.popleft()
        remaining.discard(source)
        for e in range(offsets[source], offsets[source + 1], edge_width):
            kind = edge_types[edges[e + edge_fields.index("type")]]
            if kind == "weak":
                continue
            target = edges[e + edge_fields.index("to_node")] // width
            if target not in parents:
                name = edges[e + edge_fields.index("name_or_index")]
                name = name if kind in ("element", "hidden") else strings[name]
                parents[target] = (source, str(name))
                queue.append(target)
    paths = {}
    for name, target in targets.items():
        chain = []
        while target in parents and parents[target] is not None:
            source, edge = parents[target]
            chain.append({"node": labels[target], "edge": edge})
            target = source
        paths[name] = list(reversed(chain))
    return {"file": path.name, "groups": dict(groups), "retainingPaths": paths}


results = [summarize(pathlib.Path(p)) for p in sys.argv[1:]]
base = results[0]["groups"]
for result in results[1:]:
    keys = set(base) | set(result["groups"])
    result["largestGrowthFromFirst"] = sorted(
        ({"group": k,
          "count": result["groups"].get(k, [0, 0])[0] - base.get(k, [0, 0])[0],
          "bytes": result["groups"].get(k, [0, 0])[1] - base.get(k, [0, 0])[1]}
         for k in keys), key=lambda r: r["bytes"], reverse=True)[:30]
print(json.dumps(results, indent=2))
