export async function workerHeaps(browser) {
 const cdp=await browser.newBrowserCDPSession(),out=[];
 try {
  const {targetInfos}=await cdp.send('Target.getTargets');
  for(const target of targetInfos.filter(x=>x.type==='worker')){
   const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let id=0;
   const send=async method=>{const next=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(new Error('Worker heap timeout'));},15000);const listener=event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id!==next)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);message.error?reject(new Error(JSON.stringify(message.error))):resolve(message.result);};cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:next,method})}).catch(reject);});};
   try{await send('HeapProfiler.collectGarbage');out.push({url:target.url,heap:await send('Runtime.getHeapUsage')});}catch(error){out.push({url:target.url,error:String(error)});}finally{await cdp.send('Target.detachFromTarget',{sessionId});}
  }
 }finally{await cdp.detach();}
 return out;
}
