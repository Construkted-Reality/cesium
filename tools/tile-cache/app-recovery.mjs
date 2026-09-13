import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {attachAppProbe} from './app-probe.js';

export async function exerciseAppRecovery(page,{mode,directory,pose,sampleMemory}) {
 const result={mode};
 result.before=await page.evaluate(()=>({cache:window.cacheAppProbe.cache?.stats(),frames:window.cacheAppProbe.frameTimes.length,contextLost:window.Construkted.cesiumViewer.scene.context._gl.isContextLost()}));
 const session=await page.context().newCDPSession(page);
 const object=await session.send('Runtime.evaluate',{expression:'window.Construkted.cesiumViewer.canvas'});
 const listeners=await session.send('DOMDebugger.getEventListeners',{objectId:object.result.objectId});
 result.contextListeners=listeners.listeners.filter(x=>x.type.includes('webglcontext')).map(x=>({type:x.type,scriptId:x.scriptId,lineNumber:x.lineNumber}));
 result.lossSupported=await page.evaluate(allow=>{
  const canvas=window.Construkted.cesiumViewer.canvas;
  const gl=window.Construkted.cesiumViewer.scene.context._gl;
  const extension=gl.getExtension('WEBGL_lose_context');
  window.cacheAppProbe.loseExtension=extension;
  if(allow){canvas.addEventListener('webglcontextlost',event=>event.preventDefault(),{once:true});}
  extension?.loseContext();return !!extension;
 },mode==='assisted');
 await page.waitForTimeout(750);
 result.afterLoss=await page.evaluate(()=>({lost:window.Construkted.cesiumViewer.scene.context._gl.isContextLost(),events:window.cacheAppProbe.contextEvents,cache:window.cacheAppProbe.cache?.stats(),errors:window.cacheAppProbe.errors}));
 await page.evaluate(()=>window.cacheAppProbe.loseExtension?.restoreContext());
 await page.waitForTimeout(2000);
 result.afterRestore=await page.evaluate(()=>({lost:window.Construkted.cesiumViewer.scene.context._gl.isContextLost(),events:window.cacheAppProbe.contextEvents,cache:window.cacheAppProbe.cache?.stats(),errors:window.cacheAppProbe.errors,frames:window.cacheAppProbe.frameTimes.length,renderLoop:window.Construkted.cesiumViewer.useDefaultRenderLoop}));
 result.afterRestoreMemory=await sampleMemory();
 const data=await page.evaluate(()=>Promise.race([window.cacheAppProbe.capture(),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]));
 if(data){const bytes=Buffer.from(data.split(',')[1],'base64');result.restoredScreenshot='recovery-restored.png';await writeFile(join(directory,result.restoredScreenshot),bytes);result.restoredHash=createHash('sha256').update(bytes).digest('hex');}
 // Reload is an existing browser recovery action, not a new app handler.
 const started=Date.now();
 await page.reload({waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.Construkted?.cesiumViewer && window.cacheAppProbe?.tilesets.length,{},{timeout:120000});
 await page.getByText('Ok, thank you.',{exact:true}).click({timeout:2000}).catch(()=>{});
 result.reloadEnvironment=await page.evaluate(attachAppProbe);
 result.reloadVisit=await page.evaluate(p=>window.cacheAppProbe.visit(p),pose);
 result.reloadWallMs=Date.now()-started;
 const reloaded=await page.evaluate(()=>window.cacheAppProbe.capture());
 const bytes=Buffer.from(reloaded.split(',')[1],'base64');result.reloadScreenshot='recovery-reloaded.png';await writeFile(join(directory,result.reloadScreenshot),bytes);result.reloadHash=createHash('sha256').update(bytes).digest('hex');
 result.afterReloadMemory=await sampleMemory();
 await session.detach();
 return result;
}
