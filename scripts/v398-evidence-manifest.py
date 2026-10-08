"""Credential scalar scanner + LF-normalized text/raw gzip manifest and remote blob replay."""
import pathlib,hashlib,json,gzip,re,subprocess,datetime,sys
root=pathlib.Path(__file__).resolve().parents[1];base=root/'docs/reports/v398-entry-sizing-quality-review';out=base/'evidence-20261008'
paths=[p for p in base.rglob('*') if p.is_file() and p.name not in ['EVIDENCE_MANIFEST.json','REMOTE_R2_READBACK.json','REMOTE_I2_READBACK.json','REMOTE_FINAL_READBACK.json']]
paths += list((root/'scripts').glob('v398-*'))+[root/'docs/plans/V398_ENTRY_SIZING_RISK_BUDGET_PLAN.md']
paths=[p for p in paths if p.is_file() and '__pycache__' not in p.parts]
findings=[];rows=[]
def normalized(p,b):return b if p.suffix in ['.gz','.zip','.png'] else b.replace(b'\r\n',b'\n')
for p in sorted(set(paths)):
 b=p.read_bytes();scan=gzip.decompress(b) if p.suffix=='.gz' else b
 text=scan.decode('utf-8',errors='replace')
 for match in re.finditer(r'"(apiKey|apiSecret|password|access_token|refresh_token|privateKey|ciphertext|cookie|authorization)"\s*:\s*"([^"\n]+)"',text,re.I):
  if match.group(2) not in ['REDACTED','UNKNOWN','']:findings.append({'file':p.relative_to(root).as_posix(),'field':match.group(1),'valueOmitted':True})
 if re.search(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----',text):findings.append({'file':p.relative_to(root).as_posix(),'field':'credentialPattern','valueOmitted':True})
 rows.append({'path':p.relative_to(root).as_posix(),'bytesLFNormalized':len(normalized(p,b)),'sha256':hashlib.sha256(normalized(p,b)).hexdigest()})
if findings:
 (out/'credential-findings.json').write_text(json.dumps(findings,indent=2)+'\n',encoding='utf-8');raise SystemExit('CREDENTIAL_SCANNER_FAILED_VALUES_NOT_PRINTED')
manifest={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hashNormalization':'LF-normalized UTF-8 for text; raw bytes for gzip/binary','artifactCount':len(rows),'credentialScalarFindings':findings,'artifacts':rows}
if '--remote' in sys.argv:
 ref=sys.argv[sys.argv.index('--remote')+1];mismatches=[]
 committedManifest=json.loads(subprocess.check_output(['git','show',ref+':docs/reports/v398-entry-sizing-quality-review/evidence-20261008/EVIDENCE_MANIFEST.json'],cwd=root))
 rows=committedManifest['artifacts']
 for r in rows:
  proc=subprocess.run(['git','show',ref+':'+r['path']],cwd=root,capture_output=True)
  if proc.returncode or hashlib.sha256(normalized(pathlib.Path(r['path']),proc.stdout)).hexdigest()!=r['sha256']:mismatches.append(r['path'])
 result={'ref':ref,'sha':subprocess.check_output(['git','rev-parse',ref],cwd=root,text=True).strip(),'checked':len(rows),'mismatches':mismatches,'passed':not mismatches,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 name='REMOTE_'+(sys.argv[sys.argv.index('--phase')+1] if '--phase' in sys.argv else 'R2')+'_READBACK.json'
 (out/name).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(result));sys.exit(1 if mismatches else 0)
(out/'EVIDENCE_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'artifactCount':len(rows),'credentialFindings':0}))
