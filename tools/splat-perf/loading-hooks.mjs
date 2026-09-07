/* global Cesium */
import {prepareCloud} from "./loading-kernels.mjs";
const params=new URLSearchParams(location.search);
const mode=params.get("loading") || "base";
const stats=window.__loadingStats={mode,started:0,completed:0,cancelled:0,queuedPeak:0,inputBytes:0,outputBytes:0,decodeMs:0,packMs:0,mainMs:0,failures:0};
let worker, active, id=0;
const queue=[];
function ensureWorker() {
    if(!worker) {
      worker=new Worker("/tools/splat-perf/loading-worker.mjs",{type:"module"});
      worker.onmessage=event=> {
        const job=active; active=undefined;
        if(event.data.id!==job.id){throw new Error("Worker result mismatch");}
        if(event.data.error) {stats.failures++;worker.terminate();worker=undefined;job.reject(new Error(event.data.error));}
        else {stats.completed++;if(job.owner.isDestroyed()){stats.cancelled++;}stats.decodeMs+=event.data.decodeMs;stats.packMs+=event.data.packMs;stats.outputBytes+=event.data.outputBytes;job.resolve(event.data.cloud);}
        dispatch();
      };
      worker.onerror=event=> {
        const error=new Error(event.message);stats.failures++;
        active?.reject(error);active=undefined;
        for(const job of queue){job.reject(error);}queue.length=0;
        worker.terminate();worker=undefined;
      };
    }
}
function dispatch() {
  if(active){return;}
  while(queue.length) {
    const job=queue.shift();
    if(job.owner.isDestroyed()) {stats.cancelled++;job.reject(new Error("Queued loader destroyed"));continue;}
    active=job;
    ensureWorker();
    const input=new Uint8Array(job.input);
    stats.inputBytes+=input.byteLength;stats.started++;
    worker.postMessage({id:job.id,input,options:job.options,schema:job.schema},[input.buffer]);
    return;
  }
}
window.__loadingDecode=(input,options,owner,decode)=> {
  const schema=Object.keys(owner._primitive?.attributes||{}).filter(k=>k.includes("SH_DEGREE_")).map(k=> {
    const m=/SH_DEGREE_(\d+)_COEF_(\d+)/.exec(k);return m?`${m[1]}:${m[2]}`:"invalid";
  });
  if(mode==="worker"){return new Promise((resolve,reject)=> {
    queue.push({id:++id,input,options,owner,schema,resolve,reject});stats.queuedPeak=Math.max(stats.queuedPeak,queue.length);dispatch();
  });}
  const started=performance.now();stats.started++;
  return decode(input,options).then(cloud=> {
    const decoded=performance.now();stats.decodeMs+=decoded-started;
    if(mode==="direct" && !owner.isDestroyed()){prepareCloud(cloud,schema);}
    stats.packMs+=performance.now()-decoded;stats.completed++;return cloud;
  });
};
window.__loadingQueueState=()=>({active:!!active,queued:queue.length});
window.__setPositionBudget=bytes=> {
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>1024*1024*1024){throw new Error("Budget must be an integer from 0 to 1 GiB");}
  window.__positionBudget=bytes;Cesium.GaussianSplatSorter.maximumCacheByteLength=bytes;
  if(Cesium.GaussianSplatSorter._taskProcessorReady){return Cesium.GaussianSplatSorter._sorterTaskProcessor.scheduleTask({cacheByteBudget:bytes});}
};
window.__setPositionBudget(Number(params.get("budgetMiB")||128)*1024*1024);
const schedule=Cesium.TaskProcessor.prototype.scheduleTask;
Cesium.TaskProcessor.prototype.scheduleTask=function(parameters,...rest) {
  if(this._workerPath.includes("gaussianSplatSorter")){parameters.cacheByteBudget=window.__positionBudget;}
  return schedule.call(this,parameters,...rest);
};

const install=window.__installTelemetry;
window.__installTelemetry=(scene,tilesets)=> {
  install(scene,tilesets);
  let frame=0;stats.budgetChanges=[];
  scene.preUpdate.addEventListener(()=> {
    if(params.get("budgetChanges")==="1" && window.__benchPhase==="measuring") {
      const values={0:256,120:64,240:0,360:128};
      if(values[frame]!==undefined) {window.__setPositionBudget(values[frame]*1048576);stats.budgetChanges.push({frame,MiB:values[frame]});}
      frame++;
    }
  });
};
