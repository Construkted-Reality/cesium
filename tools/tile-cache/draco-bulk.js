// This fragment is appended to the diagnostic worker by draco-build.mjs.
// It uses that worker's Draco module and original extraction functions.
/* global draco, verifyExtraction, original_decodeIndexArray,
  original_decodeQuantizedDracoTypedArray, original_decodeDracoTypedArray */
function copyHeap(Type, length, fill) {
  const bytes = length * Type.BYTES_PER_ELEMENT;
  const pointer = draco._malloc(bytes);
  try {
    if (!fill(pointer, bytes)) {
      throw new Error("Draco bulk extraction failed");
    }
    // Read HEAPU8 after the API call in case WebAssembly memory grew.
    return new Type(draco.HEAPU8.buffer, pointer, length).slice();
  } finally {
    draco._free(pointer);
  }
}
function checkEqual(actual, expected) {
  if (
    actual.constructor !== expected.constructor ||
    actual.byteLength !== expected.byteLength
  ) {
    throw new Error("Bulk extraction type or length differs");
  }
  const a = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const b = new Uint8Array(
    expected.buffer,
    expected.byteOffset,
    expected.byteLength,
  );
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`Bulk extraction differs at byte ${i}`);
    }
  }
}
export function bulk_decodeIndexArray(geometry, decoder) {
  const count = geometry.num_faces() * 3;
  const Type = geometry.num_points() >= 65536 ? Uint32Array : Uint16Array;
  const array = copyHeap(Type, count, (pointer, bytes) =>
    Type === Uint16Array
      ? decoder.GetTrianglesUInt16Array(geometry, bytes, pointer)
      : decoder.GetTrianglesUInt32Array(geometry, bytes, pointer),
  );
  if (verifyExtraction) {
    checkEqual(array, original_decodeIndexArray(geometry, decoder).typedArray);
  }
  return { typedArray: array, numberOfIndices: count };
}
function bulkAttribute(geometry, decoder, attribute, length, Type, dataType) {
  return copyHeap(Type, length, (pointer, bytes) =>
    decoder.GetAttributeDataArrayForAllPoints(
      geometry,
      attribute,
      dataType,
      bytes,
      pointer,
    ),
  );
}
export function bulk_decodeQuantizedDracoTypedArray(
  geometry,
  decoder,
  attribute,
  quantization,
  length,
) {
  const bits = quantization.quantizationBits;
  const Type = bits <= 8 ? Uint8Array : bits <= 16 ? Uint16Array : Float32Array;
  const dataType =
    bits <= 8
      ? draco.DT_UINT8
      : bits <= 16
        ? draco.DT_UINT16
        : draco.DT_FLOAT32;
  const array = bulkAttribute(
    geometry,
    decoder,
    attribute,
    length,
    Type,
    dataType,
  );
  if (verifyExtraction) {
    checkEqual(
      array,
      original_decodeQuantizedDracoTypedArray(
        geometry,
        decoder,
        attribute,
        quantization,
        length,
      ),
    );
  }
  return array;
}
export function bulk_decodeDracoTypedArray(
  geometry,
  decoder,
  attribute,
  length,
) {
  const types = {
    1: [Int8Array, draco.DT_INT8],
    11: [Int8Array, draco.DT_INT8],
    2: [Uint8Array, draco.DT_UINT8],
    3: [Int16Array, draco.DT_INT16],
    4: [Uint16Array, draco.DT_UINT16],
    5: [Int32Array, draco.DT_INT32],
    7: [Int32Array, draco.DT_INT32],
    6: [Uint32Array, draco.DT_UINT32],
    8: [Uint32Array, draco.DT_UINT32],
    9: [Float32Array, draco.DT_FLOAT32],
    10: [Float32Array, draco.DT_FLOAT32],
  };
  const [Type, dataType] = types[attribute.data_type()];
  const array = bulkAttribute(
    geometry,
    decoder,
    attribute,
    length,
    Type,
    dataType,
  );
  if (verifyExtraction) {
    checkEqual(
      array,
      original_decodeDracoTypedArray(geometry, decoder, attribute, length),
    );
  }
  return array;
}
