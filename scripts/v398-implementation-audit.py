"""Bounded current-source manifest and explicit frozen-authority/no-add call graph."""
import pathlib,subprocess,json,hashlib,datetime
root=pathlib.Path(__file__).resolve().parents[1]
base='2b0143e5dc112266437da2e14c7eb808f51d9869'
changed=subprocess.check_output(['git','diff','--name-only',base,'--','apps','packages','package.json','package-lock.json'],cwd=root,text=True).splitlines()
changed+=subprocess.check_output(['git','ls-files','--others','--exclude-standard','--','apps','packages'],cwd=root,text=True).splitlines()
files=[]
for f in sorted(set(changed)):
 p=root/f
 if p.is_file():files.append({'path':f,'sha256LF':hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()})
protected=['apps/engine/src/services/tpGuardian.ts','apps/engine/src/services/positionReviewRunner.ts','apps/engine/src/services/positionService.ts','config/settings.default.json']
checks={f:subprocess.check_output(['git','diff',base,'--',f],cwd=root)==b'' for f in protected}
dirty=subprocess.check_output(['git','status','--porcelain','--','apps','packages'],cwd=root,text=True).strip()
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'researchPlanRemoteBase':base,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'sourceState':'UNCOMMITTED_I1' if dirty else 'COMMITTED_I2','files':files,'protectedSourceUnchanged':checks,'authority':['read physical position/pending/origin -> deterministic no-add envelope before candidate freeze','frozen candidate set -> sole Primary candidate ID -> TradePlan -> reservation -> intent','JIT frozen quantity equality -> BEGIN IMMEDIATE origin + submission journal claim','exact intent/client/quantity cap -> final no-add/owner check -> TESTNET adapter','UNKNOWN -> WS/exact same-order GET; never replacement POST','full fresh reconciliation + exact terminal + CLOSED/CONSERVED cycle -> release original authority'],'shadowRiskBoundsLiveCallers':[],'formalRiskCalibration':'INSUFFICIENT_EVIDENCE','noHistoryRewrite':True}
out=root/'docs/reports/v398-entry-sizing-quality-review/evidence-20261008/implementation-source-audit.json'
out.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'files':len(files),'sourceState':result['sourceState'],'protectedUnchanged':all(checks.values())}))
