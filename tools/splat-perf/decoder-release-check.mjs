/* global Cesium */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";
const out=process.env.SPLAT_RESULTS;
if(!out){throw new Error("SPLAT_RESULTS is required");}
const html=readFileSync("tools/splat-perf/loading-harness.html","utf8").replaceAll("Build/CesiumUnminified","Build/Cesium");
const results=[];
const wayland=process.env.SPLAT_RELEASE_BACKEND==="gl";
const warmGpu=process.env.SPLAT_WARM_GPU==="1";
for(const asset of ["geo-newdefault","geo-degree0-validation"]) {
  const browser=await chromium.launch({channel:"chromium",headless:!wayland,args:wayland?GPU_LAUNCH_ARGS.filter(a=>!a.startsWith("--use-angle=")&&!a.startsWith("--enable-features=")).concat(["--use-angle=gl","--ozone-platform=wayland"]):GPU_LAUNCH_ARGS,...(wayland?{env:{...process.env,XDG_RUNTIME_DIR:process.env.SPLAT_WAYLAND_RUNTIME,WAYLAND_DISPLAY:"splat-wayland",__EGL_VENDOR_LIBRARY_FILENAMES:"/usr/share/glvnd/egl_vendor.d/10_nvidia.json"}}:{})});
  let page; const errors=[]; const messages=[];
  try {
    page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:1});
    page.on("pageerror",e=>errors.push(String(e)));
    page.on("console",m=>{if(m.type()==="error"){messages.push(m.text());}});
    if(warmGpu) {
      await page.goto("http://127.0.0.1:8099/package.json");
      await page.evaluate(async()=> {
        const canvas=document.createElement("canvas");document.body.append(canvas);
        const gl=canvas.getContext("webgl2",{preserveDrawingBuffer:true,powerPreference:"high-performance"});
        if(!gl){throw new Error("GPU warmup failed");}
        gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.finish();
        await new Promise(r=>setTimeout(r,1000));
        if(gl.isContextLost()){throw new Error("GPU warmup lost context");}
      });
    }
    await page.route("**/loading-harness.html?*",route=>route.fulfill({body:html,contentType:"text/html"}));
    const query=new URLSearchParams({tileset:`/splat-data/oracle-run/${asset}/tileset.json`,production:"candidate",mode:"static",sse:"8",frames:"30",warmup:"120",capture:"1"});
    await page.goto(`http://127.0.0.1:8099/tools/splat-perf/loading-harness.html?${query}`);
    await page.waitForFunction(()=>window.__benchResult||window.__benchError,null,{timeout:180000});
    await page.waitForFunction(()=>window.__benchError || (window.__round2Tilesets.every(t=>t.tilesLoaded) && window.__splatPrimitive?._numSplats===545605 && !window.__splatPrimitive?._pendingSnapshot),null,{timeout:60000});
    const result=await page.evaluate(async asset=> {
      if(window.__benchError){throw new Error(window.__benchError);}
      const C=Cesium;
      const wait=()=>new Promise(r=>requestAnimationFrame(r));
      const start=performance.now();
      while(C.SpzDecoder._slots.some(s=>s.busy)){await wait();if(performance.now()-start>30000){throw new Error("Pool did not drain");}}
      const url=new URL(`/splat-data/oracle-run/${asset}/tileset.json`,location.href);
      const json=await(await fetch(url)).json();
      const content=t=>t.content?.uri||t.children?.map(content).find(Boolean);
      const bytes=await(await fetch(new URL(content(json.root),url))).arrayBuffer();
      const length=new DataView(bytes).getUint32(12,true);
      const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
      const primitive=gltf.meshes[0].primitives[0];
      const view=gltf.bufferViews[primitive.extensions.KHR_gaussian_splatting.extensions.KHR_gaussian_splatting_compression_spz_2.bufferView];
      const input=new Uint8Array(bytes,28+length+(view.byteOffset||0),view.byteLength);
      const degree=asset.includes("degree0")?0:3;
      let malformedRejected=false;
      try {await C.SpzDecoder.decode(new Uint8Array([1,2,3]),degree);}catch{malformedRejected=true;}
      const failed=C.SpzDecoder.decode(input,degree);
      C.SpzDecoder._slots.find(s=>s.busy).processor._worker.dispatchEvent(new ErrorEvent("error",{message:"Injected worker failure"}));
      let workerRejected=false;try{await failed;}catch{workerRejected=true;}
      const decoded=await C.SpzDecoder.decode(input,degree);
      if(!malformedRejected||!workerRejected||decoded.gcloud.shDegree!==degree||decoded.gcloud.sh.length!==decoded.gcloud.numPoints*[0,9,24,45][degree]||!decoded.packedSphericalHarmonics||!input.byteLength){throw new Error("Decode recovery or shared coefficient check failed");}
      const scene=window.__scene, gl=scene.context._gl;
      const pixels=await new Promise(resolve=> {
        const remove=scene.postRender.addEventListener(()=> {
          remove();const width=scene.drawingBufferWidth,height=scene.drawingBufferHeight;
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);const bytes=new Uint8Array(width*height*4);
          gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
          let binary="";for(let i=0;i<bytes.length;i+=32768){binary+=String.fromCharCode(...bytes.subarray(i,i+32768));}
          resolve({width,height,base64:btoa(binary)});
        });
      });
      return {bench:window.__benchResult,activePeak:window.__loadingStats.activePeak,malformedRejected,workerRejected,recoveredPoints:decoded.gcloud.numPoints,degree,glError:gl.getError(),settledCount:window.__splatPrimitive._numSplats,pixels};
    },asset);
    const pixels=Buffer.from(result.pixels.base64,"base64");delete result.pixels;
    if(result.glError||errors.length||!pixels.some((v,i)=>i%4!==3&&v!==0)||!result.bench.renderer.includes("NVIDIA")){throw new Error(JSON.stringify({result,errors}));}
    writeFileSync(`${out}/release-${asset}.raw`,pixels);
    results.push({...result,asset,errors,pixelSha256:createHash("sha256").update(pixels).digest("hex")});
    writeFileSync(`${out}/release-check.json`,JSON.stringify(results,null,2));
    console.log(asset,result.bench.splats,result.malformedRejected,result.workerRejected);
  } catch(error) {
    writeFileSync(`${out}/release-${asset}-failed.json`,JSON.stringify({error:String(error),errors,messages,state:await page?.evaluate(()=>({phase:window.__benchPhase,telemetry:window.__telemetry,loading:window.__loadingStats,contextLost:window.__scene?.context?._gl.isContextLost(),drawing:[window.__scene?.drawingBufferWidth,window.__scene?.drawingBufferHeight]})).catch(()=>null)},null,2));
    throw error;
  } finally {await browser.close();}
}
