"""Bounded SQLite read-only research. Never import runtime, secrets, or submit adapters."""
import sqlite3, json, pathlib, datetime, sys, subprocess, urllib.request, gzip, hashlib, csv
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
OUT.mkdir(parents=True, exist_ok=True)
def save(name, obj):
    (OUT/name).write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
def connect(name):
    p = pathlib.Path('D:/MITS/data') / name
    c = sqlite3.connect(p.as_uri()+'?mode=ro', uri=True, timeout=5)
    c.execute('pragma query_only=on')
    c.execute('pragma busy_timeout=5000')
    return c
if '--schema' in sys.argv:
    result = {}
    for name in ['zdj-settings.sqlite','v396-ownership.sqlite','trading-quality.sqlite']:
        with connect(name) as c:
            result[name] = c.execute("select name,sql from sqlite_master where type='table' limit 100").fetchall()
    save('sqlite-schema.json', result)
    print(json.dumps({k:[r[0] for r in v] for k,v in result.items()}))
    sys.exit(0)
with connect('zdj-settings.sqlite') as c:
    c.execute('begin')
    kinds = c.execute('select distinct kind from runtime_entities limit 100').fetchall()
    core = c.execute('select payload,updated_at from runtime_state where id=1').fetchone()
    obj=json.loads(core[0]) if core else {}
    save('local-state-shape.json',{'kinds':kinds,'coreKeys':list(obj),'updatedAt':core[1] if core else None,
        'valueShapes':{k:list(v)[:50] if isinstance(v,dict) else type(v).__name__ for k,v in obj.items()}})
    records=[json.loads(r[0]) for r in c.execute('select payload from trade_records order by updated_at desc limit 2001')]
    if len(records)>2000: raise RuntimeError('TRADE_RECORD_BOUND_REACHED')
    save('trade-records-bounded.json',records)
    print(json.dumps({'recordCount':len(records),'keys':list(records[0]) if records else [],'coreKeys':list(obj),'kinds':kinds}))
    def safe(value):
        if isinstance(value,dict):
            return {k:safe(v) for k,v in value.items() if k.lower() not in ['apikey','apisecret','token','authorization','credentialref','accountid','account_id','account','prompt','systemprompt','userprompt','rawprompt','messages','inputpreview','outputpreview','rawresponse']}
        if isinstance(value,list): return [safe(v) for v in value]
        return value
    save('persisted-account-asof.json',safe(obj.get('account',{})))
    entities={}
    limits={'positions':100,'entryIntents':5000,'entryOrders':5000,'executionFills':10000,'tradePlans':5000,'entryReservations':5000,'tpOrders':5000,'manualIntents':1000,'manualOrders':1000}
    for kind,bound in limits.items():
        rows=c.execute('select entity_id,payload from runtime_entities where kind=? order by entity_id limit ?', (kind,bound+1)).fetchall()
        if len(rows)>bound: raise RuntimeError(kind+'_BOUND_REACHED')
        entities[kind]=[safe(json.loads(r[1])) for r in rows]
    allocation_ids={i.get('allocationPlan',{}).get('planId') for i in entities['entryIntents'] if isinstance(i.get('allocationPlan'),dict)}
    entities['allocationPlans']=[]
    for id in sorted(i for i in allocation_ids if i):
        r=c.execute('select payload from runtime_entities where kind=? and entity_id=?',('allocationPlans',id)).fetchone()
        if r: entities['allocationPlans'].append(safe(json.loads(r[0])))
    payload=json.dumps(entities,ensure_ascii=False,separators=(',',':')).encode()
    (OUT/'bounded-entities.json.gz').write_bytes(gzip.compress(payload,mtime=0))
    save('bounded-entities-manifest.json',{'counts':{k:len(v) for k,v in entities.items()},'uncompressedSha256':hashlib.sha256(payload).hexdigest(),'limits':limits})
    save('positions-asof.json',{'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'READ_ONLY_PERSISTED_SQLITE_NOT_FRESH_EXCHANGE','coreUpdatedAt':core[1], 'positions':entities['positions']})
    settings=c.execute('select version,payload,updated_at from settings where id=1').fetchone()
    cfg=json.loads(settings[1])
    save('settings-policy-subset.json',{'version':settings[0],'updatedAt':settings[2],'environment':cfg.get('connections',{}).get('exchange',{}).get('environment'),'executionMode':cfg.get('connections',{}).get('executionMode'),**{k:safe(cfg.get(k)) for k in ['entry','takeProfit','tradeEconomics','riskGovernance','portfolio','positionManagement']}})
    ids={r.get('entryRunId') for r in records if r.get('entryRunId')}
    ids.update(r.get('brainRunId') for r in entities['entryIntents'] if r.get('brainRunId'))
    runs={}
    for id in sorted(ids):
        r=c.execute('select payload from ai_runs_archive where run_id=?',(id,)).fetchone()
        if r and r[0] and r[0]!='{}':
            run=json.loads(r[0])
            if isinstance(run.get('inputPreview'),str) and len(run['inputPreview'])<=262144:
                try:
                    packet=json.loads(run['inputPreview']).get('packet',{})
                    if packet.get('packetId')==run.get('packetId') and isinstance(packet.get('createdAt'),(int,float)):
                        run['contextCreatedAt']=packet['createdAt']
                        run['contextTimestampExtraction']='Exact archived packetId match; full private prompt excluded'
                except (ValueError,TypeError): pass
            runs[id]=safe(run)
    runbytes=json.dumps(runs,ensure_ascii=False,separators=(',',':')).encode()
    (OUT/'linked-primary-runs.json.gz').write_bytes(gzip.compress(runbytes,mtime=0))
    save('collection-boundaries.json',{'source':'SQLite mode=ro + query_only + single read transaction, WAL observed normally; no immutable','collectedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runtimeUpdatedAt':core[1],'recordCount':len(records),'recordLimit':2000,'runsRequested':len(ids),'runsPresent':len(runs),'readOnlyQueries':True,'taskDatabaseWrites':0,'taskExchangeWrites':0,'productionWritesCurrent':'UNKNOWN_ENGINE_OFFLINE','limits':limits,'redaction':'credential keys, raw prompts/messages, account labels omitted recursively; native order identity retained'})
    print(json.dumps({'entityCounts':{k:len(v) for k,v in entities.items()},'runsPresent':len(runs),'positionKeys':list(entities['positions'][0]) if entities['positions'] else []}))
