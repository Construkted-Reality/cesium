import {workerHeaps} from './worker-heap.mjs';
import {chromium} from '/mnt/data2/cesium-splat-perf/cesiumjs/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='/mnt/data2/cesium-splat-perf/experiments-2026-09-12-budget-cpu';
const [label='cpu-life-baseline',bundle='baseline-Cesium.js']=process.argv.slice(2);
const browser=await chromium.launch({channel:'chromium',headless:false,args:['--no-sandbox','--use-angle=gl','--ozone-platform=wayland'],env:{...process.env,XDG_RUNTIME_DIR:dir+'/wayland',WAYLAND_DISPLAY:'splat-wayland'}});
const result={label,errors:[],stages:[]};
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>result.errors.push(e.message));
 await page.route('**/Build/CesiumUnminified/Cesium.js',r=>r.fulfill({body:readFileSync(dir+'/'+bundle),contentType:'text/javascript'}));
 await page.goto('http://localhost:8099/tools/splat-perf/loading-harness.html?tileset=/splat-data/oracle-run/geo-newdefault/tileset.json&tileCache=1073741824&sse=4&warmup=120&frames=30&mode=static&capture=1');
 await page.waitForFunction(()=>window.__round2Tilesets?.length,null,{timeout:30000});
 console.log('tileset initialized');
 const settled=()=>{const t=window.__round2Tilesets?.[0],p=t?.gaussianSplatPrimitive;return t?.tilesLoaded&&t.statistics.numberOfTilesWithContentReady===139&&p?._numSplats===2087136&&!p._pendingSnapshot&&t._selectedTiles.every(tile=>p._selectedTileSet.has(tile));};
 await page.waitForFunction(settled,null,{timeout:90000});await page.waitForTimeout(500);console.log('settled');
 await page.evaluate(()=>{
  const t=__round2Tilesets[0],stack=[t.root];window.__retainedContents=[];while(stack.length){const tile=stack.pop();stack.push(...tile.children);if(tile.contentReady)__retainedContents.push(tile.content);}
  window.__cpuLedger=()=>{
   const buffers=new Map(),seen=new Set();function walk(o,path,depth){if(!o||typeof o!=='object'||seen.has(o)||depth>14)return;seen.add(o);if(ArrayBuffer.isView(o)||o instanceof ArrayBuffer){const b=ArrayBuffer.isView(o)?o.buffer:o;let v=buffers.get(b);if(!v){v={bytes:b.byteLength,paths:[]};buffers.set(b,v);}v.paths.push(path);return;}for(const [k,v]of Object.entries(o)){if(['_tileset','_tile','_resource','_resourceCache','_parent','parent','_context'].includes(k))continue;walk(v,path+'.'+k,depth+1);}}
   __retainedContents.forEach((c,i)=>{for(const k of ['_positions','_rotations','_scales','_packedSphericalHarmonicsData','gltfPrimitive','_loader'])walk(c[k],'tile'+i+'.'+k,0);});
   const tileBytes=[...buffers.values()].reduce((n,x)=>n+x.bytes,0);const p=t.gaussianSplatPrimitive;if(p)for(const k of ['_positions','_rotations','_scales','_colors','_shData','_indexes','_aggregateScratchBuffers','_scratchAggregateShBuffer','_snapshot','_pendingSnapshot'])walk(p[k],'primitive.'+k,0);
   return {tileBytes,totalBytes:[...buffers.values()].reduce((n,x)=>n+x.bytes,0),buffers:[...buffers.values()],gpuBytes:t.totalMemoryUsageInBytes,tiles:__retainedContents.length};};
 });
 const cdp=await page.context().newCDPSession(page);const sample=async name=>{await cdp.send('HeapProfiler.collectGarbage');result.stages.push({name,heap:await cdp.send('Runtime.getHeapUsage'),ledger:await page.evaluate(()=>__cpuLedger())});};
 await sample('loaded');result.workers=await workerHeaps(browser);console.log('sampled loaded');
 // Capture synchronously after rendering, before the next browser frame.
 const pixels=await page.evaluate(()=>{__scene.render();const gl=__scene.context._gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return Array.from(a);});writeFileSync(dir+'/'+label+'.rgba',Buffer.from(pixels));
 await page.evaluate(()=>{const t=__round2Tilesets[0];__scene.primitives.remove(t);});await page.waitForTimeout(500);await sample('destroyed-with-content-references');
 await page.evaluate(()=>{__retainedContents=[];});await sample('references-released');
}catch(e){result.failure=String(e);process.exitCode=1;}finally{writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));await browser.close();}
