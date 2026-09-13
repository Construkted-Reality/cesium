import { readFile,readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
export async function sampleProcessMemory(session) {
 const {processInfo}=await session.send('SystemInfo.getProcessInfo');
 const root=processInfo.find(p=>p.type==='browser').id;
 const entries=await readdir('/proc');
 const relations=await Promise.all(entries.filter(x=>/^\d+$/.test(x)).map(async pid=>{
  try {const text=await readFile(`/proc/${pid}/status`,'utf8');return {pid:Number(pid),parent:Number(text.match(/^PPid:\s*(\d+)/m)[1])};} catch{return null;}
 }));
 const ids=new Set([root]);let changed=true;
 while(changed){changed=false;for(const p of relations){if(p&&ids.has(p.parent)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}}
 const processes=[];
 for(const pid of ids){try{
  const text=await readFile(`/proc/${pid}/smaps_rollup`,'utf8');
  const field=name=>Number(text.match(new RegExp(`^${name}:\\s*(\\d+)`,'m'))?.[1]||0)*1024;
  const cmd=(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0');
  processes.push({pid,type:cmd.join(' ').match(/(?:^|\s)(--type=\S+)/)?.[1]||'browser',rss:field('Rss'),pss:field('Pss'),privateBytes:field('Private_Clean')+field('Private_Dirty')});
 }catch{/* Processes may exit between the directory and memory reads. */}}
 const gpu=await execute('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits']);
 return {at:Date.now(),processes,pss:processes.reduce((s,p)=>s+p.pss,0),rss:processes.reduce((s,p)=>s+p.rss,0),privateBytes:processes.reduce((s,p)=>s+p.privateBytes,0),deviceUsedMiB:gpu.stdout.trim(),note:'PSS sums this browser process tree. RSS double counts shared pages. GPU usage is device-wide, not isolated to this page.'};
}
