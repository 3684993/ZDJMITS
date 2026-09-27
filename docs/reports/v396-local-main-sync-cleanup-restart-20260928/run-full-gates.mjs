import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const output=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(output,'../../..');
const definitions=[
 ['focused-engine','npm run test -w @zdj/engine -- src/services/unknownProofValidation.test.ts src/services/unknownProofHydration.test.ts src/services/reconciliationService.test.ts src/services/reconciliationUnknownRisk.test.ts src/services/reconciliationCoverageContract.test.ts src/services/executionLifecycle.integration.test.ts src/services/placeToSubmitCapacityTruth.test.ts src/services/pipelineVerdict.test.ts src/services/grossRiskCapacityVisibility.test.ts src/services/frozenChoiceTelemetry.test.ts src/services/entryExecutionChain.test.ts src/api/snapshotReadOnly.test.ts src/services/unknownRiskAuditTiering.test.ts src/services/unknownNoActiveRiskProofRenewal.test.ts src/services/p0EntryIntegrity.test.ts src/services/remoteFactAuditIntegration.test.ts src/services/finalRiskConvergence.test.ts src/services/pendingRiskOccupancyConvergence.test.ts src/api/activeEntryProjection.test.ts src/state/c2ReservationAtomicityHostile.test.ts'],
 ['focused-dashboard','npm run test -w @zdj/dashboard -- src/views/OverviewView.capacity.test.ts'],
 ['workspace-tests','npm test'],
 ['workspace-typecheck','npm run typecheck'],
 ['verify-deps','npm run verify:deps'],
 ['verify-scripts','npm run verify:scripts'],
 ['full-verify','npm run verify'],
 ['formal-build','npm run build'],
 ['s00','node scripts/v396-s00-static-check.mjs'],
 ['storage-coverage','node scripts/v396-storage-coverage.mjs --out=docs/reports/v396-local-main-sync-cleanup-restart-20260928/storage-coverage.json --verify-backup'],
 ['diff-check','git diff --check'],
];
const sourceDiffHash=()=>createHash('sha256').update(spawnSync('git',['diff','--binary','HEAD','--','apps','packages'],{cwd:root,encoding:'utf8'}).stdout.replaceAll('\r\n','\n')).digest('hex');
const selected=process.argv.slice(2),gates=selected.length?definitions.filter(([id])=>selected.includes(id)):definitions;
let results=[];try{results=JSON.parse(readFileSync(path.join(output,'gate-results.json'),'utf8')).gates??[];}catch{}
for(const [id,command] of gates){
 const sourceDiffSha256=sourceDiffHash(),startedAt=new Date().toISOString();console.log(`START ${id} ${startedAt}`);
 const run=spawnSync(command,{cwd:root,shell:true,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});
 const attempt=results.filter(row=>row.id===id).length+1,log=`${id}-${attempt}.txt`;
 const body=((run.stdout??'')+'\n'+(run.stderr??'')).replace(/\u001b\[[0-9;]*m/g,'').replaceAll(root,'<ISOLATED_WORKTREE>').split(/\r?\n/).map(line=>line.trimEnd()).join('\n');
 writeFileSync(path.join(output,log),body+'\n');
 results.push({id,attempt,command,sourceDiffSha256,sourceDiffSha256After:sourceDiffHash(),startedAt,endedAt:new Date().toISOString(),exitCode:run.status,signal:run.signal,error:run.error?.message??null,status:run.status===0?'PASS':'FAIL',log});
 writeFileSync(path.join(output,'gate-results.json'),JSON.stringify({schema:'V396_UNKNOWN_PROOF_LOCAL_GATES_1',baseCommit:'2aa2d7d2ac348b642fcc9b8d89fbbe54cc22cd9e',runtimeAcceptance:'NOT_RUN_EXTERNAL',deployment:'USER_AUTHORIZED_PENDING_PRESTOP_GATES',lifecycle:'NOT_RUN',githubActions:'NOT_RUN_BILLING_LIMIT',gates:results},null,2)+'\n');
 console.log(`END ${id} exit=${run.status} ${log}`);
 if(run.status!==0){console.log(body.slice(-10000));process.exit(1);}
}
