import {TradingQualityExperimentManifestSchema,TradingQualityEnrollmentEvidenceSchema,TradingQualityFundingEvidenceSchema} from '@zdj/contracts';
import type {
  TradeRecord,
  TradingQualityEnrollmentEvidence,
  TradingQualityExperimentManifest,
  TradingQualityFundingEvidence,
  TradingQualityMetricBasis,
} from '@zdj/contracts';

export type EligibilityResult = { eligible:boolean; reasons:string[] };
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const approx=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-8,Math.max(Math.abs(a),Math.abs(b))*1e-8);
const ok=(reasons:string[]):EligibilityResult=>({eligible:reasons.length===0,reasons});

/** Ledger completeness is deliberately independent from funding economics. */
export function ledgerClosedComplete(record:TradeRecord):EligibilityResult {
  const reasons:string[]=[];
  if(record.status!=='CLOSED')reasons.push('STATUS_NOT_CLOSED');
  if(record.classification!=='COMPLETE')reasons.push('CLASSIFICATION_NOT_COMPLETE');
  if(record.recordCompleteness!=='COMPLETE')reasons.push('RECORD_NOT_COMPLETE');
  if(record.feeCompleteness!=='COMPLETE')reasons.push('FEE_NOT_COMPLETE');
  if(record.canonical===false||record.duplicateOf)reasons.push('NON_CANONICAL_OR_DUPLICATE');
  if(!record.cycleId)reasons.push('CYCLE_ID_MISSING');
  if(record.integrityFlags.includes('CONFLICT')||record.integrityFlags.includes('FILL_CONSERVATION_FAILED'))reasons.push('IDENTITY_OR_QUANTITY_CONFLICT');
  if(record.entryFillCount<=0||record.exitFillCount<=0)reasons.push('FILL_FACTS_MISSING');
  if(!finite(record.entryAveragePrice)||!finite(record.exitAveragePrice))reasons.push('AVERAGE_PRICE_MISSING');
  if(!finite(record.entryQty)||record.entryQty<=0||!finite(record.openedAt)||!finite(record.closedAt)||record.closedAt<record.openedAt)reasons.push('LEDGER_RANGE_INVALID');
  if(!finite(record.entryFee)||!finite(record.exitFee)||!finite(record.totalFee)||!approx(record.entryFee+record.exitFee,record.totalFee))reasons.push('FEE_SUM_INCONSISTENT');
  if(!finite(record.grossRealizedPnl)||!finite(record.tradingNetPnlExFunding)||!finite(record.totalFee)||!approx(record.grossRealizedPnl-record.totalFee,record.tradingNetPnlExFunding))reasons.push('TRADING_NET_INCONSISTENT');
  if(!finite(record.totalFee))reasons.push('FEE_VALUE_MISSING');
  const exitQty=record.exitQty;
  if(!finite(exitQty)||!finite(record.remainingQty)||!approx(exitQty,record.entryQty)||!approx(record.remainingQty,0))reasons.push('QUANTITY_NOT_CONSERVED');
  return ok([...new Set(reasons)]);
}

export function legacyEconomicInconsistency(record:TradeRecord):boolean {
  return finite(record.netPnl)&&(record.fundingAttributionStatus!=='EXACT'||record.pnlBasis!=='CANONICAL_NET_WITH_FUNDING');
}

function fundingEvidenceValid(record:TradeRecord,evidence?:TradingQualityFundingEvidence|null,accountScope?:string):boolean{
  if(record.fundingAttributionStatus!=='EXACT'||record.pnlBasis!=='CANONICAL_NET_WITH_FUNDING'||!finite(record.funding))return false;
  if(!TradingQualityFundingEvidenceSchema.safeParse(evidence).success||!evidence||!accountScope)return false;
  if(evidence.accountScope!==accountScope||record.openedAt==null||record.closedAt==null||evidence.coverageStartAt>record.openedAt||evidence.coverageEndAt<record.closedAt||evidence.verifiedAt<evidence.coverageEndAt)return false;
  return evidence.attributionStatus==='EXACT'&&evidence.cycleId===record.cycleId&&evidence.factIds.length>0&&evidence.coverageEndAt>=evidence.coverageStartAt;
}

/** Formal net-PnL eligibility. The stored authoritative net is consumed, never manufactured here. */
export function canonicalPnlEligible(record:TradeRecord,input?:{fundingEvidence?:TradingQualityFundingEvidence|null;accountScope?:string}):EligibilityResult{
  const ledger=ledgerClosedComplete(record),reasons=[...ledger.reasons];
  if(!fundingEvidenceValid(record,input?.fundingEvidence,input?.accountScope))reasons.push('FUNDING_EVIDENCE_NOT_EXACT');
  if(!finite(record.tradingNetPnlExFunding))reasons.push('TRADING_NET_EX_FUNDING_MISSING');
  if(!finite(record.netPnl))reasons.push('AUTHORITATIVE_NET_PNL_MISSING');
  if(finite(record.tradingNetPnlExFunding)&&finite(record.funding)&&finite(record.netPnl)&&!approx(record.tradingNetPnlExFunding+record.funding,record.netPnl))reasons.push('AUTHORITATIVE_NET_PNL_INCONSISTENT');
  return ok([...new Set(reasons)]);
}

