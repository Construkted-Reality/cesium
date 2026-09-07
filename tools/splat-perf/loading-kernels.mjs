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
export function packDirect(gcloud) {
  const stride = [0,9,24,45][gcloud.shDegree];
  if(stride === undefined || gcloud.sh.length !== gcloud.numPoints*stride){throw new Error("Invalid SH layout");}
  if(stride===0){return new Uint32Array(0);}
  const padded = Math.ceil(stride/4)*4;
  const packed = new Uint32Array(gcloud.numPoints*padded/2);
  for(let i=0;i<gcloud.numPoints;i++) {
    const src=i*stride, dst=i*padded/2;
    for(let j=0;j<stride;j+=2) {
      packed[dst+(j>>>1)] = float32ToFloat16(gcloud.sh[src+j]) | ((j+1<stride ? float32ToFloat16(gcloud.sh[src+j+1]):0)<<16);
    }
  }
  return packed;
}
export function prepareCloud(cloud, schema) {
  if(schema) {
    const expected=[];
    for(let degree=1;degree<=cloud.shDegree;degree++){for(let n=0;n<2*degree+1;n++){expected.push(`${degree}:${n}`);}}
    if(schema.length!==expected.length || expected.some(k=>!schema.includes(k))){return cloud;}
  }
  cloud.__packedSH=packDirect(cloud);
  // The prototype passes packed data through metadata on SH attribute placeholders.
  // A production implementation needs an explicit loader/component field instead.
  delete cloud.sh;
  return cloud;
}
