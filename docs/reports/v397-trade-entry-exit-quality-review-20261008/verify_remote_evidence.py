import subprocess,pathlib,json,hashlib,datetime,sys
p=pathlib.Path(__file__).resolve().parent
ref='refs/remotes/origin/main'; head=subprocess.check_output(['git','rev-parse',ref],text=True).strip();expected=sys.argv[1]
assert head==expected,(head,expected)
prefix=p.relative_to(pathlib.Path.cwd()).as_posix()
manifest=json.loads(subprocess.check_output(['git','show',ref+':'+prefix+'/EVIDENCE_MANIFEST.json']))
verified=[]
for row in manifest['files']:
 b=subprocess.check_output(['git','show',ref+':'+prefix+'/'+row['path']]);assert hashlib.sha256(b).hexdigest()==row['sha256'],row['path'];verified.append(row['path'])
paths=[prefix+'/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md','docs/plans/V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md','docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md']
blobids={s:subprocess.check_output(['git','rev-parse',ref+':'+s],text=True).strip() for s in paths}
changed=subprocess.check_output(['git','diff','--name-only','9eabbc43bf44042dffdef0d6d66e051421398d85',ref,'--','apps','scripts','packages','package.json','package-lock.json'],text=True).splitlines();assert not changed,changed
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'remoteMain':head,'verifiedArtifactCount':len(verified),'remoteManifestReplay':'PASS_EXACT_SHA256','requiredDocumentBlobIds':blobids,'runtimeSourceChanges':changed,'promotion':'ordinary non-force push; fetched main ancestry proven before push','fanout':'COMPLETE_EFFECTIVE','engineReactivity':'FAIL','remaining6140msCaller':'UNKNOWN','reactivityFollowup':'PAUSED_SEPARATE_SCOPE','strategyImplementation':'NOT_STARTED','productionWritesFinalObserved':0,'settingsVersionFinalObserved':247,'servicesRestarted':0,'fullVerifyRuns':0}
(p/'REMOTE_CLOSEOUT.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8');print('Remote artifact hashes verified:',len(verified),'main',head)
