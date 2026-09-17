import fs from 'node:fs';

const coordinatorPath='apps/engine/src/services/entryCoordinator.ts';
if(fs.readFileSync(coordinatorPath,'utf8').includes("materializeAiQuantityAllocation")){console.log('V3.9.3 autonomous Entry patch already applied');process.exit(0);}
const warnings=[];
const patch=(file,fn)=>{const before=fs.readFileSync(file,'utf8'),after=fn(before);if(after===before)warnings.push(`NO_CHANGE:${file}`);else fs.writeFileSync(file,after);};
const once=(s,from,to,label)=>{const n=s.split(from).length-1;if(n===0){warnings.push(`MISS:${label}`);return s;}if(n>1)throw new Error(`${label}: expected <=1 match, got ${n}`);return s.replace(from,to);};

patch('apps/engine/src/services/preAiExecutionEnvelope.ts',s=>{
  s=once(s,"import { activeExecutionLeaseMargin } from './executionLease.js';","import { activeExecutionLeaseMargin } from './executionLease.js';\nimport { privateAccountFresh } from './privateAccountReadiness.js';",'envelope import');
  s=once(s,"  const capacity=state.entryCapacity(),sameUnderlyingOccupied=", "  const privateReady=privateAccountFresh(state.account,now),capacity=state.entryCapacity(),sameUnderlyingOccupied=",'envelope private');
  s=s.replace(/executable:slotAvailable&&maxNotionalUsd\+1e-8>=minimumNotional&&maxQuantityUnits>=minUnits/g,"executable:privateReady&&slotAvailable&&maxNotionalUsd+1e-8>=minimumNotional&&maxQuantityUnits>=minUnits");
  return s;
});

