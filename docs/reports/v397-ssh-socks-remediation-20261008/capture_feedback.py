"""One read-only local feedback capture, separate from timed acceptance samples."""
import datetime, json, pathlib, re, sys
from collect_stability import read, sample
root=pathlib.Path(__file__).resolve().parent
label=sys.argv[1]
if not re.fullmatch('[a-z0-9-]+',label): raise SystemExit('Invalid evidence label')
target=root/(label+'.json')
if target.exists(): raise SystemExit('Refusing to overwrite evidence')
value=sample(compact=False)
_,metrics=read(('httpMetrics','/api/v3/diagnostics/http'))
value['httpMetrics']=metrics
target.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
endpoints=value['endpoints'];pipeline=endpoints.get('closeout',{}).get('data',{}).get('pipeline',{})
routes=endpoints.get('governance',{}).get('data',{}).get('routes',[])
print(json.dumps({'at':value['capturedAt'],'health':endpoints['health'].get('data',{}).get('status'),
 'private':pipeline.get('binancePrivate'),'tp':pipeline.get('takeProfit'),'freshMarkets':pipeline.get('freshMarkets'),
 'incidents':endpoints.get('incidents',{}).get('data',{}).get('active',[]),
 'routes':[{'route':r.get('rest',{}).get('routeIdentity'),'budget':{k:r.get('requestBudget',{}).get(k) for k in ('status','queuePressure','queued','decisions','laneStats')}} for r in routes],
 'httpMetrics':metrics},ensure_ascii=True))
