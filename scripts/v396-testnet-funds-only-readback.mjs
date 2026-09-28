// Read-only current-instance evidence. No exchange calls, mutations or lifecycle actions.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.'),out=process.argv[3];
const response=await fetch('http://127.0.0.1:8080/api/v3/diagnostics/closeout');
if(!response.ok)throw Error(`CLOSEOUT_HTTP_${response.status}`);
const j=await response.json(),p=j.pipeline??{},r=j.runtime??{},since=Number(r.lastRestartAt);
const db=new DatabaseSync(path.join(root,'data','zdj-settings.sqlite'),{readOnly:true});
const counts=Object.fromEntries(db.prepare('SELECT type,COUNT(*) n FROM runtime_events WHERE ts>=? GROUP BY type').all(since).map(row=>[row.type,row.n]));
const types=['ENTRY_RESOURCE_POLICY_LOADED','ENTRY_DECISION_BLOCKED','ENTRY_ORDER_BLOCKED','ENTRY_ANALYSIS_FAILED','ENTRY_EXECUTION_WAIT_TERMINATED','PRIMARY_NO_ENTRY','PRIMARY_DECISION_NORMALIZED','PORTFOLIO_RISK_ADMISSION_EVALUATED','TRADE_PLAN_PERSISTED','ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED'];
const events=db.prepare(`SELECT ts,type,symbol,payload FROM runtime_events WHERE ts>=? AND type IN (${types.map(()=>'?').join(',')}) ORDER BY ts DESC LIMIT 100`).all(since,...types).map(row=>{
  const v=JSON.parse(row.payload);return {ts:row.ts,type:row.type,symbol:row.symbol,brainRunId:v.brainRunId??v.runId??null,reason:v.reason??v.message??null,reasons:v.reasons??null,decision:v.decision??null,stage:v.stage??null,allowed:v.allowed??null,entryVetoEnforced:v.entryVetoEnforced??null,planId:v.planId??null,intentId:v.intentId??v.intent?.id??null,orderId:v.orderId??v.order?.id??null,status:v.order?.status??null};
});
const envelopes=db.prepare("SELECT ts,symbol,payload FROM runtime_events WHERE ts>=? AND type='PRE_AI_EXECUTION_ENVELOPE_CREATED' ORDER BY ts DESC LIMIT 12").all(since).map(row=>{
  const e=JSON.parse(row.payload).executionEnvelope;return {ts:row.ts,symbol:row.symbol,resourcePolicy:e.resourcePolicy,executableSides:e.executableSides,LONG:{executable:e.LONG.executable,blockers:e.LONG.riskHeadroom?.blockers},SHORT:{executable:e.SHORT.executable,blockers:e.SHORT.riskHeadroom?.blockers}};
});
db.close();
const result={observedAt:new Date().toISOString(),runtime:{pid:r.pid,instanceId:r.instanceId,buildId:r.buildId,lastRestartAt:r.lastRestartAt,lastRestartReason:r.lastRestartReason},policy:p.entryResourcePolicy??null,pipeline:{state:p.pipelineState,noEntryReason:p.noEntryReason??null,authoritativeBlocker:p.authoritativeBlocker,analysis:p.analysisDispatch??p.analysis??null,executionReadiness:p.executionReadiness??null,capitalExecutableCandidates:p.runtimeControl?.capital?.executableCandidateCount,capitalReasons:p.runtimeControl?.capital?.reasonCounts},capacity:{firstBlocker:p.capacityVisibility?.firstBlocker,exhaustedReason:p.capacityVisibility?.exhaustedReason,admission:p.capacityVisibility?.admission,funding:p.capacityVisibility?.funding},productionWriteBoundary:j.productionWriteBoundary,counts,events,envelopes};
if(out)fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({runtime:result.runtime,policy:result.policy,pipeline:result.pipeline,capacity:{firstBlocker:result.capacity.firstBlocker,exhaustedReason:result.capacity.exhaustedReason},counts:Object.fromEntries(Object.entries(counts).filter(([type])=>/PRIMARY|ENTRY_(DECISION|SUBMIT|ORDER|INTENT|RESERVATION)|TRADE_PLAN|POLICY_LOADED/.test(type))),envelopes:envelopes.slice(0,3)},null,2));
