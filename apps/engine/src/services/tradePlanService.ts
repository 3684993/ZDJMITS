import {createHash} from 'node:crypto';
import {z} from 'zod';
import {TradePlanSchema, type ExecutedPlanRecord, type TradePlan, type TradePlanCandidate} from '@zdj/contracts';
import type {CandidateSet} from './quantityHorizonCandidates.js';
import {reachabilityTimeframe} from './historicalTpReachability.js';

/**
 * S06-A/D/E: assembling, verifying and keeping the original trade plan.
 *
 * The model's output is only ever a choice: a candidate id, or WAIT, plus its thesis and evidence
 * references. Anything that would widen what may actually be sent - a bigger size, a longer horizon,
 * a different direction, an executable predicate expression - is refused here rather than normalised
 * away, so the refusal is auditable. The plan is persisted before a reservation exists, and a fill
 * writes a separate execution record; the original numbers are never edited to match the outcome.
 */

export type PlanSelection={decision:'PLACE_LONG'|'PLACE_SHORT'|'WAIT'|string;side:'LONG'|'SHORT'|'WAIT';selectedCandidateId?:string|null;
  thesis:string|null;invalidationPredicate:string|null;predicateLevel?:number|null;predicateEvidenceRefs:string[];counterEvidenceRefs:string[];
  releaseCondition:string|null;modelRunId:string|null;promptVersion:string|null;modelConfidence:number|null;
  quantityUnits?:number|null;targetPrice?:number|null;targetHorizonMinutes?:number|null;horizonMinutes?:number|null;acceptableTargetRange?:{min:number;max:number}|null};

export type AssembledPlan={plan:TradePlan|null;refusals:string[];warnings:string[];candidate:TradePlanCandidate|null};

const stableId=(prefix:string,value:unknown)=>`${prefix}${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32)}`;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/** The facts a plan was computed on, hashed by the plan layer so no writer needs the risk module. */
export const planFactVersionOf=(facts:unknown)=>`v396p${createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0,40)}`;

/**
 * A plan is identified by the cycle and the exact facts it was computed from, so re-evaluating the
 * same frozen facts yields the same plan id (S06-T09) instead of a fresh random identity.
 */
export function planIdOf(input:{scope:string;cycleId:string;factVersion:string;candidateSetHash:string;side:string;selectedCandidateId:string|null;planVersion:number}){
  return stableId('plan_',input);
}

