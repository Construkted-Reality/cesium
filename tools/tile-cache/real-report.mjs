import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
const file = process.argv[2];
assert.ok(file, "Supply a real-run results.json path");
const report = JSON.parse(await readFile(file, "utf8"));
const groups = {};
for (const run of report.runs.filter(run => run.complete)) {
  (groups[run.condition.name] ||= []).push(run);
}
function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const n = sorted.length;
  return { n, min: sorted[0], median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2, max: sorted.at(-1) };
}
const summary = {
  asset: report.asset.name, commit: report.commit, complete: report.completedAt || null,
  errors: report.runs.filter(run => run.error).map(run => ({ condition: run.condition.name, repetition: run.repetition, error: run.error })),
  conditions: Object.fromEntries(Object.entries(groups).map(([name, runs]) => [name, {
    revisitMs: distribution(runs.flatMap(r => (r.revisits || [{ step: 2 }]).map(v => r.visits[v.step].settleMs))),
    perPose: Object.fromEntries(report.asset.poses.map((pose, index) => [pose.name, distribution(runs.flatMap(r => (r.revisits || [{ step: 2, poseIndex: 0 }]).filter(v => v.poseIndex === index).map(v => r.visits[v.step].settleMs)))]).filter(([, data]) => data.n)),
    returnMs: distribution(runs.map(r => r.visits[r.returnStep ?? 2].settleMs)),
    initialViewMs: distribution(runs.map(r => r.setupMs + r.visits[0].settleMs)),
    returnRequests: runs.map(r => r.visits[r.returnStep ?? 2].transfer.upstreamRequests),
    returnBytes: runs.map(r => r.visits[r.returnStep ?? 2].transfer.upstreamEncodedBytes),
    evictedAtB: runs.map(r => r.evictedAtB), reloadedAtA: runs.map(r => r.reloadedAtA),
    sameReturnPixels: runs.every(r => r.sameReturnPixels),
    offlineRestarts: runs.filter(r => r.restart).length,
    sameRestartPixels: runs.filter(r => r.restart).every(r => r.sameRestartPixels),
  }]))
};
await writeFile(join(dirname(file), "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rows = Object.entries(summary.conditions).map(([name, data]) => `<tr><td>${escape(name)}</td><td>${data.returnMs.n}</td><td>${data.returnMs.median.toFixed(1)}</td><td>${data.returnMs.min.toFixed(1)} to ${data.returnMs.max.toFixed(1)}</td><td>${escape(data.returnRequests.join(", "))}</td></tr>`).join("");
const gallery = report.runs.filter(r => r.complete).map(r => ({ condition: r.condition.name, repetition: r.repetition,
  views: [...r.visits, ...(r.restart ? [r.restart] : [])].map((v, i) => ({ label: `${i < r.visits.length ? `Step ${i + 1}` : "Offline restart"}: ${v.pose.name}`, pose: v.pose, screenshot: v.screenshot, visible: v.visible, tileDetails: v.tileDetails, poseInspection: v.poseInspection, settleMs: v.settleMs, transfer: v.transfer, residentBytes: v.residentBytes })) }));
const data = JSON.stringify(gallery).replace(/</g, "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Palace camera measurements</title>
<style>body{font:16px system-ui;margin:2rem auto;max-width:1400px;padding:0 1rem;background:#111820;color:#e5edf4}h1{font-size:1.7rem}a{color:#9fd5ff}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{text-align:left;border-bottom:1px solid #45525f;padding:.6rem}select{font:inherit;padding:.5rem;margin:.5rem}#views{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:1rem}article{background:#202c37;padding:1rem;border-radius:8px}img{width:100%;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}small{color:#b0c0cc}@media(max-width:500px){#views{display:block}article{margin:1rem 0}body{margin:.5rem auto}table{font-size:12px}}</style>
<h1>Palace of Fine Arts: camera and cache measurements</h1><p>Direct Wasabi HTTPS on the RTX A4000. Camera route: ${escape((report.route || [0, 1, 0]).map(i => report.asset.poses[i].name).join(" → "))}. Each screenshot is a settled 1280 × 720 Cesium canvas.</p><p>Return time includes selection, decoding, upload and four stable frames. Black areas are outside the captured model; globe and imagery are disabled.</p>
<table><thead><tr><th>Condition</th><th>Runs</th><th>Median return ms</th><th>Min to max ms</th><th>Wasabi requests on return</th></tr></thead><tbody>${rows}</tbody></table>
<label for="run">Choose a condition and repetition:</label><select id="run"></select><div id="views"></div><p><a href="results.json">Raw measurements</a> · <a href="summary.json">Summary JSON</a></p>
<script>const runs=${data};const select=document.querySelector('#run');for(const [i,r] of runs.entries()){const o=document.createElement('option');o.value=i;o.textContent=[r.condition,' / repetition ',r.repetition+1].join('');select.append(o)}function render(){const root=document.querySelector('#views');root.replaceChildren();for(const v of runs[select.value||0]?.views||[]){const card=document.createElement('article');const title=document.createElement('h2');title.textContent=v.label;const a=document.createElement('a');a.href=v.screenshot;const img=document.createElement('img');img.src=v.screenshot;img.alt=[v.label,' for ',runs[select.value||0].condition].join('');img.loading='lazy';a.append(img);const p=document.createElement('p');p.textContent=[v.settleMs.toFixed(1),' ms; ',v.visible.length,' visible tiles; ',v.transfer.upstreamRequests,' Wasabi requests; ',(v.transfer.upstreamEncodedBytes/1048576).toFixed(2),' MiB transferred.'].join('');const details=document.createElement('details');const heading=document.createElement('summary');heading.textContent='Exact camera pose and selected tiles';const pre=document.createElement('pre');pre.textContent=JSON.stringify({pose:v.pose,poseInspection:v.poseInspection,residentBytes:v.residentBytes,visible:v.visible,tileDetails:v.tileDetails},null,2);details.append(heading,pre);card.append(title,a,p,details);root.append(card)}}select.addEventListener('change',render);render();</script></html>`;
await writeFile(join(dirname(file), "gallery.html"), html);
console.log(JSON.stringify(summary, null, 2));
