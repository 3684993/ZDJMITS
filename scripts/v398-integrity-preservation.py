"""Bounded read-only completion comparison. No live database or lifecycle writes."""
import pathlib,sqlite3,json,hashlib,subprocess,datetime
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'docs/reports/v398-trade-record-integrity-20261009/evidence'
before=json.loads((out/'local-collection-boundary.json').read_text(encoding='utf-8'))
runtime=json.loads((out/'runtime-completion.json').read_text(encoding='utf-8'))
initial=json.loads((out/'runtime-phase-a.json').read_text(encoding='utf-8'))
db=sqlite3.connect(pathlib.Path('D:/MITS/data/zdj-settings.sqlite').as_uri()+'?mode=ro',uri=True,timeout=2)
db.execute('PRAGMA query_only=ON')
version,payload=db.execute('SELECT version,payload FROM settings WHERE id=1').fetchone()
schema=db.execute("SELECT name,sql FROM sqlite_master WHERE name LIKE '%audit%' OR name LIKE '%settings%'").fetchall()
settingsAudit=[]
for ts,source,old,new,summary in db.execute('SELECT changed_at,source,old_version,new_version,summary FROM settings_audit ORDER BY id DESC LIMIT 6'):
 try:
  parsed=json.loads(summary);keys=list(parsed) if isinstance(parsed,dict) else []
 except ValueError:keys=[]
 settingsAudit.append({'changedAt':ts,'source':source,'oldVersion':old,'newVersion':new,'summaryKeys':keys,'summarySHA256':hashlib.sha256(summary.encode()).hexdigest()})
db.close()
git=lambda *args:subprocess.check_output(['git',*args],text=True).strip()
dirty=subprocess.check_output(['git','-C','D:/MITS','status','--short'],text=True).splitlines()
def project(v):
 if isinstance(v,dict):
  for k,x in v.items():
   if k in ['pid','instanceId','version','buildId','artifactHash','sourceHash','productionWrites','testnetWrites','environment','lockedToTestnet','restartCount','lastRestartReason']:
    yield k,x
   yield from project(x)
 elif isinstance(v,list):
  for x in v:yield from project(x)
def identity(r):
 health=next(x for x in r['results'] if x['endpoint']=='/health')
 return {'httpStatus':health.get('httpStatus'),'status':health.get('data',{}).get('status'),'facts':dict(project(health.get('data',{})))}
a,b=identity(initial),identity(runtime)
stable=['pid','instanceId','version','buildId','restartCount']
checks={'settingsUnchanged':version==before['settingsVersion'] and hashlib.sha256(payload.encode()).hexdigest()==before['settingsPayloadSHA256'],
 'canonicalHeadUnchanged':git('-C','D:/MITS','rev-parse','HEAD')==before['canonicalHead'],
 'canonicalDirtyPreserved':dirty==before['canonicalDirty'],
 'sameRuntimeIdentity':all(a['facts'].get(k) is not None and a['facts'].get(k)==b['facts'].get(k) for k in stable),
 'healthReady':b['httpStatus']==200 and b['status']=='READY'}
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'before':a,'completion':b,
 'settingsVersion':version,'settingsPayloadSHA256':hashlib.sha256(payload.encode()).hexdigest(),
 'runningSourceHead':git('-C','D:/MITS-worktrees/v398-entry-quality-20261008','rev-parse','HEAD'),
 'taskLiveDatabaseWrites':0,'taskManualExchangeWrites':0,'taskEngineLifecycleCalls':0,
 'liveDatabaseBytesUnchanged':'NOT_ASSERTED_OTHER_ACTORS_OR_ENGINE_MAY_WRITE','candidateDeployment':'NOT_DEPLOYED',
 'settingsChangeAttribution':'UNKNOWN_NOT_WRITTEN_BY_THIS_TASK','runtimeStoppedCause':'UNKNOWN_NO_LIFECYCLE_ACTION_BY_THIS_TASK','auditSchema':schema,'settingsAudit':settingsAudit}
(out/'runtime-preservation.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
