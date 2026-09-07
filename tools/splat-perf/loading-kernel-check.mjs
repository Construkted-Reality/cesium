import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {packDirect as prototypePack,prepareCloud} from "./loading-kernels.mjs";
const packDirect = process.argv.includes("--production") ? (await import("../../packages/engine/Source/Scene/packSpzSphericalHarmonics.js")).default : prototypePack;
const source=readFileSync("packages/engine/Source/Scene/GaussianSplat3DTileContent.js","utf8");
const fn=(name)=>{const a=source.indexOf(`function ${name}(`);return source.slice(a,source.indexOf("\n}",a)+2);};
const half=new Function(`const floatView=new Float32Array(1),intView=new Uint32Array(floatView.buffer);${fn("float32ToFloat16")};return float32ToFloat16;`)();
const baseline=new Function("float32ToFloat16","extractSHDegreeAndCoef","defined",`${fn("packSphericalHarmonicsData")};return packSphericalHarmonicsData;`)(half,n=>{const m=/SH_DEGREE_(\d+)_COEF_(\d+)/.exec(n);return {l:+m[1],n:+m[2]};}, value => value !== undefined);
const results=[];
for(const degree of [0,1,2,3]) {
  const count=262144,stride=[0,9,24,45][degree],sh=new Float32Array(count*stride);
  const edge=[0,-0,NaN,Infinity,-Infinity,1e-40,-1e-40,65504,1e10,-1e10];
  for(let i=0;i<sh.length;i++){sh[i]=i<edge.length?edge[i]:Math.sin(i)*2;}
  const attributes=[];
  for(let l=1;l<=degree;l++){for(let n=0;n<2*l+1;n++) {
    const a=new Float32Array(count*3),offset=[0,9,24][l-1]+3*n;
    for(let i=0;i<count;i++){for(let c=0;c<3;c++){a[3*i+c]=sh[i*stride+offset+c];}}
    attributes.push({name:`KHR_gaussian_splatting:SH_DEGREE_${l}_COEF_${n}`,typedArray:a});
  }}
  const tile={sphericalHarmonicsDegree:degree,sphericalHarmonicsCoefficientCount:stride,pointsLength:count,gltfPrimitive:{attributes}};
  const cloud={numPoints:count,shDegree:degree,sh};const expected=baseline(tile),direct=packDirect(cloud);
  assert.deepEqual(direct,expected);
  const times=[];
  for(let i=0;i<(process.argv.includes("--verify-only")?0:4);i++){for(const label of (i%2?["direct","baseline"]:["baseline","direct"])) {
    const start=performance.now();const result=label==="direct"?packDirect(cloud):baseline(tile);
    assert.equal(result.length,expected.length);times.push({label,ms:performance.now()-start});
  }}
  if(degree>0) {const fallback={...cloud};prepareCloud(fallback,[]);assert.equal(fallback.sh,sh);assert.equal(fallback.__packedSH,undefined);}
  results.push({degree,count,identical:true,avoidedAttributeBytes:sh.byteLength,packedBytes:direct.byteLength,times});
}
assert.throws(()=>packDirect({shDegree:3,numPoints:5,sh:new Float32Array(1)}));
writeFileSync(`${process.env.SPLAT_RESULTS || "/mnt/data2/cesium-splat-perf/loading-experiment-results"}/${process.argv.includes("--verify-only")?"kernel-verification":"kernel-check"}.json`,JSON.stringify(results,null,2));
console.log("All four degrees and edge values match. Mismatched schemas use the baseline path.");
