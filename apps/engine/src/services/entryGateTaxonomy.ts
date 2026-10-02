/**
 * V3.9.7 Entry gate taxonomy.
 *
 * A gate's category answers who owns the fact. Its disposition answers whether this deployment may
 * act on it. Keeping those two answers separate prevents a TESTNET portfolio observation from being
 * rendered as an execution veto, while still allowing a separately approved Production policy to
 * enforce the same measured dimension.
 */
export const ENTRY_GATE_TAXONOMY_VERSION='V3.9.7_GATE_TAXONOMY_1' as const;
export type EntryGateCategory='CORRECTNESS'|'CAPITAL_AUTHORITY'|'STRATEGY_OBSERVATION';
export type EntryGateDisposition='ENFORCE'|'OBSERVE';
export type EntryGateDecision={
  taxonomyVersion:typeof ENTRY_GATE_TAXONOMY_VERSION;
  reason:string;
  category:EntryGateCategory;
  disposition:EntryGateDisposition;
  canVeto:boolean;
  mutatesQuantity:boolean;
};

const has=(reason:string,parts:string[])=>parts.some(part=>reason.includes(part));

/** Unknown reasons deliberately fall back to CORRECTNESS/fail-closed instead of silently acquiring
 * strategy or sizing authority. The returned category never decides enforcement by itself. */
export function entryGateCategory(value:unknown):EntryGateCategory{
  const reason=String(value??'UNKNOWN').toUpperCase();
  if(has(reason,['GROSS_EXPOSURE','DIRECTION_EXPOSURE','CORRELATED_CLUSTER','CLUSTER_DIRECTION','STRESS_LIMIT','DAILY_DRAWDOWN',
    'POSITION_CAPACITY','MAX_POSITIONS','HUMAN_MANAGED_EXPOSURE','HUMAN_POTENTIAL','UNDERLYING_POSITION','UNDERLYING_ENTRY']))
    return'STRATEGY_OBSERVATION';
  if(has(reason,['INSUFFICIENT_AVAILABLE_MARGIN','AVAILABLE_MARGIN','CAPITAL_FACT','CAPITAL_ROUTE','CAPITAL_VERSION','MARGIN_REQUIREMENT',
    'BUSINESS_MIN_INITIAL_MARGIN','MARGIN_CAP','LEVERAGE_UNPROVEN','BELOW_MINIMUM_NOTIONAL','MINIMUM_NOTIONAL','RISK_PER_TRADE',
    'RISK_SIZING','RISK_ADMISSION_CEILING','ECONOMIC_MIN_NET','MIN_PROFIT','QUOTE_CAPACITY']))return'CAPITAL_AUTHORITY';
  return'CORRECTNESS';
}

export function entryGateDecision(reason:unknown,input:{disposition?:EntryGateDisposition;mutatesQuantity?:boolean}={}):EntryGateDecision{
  const normalized=String(reason??'UNKNOWN'),category=entryGateCategory(normalized),disposition=input.disposition??'ENFORCE';
  return{taxonomyVersion:ENTRY_GATE_TAXONOMY_VERSION,reason:normalized,category,disposition,canVeto:disposition==='ENFORCE',
    // An observed gate is structurally unable to alter size. Correctness gates refuse bad facts rather
    // than manufacturing a smaller order, so they also never own quantity.
    mutatesQuantity:disposition==='ENFORCE'&&category!=='CORRECTNESS'&&input.mutatesQuantity===true};
}
