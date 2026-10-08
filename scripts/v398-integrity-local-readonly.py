"""Bounded live read-only evidence. No backup, migration, history repair, private prompt export."""
import pathlib,sqlite3,json,gzip,datetime,hashlib,time,subprocess,collections
root=pathlib.Path(__file__).resolve().parents[1];out=root/'docs/reports/v398-trade-record-integrity-20261009/evidence';out.mkdir(parents=True,exist_ok=True)
denied={'apikey','apisecret','password','token','authorization','cookie','credentialref','accountid','accountalias','account','accountscope','account_scope','inputpreview','outputpreview','prompt','systemprompt','userprompt','messages','rawresponse','ciphertext','rawprompt'}
def safe(x):
 if isinstance(x,dict):return {k:safe(v) for k,v in x.items() if k.lower() not in denied}
 if isinstance(x,list):return [safe(v) for v in x]
 return x
def save(name,obj):
 raw=(json.dumps(safe(obj),ensure_ascii=False,separators=(',',':'))+'\n').encode();(out/name).write_bytes(gzip.compress(raw,mtime=0) if name.endswith('.gz') else raw)
started=time.monotonic();db=sqlite3.connect(pathlib.Path('D:/MITS/data/zdj-settings.sqlite').as_uri()+'?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON');db.set_progress_handler(lambda:time.monotonic()-started>18,100000);db.execute('BEGIN')
records=[json.loads(r[0]) for r in db.execute('SELECT payload FROM trade_records ORDER BY updated_at DESC LIMIT 2001')]
if len(records)>2000:raise RuntimeError('RECORD_BOUND')
entities={};limits={'positions':100,'entryIntents':5000,'entryOrders':5000,'executionFills':10000,'tradePlans':5000,'entryReservations':6000,'tpOrders':5000,'manualIntents':1000,'manualOrders':1000}
for kind,limit in limits.items():
 entities[kind]=[]
 for row in db.execute('SELECT payload FROM runtime_entities WHERE kind=? ORDER BY entity_id LIMIT ?',(kind,limit+1)):
  entity=json.loads(row[0]);entity={k:v for k,v in entity.items() if k not in ['snapshot','marketSnapshot','packet','evidencePacket','entryPacket','intelligencePacket','analysisPacket','technical','features','decisionSnapshot','executionEnvelope','frozenCandidateSet']}
  for k,v in list(entity.items()):
   if isinstance(v,(dict,list)) and len(json.dumps(v))>32768:entity[k]={'auditProjectionOmitted':True,'sha256':hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest()}
  entities[kind].append(safe(entity))
 if len(entities[kind])>limit:raise RuntimeError(kind+'_BOUND')
core,updated=db.execute('SELECT payload,updated_at FROM runtime_state WHERE id=1').fetchone();core=json.loads(core)
version,settingsPayload=db.execute('SELECT version,payload FROM settings WHERE id=1').fetchone();settings=json.loads(settingsPayload)
ids={r.get('entryRunId') for r in records}|{i.get('brainRunId') for i in entities['entryIntents'] if i.get('symbol') in ['AVAXUSDT','ETHUSDT','UNIUSDC']};runs={};contextProof=[]
recent=db.execute("SELECT entity_id,payload FROM runtime_entities WHERE kind='aiRuns' ORDER BY entity_id DESC LIMIT 200").fetchall()
for runid,payload in recent:
 run=json.loads(payload)
 if run.get('role')=='PRIMARY_BRAIN':ids.add(runid)
for runid in sorted(i for i in ids if i):
 row=db.execute('SELECT payload FROM ai_runs_archive WHERE run_id=?',(runid,)).fetchone()
 if not row:continue
 run=json.loads(row[0]);preview=run.get('inputPreview');proof={'runId':runid,'symbol':run.get('symbol'),'role':run.get('role'),'startedAt':run.get('startedAt'),'inputPresent':bool(preview),'inputSHA256':hashlib.sha256(preview.encode()).hexdigest() if isinstance(preview,str) else None}
 if isinstance(preview,str) and len(preview)<524288:
  try:
   inp=json.loads(preview);packet=inp.get('packet',{});proof.update({'rootKeys':list(inp),'packetKeys':list(packet),'portfolioKeys':list(packet.get('portfolio',{})) if isinstance(packet.get('portfolio'),dict) else None,'packetId':packet.get('packetId'),'packetCreatedAt':packet.get('createdAt'),'positionContext':packet.get('existingPositionContext'),'positionFactKeys':list(packet.get('position',{})) if isinstance(packet.get('position'),dict) else None});run['contextCreatedAt']=packet.get('createdAt')
  except (ValueError,TypeError):proof['parse']='UNKNOWN_NON_JSON'
 contextProof.append(proof);runs[runid]={k:run.get(k) for k in ['id','role','symbol','packetId','startedAt','completedAt','model','resourceId','modelIdentity','contextCreatedAt','decision','planVersion','contextHash','inputHash','outputHash']}
events=[{'type':kind,'ts':ts,'payload':json.loads(payload)} for kind,ts,payload in db.execute("SELECT type,ts,payload FROM runtime_events WHERE symbol='AVAXUSDT' AND ts>=? ORDER BY ts LIMIT 2001",(1789833600000,))]
marksSchema=db.execute("SELECT sql FROM sqlite_master WHERE name='shadow_mark_series'").fetchone()
marks=[]
try:marks=db.execute("SELECT symbol,ts,mark FROM shadow_mark_series WHERE symbol IN ('AVAXUSDT','ETHUSDT') ORDER BY ts LIMIT 20001").fetchall()
except sqlite3.OperationalError:pass
db.rollback();db.close()
save('trade-records.json.gz',records);save('entities.json.gz',entities);save('linked-ai-runs.json.gz',runs);save('ai-input-fact-presence.json',contextProof);save('avax-events.json.gz',{'limit':2000,'saturated':len(events)>2000,'events':events[:2000]});save('persisted-runtime.json',{'updatedAt':updated,'coreKeys':list(core),'lifecycles':core.get('lifecycles'),'account':core.get('account')});save('mark-retention.json',{'schema':marksSchema,'countRetrieved':len(marks),'sample':marks[:2]+marks[-2:],'warning':'price-only observations do not prove synchronous historical inventory or full lifecycle PnL'})
save('local-collection-boundary.json',{'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-started,'queryOnly':True,'liveDatabaseWrites':0,'records':len(records),'entityCounts':{k:len(v) for k,v in entities.items()},'limits':limits,'runsRequested':len(ids),'runsRetained':len(runs),'settingsVersion':version,'settingsPayloadSHA256':hashlib.sha256(settingsPayload.encode()).hexdigest(),'environment':settings['connections']['exchange']['environment'],'executionMode':settings['connections']['executionMode'],'canonicalHead':subprocess.check_output(['git','-C','D:/MITS','rev-parse','HEAD'],text=True).strip(),'canonicalDirty':subprocess.check_output(['git','-C','D:/MITS','status','--short'],text=True).splitlines()})
print(json.dumps({'records':len(records),'entities':{k:len(v) for k,v in entities.items()},'runs':len(runs),'elapsedSeconds':time.monotonic()-started}))
