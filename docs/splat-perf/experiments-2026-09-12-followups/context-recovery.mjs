import {chromium} from '/mnt/data2/cesium-splat-perf/cesiumjs/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='/mnt/data2/cesium-splat-perf/experiments-2026-09-12-followups';
const [label,bundle,mode='idle']=process.argv.slice(2);
const result={label,mode,errors:[],renderErrors:[]};
const browser=await chromium.launch({channel:'chromium',headless:false,args:['--no-sandbox','--use-angle=gl','--ozone-platform=wayland'],env:{...process.env,XDG_RUNTIME_DIR:dir+'/wayland',WAYLAND_DISPLAY:'splat-wayland'}});
let page;
try{
 page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>result.errors.push(e.message));
 await page.route('**/Build/CesiumUnminified/Cesium.js',r=>r.fulfill({body:readFileSync(dir+'/'+bundle),contentType:'text/javascript'}));
 await page.goto('http://localhost:8099/tools/splat-perf/loading-harness.html?tileset=/splat-data/oracle-run/geo-newdefault/tileset.json&tileCache=1073741824&sse=4&mode=static&capture=1');
 await page.waitForFunction(()=>window.__round2Tilesets?.length,null,{timeout:30000});
 await page.evaluate(mode=>{
  window.__renderErrors=[];window.__faults=0;window.__seenUploads=[];
  __scene.renderError.addEventListener((scene,error)=>__renderErrors.push(String(error)));
  if(mode==='idle'){__scene.requestRenderMode=true;__scene.maximumRenderTimeChange=Infinity;}
 },mode);
 const wait=async count=>page.waitForFunction(count=>{const t=__round2Tilesets[0],p=t.gaussianSplatPrimitive;return p?._numSplats===count&&!p._pendingSnapshot&&!p._needsSnapshotRebuild&&t.tilesLoaded;},count,{timeout:45000});
 await wait(2087136);
 if(mode==='warm-idle'){await page.evaluate(()=>{__scene.requestRenderMode=true;__scene.maximumRenderTimeChange=Infinity;});}
 result.cold=await page.evaluate(()=>({splats:__round2Tilesets[0].gaussianSplatPrimitive._numSplats,frame:__scene.frameState.frameNumber}));
 if(mode==='mesh-only'){
  await page.evaluate(async()=>{
   const center=Cesium.Cartesian3.clone(__round2Tilesets[0].boundingSphere.center);
   __scene.primitives.removeAll();window.__meshTiles=[];
   for(const url of ['/Specs/Data/Cesium3DTiles/Batched/BatchedWithBatchTable/tileset.json','/Specs/Data/Cesium3DTiles/PointCloud/PointCloudRGB/tileset.json']){
    const t=await Cesium.Cesium3DTileset.fromUrl(url);
    t.modelMatrix=Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(center,t.boundingSphere.center,new Cesium.Cartesian3()));
    __scene.primitives.add(t);__meshTiles.push(t);
   }
  });
  await page.waitForFunction(()=>__meshTiles.every(t=>t.tilesLoaded&&t._selectedTiles.length),null,{timeout:30000});
 }
 result.beforeLoss=await page.evaluate(()=>{__scene.render(Cesium.JulianDate.now());const pixels=__scene.context.readPixels();return {rgbNonzero:pixels.reduce((n,v,i)=>n+(i%4!==3&&v!==0),0)};});
 await page.evaluate(mode=>{
  __scene.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();window.__lostEvents=(window.__lostEvents||0)+1;});
  __scene.canvas.addEventListener('webglcontextrestored',()=>window.__restoredEvents=(window.__restoredEvents||0)+1);
  if(mode==='guarded'){const render=__scene.render;__scene.render=function(){if(this.context._gl.isContextLost())return;return render.apply(this,arguments);};}
  window.__lossExtension=__scene.context._gl.getExtension('WEBGL_lose_context');__lossExtension.loseContext();
 },mode);
 await page.waitForTimeout(500);
 result.lost=await page.evaluate(()=>({errors:__renderErrors,lost:__scene.context._gl.isContextLost(),events:__lostEvents,loop:__viewer.useDefaultRenderLoop}));
 await page.evaluate(()=>__lossExtension.restoreContext());await page.waitForTimeout(500);
 result.restored=await page.evaluate(()=>{__viewer.useDefaultRenderLoop=true;__scene.requestRender();return {lost:__scene.context._gl.isContextLost(),events:window.__restoredEvents,errors:__renderErrors};});
 await page.waitForTimeout(1000);
 result.after=await page.evaluate(()=>{const gl=__scene.context._gl;const pixels=__scene.context.readPixels();return {errors:__renderErrors,loop:__viewer.useDefaultRenderLoop,glError:gl.getError(),nonzero:pixels.reduce((n,v)=>n+(v!==0),0),rgbNonzero:pixels.reduce((n,v,i)=>n+(i%4!==3&&v!==0),0),splats:__round2Tilesets[0].gaussianSplatPrimitive?._numSplats};});
 await page.reload();await page.waitForFunction(()=>window.__round2Tilesets?.[0]?.gaussianSplatPrimitive?._numSplats===2087136&&!__round2Tilesets[0].gaussianSplatPrimitive._pendingSnapshot,null,{timeout:60000});
 result.reload=await page.evaluate(()=>{__scene.render(Cesium.JulianDate.now());const pixels=__scene.context.readPixels();return {splats:__round2Tilesets[0].gaussianSplatPrimitive._numSplats,loop:__viewer.useDefaultRenderLoop,error:window.__benchError,rgbNonzero:pixels.reduce((n,v,i)=>n+(i%4!==3&&v!==0),0)};});

}catch(e){result.failure=String(e);result.state=await page.evaluate(()=>{const t=__round2Tilesets[0],p=t.gaussianSplatPrimitive;return {renderErrors:__renderErrors,selected:t._selectedTiles.length,ready:t.statistics.numberOfTilesWithContentReady,processing:t.statistics.numberOfTilesProcessing,requests:t.statistics.numberOfPendingRequests,splats:p?._numSplats,pending:p?._pendingSnapshot?.state,needsRebuild:p?._needsSnapshotRebuild,stable:p?._selectedTilesStableFrames,requested:__scene._renderRequested};});process.exitCode=1;}
finally{writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));await browser.close();}
