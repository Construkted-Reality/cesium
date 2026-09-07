/* global Cesium */
import {prepareCloud} from "./loading-kernels.mjs";
const params=new URLSearchParams(location.search);
const mode=params.get("loading") || "base";
const stats=window.__loadingStats={mode,started:0,completed:0,cancelled:0,queuedPeak:0,inputBytes:0,outputBytes:0,decodeMs:0,packMs:0,mainMs:0,failures:0};
let id=0;
const workerCount=Number(params.get("workers")||1);
if(!Number.isInteger(workerCount)||workerCount<1||workerCount>4){throw new Error("workers must be an integer from 1 through 4");}
const slots=Array.from({length:workerCount},()=>({worker:undefined,active:undefined}));
const queue=[];
function ensureWorker(slot) {
  if(slot.worker){return;}
  slot.worker=new Worker("/tools/splat-perf/loading-worker.mjs",{type:"module"});
  slot.worker.onmessage=event=> {
    const job=slot.active;slot.active=undefined;
    if(event.data.id!==job.id){throw new Error("Worker result mismatch");}
    if(event.data.error){stats.failures++;slot.worker.terminate();slot.worker=undefined;job.reject(new Error(event.data.error));}
    else {
      stats.completed++;if(job.owner.isDestroyed()){stats.cancelled++;}
      stats.decodeMs+=event.data.decodeMs;stats.packMs+=event.data.packMs;stats.outputBytes+=event.data.outputBytes;
      if(params.get("workerJobs")==="1") {
        (stats.jobs ||= []).push({id:job.id,slot:slots.indexOf(slot),asset:job.owner._gltfResource?.url?.match(/oracle-run\/([^/]+)/)?.[1],queuedMs:job.started-job.queued,elapsedMs:performance.now()-job.started,decodeMs:event.data.decodeMs,packMs:event.data.packMs});
      }
      job.resolve(event.data.cloud);
    }
    dispatch();
  };
  slot.worker.onerror=event=> {
    stats.failures++;slot.active?.reject(new Error(event.message));slot.active=undefined;
    slot.worker.terminate();slot.worker=undefined;dispatch();
  };
}
function dispatch() {
  for(const slot of slots) {
    if(slot.active){continue;}
    while(queue.length) {
      const job=queue.shift();
      if(job.owner.isDestroyed()){stats.cancelled++;job.reject(new Error("Queued loader destroyed"));continue;}
      slot.active=job;ensureWorker(slot);
      const input=new Uint8Array(job.input);job.started=performance.now();
      stats.inputBytes+=input.byteLength;stats.started++;
      slot.worker.postMessage({id:job.id,input,options:job.options,schema:job.schema},[input.buffer]);
      break;
    }
  }
}
window.__loadingDecode=(input,options,owner,decode)=> {
  const schema=Object.keys(owner._primitive?.attributes||{}).filter(k=>k.includes("SH_DEGREE_")).map(k=> {
    const m=/SH_DEGREE_(\d+)_COEF_(\d+)/.exec(k);return m?`${m[1]}:${m[2]}`:"invalid";
  });
  if(mode==="worker"){return new Promise((resolve,reject)=> {
    queue.push({id:++id,input,options,owner,schema,resolve,reject,queued:performance.now()});stats.queuedPeak=Math.max(stats.queuedPeak,queue.length);dispatch();
  });}
  const started=performance.now();stats.started++;
  return decode(input,options).then(cloud=> {
    const decoded=performance.now();stats.decodeMs+=decoded-started;
    if(mode==="direct" && !owner.isDestroyed()){prepareCloud(cloud,schema);}
    stats.packMs+=performance.now()-decoded;stats.completed++;return cloud;
  });
};
window.__loadingQueueState=()=>({active:slots.some(slot=>!!slot.active),activeCount:slots.filter(slot=>slot.active).length,queued:queue.length});
window.__setPositionBudget=bytes=> {
  if(params.has("production")) { Cesium.GaussianSplatPrimitive.maximumCacheByteLength=bytes; return; }
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>1024*1024*1024){throw new Error("Budget must be an integer from 0 to 1 GiB");}
  window.__positionBudget=bytes;Cesium.GaussianSplatSorter.maximumCacheByteLength=bytes;
  if(Cesium.GaussianSplatSorter._taskProcessorReady){return Cesium.GaussianSplatSorter._sorterTaskProcessor.scheduleTask({cacheByteBudget:bytes});}
};
window.__setPositionBudget(Number(params.get("budgetMiB")||128)*1024*1024);
const schedule=Cesium.TaskProcessor.prototype.scheduleTask;
Cesium.TaskProcessor.prototype.scheduleTask=function(parameters,...rest) {
  if(!params.has("production") && this._workerPath.includes("gaussianSplatSorter")){parameters.cacheByteBudget=window.__positionBudget;}
  return schedule.call(this,parameters,...rest);
};

const install=window.__installTelemetry;
window.__installTelemetry=(scene,tilesets)=> {
  install(scene,tilesets);
  let frame=0;stats.budgetChanges=[];
  stats.startup=[];let previous=performance.now();
  if(params.get("mode")==="static"){scene.postRender.addEventListener(()=> {
    if(window.__benchPhase==="measuring"||window.__benchPhase==="idle"){return;}
    const now=performance.now();
    stats.startup.push({t:now,dt:now-previous,tiles:tilesets.filter(t=>!t.isDestroyed()).map(t=>({count:t.gaussianSplatPrimitive?._numSplats||0,loaded:t.tilesLoaded,pending:!!t.gaussianSplatPrimitive?._pendingSnapshot,selected:t._selectedTiles.length}))});
    previous=now;
  });}

  scene.preUpdate.addEventListener(()=> {
    if(params.get("budgetChanges")==="1" && window.__benchPhase==="measuring") {
      const values={0:256,120:64,240:0,360:128};
      if(values[frame]!==undefined) {window.__setPositionBudget(values[frame]*1048576);stats.budgetChanges.push({frame,MiB:values[frame]});}
      frame++;
    }
  });
};

if(params.get("wasmProbe")==="1") {
  const init=Cesium.TaskProcessor.prototype.initWebAssemblyModule;
  Cesium.TaskProcessor.prototype.initWebAssemblyModule=function(options) {
    if(this._workerPath==="gaussianSplatTextureGenerator"){this._workerPath=`${location.origin}/Build/CesiumUnminified/Workers/gaussianSplatTextureGenerator.js`;}
    return init.call(this,options);
  };
}

// Observe the production pool without changing its admission policy.
if (params.get("production") === "candidate" && Cesium.SpzDecoder) {
  const decoder = Cesium.SpzDecoder;
  const decode = decoder.decode;
  decoder.decode = function (...args) {
    const task = decode.apply(this, args);
    if (!task) { stats.busyRetries=(stats.busyRetries||0)+1; return task; }
    stats.started++;
    const active=decoder._slots.filter(s=>s.busy).length;
    stats.activePeak=Math.max(stats.activePeak||0,active);
    return task.then(result=> {stats.completed++;return result;},error=> {stats.failures++;throw error;});
  };
  window.__loadingQueueState=()=>({active:decoder._slots.some(s=>s.busy),activeCount:decoder._slots.filter(s=>s.busy).length,queued:0});
}
