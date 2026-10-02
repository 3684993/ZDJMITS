import {afterEach,describe,expect,it,vi} from 'vitest';
import {ENTRY_FACT_BOUND_REFERENCE_PROTOCOL as R2,ENTRY_CANDIDATE_REFERENCE_PROTOCOL as R1,EntryDecisionFactBoundJsonSchema,
  EntryDecisionReferenceJsonSchema,ENTRY_FACT_BOUND_REQUIRED_FIELDS} from '@zdj/contracts';
import {frozenEntryDirectionFacts} from '@zdj/core';
import {entryDecisionParse} from './aiFabric.js';
import {resolveFactBoundReference,validateFrozenDirectionResolution} from './resolveFactBoundReference.js';
import {validateDirectionContract,captureEntryThesis,entryThesisDrift} from './entryDirectionContract.js';
import {resolveEntryOpportunityAuthorization} from './entryOpportunityAuthorization.js';
import {now,referenceFixture} from '../testing/candidateReferenceFixture.js';

const fixture=(side:'LONG'|'SHORT'='LONG')=>{
  const {packet,wire:old}=referenceFixture(side);
  packet.market.technical={...packet.market.technical,...Object.fromEntries(['1d','4h','15m','1m','5m'].map(tf=>[tf,
    {trend:'UP',macdHistogram:.01,emaSlope21:-.2,asOf:now-1000,atr14:10,isClosed:true}]))} as any;
  packet.market.quote={last:100,bid:99.99,ask:100.01,mark:100,ts:now} as any;
  const {trend1dRole,trend4hRole,trend15mRole,alignmentClass,counterTrendException,directionReason,timingReason,
    entryLocationReason,blockingCondition,releaseCondition,timingEvent,...wire}=old;
  return{packet,old,wire:{...wire,schemaVersion:R2,counterTrendReason:side==='SHORT'?'Explicit strategic reversal with defined invalidation':null,
    directionFactsVersion:frozenEntryDirectionFacts(packet).version,timingEventId:null,
    factChecks:['1d','4h','15m'].map(tf=>({factId:`technical.${tf}.confirmed`,field:'macdHistogram',value:'POSITIVE'}))}};
};
afterEach(()=>vi.restoreAllMocks());

