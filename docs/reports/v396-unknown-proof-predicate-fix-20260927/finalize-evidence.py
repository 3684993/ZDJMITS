"""Finalize repository evidence only; run after capture-identity and all final gates."""
from pathlib import Path
import json, re, subprocess, hashlib
OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
def read(name): return json.loads((OUT/name).read_text(encoding='utf-8-sig'))
def write(name, value): (OUT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
m, gates = read('source-build-identity.json'), read('gate-results.json')
last = {row['id']: row for row in gates['gates']}
assert all(row['status']=='PASS' and row['sourceDiffSha256']==m['sourceDiffSha256']==row['sourceDiffSha256After'] for row in last.values())
assert not read('unknown-proof-negative-control.json')['blockers']
workspace_log = (OUT/last['workspace-tests']['log']).read_text(encoding='utf-8')
counts = [int(n) for n in re.findall(r'Tests\s+(\d+) passed', workspace_log)]
assert counts == [58, 63, 1493], counts
focus_log = (OUT/last['focused-engine']['log']).read_text(encoding='utf-8')
assert re.search(r'Tests\s+261 passed', focus_log)
gates.update(status='V396_UNKNOWN_PROOF_PREDICATE_FIXED_LOCAL_PASS', finalSourceDiffSha256=m['sourceDiffSha256'], blockingFindings=[],
 counts={'focusedEngine':261,'focusedEngineFiles':20,'focusedDashboard':17,'engine':1493,'engineFiles':176,'core':58,'coreFiles':8,'dashboard':63,'dashboardFiles':14,'contracts':'PASS_WITH_NO_TESTS per package policy','strictValidator':47,'hydrationProducerConsumer':13,'negativeControl':6})
gates['initialExploration'] = [
 {'log':'focused-initial.txt','exitCode':1,'resolution':'Test now preserves explicit tier0 while exercising tier0 TTL excess; it no longer changes the legacy tier in the same assertion.'},
 {'log':'focused-new.txt','exitCode':1,'resolution':'Fixture uses the real RuntimeState.restore method.'},
 {'log':'focused-new-retry.txt','exitCode':1,'resolution':'Restore fixture now includes full state.serialize, including runtimeControl.'},
 {'command':'npm run typecheck -w @zdj/engine','log':'typecheck-initial.txt','exitCode':0}]
for row in gates['initialExploration']:
 if 'command' not in row:
  log=(OUT/row['log']).read_text(encoding='utf-8-sig')
  command=re.findall(r'npm error command .*? /c (.+)',log)
  row['command']=command[-1] if command else 'See exact npm command in retained log'
  row['cwd']='apps/engine'
write('gate-results.json',gates)
a,b=read('runtime-before.json'),read('runtime-after.json')
assessment=read('runtime-vs-source.json')
assessment.update(candidateBuildId=m['candidateBuildId'],candidateSourceHash=m['source']['hash'],candidateArtifactHash=m['artifact']['hash'],samePid=a['runtime']['pid']==b['runtime']['pid'],sameInstance=a['runtime']['instanceId']==b['runtime']['instanceId'],sameRunningBuild=a['runtime']['buildId']==b['runtime']['buildId'],sameSettingsVersion=a['settingsVersion']==b['settingsVersion'],candidateIsRunning=m['candidateBuildId']==b['runtime']['buildId'])
write('runtime-vs-source.json',assessment)
report=(OUT/'REPORT.md').read_text(encoding='utf-8')
report=re.sub(r'候选 build \*\*3\.9\.6-[a-f0-9]+\*\*，source hash `[a-f0-9]+`，artifact hash `[a-f0-9]+`',f"候选 build **{m['candidateBuildId']}**，source hash `{m['source']['hash']}`，artifact hash `{m['artifact']['hash']}`",report)
report=re.sub(r'开始/结束 source diff SHA256 均一致为 `[a-f0-9]+`',f"开始/结束 source diff SHA256 均一致为 `{m['sourceDiffSha256']}`",report)
(OUT/'REPORT.md').write_text(report,encoding='utf-8')
# Refresh line numbers/excerpts after the final source edits.
old_map=read('source-producer-consumer-map.json');needles={}
for row in old_map: needles.setdefault(row['path'],set()).update(row['matches'])
rows=[]
for file,patterns in needles.items():
 for number,line in enumerate((ROOT/file).read_text(encoding='utf-8-sig').splitlines(),1):
  hits=sorted(p for p in patterns if p in line)
  if hits:rows.append({'path':file,'line':number,'matches':hits,'source':line.strip()})
write('source-producer-consumer-map.json',rows)
summary=subprocess.check_output(['git','diff','--numstat','HEAD','--','apps','packages'],cwd=ROOT,encoding='utf-8')
(OUT/'changed-files.tsv').write_text('added\tdeleted\tpath\n'+summary,encoding='utf-8')
for file in OUT.glob('*.txt'):
 text=file.read_text(encoding='utf-8-sig');file.write_text('\n'.join(line.rstrip() for line in text.splitlines()).rstrip()+'\n',encoding='utf-8')
print(json.dumps({'status':gates['status'],'finalSourceDiffSha256':m['sourceDiffSha256'],'counts':gates['counts']},indent=2))