export function assembleTradePlan(input:{
  selection:PlanSelection;
  candidateSet:CandidateSet;
  scope:string;
  cycleId:string;
  symbol:string;
  leverage:number;
  minNetProfitUsd:number;
  maxRealizedLossUsd:number;
  factVersion:string;
  now:number;
  planVersion?:number;
  supersedesPlanId?:string|null;
  source?:'AI'|'HUMAN'|'SYSTEM';
}):AssembledPlan{
  const refusals:string[]=[],warnings:string[]=[];
  const {selection,candidateSet}=input;
  const wantsPlace=selection.decision==='PLACE_LONG'||selection.decision==='PLACE_SHORT'||(selection.side!=='WAIT'&&selection.decision==='PLACE');
  const side=selection.decision==='PLACE_SHORT'?'SHORT':selection.decision==='PLACE_LONG'?'LONG':selection.side;
  if(!wantsPlace&&side!=='WAIT'){
    return{plan:null,refusals:['PLAN_DECISION_UNRECOGNISED'],warnings:[],candidate:null};
  }
  const parse=(value:unknown)=>{try{return{plan:TradePlanSchema.parse(value),issues:[] as string[]};}catch(error){
    const issues=error instanceof z.ZodError?error.issues.map(issue=>`${String(issue.code)}:${issue.message}`):['PLAN_SCHEMA_INVALID'];
    return{plan:null,issues};}};
  if(side==='WAIT'){
    if(selection.selectedCandidateId)refusals.push('WAIT_CARRIES_CANDIDATE_AUTHORITY');
    if(Number(selection.quantityUnits??0)>0)refusals.push('WAIT_CARRIES_EXECUTABLE_QUANTITY');
    if(finite(selection.targetPrice))refusals.push('WAIT_CARRIES_TARGET_AUTHORITY');
    if(!selection.thesis||!selection.releaseCondition)refusals.push('WAIT_REQUIRES_MACHINE_READABLE_RELEASE_CONDITION');
    if(refusals.length)return{plan:null,refusals,warnings,candidate:null};
    const {plan:waitPlan,issues:waitIssues}=parse({
      planId:planIdOf({scope:input.scope,cycleId:input.cycleId,factVersion:input.factVersion,candidateSetHash:candidateSet.candidateSetHash,side:'WAIT',selectedCandidateId:null,planVersion:input.planVersion??1}),
      planVersion:input.planVersion??1,supersedesPlanId:input.supersedesPlanId??null,cycleId:input.cycleId,scope:input.scope,symbol:input.symbol,side:'WAIT',
      selectedCandidateId:null,quantityUnits:0,notionalUsd:0,marginUsd:0,leverage:input.leverage,
      entryReferencePrice:null,targetPrice:null,acceptableTargetRange:null,
      entryTtlMinutes:1,targetHorizonMinutes:5,managementDurationMs:Math.max(60_000,5*60_000),
      thesis:String(selection.thesis).slice(0,600),invalidationPredicate:'NO_PREDICATE',predicateLevel:null,predicateEvidenceRefs:[],counterEvidenceRefs:[],
      releaseCondition:String(selection.releaseCondition).slice(0,600),costs:null,economics:null,risk:null,
      minNetProfitUsd:input.minNetProfitUsd,maxRealizedLossUsd:input.maxRealizedLossUsd,
      provenance:{modelRunId:selection.modelRunId??null,promptVersion:selection.promptVersion??null,factVersion:input.factVersion,
        envelopeExpiresAt:candidateSet.expiresAt,candidateSetHash:candidateSet.candidateSetHash,createdAt:input.now,source:input.source??'AI'},
      persistedAt:input.now,immutable:true,
    });
    if(!waitPlan)return{plan:null,refusals:[...refusals,...waitIssues],warnings,candidate:null};
    return{plan:waitPlan,refusals,warnings,candidate:null};
  }
  if(side!=='LONG'&&side!=='SHORT')return{plan:null,refusals:['PLAN_SIDE_UNDETERMINED'],warnings:[],candidate:null};
  // The chosen side must have candidates. A side with no capacity is reported as unexecutable; it is
  // never quietly switched to the side that happens to have more room (S06-T01).
  const available=candidateSet.candidates.filter(row=>row.side===side);
  if(!available.length){
    return{plan:null,refusals:[`PLAN_SIDE_NOT_EXECUTABLE:${side}`,...candidateSet.noTradeReasons.map(reason=>`CANDIDATE_SET_${reason}`)],warnings:[],candidate:null};
  }
  // The candidate set validated the caller's triple and resolved any parameter the model left unset.
  // An unoffered choice is refused with the reason the system computed, never rewritten to fit.
  const offered=candidateSet.selection??null;
  // An unoffered selection must arrive with the reason it was computed; a plan layer that refused
  // with an empty list would leave the operator with a blocked decision and nothing to read.
  if(offered&&!offered.offered){const stated=[...new Set(offered.refusals)];return{plan:null,refusals:stated.length?stated:['CANDIDATE_SELECTION_REFUSED_UNSPECIFIED'],warnings:[],candidate:null};}
  // A candidate id that is not the one the system resolved for this triple is a forged reference: it
  // is refused rather than quietly remapped onto whatever was offered.
  if(offered?.resolved&&selection.selectedCandidateId&&selection.selectedCandidateId!==offered.resolved.candidateId)
    return{plan:null,refusals:[`PLAN_CANDIDATE_ID_FORGED:${selection.selectedCandidateId}`],warnings:[],candidate:null};
  const chosen=offered?.resolved
    ?available.find(row=>row.candidateId===offered.resolved!.candidateId)??null
    :available.find(row=>row.quantityUnits===Number(selection.quantityUnits??0)
      &&(selection.selectedCandidateId==null||row.candidateId===selection.selectedCandidateId))??null;
  if(!chosen)return{plan:null,refusals:['PLAN_SELECTION_NOT_IN_CANDIDATE_SET'],warnings:[],candidate:null};
  if(!chosen.executable)return{plan:null,refusals:chosen.blockers.map(blocker=>`CANDIDATE_NOT_EXECUTABLE:${blocker}`),warnings:[],candidate:chosen};
  // Any parameter the model restates differently from the offered candidate is an attempt to widen
  // authority. It is refused rather than silently clamped back to the candidate.
  const statedUnits=Number(selection.quantityUnits??0),statedHorizon=Number(selection.targetHorizonMinutes??0);
  if(finite(statedUnits)&&statedUnits>0&&statedUnits!==chosen.quantityUnits)
    refusals.push(`PLAN_PARAMETER_OUTSIDE_CANDIDATE:quantityUnits=${statedUnits}!=${chosen.quantityUnits}`);
  if(finite(selection.targetPrice)&&Number(selection.targetPrice)>0&&Math.abs(Number(selection.targetPrice)-chosen.targetPrice)>1e-9)
    refusals.push(`PLAN_PARAMETER_OUTSIDE_CANDIDATE:targetPrice=${selection.targetPrice}!=${chosen.targetPrice}`);
  if(finite(statedHorizon)&&statedHorizon>0&&statedHorizon!==chosen.targetHorizonMinutes)
    refusals.push(`PLAN_PARAMETER_OUTSIDE_CANDIDATE:targetHorizonMinutes=${statedHorizon}!=${chosen.targetHorizonMinutes}`);
  if(refusals.length)return{plan:null,refusals:[...new Set(refusals)],warnings,candidate:chosen};
  const authorizedRange=selection.acceptableTargetRange??chosen.acceptableTargetRange;
  if(!finite(authorizedRange?.min)||!finite(authorizedRange?.max)||authorizedRange.min<=0||authorizedRange.min>chosen.targetPrice||authorizedRange.max<chosen.targetPrice)refusals.push('PLAN_AUTHORIZED_TARGET_RANGE_INVALID');
  if(!selection.thesis)refusals.push('PLAN_THESIS_MISSING');
  if(selection.invalidationPredicate&&selection.invalidationPredicate!=='NO_PREDICATE'&&!Array.isArray(selection.predicateEvidenceRefs))
    refusals.push('PLAN_PREDICATE_EVIDENCE_MALFORMED');
  if(!['CLOSED_BAR_BREAKS_LEVEL','STRUCTURE_EVIDENCE_WITHDRAWN','EXTERNAL_FACT_EXPIRED','PLAN_HORIZON_ELAPSED','NO_PREDICATE'].includes(String(selection.invalidationPredicate??'NO_PREDICATE')))
    refusals.push('PLAN_PREDICATE_UNSUPPORTED');
  if(refusals.length)return{plan:null,refusals,warnings,candidate:chosen};
  if(chosen.economics.modelConfidenceIsAuthority!==false)refusals.push('PLAN_CONFIDENCE_MUST_NOT_BE_AUTHORITY');
  const {plan,issues}=parse({
    planId:planIdOf({scope:input.scope,cycleId:input.cycleId,factVersion:input.factVersion,candidateSetHash:candidateSet.candidateSetHash,side,selectedCandidateId:chosen.candidateId,planVersion:input.planVersion??1}),
    planVersion:input.planVersion??1,supersedesPlanId:input.supersedesPlanId??null,cycleId:input.cycleId,scope:input.scope,symbol:input.symbol,side,
    selectedCandidateId:chosen.candidateId,quantityUnits:chosen.quantityUnits,notionalUsd:chosen.notionalUsd,marginUsd:chosen.marginUsd,leverage:input.leverage,
    entryReferencePrice:chosen.entryReferencePrice,targetPrice:chosen.targetPrice,acceptableTargetRange:authorizedRange,
    entryTtlMinutes:chosen.entryTtlMinutes,targetHorizonMinutes:chosen.targetHorizonMinutes,managementDurationMs:chosen.managementDurationMs,
    thesis:String(selection.thesis).slice(0,600),
    invalidationPredicate:selection.invalidationPredicate??'NO_PREDICATE',predicateLevel:finite(selection.predicateLevel)?selection.predicateLevel:null,
    predicateEvidenceRefs:(selection.predicateEvidenceRefs??[]).slice(0,12),counterEvidenceRefs:(selection.counterEvidenceRefs??[]).slice(0,12),
    releaseCondition:selection.releaseCondition?String(selection.releaseCondition).slice(0,600):null,
    costs:chosen.costs,economics:{...chosen.economics,modelConfidence:finite(selection.modelConfidence)?selection.modelConfidence:null},
    risk:chosen.risk,minNetProfitUsd:input.minNetProfitUsd,maxRealizedLossUsd:input.maxRealizedLossUsd,
    provenance:{modelRunId:selection.modelRunId??null,promptVersion:selection.promptVersion??null,factVersion:input.factVersion,
      envelopeExpiresAt:candidateSet.expiresAt,candidateSetHash:candidateSet.candidateSetHash,createdAt:input.now,source:input.source??'AI'},
    persistedAt:input.now,immutable:true,
  });
  if(!plan)return{plan:null,refusals:[...refusals,...issues],warnings,candidate:chosen};
  if(chosen.economics.expectedNetPnlAtHorizonStatus!=='VERIFIED')warnings.push(`EXPECTED_NET_PNL_${chosen.economics.expectedNetPnlAtHorizonStatus}`);
  if(chosen.costs.fundingStatus!=='VERIFIED')warnings.push('FUNDING_COST_UNPROVEN');
  return{plan,refusals:[...new Set(refusals)],warnings,candidate:chosen};
}

