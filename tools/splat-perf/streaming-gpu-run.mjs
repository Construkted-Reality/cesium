/* global Cesium */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";
const out = "/mnt/data2/cesium-splat-perf/streaming-gpu-results";
const runs = JSON.parse(readFileSync(process.argv[2], "utf8"));
mkdirSync(out, {recursive:true});
const clock = () => execFileSync("nvidia-smi", ["--query-gpu=clocks.gr,clocks.mem,temperature.gpu,memory.used", "--format=csv,noheader"], {encoding:"utf8"}).trim();
for (const run of runs) {
  for (let attempt=0; attempt<3; attempt++) {
    const browser = await chromium.launch({headless:true, channel:"chromium",args:GPU_LAUNCH_ARGS});
    const context = await browser.newContext({viewport:{width:Number(run.width||1920),height:Number(run.height||1080)},deviceScaleFactor:1});
    const errors=[]; const before=clock();
    await context.route("**/Workers/gaussianSplatSorter.js", async route => {
      const response=await route.fetch(); let body=await response.text();
      if(run.probe === "cache256") {
        const budget="GaussianSplatPositionCache.maximumByteLength = 128 * 1024 * 1024;";
        if(!body.includes(budget)){throw new Error("Cache budget anchor missing");}
        body=body.replace(budget,"GaussianSplatPositionCache.maximumByteLength = 256 * 1024 * 1024;");
      }
      const anchor="var cachedPositions = new GaussianSplatPositionCache_default();";
      if (!body.includes(anchor)) {throw new Error("Worker instrumentation anchor missing");}
      body=body.replace(anchor, `${anchor}
globalThis.__cacheProbe = {cache:cachedPositions,peak:0,sets:0,releases:0};
const originalSet = cachedPositions.set.bind(cachedPositions);
cachedPositions.set = function(...args) { originalSet(...args); globalThis.__cacheProbe.sets++; globalThis.__cacheProbe.peak = Math.max(globalThis.__cacheProbe.peak,this.byteLength); };`);
      body=body.replace("cachedPositions.remove(key);", "globalThis.__cacheProbe.releases++; cachedPositions.remove(key);");
      await route.fulfill({response,body});
    });
    const page=await context.newPage();
    page.on("pageerror",e=>errors.push(String(e)));
    page.on("console",m=> { if(m.type()==="error" && !m.text().includes("404")){errors.push(m.text());} });
    const cdp=await context.newCDPSession(page);
    const liveTimer=setInterval(async()=> {
      try { const state=await page.evaluate(()=>({phase:window.__benchPhase,error:window.__benchError,tiles:window.__round2Tilesets?.map(t=>t.isDestroyed()?{destroyed:true}:{loaded:t.tilesLoaded,count:t.gaussianSplatPrimitive?._numSplats,pending:t.gaussianSplatPrimitive?._pendingSnapshot?.state,sorter:t.gaussianSplatPrimitive?._sorterState}),builds:window.__telemetry?.builds}));writeFileSync(`${out}/${run.label}-live.json`,JSON.stringify({state,errors})); } catch { /* The page can close while a status sample is pending. */ }
    },5000);
    const cache=async()=> {
      const result=[];
      for (const w of page.workers()) { const value=await w.evaluate(()=> { const p=globalThis.__cacheProbe;return p?{bytes:p.cache.byteLength,keys:p.cache._entries.size,peak:p.peak,sets:p.sets,releases:p.releases,budget:p.cache.maximumByteLength}:null; }); if(value) {result.push(value);} }
      return result;
    };
    try {
      if(run.profileCPU==="1") {await cdp.send("Profiler.enable");}
      const query=new URLSearchParams({tileset:"/splat-data/oracle-run/geo-newdefault/tileset.json",sse:"4",frames:"400",warmup:"120",mode:"orbit",...run});
      await page.goto(`http://127.0.0.1:8099/tools/splat-perf/streaming-gpu-harness.html?${query}`,{waitUntil:"domcontentloaded"});
      if(run.profileCPU==="1") {
        await page.waitForFunction(()=>window.__benchPhase==="measuring"||window.__benchError,null,{timeout:240000,polling:50});
        await cdp.send("Profiler.start");
      }
      await page.waitForFunction(()=>window.__benchResult||window.__benchError,null,{timeout:240000});
      const failure=await page.evaluate(()=>window.__benchError); if(failure) {throw new Error(failure);}
      const result=await page.evaluate(()=>({bench:window.__benchResult,telemetry:window.__telemetry}));
      result.worker=await cache();
      if(run.profileCPU==="1") {const profile=await cdp.send("Profiler.stop");writeFileSync(`${out}/${run.label}.cpuprofile`,JSON.stringify(profile.profile));}
      if (run.lifecycle === "1") {
        result.lifecycle=[];
        for(let cycle=0;cycle<4;cycle++) {
          if(cycle>0) {
            await page.evaluate(async()=> {
              const C=Cesium, scene=window.__scene, list=window.__round2Tilesets;
              for(let n=0;n<6;n++) {
                const t=await C.Cesium3DTileset.fromUrl("/splat-data/oracle-run/geo-newdefault/tileset.json",{maximumScreenSpaceError:4});
                scene.primitives.add(t);list.push(t);
              }
              const wait=()=>new Promise(r=>requestAnimationFrame(r));
              const started=performance.now();
              while(!list.every(t=>t.tilesLoaded&&t.gaussianSplatPrimitive?._numSplats>0&&!t.gaussianSplatPrimitive?._pendingSnapshot)) {
                await wait(); if(performance.now()-started>180000){throw new Error("Lifecycle reload timeout");}
              }
              for(let n=0;n<120;n++){await wait();}
            });
          }
          await cdp.send("HeapProfiler.collectGarbage");
          const loaded={cycle,stage:"loaded",worker:await cache(),heap:await cdp.send("Runtime.getHeapUsage"),state:await page.evaluate(()=>({gl:window.__telemetry.gl,tiles:window.__round2Tilesets.map(t=>({count:t.gaussianSplatPrimitive?._numSplats,bytes:t.totalMemoryUsageInBytes}))}))};
          result.lifecycle.push(loaded);
          await page.evaluate(async()=> {
            const scene=window.__scene, list=window.__round2Tilesets;
            for(const t of list) {scene.primitives.remove(t);if(!t.isDestroyed()){throw new Error("Tileset not destroyed");}}
            list.length=0;window.__splatPrimitive=null;
            for(let i=0;i<120;i++){await new Promise(r=>requestAnimationFrame(r));}
          });
          await cdp.send("HeapProfiler.collectGarbage");
          result.lifecycle.push({cycle,stage:"removed",worker:await cache(),heap:await cdp.send("Runtime.getHeapUsage"),state:await page.evaluate(()=>({gl:window.__telemetry.gl}))});
          writeFileSync(`${out}/${run.label}-partial.json`,JSON.stringify(result,null,2));
        }
      }
      if(run.capture==="1") {
        const pixels=await page.evaluate(()=>new Promise(resolve=> {
          const scene=window.__scene;
          const remove=scene.postRender.addEventListener(()=> {
            remove(); const gl=scene.context._gl,w=scene.drawingBufferWidth,h=scene.drawingBufferHeight;
            gl.bindFramebuffer(gl.FRAMEBUFFER,null);const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);
            let s="";for(let i=0;i<a.length;i+=32768){s+=String.fromCharCode(...a.subarray(i,i+32768));}
            resolve({w,h,data:btoa(s),nonzero:a.some((v,i)=>i%4!==3&&v!==0)});
          });
        }));
        if(!pixels.nonzero){throw new Error("Blank image capture");}
        writeFileSync(`${out}/${run.label}.raw`,Buffer.from(pixels.data,"base64"));
      }
      const glError=await page.evaluate(()=>window.__scene.context._gl.getError());
      if(glError!==0){throw new Error(`WebGL error: ${glError}`);}
      Object.assign(result,{run,errors,before,after:clock(),glError});
      writeFileSync(`${out}/${run.label}.json`,JSON.stringify(result,null,2));
      console.log(JSON.stringify({label:run.label,frame:result.bench.frameMs,gpu:result.bench.gpuMs,splats:result.bench.splats,worker:result.worker,errors}));
      break;
    } catch(e) {
      const state=await page.evaluate(()=>({phase:window.__benchPhase,error:window.__benchError,telemetry:window.__telemetry})).catch(()=>null);
      writeFileSync(`${out}/${run.label}-failed-${attempt}.json`,JSON.stringify({error:String(e),state,errors},null,2));
      if (!((String(e).includes("Expected width to be greater than 0") || String(e).includes("FramebufferManager.update")) && state?.telemetry?.builds===0 && attempt<2)){throw e;}
    } finally { clearInterval(liveTimer); await browser.close(); }
  }
}
