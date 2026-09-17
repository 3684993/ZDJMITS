import fs from 'node:fs';
const file='apps/engine/src/services/entryCoordinator.ts';
let s=fs.readFileSync(file,'utf8');
const must=(from,to,label)=>{if(s.includes(to))return;if(!s.includes(from))throw new Error(`V393_WIRING_MISSING:${label}`);s=s.replace(from,to);};

must("import { buildOpportunityEvidence, qualityPolicy, revalidateOpportunity, validateOpportunityDecision } from './opportunityEvidence.js';","import { buildOpportunityEvidence, qualityPolicy } from './opportunityEvidence.js';",'opportunity import');
s=s.replace('  buildAllocationPlan,\n','').replace('  sizeEntryQuantity,\n','');
s=s.replace("import { DirectionPolicyService } from './directionPolicyService.js';\n",'');
must("import { evaluatePreflightFeasibility } from './preflightFeasibility.js';","import { evaluatePreflightFeasibility } from './preflightFeasibility.js';\nimport { buildPreAiExecutionEnvelope } from './preAiExecutionEnvelope.js';\nimport { acquireExecutionLease, releaseExecutionLease, validateExecutionLease } from './executionLease.js';\nimport { materializeAiQuantityAllocation } from './aiQuantityAllocation.js';",'new imports');
s=s.replace('  private readonly directionPolicy:DirectionPolicyService;\n','');

must("  private preflight(symbol:string){return evaluatePreflightFeasibility(this.state,symbol,this.market?.primaryReadyReasons(symbol,Date.now())??[]);}\n","  private preflight(symbol:string){return evaluatePreflightFeasibility(this.state,symbol,this.market?.primaryReadyReasons(symbol,Date.now())??[]);}\n  private objectiveCapacity(symbol:string){try{const envelope=buildPreAiExecutionEnvelope(this.state,symbol);return envelope.LONG.executable||envelope.SHORT.executable;}catch{return false;}}\n",'objective capacity');

const oldReady=`            const route=routes.get(x.symbol),trend=this.state.snapshots.get(x.symbol)?.technical?.['15m']?.trend;
            const directionExecutable=Boolean(route)&&(trend==='UP'?Boolean(route!.longExecutable):trend==='DOWN'?Boolean(route!.shortExecutable):Boolean(route!.longExecutable||route!.shortExecutable));
            if(route&&!directionExecutable)this.events.publish('PRIMARY_SKIPPED_DIRECTION_BUDGET',{trend,reason:'CONFIRMED_DIRECTION_NOT_EXECUTABLE',longAvailableNotionalUsd:this.state.runtimeControl.capital.directionBudget.longAvailableNotionalUsd,shortAvailableNotionalUsd:this.state.runtimeControl.capital.directionBudget.shortAvailableNotionalUsd,generation:this.state.runtimeControl.capital.generation,primaryRequested:false},x.symbol);`;
must(oldReady,`            const directionExecutable=this.objectiveCapacity(x.symbol);
            if(!directionExecutable)this.events.publish('PRIMARY_SKIPPED_EXECUTION_CAPACITY',{reason:'NO_OBJECTIVE_EXECUTION_CAPACITY',primaryRequested:false},x.symbol);`,'ready direction filter');

const oldPacket=`      packet=this.eip.build(symbol);
      const preflight=this.preflight(symbol);
      this.events.publish('ENTRY_PREFLIGHT_EVALUATED',preflight,symbol);
      if(!preflight.pass){this.events.publish('ENTRY_PREFLIGHT_BLOCKED',preflight,symbol);this.reject(symbol,\`PREFLIGHT_\${preflight.reason}\`);return;}
      const confirmation=this.state.candidateLifecycle.get(symbol)?.confirmation;`;
