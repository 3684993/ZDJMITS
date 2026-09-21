import type {ExitEstimate,PriceBoundResult} from './s03ExitCostEstimator.js';

export type OwnerState='AI_ACTIVE'|'HANDOFF_PENDING'|'HUMAN_MANAGED'|'CLOSED';
export type VerdictOutcome='ALLOW'|'HOLD'|'HANDOFF'|'BLOCKED_FACTS';

export type AiExitVerdict={
  outcome:VerdictOutcome;reasonCodes:string[];evidenceRefs:string[];
  ownerVersion:number;planVersion:number;estimateHash:string;
  authorizationExpiresAt:number|null;boundaryPrice:number|null;
  lossLimit:number;conservativeNet:number|null;
  orderType:'LIMIT';marketFallbackAllowed:false;
};

export type PolicyInput={
  owner:{ownerState:OwnerState;ownerVersion:number;cycleId:string;scope:string;deadline:number|null};
  plan:{planVersion:number;cycleId:string;scope:string;thesisInvalid:boolean;invalidationPredicate:string|null;invalidationEvidenceRefs:string[];exitConditionMet:boolean;minNetProfitUsd:number};
  estimate:ExitEstimate;
  bound:PriceBoundResult;
  policy:{lossLimit:number;allowSmallLoss:boolean;authorizationTtlMs:number};
  now:number;
};

const MILLI=1_000;
const verdict=(input:PolicyInput,outcome:VerdictOutcome,codes:string[],extra:Partial<AiExitVerdict>={}):AiExitVerdict=>({
  outcome,reasonCodes:[...new Set(codes)].sort(),evidenceRefs:[...new Set(input.estimate.sourceIds.concat(input.plan.invalidationEvidenceRefs))].sort(),
  ownerVersion:input.owner.ownerVersion,planVersion:input.plan.planVersion,estimateHash:input.estimate.estimateHash,
  authorizationExpiresAt:null,boundaryPrice:null,lossLimit:input.policy.lossLimit,conservativeNet:input.estimate.conservativeNet,
  orderType:'LIMIT',marketFallbackAllowed:false,...extra,
});

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
  if(!Number.isSafeInteger(plan.minNetProfitUsd*MILLI)||plan.minNetProfitUsd<0)
    return verdict(input,'BLOCKED_FACTS',['POLICY_CONFIG_INVALID_PROFIT_FLOOR']);

  if(owner.scope!==estimate.scope||plan.scope!==estimate.scope||owner.cycleId!==estimate.cycleId||plan.cycleId!==estimate.cycleId)
    return verdict(input,'HOLD',['IDENTITY_MISMATCH_OWNER_PLAN_ESTIMATE']);
  if(!Number.isSafeInteger(owner.ownerVersion)||owner.ownerVersion<1||!Number.isSafeInteger(plan.planVersion)||plan.planVersion<1)
    return verdict(input,'HOLD',['OWNER_OR_PLAN_VERSION_INVALID']);
  if(owner.ownerState==='CLOSED')return verdict(input,'HOLD',['CYCLE_CLOSED_NO_AI_EXIT']);
  if(owner.ownerState==='HUMAN_MANAGED')return verdict(input,'HOLD',['HUMAN_MANAGED_NO_AI_AUTHORITY']);
  if(owner.ownerState==='HANDOFF_PENDING')return verdict(input,'HOLD',['AI_AUTHORITY_REVOKED_PENDING_HUMAN']);
  if(owner.deadline==null||!Number.isFinite(owner.deadline))return verdict(input,'HANDOFF',['AI_MANAGEMENT_DEADLINE_UNKNOWN'],{boundaryPrice:null});
  if(now>=owner.deadline)return verdict(input,'HANDOFF',['AI_MANAGEMENT_EXPIRED']);

  if(!estimate.quoteFresh)return verdict(input,'BLOCKED_FACTS',['QUOTE_EXPIRED_NO_AUTHORITY',...estimate.reasons]);
  if(estimate.factsStatus==='CONFLICT')return verdict(input,'BLOCKED_FACTS',['FACT_CONFLICT_NO_FAVORABLE_PICK',...estimate.reasons]);
  if(estimate.reasons.some(reason=>reason.startsWith('UNCONVERTED_COST')))return verdict(input,'BLOCKED_FACTS',['COST_CURRENCY_UNCONVERTED',...estimate.reasons]);
  if(estimate.factsStatus==='UNKNOWN'||estimate.conservativeNet==null)return verdict(input,'BLOCKED_FACTS',['FACTS_INCOMPLETE_NO_NET_VALUE',...estimate.reasons]);

  const limitMilli=Math.round(policy.lossLimit*MILLI),netMilli=Math.round(estimate.conservativeNet*MILLI);
  if(netMilli<-limitMilli)return verdict(input,'HANDOFF',['CYCLE_WOULD_BREACH_LOSS_LIMIT']);
  const profitFloorMilli=Math.round(plan.minNetProfitUsd*MILLI);

  const executable=bound.executable&&bound.orderType==='LIMIT'&&bound.marketFallbackAllowed===false&&bound.limitPrice!=null;
  const finalize=(codes:string[]):AiExitVerdict=>executable
    ?verdict(input,'ALLOW',[...codes,'PRICE_BOUND_EXECUTABLE_LIMIT_ONLY'],{
        authorizationExpiresAt:Math.min(now+policy.authorizationTtlMs,estimate.expiresAt,owner.deadline),
        boundaryPrice:bound.limitPrice,
      })
    :verdict(input,'HOLD',[...codes,'EXECUTION_BOUND_UNAVAILABLE'].filter(code=>executable||code!=='PRICE_BOUND_EXECUTABLE_LIMIT_ONLY'));

  if(plan.thesisInvalid&&netMilli<0){
    if(!policy.allowSmallLoss)return verdict(input,'HOLD',['SMALL_LOSS_EXIT_NOT_PERMITTED']);
    if(!plan.invalidationPredicate||!plan.invalidationEvidenceRefs.length)return verdict(input,'BLOCKED_FACTS',['THESIS_INVALIDATION_EVIDENCE_MISSING']);
    return finalize(['THESIS_INVALIDATED_WITHIN_SMALL_LOSS_LIMIT']);
  }
  if(netMilli>=profitFloorMilli&&plan.exitConditionMet)return finalize(['MICRO_PROFIT_EXIT_CONDITION_MET']);
  if(netMilli>=profitFloorMilli)return verdict(input,'HOLD',['PROFIT_EXIT_CONDITION_NOT_MET']);
  return verdict(input,'HOLD',['NO_PERMITTED_EXIT_CONDITION']);
}
