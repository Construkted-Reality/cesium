// Lifecycle attribution without Playwright network tracking or Network.enable.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, createWriteStream, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GPU_LAUNCH_ARGS } from "./bench.mjs";
const out=process.env.SPLAT_RESULTS;
if(!out){throw new Error("SPLAT_RESULTS is required");}
const profile=mkdtempSync(join(tmpdir(),"splat-heap-"));
// Obtain the same launch defaults as the comparison runner, then close this server.
// The measured process has only our direct CDP connection.
const launcher=await chromium.launchServer({headless:true,channel:"chromium",args:GPU_LAUNCH_ARGS});
const [executable,...launchArgs]=launcher.process().spawnargs;
await launcher.close();
const args=launchArgs.filter(a=>!a.startsWith("--user-data-dir=")&&a!=="--remote-debugging-pipe"&&a!=="--no-startup-window");
writeFileSync(`${out}/heap-direct-launch.json`,JSON.stringify({executable,args},null,2));
const child=spawn(executable,[...args,"--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try {
 let targets;
 for(let i=0;i<100;i++){try{const port=readFileSync(join(profile,"DevToolsActivePort"),"utf8").split("\n")[0];targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{await sleep(100);}}
 if(!targets){throw new Error("Chromium startup failed");}
 ws=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let next=0,snapshot;
 const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==="HeapProfiler.addHeapSnapshotChunk"){snapshot?.write(m.params.chunk);}if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);if(m.error){p.reject(new Error(m.error.message));}else {p.resolve(m.result);}}}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}`));},240000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails){throw new Error(JSON.stringify(r.exceptionDetails));}return r.result.value;};
 await call("Emulation.setDeviceMetricsOverride",{width:960,height:540,deviceScaleFactor:1,mobile:false});
 await new Promise(r=>setTimeout(r,1000));
 await call("Page.navigate",{url:"http://127.0.0.1:8099/tools/splat-perf/loading-harness.html?tileset=/splat-data/oracle-run/geo-newdefault/tileset.json&production=candidate&mode=static&sse=8&frames=30&warmup=60&width=960&height=540&capture=1"});
 for(let i=0;i<2400;i++){const ready=await evaluate("!!window.__benchResult || window.__benchError");if(ready){if(typeof ready==="string"){console.log(await evaluate("({width:innerWidth,height:innerHeight,canvas:[window.__scene?.canvas.width,window.__scene?.canvas.height],drawing:[window.__scene?.drawingBufferWidth,window.__scene?.drawingBufferHeight],builds:window.__telemetry?.builds})"));throw new Error(ready);}break;}await sleep(100);if(i===2399){throw new Error("Load timeout");}}
 const rows=[];
 for(let cycle=0;cycle<96;cycle++){
  if(cycle>0){await evaluate(`(async()=>{const t=await Cesium.Cesium3DTileset.fromUrl("/splat-data/oracle-run/geo-newdefault/tileset.json",{maximumScreenSpaceError:8});window.__scene.primitives.add(t);window.__round2Tilesets.push(t);const start=performance.now();while(!(t.tilesLoaded&&t.gaussianSplatPrimitive?._numSplats>0&&!t.gaussianSplatPrimitive?._pendingSnapshot)){await new Promise(r=>requestAnimationFrame(r));if(performance.now()-start>180000)throw new Error("Reload timeout");}return t.gaussianSplatPrimitive._numSplats;})()`);}
  const state=await evaluate(`(async()=>{for(const t of window.__round2Tilesets)window.__scene.primitives.remove(t);window.__round2Tilesets.length=0;window.__splatPrimitive=null;for(let i=0;i<120;i++)await new Promise(r=>requestAnimationFrame(r));return {gl:window.__telemetry.gl,telemetryLengths:Object.fromEntries(Object.entries(window.__telemetry).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))};})()`);
  await call("HeapProfiler.collectGarbage");
  rows.push({cycle,heap:await call("Runtime.getHeapUsage"),state});
  writeFileSync(`${out}/heap-direct.json`,JSON.stringify(rows,null,2));
  if([0,23,95].includes(cycle)){snapshot=createWriteStream(`${out}/heap-direct-${cycle}.heapsnapshot`);await call("HeapProfiler.takeHeapSnapshot",{reportProgress:false});const stream=snapshot;await new Promise(r=>stream.end(r));snapshot=undefined;}
  console.log(JSON.stringify(rows.at(-1)));
 }
}finally{ws?.close();child.kill("SIGTERM");await new Promise(r=>child.once("exit",r));rmSync(profile,{recursive:true,force:true});}
