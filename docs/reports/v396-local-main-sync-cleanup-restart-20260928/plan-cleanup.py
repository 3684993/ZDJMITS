import os,json,subprocess
from pathlib import Path
out=Path('docs/reports/v396-local-main-sync-cleanup-restart-20260928')
inv=json.loads((out/'inventory-before.json').read_text(encoding='utf-8-sig'));plans=[]
for r in inv['repositories']:
 root=Path(r['path'])
 if not str(root).lower().startswith('d:') or str(root).lower()=='d:\\mits':continue
 tracked=set(subprocess.check_output(['git','-C',str(root),'ls-files','-z']).decode().split('\0'))
 preserve=[];links=[];skipped=[]
 for base,dirs,files in os.walk(root):
  kept=[]
  for d in dirs:
   p=Path(base)/d;rel=p.relative_to(root).as_posix()
   if os.path.isjunction(p) or p.is_symlink():links.append({'path':str(p),'target':os.readlink(p)});continue
   if d in ('.git','node_modules','dist','build','.cache','.vite','coverage','.venv','__pycache__'):
    skipped.append(rel);continue
   kept.append(d)
  dirs[:]=kept
  for f in files:
   p=Path(base)/f;rel=p.relative_to(root).as_posix()
   if rel not in tracked and rel!='.git' and not rel.endswith('.tsbuildinfo'):
    preserve.append({'path':rel,'bytes':p.stat().st_size})
 plans.append({'path':str(root),'head':r['head'],'statusEntries':r['statusEntries'],'preserveLocalFiles':preserve,'preserveBytes':sum(p['bytes'] for p in preserve),'junctionsToUnlinkOnly':links,'reproducibleDirectoriesToDiscard':skipped})
(out/'cleanup-plan.json').write_text(json.dumps({'worktrees':plans,'nonGitRootsPreserveByMove':['D:/MITS-audit-20260912','D:/MITS-backups','D:/MITS-P0-RECOVERY-EVIDENCE'],'gate':'Do not execute until new main READY and IDENTITY_CLOSED','requiredPreservation':'Current data stays D:/MITS/data; designated rollback stays backups/rollback-fa4fbc8660ef12849644; archive content is inactive.'},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'worktrees':len(plans),'localFiles':sum(len(x['preserveLocalFiles']) for x in plans),'localBytes':sum(x['preserveBytes'] for x in plans),'junctions':sum(len(x['junctionsToUnlinkOnly']) for x in plans)},indent=2))
