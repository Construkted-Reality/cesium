import { deflateSync } from "node:zlib";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, crc]);
}

// Deterministic, poorly compressible texture. No external assets or tokens.
function texture(seed, size) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  let random = seed + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * (1 + size * 4) + 1 + x * 4;
      for (let channel = 0; channel < 3; channel++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        pixels[offset + channel] = random >>> 24;
      }
      pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createFixture({ count = 8, textureSize = 512 } = {}) {
  const files = new Map();
  const positions = new Float32Array([
    -100, 0, -100, 100, 0, -100, 100, 0, 100, -100, 0, 100,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2]);
  const binary = Buffer.concat([
    Buffer.from(positions.buffer),
    Buffer.from(uv.buffer),
    Buffer.from(indices.buffer),
  ]);
  const children = [];
  for (let index = 0; index < count; index++) {
    const name = String(index);
    const gltf = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0, TEXCOORD_0: 1 },
              indices: 2,
              material: 0,
            },
          ],
        },
      ],
      buffers: [{ uri: `${name}.bin`, byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 48 },
        { buffer: 0, byteOffset: 48, byteLength: 32 },
        { buffer: 0, byteOffset: 80, byteLength: 12 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: "VEC3",
          min: [-100, 0, -100],
          max: [100, 0, 100],
        },
        { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" },
        { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
      ],
      images: [{ uri: `${name}.png` }],
      textures: [{ source: 0 }],
      materials: [
        {
          doubleSided: true,
          extensions: { KHR_materials_unlit: {} },
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
            metallicFactor: 0,
          },
        },
      ],
      extensionsUsed: ["KHR_materials_unlit"],
    };
    files.set(`${name}.gltf`, Buffer.from(JSON.stringify(gltf)));
    files.set(`${name}.bin`, binary);
    files.set(`${name}.png`, texture(index, textureSize));
    children.push({
      boundingVolume: {
        box: [index * 1000, 0, 0, 101, 0, 0, 0, 101, 0, 0, 0, 2],
      },
      geometricError: 0,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, index * 1000, 0, 0, 1],
      content: { uri: `${name}.gltf` },
    });
    // Child bounds are expressed before its transform.
    children[index].boundingVolume.box[0] = 0;
  }
  files.set(
    "tileset.json",
    Buffer.from(
      JSON.stringify({
        asset: { version: "1.1" },
        geometricError: 10000,
        root: {
          transform: [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 6378137, 0, 0, 1],
          boundingVolume: {
            box: [
              (count - 1) * 500,
              0,
              0,
              count * 500,
              0,
              0,
              0,
              101,
              0,
              0,
              0,
              2,
            ],
          },
          geometricError: 10000,
          refine: "REPLACE",
          children,
        },
      }),
    ),
  );
  return files;
}
