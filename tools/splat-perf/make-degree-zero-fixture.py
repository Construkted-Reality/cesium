"""Derive a valid degree-0 SPZ tileset while preserving geometry and base color."""
import gzip
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:3])
assert source.resolve() != target.resolve()
assert not target.exists(), "Refuse to overwrite an existing fixture"
target.mkdir(parents=True)
records = []
for path in source.rglob("*"):
    dest = target / path.relative_to(source)
    if path.is_dir():
        dest.mkdir(exist_ok=True)
    elif path.suffix != ".glb":
        shutil.copy2(path, dest)
    else:
        data = path.read_bytes()
        magic, version, size = struct.unpack_from("<III", data)
        assert magic == 0x46546c67 and version == 2 and size == len(data)
        length, kind = struct.unpack_from("<II", data, 12)
        assert kind == 0x4e4f534a
        gltf = json.loads(data[20:20+length])
        primitive = gltf["meshes"][0]["primitives"][0]
        extension = primitive["extensions"]["KHR_gaussian_splatting"]["extensions"]["KHR_gaussian_splatting_compression_spz_2"]
        view = gltf["bufferViews"][extension["bufferView"]]
        assert len(gltf["bufferViews"]) == len(gltf["buffers"]) == 1 and view.get("byteOffset", 0) == 0
        raw = bytearray(gzip.decompress(data[28+length:28+length+view["byteLength"]]))
        signature, spz_version, points, degree, fractional_bits, flags, reserved = struct.unpack_from("<IIIBBBB", raw)
        assert signature == 0x5053474e and spz_version == 3 and degree in [1,2,3]
        sh_bytes = points * [0,9,24,45][degree]
        assert len(raw) == 16 + points * 20 + sh_bytes
        raw[12] = 0
        raw = raw[:16 + points * 20]
        packed = gzip.compress(raw, mtime=0)
        primitive["attributes"] = {k:v for k,v in primitive["attributes"].items() if "SH_DEGREE_" not in k}
        view["byteLength"] = len(packed)
        gltf["buffers"][0]["byteLength"] = len(packed)
        js = json.dumps(gltf, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        binary = packed + bytes(-len(packed) % 4)
        result = struct.pack("<III", magic, version, 28 + len(js) + len(binary)) + struct.pack("<II", len(js), kind) + js + struct.pack("<II", len(binary), 0x004e4942) + binary
        dest.write_bytes(result)
        records.append({"file":str(path.relative_to(source)),"points":points,"sourceSha256":hashlib.sha256(data).hexdigest(),"fixtureSha256":hashlib.sha256(result).hexdigest()})
(target / "fixture-manifest.json").write_text(json.dumps({"source":str(source),"method":"Remove degree-1 through degree-3 coefficients from SPZ version 3. Preserve all other packed bytes.","files":records},indent=2))
print(f"Created {len(records)} degree-0 GLB files in {target}")
