import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { dirname,resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { observeNetwork,summarizeNetwork } from './network.mjs';
import { exerciseAppRecovery } from './app-recovery.mjs';
import { sampleProcessMemory } from './process-memory.mjs';
import { installAppProbe,attachAppProbe } from './app-probe.js';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const output=resolve(args.output || '/tmp/cache-app/results.json');await mkdir(dirname(output),{recursive:true});
const asset=JSON.parse(await readFile('tools/tile-cache/palace-route.json','utf8'));
const config={prefix:new URL('./',asset.url).href,decoded:args.decoded,decodedBytes:Number(args.decodedBytes || 1073741824),gpuBytes:args.gpuBytes && Number(args.gpuBytes)};
const bundle=await build({entryPoints:['packages/tile-cache/src/decoded.js'],bundle:true,format:'iife',globalName:'DecodedTest',platform:'browser',write:false});
const profile=await mkdtemp(join(tmpdir(),'cache-app-'));
const report={startedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),config,visits:[],errors:[],consoleErrors:[],scripts:[]};
const save=()=>writeFile(output,`${JSON.stringify(report,null,2)}\n`);
let context;
let memoryTimer, pendingMemory;
report.memorySamples=[];
const pendingScripts=[];
report.sourceHashes={};
for(const file of ['tools/tile-cache/app-run.mjs','tools/tile-cache/app-probe.js','tools/tile-cache/process-memory.mjs','tools/tile-cache/app-recovery.mjs','packages/tile-cache/src/decoded.js','tools/tile-cache/palace-route.json']){report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');}
report.decodedBundleHash=createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
try {
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,viewport:{width:1280,height:1000},deviceScaleFactor:1,args:['--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--ozone-platform=wayland','--remote-debugging-port=0']});
 await context.addInitScript({content:`${bundle.outputFiles[0].text}\n(${installAppProbe.toString()})(${JSON.stringify(config)});`});
 const memorySession=await context.browser().newBrowserCDPSession();
 report.memoryBeforePage=await sampleProcessMemory(memorySession);
 memoryTimer=setInterval(()=>{
  if(pendingMemory){return;}
  pendingMemory=sampleProcessMemory(memorySession).then(sample=>report.memorySamples.push(sample)).catch(error=>{report.memorySamplingError=String(error);}).finally(()=>{pendingMemory=undefined;});
 },1000);
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push({message:String(e),stack:e.stack}));page.on('console',m=>{if(m.type()==='error'){report.consoleErrors.push(m.text());}});
 page.on('response',response=>{if(response.request().resourceType()==='script'){
  const entry={url:response.url(),status:response.status(),contentType:response.headers()['content-type']};report.scripts.push(entry);
  if(/(?:construkted|Cesium)\.js(?:\?|$)/.test(response.url())){pendingScripts.push(response.body().then(body=>{entry.sha256=createHash('sha256').update(body).digest('hex');}).catch(e=>{entry.bodyError=String(e);}));}
 }});
 const network=await observeNetwork(context,page,{prefix:config.prefix,httpCache:true,profile});report.network=network.records;
 await page.goto(asset.page,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.Construkted?.cesiumViewer && window.cacheAppProbe?.tilesets.length,{},{timeout:120000});
 await page.getByText('Ok, thank you.',{exact:true}).click().catch(()=>{});
 report.environment=await page.evaluate(attachAppProbe);
 report.originalOptions=await page.evaluate(()=>window.cacheAppProbe.originalOptions);
 assert.match(report.environment.renderer,/NVIDIA RTX A4000/);
 report.storage=await page.evaluate(async()=>({estimate:await navigator.storage.estimate(),persisted:await navigator.storage.persisted()}));
 const route=args.probe==='true' ? [0] : asset.route;
 report.route=route;report.asset=asset;
 for(const [step,index] of route.entries()){
  const start=network.records.length;
  const v=await page.evaluate(p=>window.cacheAppProbe.visit(p),asset.poses[index]);
  v.transfer=summarizeNetwork(network.records.slice(start));v.network=network.records.slice(start);
  v.screenshot=`view-${step}-${index}.png`;
  const data=await page.evaluate(()=>window.cacheAppProbe.capture());
  const bytes=Buffer.from(data.split(',')[1],'base64');
  await writeFile(join(dirname(output),v.screenshot),bytes);
  v.memory=await sampleProcessMemory(memorySession);v.imageHash=createHash('sha256').update(bytes).digest('hex');
  report.visits.push(v);
  assert.equal(v.memoryAdjustedScreenSpaceError,8,'Application reduced requested detail');
  assert.deepEqual(v.errors,[]);assert.ok(!v.events.some(e=>e.name==='failed'));
  if(v.cache){assert.ok(v.cache.chargedBytes<=config.decodedBytes);assert.ok(v.cache.uniquePayloadBytes<=v.cache.chargedBytes);}
  if(step>=8){assert.deepEqual(v.visible,report.visits[index].visible);assert.equal(v.imageHash,report.visits[index].imageHash);}
  await save();
 }
 report.memoryAfterRoute=await sampleProcessMemory(memorySession);
 report.contextEvents=await page.evaluate(()=>window.cacheAppProbe.contextEvents);
 await Promise.all(pendingScripts);
 report.knownWordfenceScriptError=report.errors.length===1 && report.errors[0].message==="SyntaxError: Unexpected token '<'" && report.scripts.some(s=>s.url.includes('wordfence_syncAttackData') && s.contentType.includes('text/html'));
 assert.ok(!report.errors.length || report.knownWordfenceScriptError,'Unexpected application JavaScript error');
 assert.deepEqual(network.errors,[]);
 if(args.recovery){
  const errorStart=report.errors.length, consoleStart=report.consoleErrors.length;
  report.recovery=await exerciseAppRecovery(page,{mode:args.recovery,directory:dirname(output),pose:asset.poses[0],sampleMemory:()=>sampleProcessMemory(memorySession)});
  report.recovery.applicationErrors=report.errors.slice(errorStart);report.recovery.consoleErrors=report.consoleErrors.slice(consoleStart);
  report.recovery.sameReloadPixels=report.recovery.reloadHash===report.visits[0].imageHash;
  report.recovery.sameRestoredPixels=report.recovery.restoredHash===report.visits.at(-1).imageHash;
  report.recovery.recoveredWithoutReload=!report.recovery.afterRestore.lost && report.recovery.sameRestoredPixels && !report.recovery.afterRestore.errors.length;
  assert.ok(report.recovery.lossSupported && report.recovery.afterLoss.lost);
  assert.ok(report.recovery.sameReloadPixels,'Reload recovery pixels differ');
  if(config.decoded){assert.equal(report.recovery.afterLoss.cache.uniquePayloadBytes,0);}
 }
 report.complete=true;
} catch(error){report.error=String(error.stack);process.exitCode=1;}
finally{clearInterval(memoryTimer);await pendingMemory;report.completedAt=new Date().toISOString();await save();await context?.close();await rm(profile,{recursive:true,force:true});}
