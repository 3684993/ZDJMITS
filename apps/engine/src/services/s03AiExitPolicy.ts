import {INTEGRITY_REASON_CODES,stableHash,type ExitEstimate,type PriceBoundResult} from './s03ExitCostEstimator.js';

export type OwnerState='AI_ACTIVE'|'HANDOFF_PENDING'|'HUMAN_MANAGED'|'CLOSED';
export type VerdictOutcome='ALLOW'|'HOLD'|'HANDOFF'|'BLOCKED_FACTS';

export type AiExitVerdict={
  outcome:VerdictOutcome;reasonCodes:string[];evidenceRefs:string[];
  ownerVersion:number;planVersion:number;estimateHash:string;
  authorizationExpiresAt:number|null;boundaryPrice:number|null;
  lossLimit:number;conservativeNet:number|null;
  /** The profit line that actually bound this decision, and which authority supplied it. */
  profitFloorUsd:number|null;profitFloorSource:'AI_PERMISSION'|'PLAN_FLOOR'|'BOTH'|'NONE';
  orderType:'LIMIT';marketFallbackAllowed:false;
  /** Covers everything that could have changed this decision, not just the valuation. */
  decisionHash:string;
  provenance:'MODEL_COST_MODEL'|'SYNTHETIC_MAINTENANCE';
};

export type PolicyInput={
  owner:{ownerState:OwnerState;ownerVersion:number;cycleId:string;scope:string;deadline:number|null};
  plan:{planVersion:number;cycleId:string;scope:string;thesisInvalid:boolean;invalidationPredicate:string|null;invalidationEvidenceRefs:string[];exitConditionMet:boolean;minNetProfitUsd:number;economicMandate?:unknown|null};
  estimate:ExitEstimate;
  bound:PriceBoundResult;
  policy:{lossLimit:number;allowSmallLoss:boolean;authorizationTtlMs:number;minNetProfitUsd:number};
  now:number;
};

const MILLI=1_000;
const verdict=(input:PolicyInput,outcome:VerdictOutcome,codes:string[],extra:Partial<AiExitVerdict>={}):AiExitVerdict=>{
  const {owner,plan,estimate,policy,now,bound}=input;
  const base={
    outcome,reasonCodes:[...new Set(codes)].sort(),evidenceRefs:[...new Set(estimate.sourceIds.concat(plan.invalidationEvidenceRefs))].sort(),
    ownerVersion:owner.ownerVersion,planVersion:plan.planVersion,estimateHash:estimate.estimateHash,
    authorizationExpiresAt:null as number|null,boundaryPrice:null as number|null,
    lossLimit:policy.lossLimit,conservativeNet:estimate.conservativeNet,
    profitFloorUsd:null,profitFloorSource:'NONE' as AiExitVerdict['profitFloorSource'],
    orderType:'LIMIT' as const,marketFallbackAllowed:false as const,provenance:'MODEL_COST_MODEL' as const,...extra,
  };
  // estimateHash alone only identifies the valuation. Two different authorities can be derived
  // from it - a tighter loss limit, a switched small-loss flag, a bumped owner version - so the
  // artefact that a later stage may act on has to identify the whole decision (I01, I04, I08).
  const decisionHash=stableHash({
    ...base,now,
    owner:{state:owner.ownerState,version:owner.ownerVersion,cycleId:owner.cycleId,scope:owner.scope,deadline:owner.deadline},
    plan:{version:plan.planVersion,cycleId:plan.cycleId,scope:plan.scope,thesisInvalid:plan.thesisInvalid,predicate:plan.invalidationPredicate,exitConditionMet:plan.exitConditionMet,minNetProfitUsd:plan.minNetProfitUsd,economicMandate:plan.economicMandate??null},
    policy:{lossLimit:policy.lossLimit,allowSmallLoss:policy.allowSmallLoss,authorizationTtlMs:policy.authorizationTtlMs,minNetProfitUsd:policy.minNetProfitUsd},
    boundPrice:bound?.limitPrice??null,
  });
  return {...base,decisionHash};
};

