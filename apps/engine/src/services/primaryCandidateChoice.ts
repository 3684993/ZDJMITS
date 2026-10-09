import {EntryDecisionJsonSchema,type EntryIntelligencePacket} from '@zdj/contracts';

export const PRIMARY_CHOICE_PROTOCOL='FROZEN_CANDIDATE_ID_V1';
const redundant=['quantityUnits','idealPrice','acceptablePriceRange','horizonMinutes','profitTakePlan'];

/** New requests select an immutable menu row, rather than retyping its execution numbers. */
export function primaryChoiceJsonSchema(packet:EntryIntelligencePacket){
  return {oneOf:EntryDecisionJsonSchema.oneOf.map(branch=>{
    const properties:any={...branch.properties};for(const field of redundant)delete properties[field];
    const side=(properties.decision as any).const==='PLACE_LONG'?'LONG':(properties.decision as any).const==='PLACE_SHORT'?'SHORT':null;
    properties.executionSelection={const:PRIMARY_CHOICE_PROTOCOL};
    properties.candidateSetHash=side?{const:packet.executionEnvelope?.[side]?.candidateSetHash??'NO_OFFERED_SET'}:{type:'null'};
    if(side){const ids=packet.executionEnvelope?.[side]?.planCandidates?.map(x=>x.candidateId)??[];properties.selectedCandidateId=ids.length?{enum:ids}:{const:'NO_OFFERED_CANDIDATE'};}
    return {...branch,properties,required:[...branch.required.filter(x=>!redundant.includes(x)),'executionSelection','candidateSetHash']};
  })};
}

/** No legacy malformed price is repaired here. Only the explicitly versioned choice has no prices. */
export function materializePrimaryChoice(value:any,packet:EntryIntelligencePacket,now=Date.now()){
  if(value?.executionSelection!==PRIMARY_CHOICE_PROTOCOL)return value;
  const allowed=new Set([...EntryDecisionJsonSchema.oneOf[0]!.required.filter(x=>!redundant.includes(x)),'executionSelection','candidateSetHash']);
  if(Object.keys(value).some(key=>!allowed.has(key)))throw Error('AI_OUTPUT_INVALID: choice contains redundant or unknown fields');
  const {executionSelection,candidateSetHash,...raw}=value;
  const side=raw.decision==='PLACE_LONG'?'LONG':raw.decision==='PLACE_SHORT'?'SHORT':null;
  if(!side){
    if(candidateSetHash!==null||raw.selectedCandidateId!==null||raw.tradeSide!==null)throw Error('AI_OUTPUT_INVALID: non-PLACE choice has execution authority');
    return {...raw,quantityUnits:null,idealPrice:null,acceptablePriceRange:null,horizonMinutes:null,profitTakePlan:null};
  }
  const envelope=packet.executionEnvelope,capacity=envelope?.[side];
  if(raw.schemaVersion!=='V3.9.7'||raw.tradeSide!==side||!envelope||envelope.symbol!==packet.symbol||
    !capacity?.executable||!capacity.candidateSetHash||candidateSetHash!==capacity.candidateSetHash||
    !Number.isFinite(envelope.createdAt)||!Number.isFinite(envelope.expiresAt)||now<envelope.createdAt||now>=envelope.expiresAt)
    throw Error('AI_OUTPUT_INVALID: frozen choice identity, permission or validity conflict');
  const matches=capacity.planCandidates?.filter(x=>x.candidateId===raw.selectedCandidateId)??[];
  if(matches.length!==1||matches[0]!.side!==side)throw Error('AI_OUTPUT_INVALID: candidate id not uniquely offered on selected side');
  const selected=matches[0]!,range=(selected as any).sizingProof?.executableEntryRange,tick=envelope.exchange.tickSize;
  const price=selected.entryReferencePrice;
  if(!range||![price,range.min,range.max,tick].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)||
    range.min>range.max||price<range.min||price>range.max||Math.abs(price/tick-Math.round(price/tick))>1e-7)
    throw Error('AI_OUTPUT_INVALID: frozen candidate has no legal tick price');
  // The candidate set hash is checked again against the full frozen set at the coordinator boundary.
  return {...raw,quantityUnits:null,idealPrice:price,acceptablePriceRange:{...range},horizonMinutes:1,
    profitTakePlan:{targetPrice:selected.targetPrice,acceptableTargetRange:{...selected.acceptableTargetRange},
      targetHorizonMinutes:selected.targetHorizonMinutes,targetReason:raw.entryLocationReason,evidenceRefs:raw.supportingEvidenceRefs?.slice(0,4)??[]}};
}