/** Immutable cohort membership: runtime restart/first-observed/close time are intentionally absent. */
export function prospectiveCohortMember(manifest:TradingQualityExperimentManifest|undefined,evidence:TradingQualityEnrollmentEvidence|undefined):EligibilityResult{
  const reasons:string[]=[];
  if(!manifest){reasons.push('MANIFEST_MISSING');return ok(reasons);}
  if(!evidence){reasons.push('ENROLLMENT_EVIDENCE_MISSING');return ok(reasons);}
  if(!TradingQualityExperimentManifestSchema.safeParse(manifest).success||!TradingQualityEnrollmentEvidenceSchema.safeParse(evidence).success)return ok(['INVALID_MANIFEST_OR_ENROLLMENT']);
  if(evidence.intentCreatedAt>=manifest.entryEnrollmentEndAt||evidence.cycleCreatedAt>=manifest.entryEnrollmentEndAt)reasons.push('ENTRY_OUTSIDE_ENROLLMENT_WINDOW');
  if(evidence.source!=='NEW_DECISION')reasons.push(evidence.source==='TRANSITIONAL_EXISTING_ORDER'?'TRANSITIONAL_PREEXISTING_ORDER':'NON_PROSPECTIVE_SOURCE');
  if(evidence.decisionAt<manifest.decisionStartAt||evidence.decisionAt>=manifest.entryEnrollmentEndAt)reasons.push('DECISION_OUTSIDE_ENROLLMENT_WINDOW');
  if(evidence.intentCreatedAt<evidence.decisionAt||evidence.cycleCreatedAt<evidence.intentCreatedAt)reasons.push('ENROLLMENT_IDENTITY_PREEXISTS_DECISION');
  for(const [key,a,b] of [
    ['ENVIRONMENT',evidence.environment,manifest.environment],['ACCOUNT_SCOPE',evidence.accountScope,manifest.accountScope],['CODE_HEAD',evidence.codeHead,manifest.codeHead],
    ['CONFIG_HASH',evidence.configHash,manifest.configHash],['POLICY_VERSION',evidence.policyVersion,manifest.policyVersion],['METRIC_VERSION',evidence.metricVersion,manifest.metricVersion],['RULE_HASH',evidence.ruleHash,manifest.ruleHash],
  ] as const)if(a!==b)reasons.push(`${key}_MISMATCH`);
  return ok(reasons);
}

export type EntryMetricEligibilityInput={
  exactEntryAttribution:boolean;
  anchorKnown:boolean;
  horizonMature:boolean;
  pathComplete:boolean;
  executableQuoteComplete?:boolean;
  entryCostComplete?:boolean;
  exitCostBoundComplete?:boolean;
  fundingHorizonComplete?:boolean;
  dataConflict?:boolean;
};

export function entryMetricEligible(basis:TradingQualityMetricBasis,input:EntryMetricEligibilityInput):EligibilityResult{
  const reasons:string[]=[];
  if(!input.exactEntryAttribution)reasons.push('ENTRY_ATTRIBUTION_UNKNOWN');
  if(!input.anchorKnown)reasons.push('ANCHOR_UNKNOWN');
  if(!input.horizonMature)reasons.push('HORIZON_IMMATURE');
  if(!input.pathComplete)reasons.push('PATH_INCOMPLETE');
  if(input.dataConflict)reasons.push('DATA_CONFLICT');
  if(basis==='EXECUTABLE_EX_FUNDING'||basis==='EXECUTABLE_WITH_FUNDING'){
    if(!input.executableQuoteComplete)reasons.push('EXECUTABLE_QUOTE_INCOMPLETE');
    if(!input.entryCostComplete)reasons.push('ENTRY_COST_INCOMPLETE');
    if(!input.exitCostBoundComplete)reasons.push('EXIT_COST_BOUND_INCOMPLETE');
  }
  if(basis==='EXECUTABLE_WITH_FUNDING'&&!input.fundingHorizonComplete)reasons.push('FUNDING_HORIZON_INCOMPLETE');
  return ok(reasons);
}

export function prospectiveEconomicEligible(input:{cohort:EligibilityResult;metric:EligibilityResult;canonical?:EligibilityResult;requiresCanonical?:boolean}):EligibilityResult{
  const reasons=[...input.cohort.reasons,...input.metric.reasons];
  if(input.requiresCanonical)reasons.push(...(input.canonical?.reasons??['CANONICAL_ELIGIBILITY_NOT_EVALUATED']));
  return ok([...new Set(reasons)]);
}
