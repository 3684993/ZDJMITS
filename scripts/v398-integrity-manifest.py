"""Privacy gate and committed-blob readback; excludes self-referential receipts."""
import pathlib,json,gzip,hashlib,re,subprocess,sys,datetime
root=pathlib.Path(__file__).resolve().parents[1];base=root/'docs/reports/v398-trade-record-integrity-20261009';out=base/'evidence';paths=[p for p in base.rglob('*') if p.is_file() and p.name!='MANIFEST.json' and not p.name.startswith('REMOTE_')];paths+=list((root/'scripts').glob('v398-integrity-*'));paths+=[root/'docs/plans/V398_TRADE_RECORD_INTEGRITY_IMPLEMENTATION_PLAN_20261009.md']
changed=subprocess.check_output(['git','diff','--name-only','855362e','--','apps','packages','package.json','docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md'],cwd=root,text=True).splitlines();paths+=[root/p for p in changed]
paths += [root/p for p in subprocess.check_output(['git','ls-files','--others','--exclude-standard','--','apps','packages'],cwd=root,text=True).splitlines()];rows=[]
normalize=lambda p,b:b if p.suffix=='.gz' else b.replace(b'\r\n',b'\n')
for p in sorted(set(paths)):
 if not p.is_file() or '__pycache__' in p.parts:continue
 raw=p.read_bytes();decoded=gzip.decompress(raw).decode('utf-8') if p.suffix=='.gz' else raw.decode('utf-8')
 if re.search(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----',decoded):raise RuntimeError('SECRET_PATTERN:'+p.name)
 if p.suffix=='.json' or p.name.endswith('.json.gz'):
  obj=json.loads(decoded)
  def scan(o):
   if isinstance(o,dict):
    for k,v in o.items():
     if k.lower() in ['apikey','apisecret','ciphertext','accountid','accountalias','account_id','accountscope','account_scope','inputpreview','outputpreview','systemprompt','userprompt','prompt','messages','password','authorization'] and v not in [None,'REDACTED','UNKNOWN']:raise RuntimeError('PRIVATE_FIELD:'+p.name+':'+k)
     scan(v)
   elif isinstance(o,list):
    for v in o:scan(v)
  scan(obj)
 rows.append({'path':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(normalize(p,raw)).hexdigest()})
if '--remote' in sys.argv:
 ref='origin/main';m=json.loads(subprocess.check_output(['git','show',ref+':'+(out/'MANIFEST.json').relative_to(root).as_posix()],cwd=root));errors=[]
 for r in m['artifacts']:
  proc=subprocess.run(['git','show',ref+':'+r['path']],cwd=root,capture_output=True)
  if proc.returncode or hashlib.sha256(normalize(pathlib.Path(r['path']),proc.stdout)).hexdigest()!=r['sha256']:errors.append(r['path'])
 result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ref':ref,'head':subprocess.check_output(['git','rev-parse',ref],cwd=root,text=True).strip(),'checked':len(m['artifacts']),'mismatches':errors,'passed':not errors}
 if '--verify-only' not in sys.argv:(out/('REMOTE_'+('B' if '--phase-b' in sys.argv else 'C')+'.json')).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(result));sys.exit(bool(errors))
(out/'MANIFEST.json').write_text(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'privacyGate':'PASS_NO_PRIVATE_FIELDS_OR_SECRET_PATTERNS','normalization':'LF text/raw gzip','artifactCount':len(rows),'artifacts':rows},indent=2)+'\n',encoding='utf-8');print(json.dumps({'artifacts':len(rows),'privacyGate':'PASS'}))
