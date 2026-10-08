"""Bounded localhost-only startup observations; never invokes lifecycle or trading."""
import datetime, json, pathlib, time
from collect_stability import read
root=pathlib.Path(__file__).resolve().parent
target=root/'trade-correction-bootstrap-probes.jsonl'
if target.exists(): raise SystemExit('Refusing to overwrite startup evidence')
deadline=time.monotonic()+180
while True:
    _,health=read(('health','/health'));h=health.get('data',{})
    closeout=None
    if h.get('status')=='READY': _,closeout=read(('closeout','/api/v3/diagnostics/closeout'))
    private=(closeout or {}).get('data',{}).get('pipeline',{}).get('binancePrivate',{})
    ready=h.get('status')=='READY' and private.get('status')=='READY'
    row={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'health':health,'closeout':closeout,'ready':ready}
    with target.open('a',encoding='utf-8') as output: output.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps({'at':row['capturedAt'],'health':h.get('status'),'pid':h.get('pid'),'private':private.get('status'),'ready':ready}),flush=True)
    if ready: break
    if time.monotonic()>=deadline: raise SystemExit('STARTUP_INCOMPLETE: process/endpoint inspection required, no automatic restart')
    time.sleep(5)
