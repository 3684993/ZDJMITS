import {ENTRY_CANDIDATE_REFERENCE_PROTOCOL,type EntryIntelligencePacket} from '@zdj/contracts';

export const now=1_790_900_000_000;
export function referenceFixture(side:'LONG'|'SHORT'='LONG') {
  const menu=(direction:'LONG'|'SHORT')=>({executable:true,candidateSetHash:`cset_v2_${direction}`,candidateSetFactVersion:`facts-${direction}`,
    planCandidates:[{candidateId:`cand_v2_${direction}`,side:direction,quantityUnits:7,entryReferencePrice:100,costVersion:'cost-1',
      targetPrice:direction==='LONG'?103.123456789:96.123456789,
      acceptableTargetRange:direction==='LONG'?{min:102.123456789,max:104.123456789}:{min:95.123456789,max:97.123456789},targetHorizonMinutes:240}]});
  const packet={packetId:'packet-frozen',symbol:'TESTUSDT',createdAt:now,expiresAt:now+90_000,
    market:{technical:{}},microstructure:{imbalance:0},executionEnvelope:{symbol:'TESTUSDT',createdAt:now,
      expiresAt:now+195_000,leaseExpiresAt:now+195_000,LONG:menu('LONG'),SHORT:menu('SHORT')}} as unknown as EntryIntelligencePacket;
  const wire={action:'FINAL',schemaVersion:ENTRY_CANDIDATE_REFERENCE_PROTOCOL,decision:`PLACE_${side}`,tradeSide:side,structureDirection:side,
    selectedCandidateId:`cand_v2_${side}`,candidateSetHash:`cset_v2_${side}`,candidateSetFactVersion:`facts-${side}`,
    confidence:.8,trend1dRole:'NEUTRAL',trend4hRole:'NEUTRAL',trend15mRole:'NEUTRAL',alignmentClass:'MIXED',
    counterTrendException:false,counterTrendReason:null,opportunityType:'TREND_RESUMPTION',marketRegime:'TRANSITION',
    idealPrice:100,acceptablePriceRange:{min:99,max:101},horizonMinutes:3,waitCondition:null,
    directionReason:'Independent market thesis',timingReason:'Closed-bar timing',entryLocationReason:'Inside maker range',
    reason:'Selected target and horizon fit the market thesis',entryInvalidation:'Invalidate on a changed thesis',
    supportingEvidenceRefs:['quote.top'],rejectLayer:'NONE',blockingCondition:'',releaseCondition:'',timingEvent:null};
  return {packet,wire};
}