describe('R2 frozen facts with independent model hypothesis',()=>{
  it.each(['LONG','SHORT'] as const)('materializes objective facts and exact frozen %s candidate without changing model choice',side=>{
    const {packet,wire}=fixture(side),before=structuredClone({packet,wire});vi.spyOn(Date,'now').mockReturnValue(now+1);
    const d=entryDecisionParse(wire,packet,R2),candidate=packet.executionEnvelope![side].planCandidates![0];
    expect(d).toMatchObject({schemaVersion:R2,protocolVersion:R2,tradeSide:side,quantityUnits:null,
      trend1dRole:'SUPPORTS_LONG',trend4hRole:'SUPPORTS_LONG',trend15mRole:'SUPPORTS_LONG',counterTrendException:side==='SHORT',
      alignmentClass:side==='SHORT'?'COUNTER_TREND_REVERSAL':'ALIGNED_LONG',
      profitTakePlan:{targetPrice:candidate.targetPrice,acceptableTargetRange:candidate.acceptableTargetRange},
      candidateReferenceResolution:{protocol:R2,source:'SYSTEM_FROZEN_CANDIDATE'},
      directionResolution:{source:'SYSTEM_FROZEN_DIRECTION_FACTS',facts:frozenEntryDirectionFacts(packet),factChecks:wire.factChecks}});
    expect(validateDirectionContract(packet.market,d)).toMatchObject({ok:true,minimumCandidateRequired:side==='SHORT'});
    expect(validateFrozenDirectionResolution(d,packet)).toBe(true);
    expect({packet,wire}).toEqual(before);
  });
  it('preserves an explicit null model structure opinion separately from the chosen trade side',()=>{
    const {packet,wire}=fixture();vi.spyOn(Date,'now').mockReturnValue(now+1);
    wire.structureDirection=null;
    expect(entryDecisionParse(wire,packet,R2)).toMatchObject({structureDirection:null,tradeSide:'LONG',trend1dRole:'SUPPORTS_LONG'});
  });
  it.each([
    ['incorrect hash',{candidateSetHash:'other'}],['incorrect candidate version',{candidateSetFactVersion:'other'}],
    ['incorrect direction version',{directionFactsVersion:'other'}],['opposite side',{tradeSide:'SHORT'}],
    ['invented ID',{selectedCandidateId:'absent'}],['cross-side ID',{selectedCandidateId:'cand_v2_SHORT'}],
    ['model role field',{trend4hRole:'SUPPORTS_LONG'}],['model class',{alignmentClass:'ALIGNED_LONG'}],
    ['model quantity',{quantityUnits:null}],['model target',{profitTakePlan:null}],['forged proof',{directionResolution:{}}],
    ['entry outside range',{idealPrice:102}],['non-applicable exception',{counterTrendReason:'Forged reversal'}],
  ])('rejects %s',(name,patch)=>{
    const {packet,wire}=fixture();expect(()=>resolveFactBoundReference({...wire,...patch},packet,now+1)).toThrow();
  });
  it.each(ENTRY_FACT_BOUND_REQUIRED_FIELDS)('requires explicit field %s',key=>{
    const {packet,wire}=fixture();delete (wire as any)[key];expect(()=>resolveFactBoundReference(wire,packet,now+1)).toThrow('missing field');
  });
  it.each(['wrong sign','missing sign','duplicate','unknown ID','wrong field','wrong type','invented unknown'])('rejects %s factual check',kind=>{
    const {packet,wire}=fixture();
    if(kind==='wrong sign')wire.factChecks[0].value='NEGATIVE';
    if(kind==='missing sign')wire.factChecks[0].field='emaSlope21';
    if(kind==='duplicate')wire.factChecks[0]={...wire.factChecks[1]};
    if(kind==='unknown ID')wire.factChecks[0].factId='technical.7d.confirmed';
    if(kind==='wrong field')wire.factChecks[0].field='ema999';
    if(kind==='wrong type')wire.factChecks[0].value='UP';
    if(kind==='invented unknown')wire.factChecks[0].value='UNKNOWN';
    expect(()=>resolveFactBoundReference(wire,packet,now+1)).toThrow();
  });
  it('validates zero and missing distinctly and never rewrites a non-PLACE into PLACE',()=>{
    const {packet,wire}=fixture();packet.market.technical['1d'].macdHistogram=0;
    delete (packet.market.technical['4h'] as any).macdHistogram;
    wire.factChecks[0].value='ZERO';wire.factChecks[1].value='UNKNOWN';
    Object.assign(wire,{decision:'DATA_ERROR',tradeSide:null,selectedCandidateId:null,candidateSetHash:null,candidateSetFactVersion:null,
      idealPrice:null,acceptablePriceRange:null,horizonMinutes:null,rejectLayer:'DATA'});
    const r=resolveFactBoundReference(wire,packet,now+1);expect(r.decision.decision).toBe('DATA_ERROR');expect(r.proof).toBeNull();
    wire.factChecks[1].value='ZERO';expect(()=>resolveFactBoundReference(wire,packet,now+1)).toThrow('fact check mismatch');
  });
  it('requires explicit reverse-trend reason and leaves the minimum-candidate gate applicable',()=>{
    const {packet,wire}=fixture('SHORT');wire.counterTrendReason=null;
    expect(()=>resolveFactBoundReference(wire,packet,now+1)).toThrow('explicit counter-trend');
  });
  it.each(['expired','lease','duplicate','disabled side','disabled candidate','side corruption','invalid target'])('preserves %s candidate denial',kind=>{
    const {packet,wire}=fixture(),envelope=packet.executionEnvelope!,side=envelope.LONG,candidate=side.planCandidates![0];
    if(kind==='expired')envelope.expiresAt=now;if(kind==='lease')envelope.leaseExpiresAt=now;
    if(kind==='duplicate')side.planCandidates!.push({...candidate});if(kind==='disabled side')side.executable=false;
    if(kind==='disabled candidate')(candidate as any).executable=false;if(kind==='side corruption')candidate.side='SHORT';
    if(kind==='invalid target')candidate.acceptableTargetRange={min:200,max:100};
    expect(()=>resolveFactBoundReference(wire,packet,now+1)).toThrow();
  });
  it('rejects stale/tampered direction proof, preserves current JIT guards and does not reset timestamps',()=>{
    const {packet,wire}=fixture();vi.spyOn(Date,'now').mockReturnValue(now+1);
    const d=entryDecisionParse(wire,packet,R2),before=captureEntryThesis(packet.market),current=structuredClone(packet.market);
    current.technical['15m'].asOf+=900000;
    expect(entryThesisDrift(before,current,{min:d.acceptablePriceRange.min,max:d.acceptablePriceRange.max}).ok).toBe(false);
    expect(validateFrozenDirectionResolution(d,{...packet,packetId:'other'})).toBe(false);
    expect(validateFrozenDirectionResolution({...d,trend4hRole:'SUPPORTS_SHORT'},packet)).toBe(false);
    expect(validateFrozenDirectionResolution({...d,directionResolution:undefined},packet)).toBe(false);
    expect(d.candidateReferenceResolution!.envelopeExpiresAt).toBe(packet.executionEnvelope!.expiresAt);
  });
  it.each(['referenced matching side','other side','not referenced'] as const)('preserves original event clock: %s',kind=>{
    const {packet,wire}=fixture();vi.spyOn(Date,'now').mockReturnValue(now+1);
    const event={id:'event-original',status:'COMPLETED',time:now-301000,anchorPrice:100,timeframe:'15m',provenance:'CLOSED_BAR'};
    packet.opportunityEvidence={opportunityId:'opp-1',version:'v1',policyVersion:'p1',observedAt:now-1000,symbol:packet.symbol,
      direction:kind==='other side'?'SHORT':'LONG',eventTtlMs:300000,eventExpiresAt:now-1000,timingEvent:event} as any;
    wire.timingEventId=kind==='not referenced'?null:event.id;
    const decision=entryDecisionParse(wire,packet,R2);
    expect(decision.timingEvent).toEqual(kind==='not referenced'?null:event);
    const auth=resolveEntryOpportunityAuthorization({opportunity:packet.opportunityEvidence,decision,symbol:packet.symbol,
      decisionCompletedAt:now,decisionExecutionExpiresAt:now+60000,existingAbsoluteExpiresAt:now+60000,now:now+1});
    expect(auth.ok).toBe(kind!=='referenced matching side');
    if(kind==='referenced matching side')expect(auth.reason).toBe('ENTRY_OPPORTUNITY_EVENT_EXPIRED');
    expect(auth.identity.timingEventTime).toBe(event.time);
    wire.timingEventId='invented';expect(()=>entryDecisionParse(wire,packet,R2)).toThrow('unknown timing event reference');
  });
  it('does not accept R1 on R2 requests or reinterpret R1 factual roles',()=>{
    const {packet,old,wire}=fixture();vi.spyOn(Date,'now').mockReturnValue(now+1);
    const legacy=entryDecisionParse(old,packet,R1);expect(legacy.trend1dRole).toBe('NEUTRAL');
    expect(legacy.directionResolution).toBeUndefined();
    expect(validateDirectionContract(packet.market,legacy).ok).toBe(false);
    expect(()=>entryDecisionParse(old,packet,R2)).toThrow('protocol does not match');
    expect(()=>entryDecisionParse(wire,packet,R1)).toThrow('protocol does not match');
  });
  it('shares property definitions while preserving complete strict authorization branches',()=>{
    expect(JSON.stringify(EntryDecisionFactBoundJsonSchema).length).toBeLessThan(JSON.stringify(EntryDecisionReferenceJsonSchema).length*.65);
    expect(Object.keys(EntryDecisionFactBoundJsonSchema.$defs).length).toBeGreaterThan(0);
    expect(EntryDecisionFactBoundJsonSchema.oneOf).toHaveLength(4);
    for(const branch of EntryDecisionFactBoundJsonSchema.oneOf){
      expect(branch.additionalProperties).toBe(false);
      expect(branch.required).toEqual(expect.arrayContaining(['directionFactsVersion','factChecks','counterTrendReason','timingEventId']));
      expect(branch.properties).not.toHaveProperty('quantityUnits');
    }
  });
});
