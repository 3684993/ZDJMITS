import {ENTRY_CANDIDATE_REFERENCE_PROTOCOL,ENTRY_FACT_BOUND_REFERENCE_PROTOCOL,ENTRY_FACT_BOUND_REQUIRED_FIELDS,
  EntryDecisionFactBoundSchema,EntryDirectionResolutionSchema,type EntryIntelligencePacket,type BrainDecision,
  type CandidateReferenceResolution} from '@zdj/contracts';
import {frozenEntryDirectionFacts} from '@zdj/core';
import {resolveCandidateReference} from './resolveCandidateReference.js';

const invalid=(reason:string):never=>{throw new Error(`AI_OUTPUT_INVALID: R2 ${reason}`);};
const sign=(value:unknown)=>typeof value!=='number'||!Number.isFinite(value)?'UNKNOWN':value>0?'POSITIVE':value<0?'NEGATIVE':'ZERO';

/** Validate machine-readable factual claims against the exact request, not a later market snapshot. */
export function validateEntryFactChecks(checks:ReturnType<typeof EntryDecisionFactBoundSchema.parse>['factChecks'],packet:EntryIntelligencePacket){
  const seen=new Set<string>();
  for(const check of checks){
    const key=`${check.factId}:${check.field}`;
    if(seen.has(key))invalid('duplicate fact check');
    seen.add(key);
    const frame=check.factId.split('.')[1] as '1d'|'4h'|'15m',card=packet.market.technical[frame];
    const raw=card?.[check.field];
    const expected=check.field==='trend'?(['UP','DOWN','RANGE'].includes(String(raw))?raw:'UNKNOWN'):sign(raw);
    if(check.value!==expected)invalid(`fact check mismatch ${key}`);
  }
  for(const frame of ['1d','4h','15m'])
    if(!seen.has(`technical.${frame}.confirmed:macdHistogram`))invalid(`missing MACD fact check ${frame}`);
}

/** Materialization is explicit R2-only. Never repair or re-interpret historical R1 model output. */
export function resolveFactBoundReference(value:unknown,packet:EntryIntelligencePacket,now=Date.now()){
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('requires one decision object');
  for(const key of ENTRY_FACT_BOUND_REQUIRED_FIELDS)
    if(!Object.hasOwn(value as object,key)||(value as any)[key]===undefined)invalid(`missing field ${key}`);
  const wire=EntryDecisionFactBoundSchema.parse(value),facts=frozenEntryDirectionFacts(packet);
  if(wire.directionFactsVersion!==facts.version)invalid('direction facts version mismatch');
  validateEntryFactChecks(wire.factChecks,packet);
  const place=wire.decision==='PLACE_LONG'||wire.decision==='PLACE_SHORT';
  const counterTrend=Boolean(place&&wire.tradeSide&&facts.strategicConsensus&&wire.tradeSide!==facts.strategicConsensus);
  if(counterTrend&&!wire.counterTrendReason?.trim())invalid('explicit counter-trend reason required');
  if(!counterTrend&&wire.counterTrendReason!==null)invalid('counter-trend reason not applicable');
  const {directionFactsVersion,factChecks,timingEventId,...fields}=wire;
  const originalEvent=packet.opportunityEvidence?.timingEvent;
  if(timingEventId!==null&&(!originalEvent||timingEventId==='NONE'||timingEventId!==originalEvent.id))invalid('unknown timing event reference');
  const timingEvent=timingEventId===null?null:{...originalEvent};
  // Existing candidate binding, expiry, side, price and wait rules run unchanged on the materialized contract.
  const reference=resolveCandidateReference({...fields,schemaVersion:ENTRY_CANDIDATE_REFERENCE_PROTOCOL,
    trend1dRole:facts.trend1dRole,trend4hRole:facts.trend4hRole,trend15mRole:facts.trend15mRole,
    alignmentClass:counterTrend?'COUNTER_TREND_REVERSAL':facts.baseAlignmentClass,counterTrendException:counterTrend,
    directionReason:wire.reason,timingReason:wire.reason,entryLocationReason:wire.reason,
    blockingCondition:place?'':wire.reason,releaseCondition:'',timingEvent},packet,now);
  const directionResolution=EntryDirectionResolutionSchema.parse({source:'SYSTEM_FROZEN_DIRECTION_FACTS',facts,factChecks});
  return{...reference,proof:reference.proof?{...reference.proof,protocol:ENTRY_FACT_BOUND_REFERENCE_PROTOCOL} as CandidateReferenceResolution:null,
    directionResolution};
}

/** Defense at execution boundary: an R2 decision cannot bypass the parser's frozen fact binding. */
export function validateFrozenDirectionResolution(decision:BrainDecision,packet:EntryIntelligencePacket):boolean{
  try{
    const proof=EntryDirectionResolutionSchema.parse(decision.directionResolution),facts=frozenEntryDirectionFacts(packet);
    if(JSON.stringify(proof.facts)!==JSON.stringify(facts))return false;
    if(decision.trend1dRole!==facts.trend1dRole||decision.trend4hRole!==facts.trend4hRole||decision.trend15mRole!==facts.trend15mRole)return false;
    validateEntryFactChecks(proof.factChecks,packet);
    return true;
  }catch{return false;}
}
