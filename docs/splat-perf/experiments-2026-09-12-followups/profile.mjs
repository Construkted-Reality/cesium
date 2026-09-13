import {chromium} from '/mnt/data2/cesium-splat-perf/cesiumjs/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='/mnt/data2/cesium-splat-perf/experiments-2026-09-12-followups';
const [label,bundle,dataset='geo']=process.argv.slice(2);
const result={label,dataset,errors:[],stages:[]};
const browser=await chromium.launch({channel:'chromium',headless:false,args:['--no-sandbox','--use-angle=gl','--ozone-platform=wayland'],env:{...process.env,XDG_RUNTIME_DIR:dir+'/wayland',WAYLAND_DISPLAY:'splat-wayland'}});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>result.errors.push(e.message));
 const instrument=`
;globalThis.__ledger=[];globalThis.__frames=[];
(() => {
const P=Cesium.GaussianSplatPrimitive;
globalThis.__profile=[];globalThis.__glCalls=[];
P.profiling.enabled=true;
const add=P.profiling.add;
P.profiling.add=function(name,start){__profile.push({name,start,end:performance.now()});return add.apply(this,arguments);};
for(const name of ['texImage2D','texSubImage2D','bufferData','bufferSubData','deleteTexture']){
 const original=WebGL2RenderingContext.prototype[name];
 WebGL2RenderingContext.prototype[name]=function(...args){const start=performance.now();const r=original.apply(this,args);const ms=performance.now()-start;if(ms>.1)__glCalls.push({name,start,ms,width:typeof args[3]==='number'?args[3]:undefined,height:typeof args[4]==='number'?args[4]:undefined});return r;};
}

const gen=Cesium.GaussianSplatTextureGenerator.generateFromAttributes;
Cesium.GaussianSplatTextureGenerator.generateFromAttributes=function(parameters){const result=gen.apply(this,arguments);if(result)result.then(data=>__profile.push({name:'workerOutput',count:parameters.count,width:data.width,height:data.height,bytes:data.data.byteLength,requiredBytes:32768*Math.ceil(parameters.count/16384)*16}));return result;};
const record=p=>{
 const snap=s=>s?{state:s.state,count:s.numSplats,tex:(s.gaussianSplatTexture?.sizeInBytes||0)+(s.sphericalHarmonicsTexture?.sizeInBytes||0),attributeCpu:s.attributeTextureData?.data?.buffer?.byteLength||0,shSharesBuffer:s.shData?.buffer===s.sphericalHarmonicsTextureData?.data?.buffer,cpu:(s.attributeTextureData?.data?.byteLength||0)+(s.sphericalHarmonicsTextureData?.data?.byteLength||0)}:null;
 __ledger.push({time:performance.now(),bytes:p._tileset.totalMemoryUsageInBytes,active:snap(p._snapshot),pending:snap(p._pendingSnapshot),retired:p._retiredTextures.reduce((n,x)=>n+x.texture.sizeInBytes,0)});
};
const update=P.prototype._updateMemoryStatistics;
P.prototype._updateMemoryStatistics=function(){const r=update.apply(this,arguments);record(this);return r;};
const build=P.buildGSplatDrawCommand;
P.buildGSplatDrawCommand=function(p){p._updateMemoryStatistics();const r=build.apply(this,arguments);p._updateMemoryStatistics();return r;};
})();`;
 await page.route('**/Build/CesiumUnminified/Cesium.js',r=>r.fulfill({body:readFileSync(dir+'/'+bundle,'utf8')+instrument,contentType:'text/javascript'}));
 await page.route('**/Build/CesiumUnminified/Workers/**',route=>{const filename=new URL(route.request().url()).pathname.split('/').pop();return route.fulfill({body:readFileSync(dir+'/'+bundle.replace('-Cesium.js','-Workers')+'/'+filename),contentType:'text/javascript'});});
 await page.goto('http://localhost:8099/tools/splat-perf/loading-harness.html?tileset=/splat-data/oracle-run/'+dataset+'-newdefault/tileset.json&tileCache=1073741824&sse=4&mode=static&capture=1');
 await page.waitForFunction(()=>window.__round2Tilesets?.length,null,{timeout:30000});
 await page.evaluate(()=>{__scene.postRender.addEventListener(()=>__frames.push(performance.now()));});
 const settle=async()=>{await page.waitForFunction(()=>{const t=__round2Tilesets[0],p=t.gaussianSplatPrimitive;return t.tilesLoaded&&p?._numSplats>0&&!p._pendingSnapshot&&!p._needsSnapshotRebuild&&t._selectedTiles.length===p._selectedTileSet.size&&t._selectedTiles.every(x=>p._selectedTileSet.has(x));},null,{timeout:90000});await page.waitForTimeout(1000);};
 await settle();
 for(const sse of [8,4,12,4]){
  await page.evaluate(sse=>{__ledger=[];__frames=[];__profile=[];__glCalls=[];__round2Tilesets[0].maximumScreenSpaceError=sse;},sse);
  const start=Date.now();await page.waitForTimeout(100);await settle();
  const stage=await page.evaluate(()=>{const t=__round2Tilesets[0],p=t.gaussianSplatPrimitive;__scene.render(Cesium.JulianDate.now());const pixels=__scene.context.readPixels();let hash=2166136261;for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619);}return {profile:__profile,glCalls:__glCalls,ledger:__ledger,frames:__frames,splats:p._numSplats,selected:t._selectedTiles.length,ready:t.statistics.numberOfTilesWithContentReady,gpuBytes:t.totalMemoryUsageInBytes,pixelHash:hash>>>0};});
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');stage.heap=await cdp.send('Runtime.getHeapUsage');await cdp.detach();
  await page.locator('canvas').first().screenshot({path:dir+'/'+label+'-'+result.stages.length+'.png'});
  result.stages.push({...stage,sse,settleMs:Date.now()-start});
  writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));
 }
}catch(e){result.failure=String(e);process.exitCode=1;}
finally{writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));await browser.close();}
