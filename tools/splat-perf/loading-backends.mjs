import {chromium} from "@playwright/test";
import {writeFileSync} from "node:fs";
import {GPU_LAUNCH_ARGS} from "./bench.mjs";
const common=GPU_LAUNCH_ARGS.filter(x=>!x.startsWith("--use-angle=")&&!x.startsWith("--enable-features="));
const variants=[{name:"gl",args:[...common,"--use-angle=gl"]},{name:"gl-angle",args:[...common,"--use-gl=angle","--use-angle=gl"]},{name:"gl-ozone",args:[...common,"--use-gl=angle","--use-angle=gl","--ozone-platform=headless"]},{name:"vulkan",args:GPU_LAUNCH_ARGS}];
const results=[];
for(const v of variants) {
 const browser=await chromium.launch({channel:"chromium",headless:true,args:v.args});
 try {
  const page=await browser.newPage();await page.goto("about:blank");
  const result=await page.evaluate(()=>{const gl=document.createElement("canvas").getContext("webgl2");if(!gl){return {available:false};}const ext=gl.getExtension("WEBGL_debug_renderer_info");return {available:true,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),timer:!!gl.getExtension("EXT_disjoint_timer_query_webgl2")};});
  results.push({...v,...result});
 } catch(error){results.push({...v,error:String(error)});}
 finally {await browser.close();}
}
writeFileSync("/mnt/data2/cesium-splat-perf/loading-experiment-results/backends.json",JSON.stringify(results,null,2));console.log(JSON.stringify(results));
