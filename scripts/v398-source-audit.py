"""Line-number evidence from current checkout; pattern-based, reviewable source excerpts."""
import pathlib, json, subprocess, hashlib
root=pathlib.Path(__file__).resolve().parents[1];out=root/'docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
specs={
'apps/engine/src/services/entryCoordinator.ts':['primaryOccupancyBlock(','if(testnetFundsOnlyEntry(this.state.settings))return null','buildPreAiExecutionEnvelope(this.state,symbol','buildPreAiCandidateSets(','materializeCandidateQuantityAllocation(','reserveEntry({','async submitExactlyOnce','entrySubmissionIsolation(','this.exchange.placeEntry(','setLeverage(','buildAndPersistTradePlan('],
'apps/engine/src/services/v397FrozenSizing.ts':['export function leverageChoices','export function minimumQuantityForTarget','const notionalFloor','const ceilingUnits','if(!profitable(ceilingUnits))','while(lo<hi)'],
'apps/engine/src/services/quantityHorizonCandidates.ts':['export function quantityLadder','export function buildQuantityHorizonCandidates','const quantityCeiling','minimumQuantityForTarget({','const risk:TradePlanRisk','const sizingProof'],
'apps/engine/src/services/preAiExecutionEnvelope.ts':['export function buildPreAiExecutionEnvelope','sameUnderlyingOccupied','fundsOnly','availableBalance','const LONG=sideCapacity'],
'apps/engine/src/services/entrySubmissionIdentity.ts':['export function entrySubmissionIsolation',"mode:fundsOnly?'SUBMISSION_ONLY'",'isolationKey:key'],
'apps/engine/src/config/settingsStore.ts':['claimEntryExecution(',"if(mode==='UNDERLYING_LEGACY')",'BEGIN IMMEDIATE','saveEntryExecutionRecord('],
'apps/engine/src/services/entryLineage.ts':['export function projectEntryLineage','LOT_FILL_CHAIN_UNPROVEN','LOT_PLAN_CHAIN_UNPROVEN','ORIGIN_PRIMARY_RUN_UNPROVEN','const complete='],
'apps/engine/src/services/positionLifecycleTracker.ts':["transition==='INCREASE'",'addCount:'],
'apps/engine/src/services/positionService.ts':['addCount','HUMAN_MANAGED'],
'apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts':['async placeEntry','async replaceEntry','async setLeverage','async fetchPositions','productionWrites','async signed'],
'apps/engine/src/state/runtimeState.ts':['reserveEntry(input)','entryReservations','restore('],
'apps/engine/src/services/aiQuantityAllocation.ts':['materializeCandidateQuantityAllocation','quantityUnits','authorizationMaxPrice'],
'apps/engine/src/services/executionLease.ts':['acquireExecutionLease','lease','reservedMarginUsd'],
'apps/engine/src/services/tpGuardian.ts':['HUMAN_MANAGED','ownerVersion','quantity','replace'],
'apps/engine/src/services/manualPositionService.ts':['async','placeEntry','ENTRY','quantity','REDUCE','CLOSE'],
'apps/engine/src/services/positionReviewRunner.ts':['HUMAN_MANAGED','ownerVersion','executionAuthority','apply'],
'apps/engine/src/services/positionReviewScheduler.ts':['ownerVersion','HUMAN_MANAGED','submit'],
}
hits=[];sources=[]
for file,patterns in specs.items():
 p=root/file
 if not p.exists(): continue
 text=p.read_text(encoding='utf-8');sources.append({'path':file,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 for n,line in enumerate(text.splitlines(),1):
  matched=[v for v in patterns if v in line]
  if matched:hits.append({'file':file,'line':n,'commit':sha,'patterns':matched,'excerpt':line.strip()})
(out/'sizing-authority-audit.json').write_text(json.dumps({'commit':sha,'sources':sources,'hits':hits,'historicalRuntimeMatchesCurrentSource':'UNPROVEN; latest P0 not deployed','unproven':['Complete ETH/AVAX immutable PRIMARY chains','Historical portfolio and owner-version as-of','Complete AVAX quantity conservation','Natural new-policy concurrency/restart acceptance']},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines=['# Source call graph',f'Commit `{sha}`. Line numbers generated directly from this checkout.','',
'Universe / market → pre-AI envelope → frozen quantity/horizon/target set → Primary candidate ID → allocation → immutable TradePlan → capital reservation → intent → durable journal identity claim → JIT/funds/environment check → exact adapter submit → WS/exact recovery → fills → physical cycle / TP / owner → per-lot lineage.',
'','TESTNET funds-only bypasses old occupancy and portfolio-risk vetoes; submission identity remains per intent. A deterministic NO-SEPARATE-ADD policy is absent in this baseline. `addCount` increments quantity transitions and is not a count of independent orders. Historical owners and order histories are not inferred from current source.','','| Source | Exact line | Excerpt |','|---|---:|---|']
for h in hits:lines.append(f'| `{h["file"]}` | {h["line"]} | `{h["excerpt"].replace("|"," / ")[:260]}` |')
(out/'architecture-callgraph.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'commit':sha,'files':len(sources),'sourceExcerpts':len(hits)}))
