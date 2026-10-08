"""Current canonical settings digest and maintained checkout identity, without secret payloads."""
import pathlib,sqlite3,json,hashlib,datetime,subprocess,sys,re
root=pathlib.Path(__file__).resolve().parents[1]
label=sys.argv[1] if len(sys.argv)>1 else 'pre-start'
if not re.fullmatch('[a-z0-9-]+',label):raise SystemExit('INVALID_LABEL')
db=sqlite3.connect(pathlib.Path('D:/MITS/data/zdj-settings.sqlite').as_uri()+'?mode=ro',uri=True)
db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
version,payload,updated=db.execute('SELECT version,payload,updated_at FROM settings WHERE id=1').fetchone();settings=json.loads(payload)
exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v398_entry_origins'").fetchone()
origins=db.execute('SELECT count(*) FROM v398_entry_origins WHERE released_at=0').fetchone()[0] if exists else None
events=[]
if '--events' in sys.argv:
    identity=json.loads(pathlib.Path('D:/MITS/data/runtime/engine-instance.json').read_text(encoding='utf-8'))
    def safe(value):
        if isinstance(value,list):return [safe(v) for v in value]
        if isinstance(value,dict):return {k:safe(v) for k,v in value.items() if k not in ['apiKey','apiSecret','password','cookie','authorization','access_token','refresh_token','inputPreview','outputPreview','prompt','accountId','accountAlias']}
        return value
    for kind,ts,event_payload in db.execute("SELECT type,ts,payload FROM runtime_events WHERE ts>=? AND (type LIKE 'TP_%' OR type IN ('ENTRY_SUBMIT_ATTEMPTED','ENTRY_ADAPTER_REQUEST_FACTS','ENTRY_ORIGIN_AUTHORIZATION_REFUSED','ENGINE_INSTANCE_STARTED')) ORDER BY ts LIMIT 128",(identity['startedAt'],)):
        events.append({'type':kind,'ts':ts,'payload':safe(json.loads(event_payload))})
db.rollback();db.close()
git=lambda directory,args:subprocess.check_output(['git','-C',str(directory),*args],text=True).strip()
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'databaseMode':'read-only/query-only','settingsVersion':version,'settingsUpdatedAt':updated,'settingsPayloadSha256':hashlib.sha256(payload.encode()).hexdigest(),'environment':settings['connections']['exchange']['environment'],'executionMode':settings['connections']['executionMode'],'activeV398Origins':origins,'releaseHead':git(root,['rev-parse','HEAD']),'canonicalHead':git('D:/MITS',['rev-parse','HEAD']),'preservedCanonicalStatus':git('D:/MITS',['status','--short']).splitlines(),'taskSettingsWrites':0,'taskExchangeWrites':0}
if '--events' in sys.argv:result['currentInstanceBoundedEvents']=events;result['eventLimit']=128
if '--process' in sys.argv:
    receipt=json.loads(pathlib.Path('D:/MITS/data/runtime/engine-launch-receipt.json').read_text(encoding='utf-8'))
    def tail_json(file):
        with pathlib.Path(file).open('rb') as stream:
            size=stream.seek(0,2);cut=max(0,size-65536);stream.seek(cut);raw=stream.read(65536)
        lines=raw.decode('utf-8',errors='replace').splitlines()
        if cut:lines=lines[1:]
        return [json.loads(line) for line in lines if line.strip()]
    process=tail_json('D:/MITS/data/runtime-logs/engine-process-lifecycle.jsonl')
    host=tail_json('D:/MITS/data/runtime-logs/engine-launch-lifecycle.jsonl')
    result['processProof']={'receipt':receipt,'processEvents':[e for e in process if e.get('pid')==receipt['pid']],'hostEvents':[e for e in host if e.get('launchId')==receipt['launchId']],'bytesPerFileBound':65536,'actualEngineStartsThisTask':1,'actualEngineStopsThisTask':0,'preflightRefusalBeforeAnyChildStart':True}
out=root/f'docs/reports/v398-entry-sizing-quality-review/evidence-20261008/local-identity-{label}.json';out.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:result[k] for k in ['settingsVersion','environment','executionMode','activeV398Origins','taskSettingsWrites']}))
