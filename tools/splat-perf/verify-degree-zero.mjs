import {readFileSync} from "node:fs";
import {chromium} from "@playwright/test";
const source=process.argv[2],target=process.argv[3];
const manifest=JSON.parse(readFileSync(`${target}/fixture-manifest.json`,"utf8"));
const files=[0,Math.floor(manifest.files.length/2),manifest.files.length-1].map(i=>manifest.files[i].file);
const browser=await chromium.launch({channel:"chromium",headless:true});
try {
  const page=await browser.newPage();await page.goto("http://127.0.0.1:8099/package.json");
  const records=await page.evaluate(async ({source,target,files})=> {
    const moduleUrl=new URL("/node_modules/@spz-loader/core/dist/index.js",location.href).href;
    const {loadSpz}=await import(moduleUrl);
    function check(value,message){if(!value){throw new Error(message);}}
    async function read(name) {
      const data=await (await fetch(name)).arrayBuffer(),length=new DataView(data).getUint32(12,true),gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,length)));
      const primitive=gltf.meshes[0].primitives[0],view=gltf.bufferViews[primitive.extensions.KHR_gaussian_splatting.extensions.KHR_gaussian_splatting_compression_spz_2.bufferView];
      return {cloud:await loadSpz(new Uint8Array(data,28+length+(view.byteOffset||0),view.byteLength)),primitive};
    }
    const results=[];
    for(const file of files){
      const a=await read(`${source}/${file}`),b=await read(`${target}/${file}`);
      check(b.cloud.shDegree===0&&b.cloud.sh.length===0,"Wrong decoded degree");
      check(a.cloud.numPoints===b.cloud.numPoints,"Point count changed");
      check(!Object.keys(b.primitive.attributes).some(k=>k.includes("SH_DEGREE_")),"SH attributes remain");
      for(const field of ["positions","scales","rotations","alphas","colors"]){
        const x=new Uint8Array(a.cloud[field].buffer),y=new Uint8Array(b.cloud[field].buffer);
        check(x.length===y.length&&x.every((v,i)=>v===y[i]),`Changed ${field}`);
      }
      results.push({file,points:b.cloud.numPoints,degree:0,geometryAndBaseColorIdentical:true});
    }
    return results;
  },{source:`/splat-data/oracle-run/${source.split("/").pop()}`,target:`/splat-data/oracle-run/${target.split("/").pop()}`,files});
  console.log(JSON.stringify(records,null,2));
} finally {await browser.close();}