export type EvidenceVerdict={ready:boolean;usable:string[];unusable:Array<{ref:string;reason:string}>;evidenceVersion:string};

/**
 * S06-D: an evidence reference is only support if the fact it names still exists, still applies to
 * this symbol and timeframe, and is still closed and fresh. A valid-looking id from another cycle or
 * an unclosed bar is unusable, not "probably fine".
 */
export function evaluatePlanEvidence(plan:TradePlan,input:{
  now:number;
  facts:{symbol:string;timeframe:string;isClosed:boolean;barCloseTime:number;maxAgeMs:number;appliesToSymbol:string}[];
  resolve:(ref:string)=>{symbol?:string;timeframe?:string;closedAt?:number;observedAt?:number}|null;
}):EvidenceVerdict{
  const usable:string[]=[],unusable:{ref:string;reason:string}[]=[];
  const refs=[...new Set([...plan.predicateEvidenceRefs,...plan.counterEvidenceRefs])];
  for(const ref of refs){
    const resolved=input.resolve(ref);
    if(!resolved){unusable.push({ref,reason:'PLAN_EVIDENCE_UNRESOLVED'});continue;}
    if(resolved.symbol&&resolved.symbol!==plan.symbol){unusable.push({ref,reason:`PLAN_EVIDENCE_SYMBOL_MISMATCH:${resolved.symbol}`});continue;}
    const fact=input.facts.find(row=>row.timeframe===(resolved.timeframe??row.timeframe));
    if(!fact){unusable.push({ref,reason:'PLAN_EVIDENCE_TIMEFRAME_MISSING'});continue;}
    if(!fact.isClosed){unusable.push({ref,reason:'PLAN_EVIDENCE_BAR_NOT_CLOSED'});continue;}
    if(resolved.closedAt!=null&&resolved.closedAt!==fact.barCloseTime){unusable.push({ref,reason:'PLAN_EVIDENCE_BAR_SUPERSEDED'});continue;}
    if(input.now-fact.barCloseTime>fact.maxAgeMs){unusable.push({ref,reason:'PLAN_EVIDENCE_STALE'});continue;}
    if(fact.appliesToSymbol&&fact.appliesToSymbol!==plan.symbol){unusable.push({ref,reason:'PLAN_EVIDENCE_NOT_APPLICABLE'});continue;}
    usable.push(ref);
  }
  const required=plan.invalidationPredicate!=='NO_PREDICATE'&&plan.side!=='WAIT';
  return{ready:!required||usable.length>0,usable,unusable,evidenceVersion:stableId('ev_',{usable,unusable,now:input.now})};
}

