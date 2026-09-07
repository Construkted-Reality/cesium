import { loadSpz } from "../../node_modules/@spz-loader/core/dist/index.js";
import { prepareCloud } from "./loading-kernels.mjs";
let chain=Promise.resolve();
self.onmessage=event=> {
  const {id,input,options,schema}=event.data;
  chain=chain.then(async()=> {
    try {
      const start=performance.now();
      const cloud=await loadSpz(input,options);
      const decoded=performance.now();
      prepareCloud(cloud,schema);
      const packed=performance.now();
      const buffers=[...new Set(Object.values(cloud).filter(ArrayBuffer.isView).map(v=>v.buffer))];
      self.postMessage({id,cloud,decodeMs:decoded-start,packMs:packed-decoded,outputBytes:buffers.reduce((s,b)=>s+b.byteLength,0)},buffers);
    } catch(error) {self.postMessage({id,error:String(error)});}
  });
};