/**
 * S03-B: the AI exit authority decision, in CONTRACTS §5 order and nothing else.
 *
 * owner and deadline first, then fact completeness, then the cumulative cycle loss line, then
 * an invalidated thesis inside the small-loss allowance, then a genuine micro profit, then
 * HOLD. A deeper loss is decided before any model conviction, and neither an expired deadline
 * nor a human-managed cycle can be revived by a profitable mark (I01, I04, I06).
 *
 * ALLOW additionally requires an executable limit price: an unreachable or too-small bound
 * downgrades to HOLD rather than becoming a market order, and no order path is wired here.
 */
export function decideAiExit(input:PolicyInput):AiExitVerdict{
  const {owner,plan,estimate,policy,now,bound}=input;
  if(!Number.isFinite(now)||now<0)return verdict(input,'HOLD',['NOW_INVALID']);
  if(!Number.isFinite(policy.lossLimit)||policy.lossLimit<0||policy.lossLimit>10||!Number.isSafeInteger(Math.round(policy.lossLimit*MILLI))||!(policy.authorizationTtlMs>0))
    return verdict(input,'BLOCKED_FACTS',['POLICY_CONFIG_INVALID_LOSS_LIMIT_OR_TTL']);
  if(!Number.isSafeInteger(plan.minNetProfitUsd*MILLI)||!(plan.minNetProfitUsd>0))
    return verdict(input,'BLOCKED_FACTS',['POLICY_CONFIG_INVALID_PROFIT_FLOOR']);
  // The AI has its own profit permission line. An unset or impossible value is a configuration
  // failure, never a silent fall back to the take-profit economics floor, which is a different
  // authority about a different thing (S08: the TP floor must not be borrowed as AI policy).
  if(!Number.isSafeInteger(policy.minNetProfitUsd*MILLI)||!(policy.minNetProfitUsd>0))
    return verdict(input,'BLOCKED_FACTS',['POLICY_CONFIG_INVALID_AI_MIN_NET_PROFIT']);

  if(owner.scope!==estimate.scope||plan.scope!==estimate.scope||owner.cycleId!==estimate.cycleId||plan.cycleId!==estimate.cycleId)
    return verdict(input,'HOLD',['IDENTITY_MISMATCH_OWNER_PLAN_ESTIMATE']);
  if(!Number.isSafeInteger(owner.ownerVersion)||owner.ownerVersion<1||!Number.isSafeInteger(plan.planVersion)||plan.planVersion<1)
    return verdict(input,'HOLD',['OWNER_OR_PLAN_VERSION_INVALID']);
  if(owner.ownerState==='CLOSED')return verdict(input,'HOLD',['CYCLE_CLOSED_NO_AI_EXIT']);
  if(owner.ownerState==='HUMAN_MANAGED')return verdict(input,'HOLD',['HUMAN_MANAGED_NO_AI_AUTHORITY']);
  if(owner.ownerState==='HANDOFF_PENDING')return verdict(input,'HOLD',['AI_AUTHORITY_REVOKED_PENDING_HUMAN']);
  if(owner.deadline==null||!Number.isFinite(owner.deadline))return verdict(input,'HANDOFF',['AI_MANAGEMENT_DEADLINE_UNKNOWN'],{boundaryPrice:null});
  if(now>=owner.deadline)return verdict(input,'HANDOFF',['AI_MANAGEMENT_EXPIRED']);

  // Defence in depth: the estimator already withholds the value for these, but a verdict must
  // not become ALLOW because somebody handed the policy a re-labelled estimate object.
  if(estimate.reasons.some(reason=>INTEGRITY_REASON_CODES.includes(reason)||reason.startsWith('FOREIGN_CYCLE_FACT')))
    return verdict(input,'BLOCKED_FACTS',['ESTIMATE_INTEGRITY_FAILED',...estimate.reasons]);
  if(!estimate.quoteFresh)return verdict(input,'BLOCKED_FACTS',['QUOTE_EXPIRED_NO_AUTHORITY',...estimate.reasons]);
  if(estimate.factsStatus==='CONFLICT')return verdict(input,'BLOCKED_FACTS',['FACT_CONFLICT_NO_FAVORABLE_PICK',...estimate.reasons]);
  if(estimate.reasons.some(reason=>reason.startsWith('UNCONVERTED_COST')))return verdict(input,'BLOCKED_FACTS',['COST_CURRENCY_UNCONVERTED',...estimate.reasons]);
  if(estimate.factsStatus==='UNKNOWN'||estimate.conservativeNet==null)return verdict(input,'BLOCKED_FACTS',['FACTS_INCOMPLETE_NO_NET_VALUE',...estimate.reasons]);

  const limitMilli=Math.round(policy.lossLimit*MILLI),netMilli=Math.round(estimate.conservativeNet*MILLI);
  if(netMilli<-limitMilli)return verdict(input,'HANDOFF',['CYCLE_WOULD_BREACH_LOSS_LIMIT']);
  // Both lines have to hold, so the binding one is the higher. Which one it was is reported rather
  // than left for a reader to infer, because "the AI closed early" and "the plan required more" are
  // two different explanations an operator will be asked about.
  const planFloorMilli=Math.round(plan.minNetProfitUsd*MILLI),aiFloorMilli=Math.round(policy.minNetProfitUsd*MILLI);
  const profitFloorMilli=Math.max(planFloorMilli,aiFloorMilli);
  const floorOf=()=>({profitFloorUsd:profitFloorMilli/MILLI,profitFloorSource:(planFloorMilli===aiFloorMilli?'BOTH'
    :(planFloorMilli>aiFloorMilli?'PLAN_FLOOR':'AI_PERMISSION')) as AiExitVerdict['profitFloorSource']});

  const executable=bound.executable&&bound.orderType==='LIMIT'&&bound.marketFallbackAllowed===false&&bound.limitPrice!=null;
  const authorizeAt=executable?Math.min(now+policy.authorizationTtlMs,estimate.expiresAt,owner.deadline):null;
  const finalize=(codes:string[]):AiExitVerdict=>executable&&authorizeAt!=null&&authorizeAt>now
    ?verdict(input,'ALLOW',[...codes,'PRICE_BOUND_EXECUTABLE_LIMIT_ONLY'],{authorizationExpiresAt:authorizeAt,boundaryPrice:bound.limitPrice,...floorOf()})
    :verdict(input,'HOLD',executable?[...codes,'AUTHORIZATION_WINDOW_EMPTY']:[...codes,'EXECUTION_BOUND_UNAVAILABLE'],floorOf());

  if(plan.thesisInvalid&&netMilli<0){
    if(!policy.allowSmallLoss)return verdict(input,'HOLD',['SMALL_LOSS_EXIT_NOT_PERMITTED'],floorOf());
    if(!plan.invalidationPredicate||!plan.invalidationEvidenceRefs.length)return verdict(input,'BLOCKED_FACTS',['THESIS_INVALIDATION_EVIDENCE_MISSING'],floorOf());
    return finalize(['THESIS_INVALIDATED_WITHIN_SMALL_LOSS_LIMIT']);
  }
  if(netMilli>=profitFloorMilli&&plan.exitConditionMet)return finalize(['MICRO_PROFIT_EXIT_CONDITION_MET']);
  if(netMilli>=profitFloorMilli)return verdict(input,'HOLD',['PROFIT_EXIT_CONDITION_NOT_MET'],floorOf());
  return verdict(input,'HOLD',['NO_PERMITTED_EXIT_CONDITION'],floorOf());
}
