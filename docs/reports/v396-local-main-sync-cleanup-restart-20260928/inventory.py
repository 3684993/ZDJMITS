import os,json,subprocess,datetime,sys
from pathlib import Path
out=Path(__file__).resolve().parent
skip={'.git','node_modules','data','data-test','dist','build','.venv','venv','.cache','$RECYCLE.BIN','System Volume Information','Windows','Program Files','.pnpm-store','.lmstudio','models'}
found=set()
for base,maxdepth in [('D:/',5),('C:/Users/5700x/.codex/worktrees',5)]:
 for root,dirs,files in os.walk(base):
  depth=len(Path(root).relative_to(base).parts)
  if '.git' in dirs or '.git' in files: found.add(Path(root).as_posix())
  dirs[:]=[d for d in dirs if d not in skip and not os.path.islink(Path(root)/d) and not os.path.isjunction(Path(root)/d)] if depth<maxdepth else []
def git(root,*args):
 r=subprocess.run(['git','--no-optional-locks','-c','core.quotePath=false','-C',root,*args],capture_output=True,encoding='utf-8',errors='replace')
 return r.stdout.rstrip('\r\n') if r.returncode==0 else None
raw=git('D:/MITS','worktree','list','--porcelain')
for l in raw.splitlines():
 if l.startswith('worktree '):found.add(l[9:])
rows=[]
for root in sorted(found):
 remote=git(root,'remote','get-url','origin')
 if not (root.lower().startswith('d:/mits') or remote and ('ZDJMITS' in remote.upper())):continue
 status=git(root,'status','--short')
 rows.append(dict(path=root,branch=git(root,'branch','--show-current'),head=git(root,'rev-parse','HEAD'),commonDir=git(root,'rev-parse','--git-common-dir'),statusShort=status,dirty=bool(status),statusEntries=len(status.splitlines()) if status else 0,remote=remote,untracked=git(root,'ls-files','--others','--exclude-standard'),modified=git(root,'diff','--name-only','HEAD')))
result=dict(capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),worktreesPorcelain=raw,repositories=rows,discoveryScope='D:/ depth5 and Codex managed worktrees depth5; prune dependencies/data/builds/reparse points; union all registered worktrees',mitsTopDirectories=[str(p) for p in Path('D:/').iterdir() if p.is_dir() and p.name.upper().startswith('MITS')])
(out/('inventory-'+(sys.argv[1] if len(sys.argv)>1 else 'before')+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{'path':r['path'],'dirty':r['dirty'],'statusEntries':r['statusEntries']} for r in rows],indent=2))