export const PREDICATE_TIMEOUT_MS=60_000;

/**
 * A predicate is evaluated by the system against enumerated facts. The plan never carries code, and
 * an unrecognised predicate name is treated as "not satisfied" rather than as permission to exit.
 */
export function evaluateInvalidationPredicate(plan:TradePlan,input:{now:number;latestClosedBar:{timeframe:string;closeTime:number;close:number}|null;
  evidenceStillValid:boolean;externalFactFresh:boolean;firstFillAt:number|null}):{thesisInvalid:boolean;reason:string|null;observedAt:number}{
  const observedAt=input.now;
  switch(plan.invalidationPredicate){
    case 'CLOSED_BAR_BREAKS_LEVEL':{
      if(!input.latestClosedBar||!finite(plan.predicateLevel))return{thesisInvalid:false,reason:'PREDICATE_FACT_MISSING',observedAt};
      const broke=input.latestClosedBar.closeTime>=plan.persistedAt&&input.latestClosedBar.close<Number(plan.predicateLevel);
      return{thesisInvalid:broke,reason:broke?'CLOSED_BAR_BELOW_PLAN_LEVEL':null,observedAt};
    }
    case 'STRUCTURE_EVIDENCE_WITHDRAWN':
      if(!input.evidenceStillValid)return{thesisInvalid:true,reason:'STRUCTURE_EVIDENCE_WITHDRAWN',observedAt};
      return{thesisInvalid:false,reason:null,observedAt};
    case 'EXTERNAL_FACT_EXPIRED':
      if(!input.externalFactFresh)return{thesisInvalid:true,reason:'EXTERNAL_FACT_EXPIRED',observedAt};
      return{thesisInvalid:false,reason:null,observedAt};
    case 'PLAN_HORIZON_ELAPSED':{
      if(!finite(input.firstFillAt)||Number(input.firstFillAt)<=0)return{thesisInvalid:false,reason:'FIRST_FILL_UNPROVEN',observedAt};
      const due=Number(input.firstFillAt)+plan.targetHorizonMinutes*60_000;
      return{thesisInvalid:observedAt>=due,reason:observedAt>=due?'PLAN_TARGET_HORIZON_ELAPSED':null,observedAt};
    }
    case 'NO_PREDICATE':return{thesisInvalid:false,reason:null,observedAt};
    default:return{thesisInvalid:false,reason:'PREDICATE_UNSUPPORTED',observedAt};
  }
}