patch(coordinatorPath,s=>{
  s=s.replace('  sizeEntryQuantity,\n','');
  s=s.replace("import { DirectionPolicyService } from './directionPolicyService.js';\n",'');
  s=s.replace("import { evaluatePreflightFeasibility } from './preflightFeasibility.js';\n", "import { evaluatePreflightFeasibility } from './preflightFeasibility.js';\nimport { buildPreAiExecutionEnvelope } from './preAiExecutionEnvelope.js';\nimport { acquireExecutionLease, releaseExecutionLease, validateExecutionLease } from './executionLease.js';\nimport { materializeAiQuantityAllocation } from './aiQuantityAllocation.js';\n");
  s=s.replace('  private readonly directionPolicy:DirectionPolicyService;\n','');
  s=s.replace('  ) { this.directionPolicy=new DirectionPolicyService(state); }','  ) {}');
  s=s.replace(/this\.state\.pool\.refreshReadyView\(new Set\(this\.state\.universe\.filter\(\(candidate:any\)=>\{const route=routes\.get\(candidate\.symbol\),trend=this\.state\.snapshots\.get\(candidate\.symbol\)\?\.technical\?\.\['15m'\]\?\.trend;return candidate\.eligible&&candidate\.pipelineEligible!==false&&Boolean\(route\)&&\(trend==='UP'\?route\.longExecutable:trend==='DOWN'\?route\.shortExecutable:route\.longExecutable\|\|route\.shortExecutable\);\}\)\.map\(\(candidate:any\)=>candidate\.symbol\)\)\);/,"this.state.pool.refreshReadyView(new Set(this.state.universe.filter((candidate:any)=>candidate.eligible&&candidate.pipelineEligible!==false&&this.objectiveCapacity(candidate.symbol)).map((candidate:any)=>candidate.symbol)));");
  s=s.replace(/const route=routes\.get\(x\.symbol\),trend=this\.state\.snapshots\.get\(x\.symbol\)\?\.technical\?\.\['15m'\]\?\.trend;\n\s*const directionExecutable=Boolean\(route\)&&\(trend==='UP'\?Boolean\(route!\.longExecutable\):trend==='DOWN'\?Boolean\(route!\.shortExecutable\):Boolean\(route!\.longExecutable\|\|route!\.shortExecutable\)\);\n\s*if\(route&&!directionExecutable\)this\.events\.publish\('PRIMARY_SKIPPED_DIRECTION_BUDGET',\{[^\n]+\},x\.symbol\);/,"const directionExecutable=this.objectiveCapacity(x.symbol);\n            if(!directionExecutable)this.events.publish('PRIMARY_SKIPPED_EXECUTION_CAPACITY',{reason:'NO_OBJECTIVE_EXECUTION_CAPACITY',primaryRequested:false},x.symbol);");
  const preflightMethod="  private preflight(symbol:string){return evaluatePreflightFeasibility(this.state,symbol,this.market?.primaryReadyReasons(symbol,Date.now())??[]);}\n";
  s=once(s,preflightMethod,preflightMethod+"  private objectiveCapacity(symbol:string){try{const envelope=buildPreAiExecutionEnvelope(this.state,symbol);return envelope.LONG.executable||envelope.SHORT.executable;}catch{return false;}}\n",'objective helper');
  s=s.replace("if(qp.mode==='ENFORCE'||intent.opportunityEvidence){const qb=qm?revalidateOpportunity(intent.opportunityEvidence,qm", "if(intent.opportunityEvidence){const qb=qm?revalidateOpportunity(intent.opportunityEvidence,qm");
  s=once(s,"    let terminalRunId:string|undefined;","    let terminalRunId:string|undefined,executionLeaseId:string|undefined,executionEnvelope:ReturnType<typeof buildPreAiExecutionEnvelope>|null=null;",'lease local');
  s=s.replace(/      packet=this\.eip\.build\(symbol\);\n      const preflight=this\.preflight\(symbol\);\n      this\.events\.publish\('ENTRY_PREFLIGHT_EVALUATED',preflight,symbol\);\n      if\(!preflight\.pass\)\{this\.events\.publish\('ENTRY_PREFLIGHT_BLOCKED',preflight,symbol\);this\.reject\(symbol,`PREFLIGHT_\$\{preflight\.reason\}`\);return;\}\n      const confirmation=this\.state\.candidateLifecycle\.get\(symbol\)\?\.confirmation;/,`      executionEnvelope=buildPreAiExecutionEnvelope(this.state,symbol);
      this.events.publish('PRE_AI_EXECUTION_ENVELOPE_CREATED',{symbol,executionEnvelope},symbol);
      if(!executionEnvelope.LONG.executable&&!executionEnvelope.SHORT.executable){this.reject(symbol,'PRE_AI_NO_EXECUTABLE_CAPACITY');return;}
      const leaseResult=acquireExecutionLease(this.state,{symbol,quoteAsset:executionEnvelope.quoteAsset,reservedMarginUsd:executionEnvelope.leaseRequiredMarginUsd,ttlMs:executionEnvelope.expiresAt-Date.now()});
      if(!leaseResult.ok){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'EXECUTION_LEASE',reason:leaseResult.reason},symbol);this.reject(symbol,leaseResult.reason);return;}
      executionLeaseId=leaseResult.lease.id;
      packet=this.eip.build(symbol,{...executionEnvelope,leaseId:leaseResult.lease.id,leaseExpiresAt:leaseResult.lease.expiresAt});
      const confirmation=this.state.candidateLifecycle.get(symbol)?.confirmation;`);
  s=s.replace(/      const directionPolicy=this\.directionPolicy\.evaluate\(symbol,marketForPolicy\),allowed=this\.directionPolicy\.allows\(directionPolicy,\{\.\.\.d,direction:decisionSide\} as any\);\n      if\(!allowed\.ok\)\{[^\n]+\n?[^\n]*\}\n/,'');
  s=s.replace("this.events.publish('MATERIAL_DECISION_CHANGE',{fingerprint,materialDecisionChange:previous?.fingerprint!==fingerprint,policy:directionPolicy,decision:nextDecision,direction:d.tradeSide},symbol);","this.events.publish('MATERIAL_DECISION_CHANGE',{fingerprint,materialDecisionChange:previous?.fingerprint!==fingerprint,policy:'AI_AUTONOMOUS_DIRECTION',decision:nextDecision,direction:d.tradeSide},symbol);");
  s=s.replace(/      const positions = \[\.\.\.this\.state\.positions\.values\(\)\]\.map\([\s\S]*?      this\.state\.allocationPlans\.set\(plan\.planId, plan\);/,`      if(!executionEnvelope)throw new Error('PRE_AI_EXECUTION_ENVELOPE_MISSING');
      const leaseCheck=validateExecutionLease(this.state,executionLeaseId,symbol);if(!leaseCheck.ok){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'POST_AI_EXECUTION_LEASE',reason:leaseCheck.reason},symbol);this.reject(symbol,leaseCheck.reason,result.runId,d.tradeSide??undefined);return;}
      const sideEnvelope=executionEnvelope[side];
      if(!sideEnvelope.executable){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'POST_PRIMARY_EXECUTION_ENVELOPE',reason:'AI_DIRECTION_NOT_EXECUTABLE',brainRunId:result.runId,direction:side},symbol);this.reject(symbol,'AI_DIRECTION_NOT_EXECUTABLE',result.runId,d.tradeSide??undefined);return;}
      const quantityUnits=Number(d.quantityUnits);if(!Number.isInteger(quantityUnits)||quantityUnits<=0){this.reject(symbol,'AI_QUANTITY_UNITS_INVALID',result.runId,d.tradeSide??undefined);return;}
      if(quantityUnits>sideEnvelope.maxQuantityUnits){this.events.publish('AI_SIZING_ERROR',{brainRunId:result.runId,reason:'AI_QUANTITY_EXCEEDS_ENVELOPE',quantityUnits,maxQuantityUnits:sideEnvelope.maxQuantityUnits,direction:side},symbol);this.reject(symbol,'AI_QUANTITY_EXCEEDS_ENVELOPE',result.runId,d.tradeSide??undefined);return;}
      const plan=materializeAiQuantityAllocation({state:this.state,candidate,snapshot:market,side,quantityUnits,authorizationMaxPrice:d.acceptablePriceRange.max,envelope:executionEnvelope});
      this.state.allocationPlans.set(plan.planId, plan);`);
  s=s.replace("      const reservationId = reservation.reservationId,leverage = plan.leverage,now = Date.now();","      const reservationId = reservation.reservationId,leverage = plan.leverage,now = Date.now();releaseExecutionLease(this.state,executionLeaseId);executionLeaseId=undefined;");
  s=s.replace("...(quality.mode==='ENFORCE'&&opportunity?{opportunityEvidence:opportunity}:{} )","...(quality.mode==='ENFORCE'&&opportunity&&opportunity.direction===side?{opportunityEvidence:opportunity}:{} )");
  s=s.replace("      const reservationRisk=computeExecutableRiskHeadroom", "      (intent as any).quantityUnits=Number(d.quantityUnits);(intent as any).executionEnvelope=executionEnvelope;\n      const reservationRisk=computeExecutableRiskHeadroom");
  s=s.replace(/sizeEntryQuantity\(plan\.notionalUsd,maker\.price,market\.quote\.stepSize,market\.quote\.minQty,market\.quote\.minNotional\)/g,"Number((intent as any).quantityUnits)*market.quote.stepSize");
  s=s.replace(/sizeEntryQuantity\(plan\.notionalUsd,retryMaker\.price,refreshed\.quote\.stepSize,refreshed\.quote\.minQty,refreshed\.quote\.minNotional\)/g,"Number((intent as any).quantityUnits)*refreshed.quote.stepSize");
  s=s.replace(/sizeEntryQuantity\(intent\.allocationPlan\.notionalUsd,next\.price,market\.quote\.stepSize,market\.quote\.minQty,market\.quote\.minNotional\)/g,"Number((intent as any).quantityUnits)*market.quote.stepSize");
  const orderCheck="if(order){const q=snapshot.quote,tickUnits=order.price/q.tickSize,stepUnits=order.quantity/q.stepSize,rangeEpsilon=";
  s=once(s,orderCheck,"if(order){const q=snapshot.quote,frozenUnits=Number((intent as any).quantityUnits),frozenEnvelope=(intent as any).executionEnvelope,expectedQuantity=frozenUnits*q.stepSize;if(!Number.isInteger(frozenUnits)||frozenUnits<=0||!frozenEnvelope||frozenUnits>Number(frozenEnvelope?.[intent.side]?.maxQuantityUnits??-1))return'AI_QUANTITY_EXCEEDS_ENVELOPE';if(Math.abs(order.quantity-expectedQuantity)>Math.max(1e-12,q.stepSize*1e-9))return'AI_QUANTITY_MUTATED_AFTER_DECISION';if(order.quantity*order.price>Number(frozenEnvelope[intent.side].maxNotionalUsd)+1e-8)return'AI_QUANTITY_EXCEEDS_ENVELOPE';const tickUnits=order.price/q.tickSize,stepUnits=order.quantity/q.stepSize,rangeEpsilon=",'jit frozen qty');
  s=s.replace("    } finally {\n      this.active.delete(symbol);","    } finally {\n      releaseExecutionLease(this.state,executionLeaseId);\n      this.active.delete(symbol);");
  const critical=['materializeAiQuantityAllocation','PRE_AI_EXECUTION_ENVELOPE_CREATED','AI_DIRECTION_NOT_EXECUTABLE','AI_QUANTITY_EXCEEDS_ENVELOPE','AI_QUANTITY_MUTATED_AFTER_DECISION'];for(const token of critical)if(!s.includes(token))throw new Error(`CRITICAL_PATCH_MISSING:${token}`);
  for(const forbidden of ['DirectionPolicyService','PRIMARY_SKIPPED_DIRECTION_BUDGET','sizeEntryQuantity('])if(s.includes(forbidden))throw new Error(`FORBIDDEN_EXECUTION_LOGIC_REMAINS:${forbidden}`);
  return s;
});

patch('apps/engine/src/services/aiFabric.ts',s=>s.replace("protocolVersion:'V3.9.2'","protocolVersion:'V3.9.3'"));
if(warnings.length)console.warn(warnings.join('\n'));
console.log('V3.9.3 autonomous Entry patch applied');
