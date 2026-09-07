import RuntimeError from "../Core/RuntimeError.js";
const floatView = new Float32Array(1);
const intView = new Uint32Array(floatView.buffer);
function float32ToFloat16(float32) {
  floatView[0] = float32;
  const bits = intView[0];

  const sign = (bits >> 31) & 0x1;
  const exponent = (bits >> 23) & 0xff;
  const mantissa = bits & 0x7fffff;

  let half;

  if (exponent === 0xff) {
    half = (sign << 15) | (0x1f << 10) | (mantissa ? 0x200 : 0);
  } else if (exponent === 0) {
    half = sign << 15;
  } else {
    const newExponent = exponent - 127 + 15;
    if (newExponent >= 31) {
      half = (sign << 15) | (0x1f << 10);
    } else if (newExponent <= 0) {
      half = sign << 15;
    } else {
      half = (sign << 15) | (newExponent << 10) | (mantissa >>> 13);
    }
  }

  return half;
}

/** Pack point-major SPZ coefficients into the renderer's half-float layout. @private */
export function packSpzSphericalHarmonics(cloud) {
  const stride = [0, 9, 24, 45][cloud.shDegree];
  if (
    !Number.isInteger(cloud.shDegree) ||
    stride === undefined ||
    !Number.isSafeInteger(cloud.numPoints) ||
    cloud.numPoints < 0 ||
    cloud.sh.length !== cloud.numPoints * stride
  ) {
    throw new RuntimeError("Invalid SPZ spherical harmonics layout.");
  }
  const words = Math.ceil(stride / 4) * 2;
  const packed = new Uint32Array(cloud.numPoints * words);
  for (let point = 0; point < cloud.numPoints; point++) {
    for (let offset = 0; offset < stride; offset += 2) {
      const source = point * stride + offset;
      const high =
        offset + 1 < stride ? float32ToFloat16(cloud.sh[source + 1]) : 0;
      packed[point * words + (offset >>> 1)] =
        float32ToFloat16(cloud.sh[source]) | (high << 16);
    }
  }
  return packed;
}

/** Return a complete, supported SH schema's degree, or undefined for the existing path. @private */
export function getPackedSphericalHarmonicsDegree(attributes) {
  const names = Object.keys(attributes).filter((name) =>
    name.includes("SH_DEGREE_"),
  );
  const degree = [0, 3, 8, 15].indexOf(names.length);
  if (degree <= 0) {
    return undefined;
  }
  const found = new Set();
  for (const name of names) {
    const match =
      /^(?:KHR_gaussian_splatting:|_)SH_DEGREE_([1-3])_COEF_([0-6])$/.exec(
        name,
      );
    if (
      !match ||
      Number(match[1]) > degree ||
      Number(match[2]) >= 2 * Number(match[1]) + 1
    ) {
      return undefined;
    }
    found.add(`${match[1]}:${match[2]}`);
  }
  return found.size === names.length ? degree : undefined;
}

export default packSpzSphericalHarmonics;