/** The loss budget of a cycle belongs to the first plan of that cycle and is never re-based. */
export function cycleLossBudget(plans:TradePlan[],cycleId:string){
  const forCycle=plans.filter(plan=>plan.cycleId===cycleId).sort((a,b)=>a.planVersion-b.planVersion||a.persistedAt-b.persistedAt);
  const origin=forCycle[0]??null;
  return{originPlanId:origin?.planId??null,maxRealizedLossUsd:origin?.maxRealizedLossUsd??null,minNetProfitUsd:origin?.minNetProfitUsd??null,rebased:false,versions:forCycle.map(plan=>plan.planVersion)};
}

/** Explicit, narrow planVersion transitions. A new version may not loosen the cycle's own limits. */
export function assertPlanSupersede(previous:TradePlan|null,next:TradePlan):string[]{
  if(!previous)return[];
  const errors:string[]=[];
  if(next.cycleId!==previous.cycleId)errors.push('SUPERSEDE_CYCLE_MISMATCH');
  if(next.planVersion<=previous.planVersion)errors.push('PLAN_VERSION_NOT_INCREASING');
  if(next.maxRealizedLossUsd>previous.maxRealizedLossUsd)errors.push('LOSS_BUDGET_MUST_NOT_GROW');
  if(next.minNetProfitUsd<previous.minNetProfitUsd)errors.push('PROFIT_FLOOR_MUST_NOT_LOOSEN');
  if(next.side!==previous.side&&next.side!=='WAIT')errors.push('PLAN_DIRECTION_REINTERPRETED');
  if(next.persistedAt<previous.persistedAt)errors.push('PLAN_TIME_TRAVEL');
  return errors;
}

