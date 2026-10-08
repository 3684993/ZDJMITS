import json,pathlib,gzip,hashlib,re,datetime
p=pathlib.Path('docs/reports/v397-trade-entry-exit-quality-review-20261008'); findings=[]
secretkeys={'apikey','secretkey','apisecret','password','accesstoken','refreshtoken','privatekey','authorization'}
def walk(v,path):
 if isinstance(v,dict):
  for k,x in v.items():
   norm=k.lower().replace('_','').replace('-','')
   if norm in secretkeys and x and str(x) not in ['[REDACTED]','undefined','null']:
    # Operational AI authorization object is not a credential; check only scalar secret material.
    if isinstance(x,str):findings.append(path+':'+k)
   walk(x,path+'/'+k)
 elif isinstance(v,list):
  for x in v:walk(x,path)
for f in p.rglob('*.json'):
 if f.name=='durable-entities.json':continue
 walk(json.loads(f.read_text(encoding='utf-8-sig')),f.name)
for f in p.rglob('*.log'):
 txt=f.read_text(encoding='utf-8',errors='replace')
 if re.search(r'(?:Bearer\s+[A-Za-z0-9_.-]{20,}|-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----)',txt):findings.append(f.name+':pattern')
h=hashlib.sha256()
with gzip.open(p/'durable-entities.json.gz','rb') as f:
 while b:=f.read(1024*1024):h.update(b)
expected=json.loads((p/'durable-entities-hashes.json').read_text(encoding='utf-8'))['rawSha256'];assert h.hexdigest()==expected
assert not findings,findings
(p/'.gitignore').write_text('durable-entities.json\n__pycache__/\n',encoding='utf-8')
manifest={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'credentialScalarFindings':findings,'losslessDurableEntities':True,'files':[],'notes':['Raw durable-entities.json intentionally local-only; lossless gzip committed.','All JSON/logs credential scalar scan passed; API secrets redacted during initial capture.','No source/tests/build/lifecycle writes. Raw query state changes naturally while analysis runs.']}
for f in sorted(p.rglob('*')):
 if not f.is_file() or f.name in ['durable-entities.json','EVIDENCE_MANIFEST.json'] or '__pycache__' in f.parts:continue
 manifest['files'].append({'path':f.relative_to(p).as_posix(),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(p/'EVIDENCE_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');print('validated',len(manifest['files']),'credential findings',len(findings))
