import json,pathlib,sqlite3,gzip,shutil,hashlib
p=pathlib.Path('docs/reports/v397-trade-entry-exit-quality-review-20261008');c=sqlite3.connect('file:D:/MITS/data/zdj-settings.sqlite?mode=ro',uri=True);c.execute('PRAGMA query_only=ON');out={}
fields={'entryIntents':['id','symbol','side','planId','planCycleId','brainRunId','createdAt','idealPrice','profitTakePlan','horizonMinutes','planWarnings','confidence','leverage'],'entryOrders':['id','intentId','symbol','cycleId','price','filledQuantity','status','createdAt','updatedAt','exchangeOrderId','clientOrderId','quantity','fillTime'],'tradePlans':['planId','cycleId','symbol','side','targetPrice','entryReferencePrice','targetHorizonMinutes','entryTtlMinutes','managementDurationMs','invalidationPredicate','predicateLevel','thesis','costs','economics','persistedAt','quantityUnits','notionalUsd','marginUsd','leverage']}
for kind in ('manualOrders','tpOrders','executionFills','entryIntents','entryOrders','tradePlans'):
 vals=[]
 for (raw,) in c.execute('SELECT payload FROM runtime_entities WHERE kind=? LIMIT 10000',(kind,)):
  v=json.loads(raw);vals.append({k:v.get(k) for k in fields[kind]} if kind in fields else v)
 out[kind]=vals
c.close();(p/'analysis-entities-slim.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
f=p/'durable-entities.json';g=p/'durable-entities.json.gz'
with f.open('rb') as src,g.open('wb') as dst,gzip.GzipFile(fileobj=dst,mode='wb',mtime=0) as gz:shutil.copyfileobj(src,gz,1024*1024)
def sha(file):
 h=hashlib.sha256()
 with file.open('rb') as s:
  for b in iter(lambda:s.read(1048576),b''):h.update(b)
 return h.hexdigest()
(p/'durable-entities-hashes.json').write_text(json.dumps({'rawBytes':f.stat().st_size,'gzipBytes':g.stat().st_size,'rawSha256':sha(f),'gzipSha256':sha(g),'storage':'lossless gzip is authoritative GitHub representation; raw locally available without deleting/altering runtime DB'},indent=2),encoding='utf-8');print('slimbytes', (p/'analysis-entities-slim.json').stat().st_size,'gzbytes',g.stat().st_size)
s=p/'project_offline.mjs';s.write_text(s.read_text(encoding='utf-8').replace("read('durable-entities.json')","read('analysis-entities-slim.json')"),encoding='utf-8')