export function executedPlanRecord(input:{plan:TradePlan;intentId:string|null;reservationId:string|null;orderId:string|null;
  actualEntryPrice:number|null;executedQuantityUnits:number;feeActualUsd:number|null;source:ExecutedPlanRecord['source'];now:number}):ExecutedPlanRecord{
  const planned=input.plan.entryReferencePrice,actual=finite(input.actualEntryPrice)?input.actualEntryPrice:null;
  return{schemaVersion:'V396-PLAN-EXECUTION-1',planId:input.plan.planId,planVersion:input.plan.planVersion,cycleId:input.plan.cycleId,
    intentId:input.intentId,reservationId:input.reservationId,orderId:input.orderId,plannedEntryPrice:planned,actualEntryPrice:actual,
    plannedQuantityUnits:input.plan.quantityUnits,executedQuantityUnits:input.executedQuantityUnits,
    priceDeviationUsd:actual!=null&&finite(planned)?Number((actual-Number(planned)).toFixed(10)):0,
    quantityDeviationUnits:input.executedQuantityUnits-input.plan.quantityUnits,
    feeActualUsd:input.feeActualUsd,fundingStatusAtFill:input.plan.costs?.fundingStatus??'UNPROVEN',
    predictionMutated:false,recordedAt:input.now,source:input.source};
}

/** Timeframe a plan's evidence must be read at, so a reviewer cannot quietly switch charts. */
export const planEvidenceTimeframe=(plan:TradePlan)=>reachabilityTimeframe(plan.targetHorizonMinutes);

/**
 * The AI exit decision reads its plan facts here and nowhere else: a cycle with no durable plan, a
 * WAIT plan, or a plan whose scope does not match the position gets nothing, so the AI inherits
 * authority from no label of any kind.
 */
export function aiExitPlanFactsOf(plans:TradePlan[],input:{scope:string;cycleId:string;now:number;
  latestClosedBar:{timeframe:string;closeTime:number;close:number}|null;markPrice:number|null;
  externalFactFresh?:boolean;evidenceStillValid?:boolean;firstFillAt:number|null}){
  const forCycle=plans.filter(plan=>plan.cycleId===input.cycleId&&plan.scope===input.scope&&plan.side!=='WAIT');
  const plan=forCycle[forCycle.length-1]??null;
  if(!plan)return null;
  const invalidation=evaluateInvalidationPredicate(plan,{now:input.now,latestClosedBar:input.latestClosedBar,
    evidenceStillValid:input.evidenceStillValid??(input.latestClosedBar?input.latestClosedBar.closeTime>=plan.persistedAt:true),
    externalFactFresh:input.externalFactFresh!==false,firstFillAt:input.firstFillAt});
  const reached=Number.isFinite(Number(input.markPrice))&&plan.targetPrice!=null
    &&(plan.side==='LONG'?Number(input.markPrice)>=Number(plan.targetPrice):Number(input.markPrice)<=Number(plan.targetPrice));
  return{planRef:plan.planId,planVersion:plan.planVersion,thesisInvalid:invalidation.thesisInvalid,
    invalidationPredicate:invalidation.reason??plan.invalidationPredicate,invalidationEvidenceRefs:[...plan.predicateEvidenceRefs],
    exitConditionMet:reached,minNetProfitUsd:Number(plan.minNetProfitUsd),managementDeadline:plan.managementDurationMs,
    horizonElapsed:invalidation.reason==='PLAN_TARGET_HORIZON_ELAPSED'};
}
