import {chromium} from '/mnt/data2/cesium-splat-perf/cesiumjs/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='/mnt/data2/cesium-splat-perf/experiments-2026-09-12-followups';
const [label,bundle]=process.argv.slice(2);
const result={label,errors:[],stages:[]};
const browser=await chromium.launch({channel:'chromium',headless:false,args:['--no-sandbox','--use-angle=gl','--ozone-platform=wayland'],env:{...process.env,XDG_RUNTIME_DIR:dir+'/wayland',WAYLAND_DISPLAY:'splat-wayland'}});
let page;
try {
 page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>result.errors.push(String(e)));
 await page.route('**/Build/CesiumUnminified/Cesium.js',r=>r.fulfill({body:readFileSync(dir+'/'+bundle),contentType:'text/javascript'}));
 await page.route('**/Build/CesiumUnminified/Workers/**',r=>r.fulfill({body:readFileSync(dir+'/'+bundle.replace('-Cesium.js','-Workers')+'/'+new URL(r.request().url()).pathname.split('/').pop()),contentType:'text/javascript'}));
 await page.goto('http://localhost:8099/tools/splat-perf/loading-harness.html?tileset=/splat-data/oracle-run/geo-newdefault/tileset.json&tileCache=1073741824&sse=8&mode=static&capture=1');
 await page.waitForFunction(()=>window.__round2Tilesets?.[0]?.gaussianSplatPrimitive?._numSplats>0,null,{timeout:60000});
 await page.evaluate(async()=>{
  window.__errors=[];window.__frames=[];window.__stressTiles=[__round2Tilesets[0]];
  __scene.renderError.addEventListener((s,e)=>__errors.push(String(e)));
  __scene.postRender.addEventListener(()=>__frames.push(performance.now()));
  const center=__stressTiles[0].boundingSphere.center;
  window.__initial={position:Cesium.Cartesian3.clone(__scene.camera.positionWC),direction:Cesium.Cartesian3.clone(__scene.camera.directionWC),up:Cesium.Cartesian3.clone(__scene.camera.upWC)};
  for(const url of ['/splat-data/oracle-run/geo-newdefault/tileset.json','/Specs/Data/Cesium3DTiles/Batched/BatchedWithBatchTable/tileset.json','/Specs/Data/Cesium3DTiles/PointCloud/PointCloudRGB/tileset.json']){
   const t=await Cesium.Cesium3DTileset.fromUrl(url,{maximumScreenSpaceError:8,cacheBytes:1073741824});
   t.modelMatrix=Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(center,t.boundingSphere.center,new Cesium.Cartesian3()));
   __scene.primitives.add(t);__stressTiles.push(t);
  }
  const cart=Cesium.Cartographic.fromCartesian(center),lon=Cesium.Math.toDegrees(cart.longitude),lat=Cesium.Math.toDegrees(cart.latitude);
  window.__polygon=__scene.primitives.add(new Cesium.Primitive({geometryInstances:new Cesium.GeometryInstance({geometry:new Cesium.PolygonGeometry({polygonHierarchy:new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray([lon-.00003,lat-.00003,lon+.00003,lat-.00003,lon+.00003,lat+.00003,lon-.00003,lat+.00003])),height:cart.height+2,vertexFormat:Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat})}),appearance:new Cesium.MaterialAppearance({material:Cesium.Material.fromType('Checkerboard'),closed:false})}));
 });
 const settle=async()=>page.waitForFunction(()=>__stressTiles.every((t,i)=>{const p=t.gaussianSplatPrimitive;return t.tilesLoaded&&(i>1||(p?._numSplats>0&&!p._pendingSnapshot&&!p._needsSnapshotRebuild&&t._selectedTiles.every(x=>p._selectedTileSet.has(x))));}),null,{timeout:90000});
 const record=async name=>{result.stages.push(await page.evaluate(name=>({name,errors:__errors,tiles:__stressTiles.map(t=>({splats:t.gaussianSplatPrimitive?._numSplats,gpu:t.totalMemoryUsageInBytes,processing:t.statistics.numberOfTilesProcessing,requests:t.statistics.numberOfPendingRequests,selected:t._selectedTiles.length,loaded:t.tilesLoaded})),frames:__frames}),name));writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));};
 await settle();await record('initial');
 for(let cycle=0;cycle<3;cycle++){
  await page.evaluate(async cycle=>{
   __scene.requestRenderMode=cycle%2===0;__scene.maximumRenderTimeChange=Infinity;
   for(let n=0;n<120;n++){
    if(n%10===0){const budget=[0,33554432,1073741824][Math.floor(n/10)%3];for(const t of __stressTiles.slice(0,2)){t.cacheBytes=budget;t.maximumCacheOverflowBytes=0;t.maximumScreenSpaceError=n%20===0?4:12;}}
    __scene.camera.lookAt(__stressTiles[0].boundingSphere.center,new Cesium.HeadingPitchRange(n*.08,-.4,__stressTiles[0].boundingSphere.radius*(n%30<15?1.6:4)));
    __scene.requestRender();await new Promise(requestAnimationFrame);
   }
   __scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
   __scene.camera.setView({destination:__initial.position,orientation:{direction:__initial.direction,up:__initial.up}});
   for(const t of __stressTiles.slice(0,2)){t.cacheBytes=1073741824;t.maximumCacheOverflowBytes=536870912;t.maximumScreenSpaceError=8;}
   __scene.requestRender();
  },cycle);
  await settle();await record('recovered-'+cycle);
 }
 result.disposal=await page.evaluate(()=>{const gs=__stressTiles.slice(0,2).map(t=>t.gaussianSplatPrimitive);__scene.primitives.removeAll();return gs.map(p=>({destroyed:p.isDestroyed(),textures:p._texturesByteLength,geometry:p._geometryByteLength}));});
 await page.waitForTimeout(1000);result.afterErrors=await page.evaluate(()=>__errors);
}catch(e){result.failure=String(e);if(page)result.state=await page.evaluate(()=>({errors:window.__errors,tiles:window.__stressTiles?.map(t=>({splats:t.gaussianSplatPrimitive?._numSplats,pending:t.gaussianSplatPrimitive?._pendingSnapshot?.state,needed:t.gaussianSplatPrimitive?._needsSnapshotRebuild,selected:t._selectedTiles.length,ready:t.statistics.numberOfTilesWithContentReady,processing:t.statistics.numberOfTilesProcessing,requests:t.statistics.numberOfPendingRequests}))}));process.exitCode=1;}
finally{writeFileSync(dir+'/'+label+'.json',JSON.stringify(result));await browser.close();}
