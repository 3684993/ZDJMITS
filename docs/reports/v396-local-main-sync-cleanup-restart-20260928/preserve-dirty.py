from pathlib import Path
import json,subprocess,os,hashlib,datetime,shutil,re
out=Path(__file__).resolve().parent
backup=Path('D:/MITS/backups/local-convergence-20260928')
backup.mkdir(parents=True,exist_ok=True)
inv=json.loads((out/'inventory-before.json').read_text(encoding='utf-8-sig'))
rows=[];refs=[]
def git(root,*args,env=None,input=None):
 r=subprocess.run(['git','--no-optional-locks','-C',str(root),*args],input=input,capture_output=True,env=env)
 if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace'))
 return r.stdout
for item in inv['repositories']:
 root=Path(item['path'])
 if not item['dirty'] or not str(root).lower().startswith('d:'):continue
 label='v395' if str(root).lower()=='d:\\mits' else 'v392-audit'
 dest=backup/label;dest.mkdir(exist_ok=True)
 changed=git(root,'diff','--name-only','HEAD','-z').decode().split('\0')
 untracked=git(root,'ls-files','--others','--exclude-standard','-z').decode().split('\0')
 safe=[]
 for name in sorted(set(changed+untracked)-{''}):
  p=root/name
  if not p.is_file():
   rows.append(dict(checkout=str(root),path=name,category='NESTED_WORKTREE_OR_DIRECTORY',action='inventory separately; preserve until READY'));continue
  data=p.read_bytes();target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
  assert hashlib.sha256(data).digest()==hashlib.sha256(target.read_bytes()).digest()
  main=subprocess.run(['git','-C',str(root),'show','origin/main:'+name],capture_output=True)
  identical=main.returncode==0 and main.stdout.replace(b'\r\n',b'\n')==data.replace(b'\r\n',b'\n')
  text=data.decode('utf-8',errors='replace')
  suspect=bool(re.search(r'(?i)(?:api[_-]?key|api[_-]?secret|password|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[\x22\x27][^\x22\x27]{8,}|sk-[a-zA-Z0-9]{15,}|ghp_[a-zA-Z0-9]{15,}|BEGIN .*PRIVATE KEY',text))
  eligible=(name.startswith(('apps/','packages/','scripts/','docs/')) or name.endswith('.md')) and p.suffix in ('.ts','.vue','.mjs','.py','.ps1','.md') and not suspect
  category='MAIN_IDENTICAL' if identical else 'PRIVATE_OR_UNREVIEWED_LOCAL_ARCHIVE' if not eligible else 'UNIQUE_HISTORICAL_SOURCE_DOC_SCRIPT'
  if eligible and not identical:safe.append(name)
  rows.append(dict(checkout=str(root),path=name,category=category,mainContainsIdenticalBytes=identical,sha256=hashlib.sha256(data).hexdigest(),localArchive=str(target),action='safe archive ref plus local backup' if eligible and not identical else 'local backup only',credentialPatternDetected=suspect))
 # Preserve exact tracked diff locally (never upload possibly sensitive full patch).
 (dest/'tracked-changes.patch').write_bytes(git(root,'diff','--binary','HEAD'))
 if safe:
  index=dest/'archive.index';env=os.environ.copy();env['GIT_INDEX_FILE']=str(index)
  git(root,'read-tree','HEAD',env=env)
  git(root,'add','--',*safe,env=env)
  tree=git(root,'write-tree',env=env).decode().strip()
  commit=git(root,'commit-tree',tree,'-p',item['head'],input=f'archive: preserve unique {label} work before canonical main convergence [skip ci]\n'.encode(),env=env).decode().strip()
  ref=f'refs/tags/archive/v396-local-convergence-20260928-{label}'
  exists=subprocess.run(['git','-C',str(root),'rev-parse','--verify',ref],capture_output=True)
  if exists.returncode==0:raise RuntimeError('Archive ref already exists; do not overwrite')
  git(root,'update-ref',ref,commit)
  refs.append(dict(ref=ref,commit=commit,base=item['head'],paths=safe))
(out/'preservation-manifest.json').write_text(json.dumps(dict(capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),localArchiveRoot=str(backup),files=rows,archiveRefs=refs,secretsPolicy='Only selected source/docs/scripts without detected credential literals enter archive refs. Raw/private data stays local; no archive is an active runtime checkout.'),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'filesPreserved':len(rows),'categories':{c:sum(r['category']==c for r in rows) for c in set(r['category'] for r in rows)},'refs':refs},ensure_ascii=True,indent=2))
