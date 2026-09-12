import {chromium} from '/mnt/data2/cesium-splat-perf/cesiumjs/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='/mnt/data2/cesium-splat-perf/experiments-2026-09-12-budget-cpu';
const [label='baseline64',budget='64',seconds='40',bundleName='baseline-Cesium.js']=process.argv.slice(2);
const browser=await chromium.launch({channel:'chromium',headless:false,args:['--no-sandbox','--use-angle=gl','--ozone-platform=wayland'],env:{...process.env,XDG_RUNTIME_DIR:dir+'/wayland',WAYLAND_DISPLAY:'splat-wayland'}});
const result={label,budgetMiB:+budget,seconds:+seconds,errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>result.errors.push(e.message));
 await page.route('**/Build/CesiumUnminified/Cesium.js',r=>r.fulfill({body:readFileSync(dir+'/'+bundleName),contentType:'text/javascript'}));
 await page.goto('http://localhost:8099/tools/splat-perf/loading-harness.html?tileset=/splat-data/oracle-run/geo-newdefault/tileset.json&tileCache='+Math.round(+budget*1048576)+'&sse=4&warmup=120&frames=30&mode=static&capture=1');
 await page.waitForFunction(()=>window.__round2Tilesets?.length,null,{timeout:30000});
 await page.evaluate(()=>{
  const t=__round2Tilesets[0];t.maximumCacheOverflowBytes=0;window.__trace=[];window.__events=[];window.__allContents=new Set();
  for(const name of ['tileLoad','tileUnload'])t[name].addEventListener(tile=>{__events.push({time:performance.now(),name,url:tile.content?.url,sse:t.memoryAdjustedScreenSpaceError,bytes:t.totalMemoryUsageInBytes});});
  __scene.postRender.addEventListener(()=>{const p=t.gaussianSplatPrimitive;const snap=s=>s?{state:s.state,count:s.numSplats,tex:(s.gaussianSplatTexture?.sizeInBytes||0)+(s.sphericalHarmonicsTexture?.sizeInBytes||0)}:null;__trace.push({time:performance.now(),frame:__scene._frameState.frameNumber,bytes:t.totalMemoryUsageInBytes,sse:t.memoryAdjustedScreenSpaceError,ready:t.statistics.numberOfTilesWithContentReady,processing:t.statistics.numberOfTilesProcessing,requests:t.statistics.numberOfPendingRequests,attempted:t.statistics.numberOfAttemptedRequests,selected:t._selectedTiles.length,splats:p?._numSplats||0,active:snap(p?._snapshot),pending:snap(p?._pendingSnapshot),needsRebuild:p?._needsSnapshotRebuild,retired:p?._retiredTextures.reduce((sum,x)=>sum+x.texture.sizeInBytes,0),draw:!!p&&__scene._frameState.commandList.includes(p._drawCommand)});});
 });
 await page.waitForTimeout(+seconds*1000);
 result.limited=await page.evaluate(()=>({trace:__trace,events:__events}));writeFileSync(dir+'/'+label+'-partial.json',JSON.stringify(result));
 await page.evaluate(()=>{const t=__round2Tilesets[0];t.cacheBytes=536870912;t.maximumCacheOverflowBytes=536870912;window.__trace=[];window.__events=[];});
 await page.waitForFunction(()=>{const t=__round2Tilesets[0],p=t.gaussianSplatPrimitive;return t.tilesLoaded&&t.statistics.numberOfTilesWithContentReady===139&&p?._numSplats===2087136&&!p._pendingSnapshot&&t._selectedTiles.every(tile=>p._selectedTileSet.has(tile));},null,{timeout:90000});
 result.recovery=await page.evaluate(()=>({trace:__trace,events:__events}));
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');result.heap=await cdp.send('Runtime.getHeapUsage');
 result.cpu=await page.evaluate(()=>{
  const t=__round2Tilesets[0],tiles=[],stack=[t.root];while(stack.length){const tile=stack.pop();stack.push(...tile.children);if(tile.contentReady)tiles.push(tile);}
  const unique=new Set();let total=0;const details=tiles.map(tile=>{const c=tile.content,buffers=new Map(),seen=new Set();function walk(o,path,depth){if(!o||typeof o!=='object'||seen.has(o)||depth>12)return;seen.add(o);if(ArrayBuffer.isView(o)){if(!buffers.has(o.buffer))buffers.set(o.buffer,{bytes:o.buffer.byteLength,paths:[]});buffers.get(o.buffer).paths.push(path);return;}if(o instanceof ArrayBuffer){if(!buffers.has(o))buffers.set(o,{bytes:o.byteLength,paths:[path]});return;}for(const [k,v] of Object.entries(o)){if(k==='_tileset'||k==='_tile'||k==='_resource'||k==='_parent'||k==='parent')continue;walk(v,path+'.'+k,depth+1);}}
   for(const k of ['_positions','_rotations','_scales','_packedSphericalHarmonicsData','gltfPrimitive','_loader'])walk(c[k],k,0);
   for(const [b]of buffers)if(!unique.has(b)){unique.add(b);total+=b.byteLength;}return {url:c.url,geometry:c.geometryByteLength,buffers:[...buffers.values()]};});return {tiles:details,totalUniqueBytes:total};
 });
} catch(e){result.failure=String(e);process.exitCode=1;} finally{writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));await browser.close();}
