import {
  CandidateReferenceResolutionSchema, ENTRY_CANDIDATE_REFERENCE_PROTOCOL, ENTRY_REFERENCE_REQUIRED_FIELDS,
  EntryDecisionReferenceSchema, EntryDecisionV370Schema, ProfitTakePlanSchema,
  type CandidateReferenceResolution, type EntryIntelligencePacket,
} from '@zdj/contracts';

const invalid=(reason:string):never=>{throw new Error(`AI_OUTPUT_INVALID: ${reason}`);};

/** Resolve only against the private snapshot used to build this request's prompt. */
export function resolveCandidateReference(value:unknown,packet:EntryIntelligencePacket,now=Date.now()) {
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('R1 requires one decision object');
  for(const key of ENTRY_REFERENCE_REQUIRED_FIELDS)
    if(!Object.hasOwn(value as object,key)||(value as any)[key]===undefined)invalid(`R1 missing field ${key}`);
  const wire=EntryDecisionReferenceSchema.parse(value);
  const {candidateSetHash,candidateSetFactVersion,...fields}=wire;
  const place=wire.decision==='PLACE_LONG'||wire.decision==='PLACE_SHORT';
  let profitTakePlan:null|ReturnType<typeof ProfitTakePlanSchema.parse>=null;
  let proof:CandidateReferenceResolution|null=null;
  if(!place){
    if(wire.selectedCandidateId!==null||candidateSetHash!==null||candidateSetFactVersion!==null)
      invalid('R1 non-PLACE carries no candidate authorization');
  }else{
    const side=wire.decision==='PLACE_LONG'?'LONG':'SHORT';
    if(wire.tradeSide!==side)invalid('R1 side must match decision');
    if(!wire.selectedCandidateId||!candidateSetHash||!candidateSetFactVersion)invalid('R1 candidate binding is required');
    const envelope=packet.executionEnvelope;
    if(!envelope||envelope.symbol!==packet.symbol)invalid('R1 execution envelope identity missing or mismatched');
    if(!Number.isFinite(envelope.expiresAt)||now>=envelope.expiresAt)invalid('R1 candidate authorization expired');
    if(envelope.leaseExpiresAt!==undefined&&(!Number.isFinite(envelope.leaseExpiresAt)||now>=envelope.leaseExpiresAt))
      invalid('R1 execution lease expired');
    const offered=envelope[side];
    if(!offered||offered.executable!==true)invalid('R1 selected side is not executable');
    if(offered.candidateSetHash!==candidateSetHash||offered.candidateSetFactVersion!==candidateSetFactVersion)
      invalid('R1 candidate set identity mismatch');
    const matches=(offered.planCandidates??[]).filter(row=>row.candidateId===wire.selectedCandidateId);
    if(matches.length!==1)invalid('R1 candidate ID is not uniquely offered on the selected side');
    const candidate=matches[0];
    if(candidate.side!==side)invalid('R1 candidate side mismatch');
    // Some archived menu projections predate these fields. The coordinator still verifies the full candidate.
    if((candidate as any).executable===false||((candidate as any).blockers?.length??0)>0)
      invalid('R1 selected candidate is not executable');
    profitTakePlan=ProfitTakePlanSchema.parse({targetPrice:candidate.targetPrice,
      acceptableTargetRange:{...candidate.acceptableTargetRange},targetHorizonMinutes:candidate.targetHorizonMinutes,
      targetReason:wire.reason,evidenceRefs:wire.supportingEvidenceRefs.slice(0,4)});
    proof=CandidateReferenceResolutionSchema.parse({source:'SYSTEM_FROZEN_CANDIDATE',protocol:ENTRY_CANDIDATE_REFERENCE_PROTOCOL,
      packetId:packet.packetId,symbol:packet.symbol,side,selectedCandidateId:candidate.candidateId,
      candidateSetHash,candidateSetFactVersion,envelopeCreatedAt:envelope.createdAt,envelopeExpiresAt:envelope.expiresAt,resolvedAt:now,
      targetPrice:profitTakePlan.targetPrice,acceptableTargetRange:{...profitTakePlan.acceptableTargetRange},targetHorizonMinutes:profitTakePlan.targetHorizonMinutes});
  }
  // Reuse every existing direction/price/exception invariant after materialization. No legacy wire is repaired.
  const decision=EntryDecisionV370Schema.parse({...fields,schemaVersion:'V3.9.7',quantityUnits:null,profitTakePlan});
  return {decision,candidateSetHash,candidateSetFactVersion,proof};
}