const newPacket=`      executionEnvelope=buildPreAiExecutionEnvelope(this.state,symbol);
      this.events.publish('PRE_AI_EXECUTION_ENVELOPE_CREATED',{executionEnvelope},symbol);
      if(!executionEnvelope.LONG.executable&&!executionEnvelope.SHORT.executable){this.reject(symbol,'PRE_AI_NO_EXECUTABLE_CAPACITY');return;}
      const lease=acquireExecutionLease(this.state,{symbol,quoteAsset:executionEnvelope.quoteAsset,reservedMarginUsd:executionEnvelope.leaseRequiredMarginUsd,ttlMs:executionEnvelope.expiresAt-Date.now()});
      if(!lease.ok){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'EXECUTION_LEASE',reason:lease.reason},symbol);this.reject(symbol,lease.reason);return;}
      executionLeaseId=lease.lease.id;
      packet=this.eip.build(symbol,{...executionEnvelope,leaseId:lease.lease.id,leaseExpiresAt:lease.lease.expiresAt});
      const confirmation=this.state.candidateLifecycle.get(symbol)?.confirmation;`;
must(oldPacket,newPacket,'pre-primary envelope');

const policy=`      const directionPolicy=this.directionPolicy.evaluate(symbol,marketForPolicy),allowed=this.directionPolicy.allows(directionPolicy,{...d,direction:decisionSide} as any);
      if(!allowed.ok){this.events.publish('ENTRY_DIRECTION_POLICY_BLOCKED',{runId:result.runId,policy:directionPolicy,reason:allowed.reason,decision:d},symbol);this.reject(symbol,allowed.reason!,result.runId,d.tradeSide??undefined);return;}
`;
s=s.replace(policy,'');
s=s.replace("      if(quality.mode==='ENFORCE'&&opportunity){const invalid=validateOpportunityDecision(result.decision,opportunity);if(invalid)throw new Error(invalid);}\n",'');
s=s.replace("      if (this.state.settings.riskGovernance.protectionMode === \"REQUIRED\" && (d.missingEvidence.length > 0 || d.contradictions.length > 3)) {this.events.publish(\"ENTRY_DECISION_BLOCKED\",{stage:\"ENTRY_PROTECTION\",reason:\"ENTRY_PROTECTION_REQUIRED\",missingEvidence:d.missingEvidence.length,contradictions:d.contradictions.length},symbol);this.reject(symbol,\"ENTRY_PROTECTION_REQUIRED\",result.runId,d.tradeSide??undefined);return;}\n",'');
s=s.replace("      if (this.state.settings.riskGovernance.protectionMode === \"SHADOW\")this.events.publish(\"ENTRY_PROTECTION_SHADOW\",{decision:d.decision,confidence:d.confidence,missingEvidence:d.missingEvidence.length,contradictions:d.contradictions.length},symbol);","      if (d.missingEvidence.length > 0 || d.contradictions.length > 3)this.events.publish(\"ENTRY_PROTECTION_SHADOW\",{decision:d.decision,confidence:d.confidence,missingEvidence:d.missingEvidence.length,contradictions:d.contradictions.length,postAiVeto:false},symbol);");
s=s.replace("...(quality.mode==='ENFORCE'&&opportunity&&opportunity.direction===side?{opportunityEvidence:opportunity}:{} )",'');
const hardOpportunity="    if(intent.opportunityEvidence){const qb=qm?revalidateOpportunity(intent.opportunityEvidence,qm,this.state.settings,order?.price??intent.idealPrice,Date.now(),order?.quantity):'OPPORTUNITY_MARKET_MISSING';if(qb)return qb;}\n";
s=s.replace(hardOpportunity,'');

must("    } finally {\n      this.active.delete(symbol);","    } finally {\n      releaseExecutionLease(this.state,executionLeaseId);\n      this.active.delete(symbol);",'lease finally');

for(const forbidden of ['DirectionPolicyService','this.directionPolicy.evaluate(','PRIMARY_SKIPPED_DIRECTION_BUDGET','validateOpportunityDecision(','sizeEntryQuantity('])if(s.includes(forbidden))throw new Error(`V393_FORBIDDEN_REMAINS:${forbidden}`);
for(const required of ['PRE_AI_EXECUTION_ENVELOPE_CREATED','acquireExecutionLease(','validateExecutionLease(','materializeAiQuantityAllocation(','AI_DIRECTION_NOT_EXECUTABLE','AI_QUANTITY_EXCEEDS_ENVELOPE','WAIT_EXECUTION_RANGE'])if(!s.includes(required))throw new Error(`V393_REQUIRED_MISSING:${required}`);
fs.writeFileSync(file,s);
console.log('V3.9.3 Entry wiring fixed');
