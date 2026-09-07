/* global Cesium */
import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";
const out = process.env.SPLAT_RESULTS || "/mnt/data2/cesium-splat-perf/loading-experiment-results";
const runs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sourcePaths=["tools/splat-perf/loading-hooks.mjs","tools/splat-perf/loading-worker.mjs","tools/splat-perf/loading-kernels.mjs","tools/splat-perf/loading-harness.html","tools/splat-perf/streaming-gpu-hooks.js","Build/CesiumUnminified/Cesium.js","Build/CesiumUnminified/Workers/gaussianSplatSorter.js","Build/CesiumUnminified/Workers/gaussianSplatTextureGenerator.js","node_modules/@spz-loader/core/dist/index.js"];
const frozenSources=Object.fromEntries(sourcePaths.map(path=>[path,readFileSync(path,"utf8")]));
const sourceHashes=Object.fromEntries(Object.entries(frozenSources).map(([path,body])=>[path,createHash("sha256").update(body).digest("hex")]));
const hostState=()=>({time:new Date().toISOString(),load:loadavg(),cpuTicks:readFileSync("/proc/stat","utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number)});

mkdirSync(out, {recursive:true});
const clock = () => execFileSync("nvidia-smi", ["--query-gpu=clocks.gr,clocks.mem,temperature.gpu,memory.used", "--format=csv,noheader"], {encoding:"utf8"}).trim();
for (const run of runs) {
  if (run.coalesceMs && run.snapshotProbe !== "1") { throw new Error("coalesceMs requires snapshotProbe=1"); }
  if (run.cycles && run.lifecycle !== "1") { throw new Error("cycles requires lifecycle=1"); }
  for (let attempt=0; attempt<3; attempt++) {
    const wayland = run.backend === "wayland-gl";
    const glArgs = GPU_LAUNCH_ARGS.filter(x=>!x.startsWith("--use-angle=")&&!x.startsWith("--enable-features=")).concat(["--use-angle=gl"]);
    const browser = await chromium.launch({headless:!wayland, channel:"chromium",args:wayland?[...glArgs,"--ozone-platform=wayland"]:run.backend === "gl"?glArgs:GPU_LAUNCH_ARGS,
      ...(wayland?{env:{...process.env,XDG_RUNTIME_DIR:process.env.SPLAT_WAYLAND_RUNTIME||"/mnt/data2/cesium-splat-perf/worker-validation-results/wayland-runtime",WAYLAND_DISPLAY:"splat-wayland",__EGL_VENDOR_LIBRARY_FILENAMES:"/usr/share/glvnd/egl_vendor.d/10_nvidia.json"}}:{})});
    const context = await browser.newContext({viewport:{width:Number(run.width||1920),height:Number(run.height||1080)},deviceScaleFactor:1});
    const errors=[]; const before=clock(); const hostBefore=hostState();
    await context.route("**/tools/splat-perf/*", route=> {
      const path=new URL(route.request().url()).pathname.slice(1), body=frozenSources[path];
      return body===undefined?route.fallback():route.fulfill({body,contentType:path.endsWith(".html")?"text/html":"text/javascript"});
    });
    await context.route("**/Build/CesiumUnminified/Cesium.js",async route=> {
      const response=await route.fetch();let body=frozenSources[new URL(route.request().url()).pathname.slice(1)] ?? await response.text();
      const swap=(a,b)=>{if(!body.includes(a)){throw new Error(`Bundle anchor missing: ${a}`);}body=body.replace(a,b);};
      if (run.production) {
        if (run.production === "baseline") { swap("packSphericalHarmonics: true", "packSphericalHarmonics: false"); }
        if (run.production === "worker") {
          swap('const decodePromise = Rr(this._bufferViewTypedArray, {\n        unpackOptions: { coordinateSystem: "UNSPECIFIED" }\n      });',
            'const decodePromise = globalThis.__loadingDecode(this._bufferViewTypedArray, {unpackOptions:{coordinateSystem:"UNSPECIFIED"}},this,Rr);');
          swap("decoded.packedSphericalHarmonics = packSpzSphericalHarmonics(gcloudData);", "decoded.packedSphericalHarmonics = gcloudData.__packedSH ?? packSpzSphericalHarmonics(gcloudData);");
        }

      } else {
      swap('const decodePromise = Rr(this._bufferViewTypedArray, {\n        unpackOptions: { coordinateSystem: "UNSPECIFIED" }\n      });',
        'const decodePromise = globalThis.__loadingDecode(this._bufferViewTypedArray, {unpackOptions:{coordinateSystem:"UNSPECIFIED"}},this,Rr);');
      swap('const gcloudData = spzLoader.decodedData.gcloud;',`const gcloudData = spzLoader.decodedData.gcloud;
        if(gcloudData.__packedSH && vertexBufferLoader._attributeSemantic.includes("SH_DEGREE_")) {
          const placeholder = new Float32Array(0); placeholder.buffer.__packedSH = gcloudData.__packedSH;
          vertexBufferLoader._typedArray=placeholder;return;
        }`);
      swap('function packSphericalHarmonicsData(tileContent) {',`function packSphericalHarmonicsData(tileContent) {
        const direct = tileContent.gltfPrimitive.attributes.find(a=>a.typedArray?.buffer.__packedSH);
        if(direct)return direct.typedArray.buffer.__packedSH;`);
      }

      if (run.coalesceMs) {
        const delay = Number(run.coalesceMs);
        if (!Number.isFinite(delay) || delay <= 0) { throw new Error("Invalid snapshot interval"); }
        swap("const allowRebuild = wantsRebuild && !defined_default(this._pendingSnapshot);", `const coalesced = isBootstrap || snapshotIsStale || tileset.tilesLoaded || performance.now() - (this.__lastExperimentSnapshot || 0) >= ${delay};
      const allowRebuild = wantsRebuild && coalesced && !defined_default(this._pendingSnapshot);`);
      }
      if (run.dropUnselected === "1") {
        swap("GaussianSplatPrimitive.prototype.onTileLoad = function(tile) {", `GaussianSplatPrimitive.prototype.onTileLoad = function(tile) {
          if (!this._selectedTileSet.has(tile)) return;`);
      }
      if (run.clearRebuild === "1") {
        swap("if (selectedTilesChanged || this._dirty) {\n        this._needsSnapshotRebuild = true;\n      }", "this._needsSnapshotRebuild = selectedTilesChanged || this._dirty;");
      }
      if (run.invalidationProbe === "1") {
        swap("GaussianSplatPrimitive.prototype.onTileLoad = function(tile) {", `GaussianSplatPrimitive.prototype.onTileLoad = function(tile) {
          (globalThis.__tileLoadTrace ||= []).push({t:performance.now(),selected:this._selectedTileSet.has(tile),current:this._tileset._selectedTiles.includes(tile),pending:!!this._pendingSnapshot,dirty:this._dirty,selectedCount:this._selectedTileSet.size});`);
      }
      if (run.snapshotProbe === "1") {
        swap("        this._splatDataGeneration++;", `
        (globalThis.__snapshotTrace ||= []).push({t:performance.now(),generation:this._splatDataGeneration+1,selected:tileset._selectedTiles.length,dirty:this._dirty,changed:selectedTilesChanged,tiles:tileset._selectedTiles.map(tile=>{globalThis.__snapshotIDs ||= new WeakMap(); if(!globalThis.__snapshotIDs.has(tile))globalThis.__snapshotIDs.set(tile,(globalThis.__snapshotNextID=(globalThis.__snapshotNextID||0)+1));return globalThis.__snapshotIDs.get(tile);}),loaded:tileset.tilesLoaded,bootstrap:isBootstrap,stable:isStable,stale:snapshotIsStale,stallFrames:this._snapshotRebuildStallFrames});
        this.__lastExperimentSnapshot = performance.now();
        this._splatDataGeneration++;`);
      }
      await route.fulfill({response,body});
    });
    if(run.wasmProbe==="1") {
      await context.route("**/Workers/gaussianSplatTextureGenerator.js",async route=> {
        const response=await route.fetch();let body=frozenSources[new URL(route.request().url()).pathname.slice(1)] ?? await response.text();
        const anchor="initSync({ module: wasmConfig.wasmBinary });";
        if(!body.includes(anchor)){throw new Error("Missing texture WASM anchor");}
        body=body.replace(anchor,"const wasmInstance=initSync({ module: wasmConfig.wasmBinary }); globalThis.__wasmHeapBytes=()=>wasmInstance.memory.buffer.byteLength;");
        await route.fulfill({response,body});
      });
      await context.route("**/node_modules/@spz-loader/core/dist/index.js",async route=> {
        const response=await route.fetch();let body=frozenSources[new URL(route.request().url()).pathname.slice(1)] ?? await response.text();const anchor="return xr(a, H), T;";
        if(!body.includes(anchor)){throw new Error("Missing decoder WASM anchor");}
        body=body.replace(anchor,`globalThis.__decoderHeapPeak=Math.max(globalThis.__decoderHeapPeak||0,a.HEAPU8.byteLength); ${anchor}`);
        await route.fulfill({response,body});
      });
    }
    await context.route("**/Workers/gaussianSplatSorter.js", async route => {
      const response=await route.fetch(); let body=frozenSources[new URL(route.request().url()).pathname.slice(1)] ?? await response.text();
      if(run.probe === "cache256") {
        const budget="GaussianSplatPositionCache.maximumByteLength = 128 * 1024 * 1024;";
        if(!body.includes(budget)){throw new Error("Cache budget anchor missing");}
        body=body.replace(budget,"GaussianSplatPositionCache.maximumByteLength = 256 * 1024 * 1024;");
      }
      if(run.wasmProbe==="1"){body=body.replace("initSync({ module: wasmConfig.wasmBinary });","const wasmInstance=initSync({ module: wasmConfig.wasmBinary }); globalThis.__wasmHeapBytes=()=>wasmInstance.memory.buffer.byteLength;");}
      const anchor="var cachedPositions = new GaussianSplatPositionCache_default();";
      if (!body.includes(anchor)) {throw new Error("Worker instrumentation anchor missing");}
      body=body.replace(anchor, `${anchor}
globalThis.__cacheProbe = {cache:cachedPositions,peak:0,sets:0,releases:0};
const originalSet = cachedPositions.set.bind(cachedPositions);
cachedPositions.set = function(...args) { originalSet(...args); globalThis.__cacheProbe.sets++; globalThis.__cacheProbe.peak = Math.max(globalThis.__cacheProbe.peak,this.byteLength); };`);
      if (!run.production) { body=body.replace("const { primitive, sortType, positionsKey } = parameters;", `if(parameters.cacheByteBudget !== undefined) {
        const b=parameters.cacheByteBudget;
        if(!Number.isSafeInteger(b)||b<0||b>1073741824)throw new Error("Invalid worker budget");
        cachedPositions.maximumByteLength=b;
        while(cachedPositions.byteLength>b)cachedPositions.remove(cachedPositions._entries.keys().next().value);
      }
      const { primitive, sortType, positionsKey } = parameters;`); }
      body=body.replace("cachedPositions.remove(key);", "globalThis.__cacheProbe.releases++; cachedPositions.remove(key);");
      await route.fulfill({response,body});
    });
    if (run.decoderProfile === "1") {
      await context.route("**/node_modules/@spz-loader/core/dist/index.js", async route => {
        const response = await route.fetch(); let body = frozenSources[new URL(route.request().url()).pathname.slice(1)] ?? await response.text();
        const start = body.indexOf("Rr = async (q, $) => {");
        const end = body.indexOf("}, Lr =", start);
        if (start < 0 || end < 0) { throw new Error("Missing decoder wrapper"); }
        body = `${body.slice(0, start)  }Rr = async (q, $) => {
          const start = performance.now(); const a = await br(); const initialized = performance.now();
          const M = q instanceof Uint8Array ? q : new Uint8Array(q); let d = null;
          try {
            d = a._malloc(M.length); if (!d) throw new Error("Allocation failed");
            a.HEAPU8.set(M, d);
            const copied = performance.now();
            const H = a.load_spz(d, M.length, {coordinateSystem:a.CoordinateSystem[$?.unpackOptions?.coordinateSystem ?? "UNSPECIFIED"]});
            const decoded = performance.now(); const T = Tr(a, H, $); const converted = performance.now();
            xr(a, H);
            (globalThis.__decoderProfile ||= []).push({initMs:initialized-start,inputMs:copied-initialized,nativeMs:decoded-copied,convertMs:converted-decoded,cleanupMs:performance.now()-converted,points:T.numPoints,heapBytes:a.HEAPU8.byteLength});
            return T;
          } finally { if (d !== null) a._free(d); }
        ${  body.slice(end)}`;
        await route.fulfill({response, body});
      });
    }
    const page=await context.newPage();
    page.on("pageerror",e=>errors.push(String(e)));
    page.on("console",m=> { if(m.type()==="error" && !m.text().includes("404")){errors.push(m.text());} });
    const cdp=await context.newCDPSession(page);
    const bcdp=await browser.newBrowserCDPSession();
    const workerHeaps=async()=> {
      const result=[];
      for(const info of (await bcdp.send("Target.getTargets")).targetInfos.filter(t=>t.type==="worker")) {
        let sessionId;
        try {
          ({sessionId}=await bcdp.send("Target.attachToTarget",{targetId:info.targetId,flatten:false}));
          let counter=0;
          const call=(method,params={})=>new Promise((resolve,reject)=> {
            const id=++counter;
            const timeout = {};
            const onMessage=e=> {if(e.sessionId!==sessionId){return;}const m=JSON.parse(e.message);if(m.id!==id){return;}clearTimeout(timeout.id);bcdp.off("Target.receivedMessageFromTarget",onMessage);if(m.error){reject(new Error(m.error.message));}else{resolve(m.result);}};
            timeout.id=setTimeout(()=>{bcdp.off("Target.receivedMessageFromTarget",onMessage);reject(new Error("Worker heap timeout"));},10000);
            bcdp.on("Target.receivedMessageFromTarget",onMessage);
            bcdp.send("Target.sendMessageToTarget",{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
          });
          await call("HeapProfiler.collectGarbage");
          const memory=(await call("Runtime.evaluate",{expression:"({wasmHeapBytes:globalThis.__wasmHeapBytes?.(),decoderHeapPeak:globalThis.__decoderHeapPeak})",returnByValue:true})).result.value;
          result.push({url:info.url,heap:await call("Runtime.getHeapUsage"),memory});
        } catch(error) {result.push({url:info.url,error:String(error)});}
        finally {if(sessionId){await bcdp.send("Target.detachFromTarget",{sessionId}).catch(()=>{});}}
      }
      return result;
    };

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
      await page.goto(`http://127.0.0.1:8099/tools/splat-perf/loading-harness.html?${query}`,{waitUntil:"domcontentloaded"});
      if (wayland) {
        await page.waitForFunction(()=>window.__scene?.context?._gl,null,{timeout:30000});
        const renderer=await page.evaluate(()=>{const gl=window.__scene.context._gl,e=gl.getExtension("WEBGL_debug_renderer_info");return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
        if(!renderer.includes("NVIDIA")||renderer.includes("Vulkan")){throw new Error(`Hardware OpenGL unavailable: ${renderer}`);}
      }

      if(run.profileCPU==="1") {
        await page.waitForFunction(()=>window.__benchPhase==="measuring"||window.__benchError,null,{timeout:240000,polling:50});
        await cdp.send("Profiler.start");
      }
      await page.waitForFunction(()=>window.__benchResult||window.__benchError,null,{timeout:240000});
      const failure=await page.evaluate(()=>window.__benchError); if(failure) {throw new Error(failure);}
      const result=await page.evaluate(()=>({bench:window.__benchResult,telemetry:window.__telemetry,loading:window.__loadingStats}));
      result.worker=await cache();
      await cdp.send("HeapProfiler.collectGarbage");
      result.heap=await cdp.send("Runtime.getHeapUsage");
      if(run.profileCPU==="1") {const profile=await cdp.send("Profiler.stop");writeFileSync(`${out}/${run.label}.cpuprofile`,JSON.stringify(profile.profile));}
      if(run.budgetValidation==="1") {
        result.budgetValidation=await page.evaluate(async()=> {
          const invalid=[-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1];const rejected=[];
          for(const v of invalid) {try {window.__setPositionBudget(v);rejected.push(false);}catch {rejected.push(true);}}
          await window.__setPositionBudget(0);
          for(let i=0;i<120;i++){await new Promise(r=>requestAnimationFrame(r));}
          return {rejected,mainLimit:Cesium.GaussianSplatSorter.maximumCacheByteLength};
        });
        result.disabledWorker=await cache();
      }
      if (run.turnCheck === "1") {
        result.turn = await page.evaluate(() => new Promise((resolve, reject) => {
          const scene=window.__scene, camera=scene.camera, tile=window.__round2Tilesets[0];
          window.__probeOwnsCamera=true;
          const position=Cesium.Cartesian3.clone(camera.positionWC), heading=camera.heading, pitch=camera.pitch;
          camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          const gl=scene.context._gl, pixels=new Uint8Array(scene.drawingBufferWidth*scene.drawingBufferHeight*4);
          const rows=[]; const timeout={}; let start, angle=0;
          const pre=scene.preUpdate.addEventListener(()=> {
            const now=performance.now();start ??= now;const t=now-start;
            angle=t<2000?180*t/2000:t<10000?180:t<12000?180*(12000-t)/2000:0;
            camera.setView({destination:position,orientation:{heading:heading+Cesium.Math.toRadians(angle),pitch,roll:0}});
          });
          const post=scene.postRender.addEventListener(()=> {
            const t=performance.now()-start;
            gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,scene.drawingBufferWidth,scene.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            let lit=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>6||pixels[i+1]>6||pixels[i+2]>6){lit++;}}
            rows.push({t,angle,coverage:lit/(pixels.length/4),count:tile.gaussianSplatPrimitive?._numSplats||0,selected:tile._selectedTiles.length,loaded:tile.tilesLoaded,pending:!!tile.gaussianSplatPrimitive?._pendingSnapshot});
            if(t>=20000){pre();post();clearTimeout(timeout.id);window.__probeOwnsCamera=false;resolve(rows);}
          });
          timeout.id=setTimeout(()=>{pre();post();window.__probeOwnsCamera=false;reject(new Error("Turn validation timeout"));},45000);
        }));
      }
      if(run.cancellation==="1") {
        result.cancellation=await page.evaluate(async options=> {
          const scene=window.__scene,list=window.__round2Tilesets;
          const wait=()=>new Promise(r=>requestAnimationFrame(r));
          const until=async predicate=> {const start=performance.now();while(!predicate()){if(performance.now()-start>60000){throw new Error("Cancellation timeout");}await wait();}};
          for(const t of list){scene.primitives.remove(t);}list.length=0;window.__splatPrimitive=null;
          await until(()=>!window.__loadingQueueState().active&&window.__loadingQueueState().queued===0);
          const records=[];
          const url=options.tileset||"/splat-data/oracle-run/geo-newdefault/tileset.json";
          for(let cycle=0;cycle<5;cycle++) {
            const t=await Cesium.Cesium3DTileset.fromUrl(url,{maximumScreenSpaceError:8});scene.primitives.add(t);list.push(t);
            await until(()=>window.__loadingQueueState().active&&window.__loadingQueueState().queued>0);
            const before={...window.__loadingStats};scene.primitives.remove(t);list.length=0;
            await until(()=>!window.__loadingQueueState().active&&window.__loadingQueueState().queued===0);
            records.push({cycle,destroyed:t.isDestroyed(),cancelled:window.__loadingStats.cancelled-before.cancelled,queue:window.__loadingQueueState()});
          }
          let invalidRejected=false;
          try {await window.__loadingDecode(new Uint8Array([1,2,3]),{unpackOptions:{coordinateSystem:"UNSPECIFIED"}},{_primitive:{attributes:{}},isDestroyed:()=>false});}catch {invalidRejected=true;}
          const t=await Cesium.Cesium3DTileset.fromUrl(url,{maximumScreenSpaceError:8});scene.primitives.add(t);list.push(t);
          await until(()=>t.tilesLoaded&&t.gaussianSplatPrimitive?._numSplats>0&&!t.gaussianSplatPrimitive?._pendingSnapshot);
          return {records,invalidRejected,recoveredCount:t.gaussianSplatPrimitive._numSplats};
        },run);
      }
      if (run.lifecycle === "1") {
        result.lifecycle=[];
        for(let cycle=0;cycle<Number(run.cycles||4);cycle++) {
          if(cycle>0) {
            await page.evaluate(async options=> {
              const C=Cesium, scene=window.__scene, list=window.__round2Tilesets;
              for(let n=0;n<Number(options.multi||1);n++) {
                const t=await C.Cesium3DTileset.fromUrl(options.tileset||"/splat-data/oracle-run/geo-newdefault/tileset.json",{maximumScreenSpaceError:Number(options.sse||4)});
                scene.primitives.add(t);list.push(t);
              }
              const wait=()=>new Promise(r=>requestAnimationFrame(r));
              const started=performance.now();
              while(!list.every(t=>t.tilesLoaded&&t.gaussianSplatPrimitive?._numSplats>0&&!t.gaussianSplatPrimitive?._pendingSnapshot)) {
                await wait(); if(performance.now()-started>180000){throw new Error("Lifecycle reload timeout");}
              }
              for(let n=0;n<120;n++){await wait();}
            },run);
          }
          await cdp.send("HeapProfiler.collectGarbage");
          const loaded={cycle,stage:"loaded",workerHeaps:await workerHeaps(),worker:await cache(),heap:await cdp.send("Runtime.getHeapUsage"),state:await page.evaluate(()=>({gl:window.__telemetry.gl,tiles:window.__round2Tilesets.map(t=>({count:t.gaussianSplatPrimitive?._numSplats,bytes:t.totalMemoryUsageInBytes}))}))};
          if(loaded.workerHeaps.some(x=>x.error)){throw new Error(`Worker heap instrumentation failed: ${JSON.stringify(loaded.workerHeaps)}`);}
          result.lifecycle.push(loaded);
          await page.evaluate(async()=> {
            const scene=window.__scene, list=window.__round2Tilesets;
            for(const t of list) {scene.primitives.remove(t);if(!t.isDestroyed()){throw new Error("Tileset not destroyed");}}
            list.length=0;window.__splatPrimitive=null;
            for(let i=0;i<120;i++){await new Promise(r=>requestAnimationFrame(r));}
          });
          await cdp.send("HeapProfiler.collectGarbage");
          result.lifecycle.push({cycle,stage:"removed",workerHeaps:await workerHeaps(),worker:await cache(),heap:await cdp.send("Runtime.getHeapUsage"),state:await page.evaluate(()=>({gl:window.__telemetry.gl,loading:window.__loadingStats,queue:window.__loadingQueueState(),telemetryLengths:Object.fromEntries(Object.entries(window.__telemetry).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))}))});
          if (run.heapSnapshot === "1" && (cycle === 0 || cycle === Number(run.cycles)-1)) {
            const chunks = []; const onChunk = event => chunks.push(event.chunk);
            cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
            await cdp.send("HeapProfiler.takeHeapSnapshot", {reportProgress:false});
            cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
            writeFileSync(`${out}/${run.label}-${cycle}.heapsnapshot`, chunks.join(""));
          }
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
      Object.assign(result,{run,errors,before,after:clock(),hostBefore,hostAfter:hostState(),sourceHashes,glError,loadingFinal:await page.evaluate(()=>window.__loadingStats),snapshotTrace:await page.evaluate(()=>window.__snapshotTrace || []),tileLoadTrace:await page.evaluate(()=>window.__tileLoadTrace || []),decoderProfiles:run.decoderProfile === "1" ? await Promise.all(page.workers().map(w=>w.evaluate(()=>globalThis.__decoderProfile || []))) : []});
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
