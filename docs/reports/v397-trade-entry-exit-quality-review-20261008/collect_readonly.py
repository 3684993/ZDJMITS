import sqlite3,pathlib,json,urllib.request,datetime,time
root=pathlib.Path(__file__).resolve().parent
SECRET={'apikey','api_key','secret','password','token','authorization','accesskey','privatekey','signature'}
def redact(v):
 if isinstance(v,dict):return {k:('[REDACTED]' if any(s in k.lower().replace('_','') for s in SECRET) else redact(x)) for k,x in v.items()}
 if isinstance(v,list):return [redact(x) for x in v]
 return v
def save(name,v): (root/name).write_text(json.dumps(redact(v),ensure_ascii=False,indent=2),encoding='utf-8')
def db(name):
 c=sqlite3.connect('file:D:/MITS/data/'+name+'?mode=ro',uri=True,timeout=4);c.row_factory=sqlite3.Row;c.execute('PRAGMA query_only=ON');c.set_progress_handler(lambda:1 if time.monotonic()>deadline else 0,10000);return c
start=datetime.datetime.now(datetime.timezone.utc).isoformat();deadline=time.monotonic()+90
api={}
for name,path in {'health':'/health','closeout':'/api/v3/diagnostics/closeout','positions':'/api/v3/positions','orders':'/api/v3/orders','snapshot':'/api/v3/snapshot','resources':'/api/v3/brain/resources','aave':'/api/v3/trade-records?symbol=AAVEUSDT&limit=100','ethfi':'/api/v3/trade-records?symbol=ETHFIUSDC&limit=100'}.items():
 t=time.monotonic()
 try:
  with urllib.request.urlopen('http://127.0.0.1:8080'+path,timeout=8) as r:v=json.load(r)
  api[name]={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedMs':(time.monotonic()-t)*1000,'data':v}
 except Exception as e:api[name]={'error':str(e)}
 save('live-'+name+'.json',api[name])
c=db('zdj-settings.sqlite');c.execute('BEGIN');core=c.execute('SELECT payload,updated_at FROM runtime_state WHERE id=1').fetchone();save('durable-core.json',{'updatedAt':core['updated_at'],'data':json.loads(core['payload'])});print('core keys',list(json.loads(core['payload'])));print('kinds',[(r[0],r[1]) for r in c.execute('SELECT kind,count(*) FROM runtime_entities GROUP BY kind')])
kinds=('positions','entryOrders','entryIntents','manualOrders','manualIntents','tpOrders','tradePlans','executionFills','planExecutions')
entities={k:[json.loads(r['payload']) for r in c.execute('SELECT payload FROM runtime_entities WHERE kind=? LIMIT 10000',(k,))] for k in kinds};save('durable-entities.json',entities)
tr=[json.loads(r['payload']) for r in c.execute('SELECT payload FROM trade_records ORDER BY updated_at DESC LIMIT 5000')];save('trade-records-bounded.json',tr)
for symbol in ('AAVEUSDT','ETHFIUSDC'):
 save('events-'+symbol+'.json',[dict(r)|{'payload':json.loads(r['payload'])} for r in c.execute('SELECT * FROM runtime_events WHERE symbol=? AND ts>=? ORDER BY ts DESC LIMIT 1200',(symbol,1791417600000))])
 save('primary-'+symbol+'.json',[dict(r)|{'payload':json.loads(r['payload'])} for r in c.execute('SELECT * FROM ai_runs_archive WHERE symbol=? AND role=? ORDER BY started_at DESC LIMIT 100',(symbol,'PRIMARY_BRAIN'))])
resources=[dict(r) for r in c.execute('SELECT * FROM ai_resources')];save('durable-ai-resources.json',resources)
c.rollback();c.close()
c=db('v396-ownership.sqlite');save('provenance-cases.json',[dict(r)|{'payload':json.loads(r['payload'])} for r in c.execute('SELECT * FROM v396_order_provenance WHERE symbol IN (?,?)',('AAVEUSDT','ETHFIUSDC'))]);c.close()
save('capture-manifest.json',{'startedAt':start,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sqliteMode':'mode=ro/query_only, one bounded settings read transaction, independent ownership transaction','apiMethods':'GET localhost cached snapshots only','tradeRecordLimit':5000,'entityKindLimit':10000,'warnings':'not atomic across HTTP/settings/ownership; current independent field freshness must be checked'});print('records',len(tr),'entitycounts',{k:len(v) for k,v in entities.items()})
