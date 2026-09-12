from pathlib import Path
import json,re
p=Path(__file__).parent
rows=[]
for name in ['baseline64','baseline128','source64','source128','settle32','bike-baseline','bike-candidate','bike-final','combined64','baseline0','settle0']:
 f=p/(name+'.json')
 if not f.exists(): continue
 d=json.loads(f.read_text());tr=d['limited']['trace'];ev=d['limited']['events'];rec=d.get('recovery',{}).get('trace',[]);end=tr[-1]['time'];late=[r for r in tr if r['time']>=end-10000]
 rows.append(dict(name=name,failure=d.get('failure'),errors=d.get('errors'),loads=sum(e['name']=='tileLoad'for e in ev),unloads=sum(e['name']=='tileUnload'for e in ev),lateEvents=sum(e['time']>=end-10000 for e in ev),peakMiB=max(t['bytes']for t in tr)/1048576,endMiB=tr[-1]['bytes']/1048576,endSse=tr[-1]['sse'],lateMinSplats=min(t['splats']for t in late),lateMaxSplats=max(t['splats']for t in late),endProcessing=tr[-1]['processing'],recoverySeconds=(rec[-1]['time']-rec[0]['time'])/1000 if rec else None))
(p/'summary.json').write_text(json.dumps(rows,indent=2))
for row in rows:print(row)
