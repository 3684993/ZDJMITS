import {afterEach,describe,expect,it,vi} from 'vitest';
import {ENTRY_CANDIDATE_REFERENCE_PROTOCOL,EntryDecisionReferenceJsonSchema} from '@zdj/contracts';
import {entryDecisionParse} from './aiFabric.js';
import {resolveCandidateReference} from './resolveCandidateReference.js';

import {now,referenceFixture} from '../testing/candidateReferenceFixture.js';
afterEach(()=>vi.restoreAllMocks());

describe('R1 frozen candidate reference',()=>{
  it.each(['LONG','SHORT'] as const)('resolves %s TP exactly while leaving quantity system-owned and model output untouched',side=>{
    vi.spyOn(Date,'now').mockReturnValue(now+100_000); // EIP audit TTL is not a new execution veto.
    const {packet,wire}=referenceFixture(side),before=structuredClone({packet,wire}),candidate=packet.executionEnvelope![side].planCandidates![0];
    const result=entryDecisionParse(wire,packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL);
    expect(result).toMatchObject({protocolVersion:ENTRY_CANDIDATE_REFERENCE_PROTOCOL,schemaVersion:ENTRY_CANDIDATE_REFERENCE_PROTOCOL,
      tradeSide:side,selectedCandidateId:wire.selectedCandidateId,quantityUnits:null,candidateSetHash:wire.candidateSetHash,
      candidateSetFactVersion:wire.candidateSetFactVersion,profitTakePlan:{targetPrice:candidate.targetPrice,
        acceptableTargetRange:candidate.acceptableTargetRange,targetHorizonMinutes:candidate.targetHorizonMinutes,targetReason:wire.reason},
      candidateReferenceResolution:{source:'SYSTEM_FROZEN_CANDIDATE',packetId:packet.packetId,side,
        targetPrice:candidate.targetPrice,acceptableTargetRange:candidate.acceptableTargetRange,targetHorizonMinutes:candidate.targetHorizonMinutes,resolvedAt:now+100_000}});
    expect({packet,wire}).toEqual(before);
  });
  it.each([
    ['unknown ID',{selectedCandidateId:'not-offered'}],['cross-side ID',{selectedCandidateId:'cand_v2_SHORT'}],
    ['wrong hash',{candidateSetHash:'wrong'}],['old fact version',{candidateSetFactVersion:'old'}],
    ['opposite side',{tradeSide:'SHORT'}],['model quantity',{quantityUnits:7}],['even null model quantity',{quantityUnits:null}],
    ['model TP',{profitTakePlan:{targetPrice:100}}],['forged proof',{candidateReferenceResolution:{source:'SYSTEM_FROZEN_CANDIDATE'}}],
    ['entry outside range',{idealPrice:102}],['counter-trend contradiction',{counterTrendException:true,counterTrendReason:'Reason',alignmentClass:'MIXED'}],
  ])('rejects %s',(name,change)=>{
    const {packet,wire}=referenceFixture();expect(()=>resolveCandidateReference({...wire,...change},packet,now+1)).toThrow();
  });
  it.each(['selectedCandidateId','candidateSetHash','candidateSetFactVersion','reason','trend1dRole','timingEvent'])('requires explicit wire field %s',field=>{
    const {packet,wire}=referenceFixture();delete (wire as any)[field];expect(()=>resolveCandidateReference(wire,packet,now+1)).toThrow('missing field');
  });
  it.each(['expired','lease expired','duplicate','wrong candidate side','not executable','invalid TP'])('rejects %s frozen authorization',kind=>{
    const {packet,wire}=referenceFixture(),envelope=packet.executionEnvelope!,offered=envelope.LONG,candidate=offered.planCandidates![0];
    if(kind==='expired')envelope.expiresAt=now;
    if(kind==='lease expired')envelope.leaseExpiresAt=now;
    if(kind==='duplicate')offered.planCandidates!.push({...candidate});
    if(kind==='wrong candidate side')candidate.side='SHORT';
    if(kind==='not executable')offered.executable=false;
    if(kind==='invalid TP')candidate.acceptableTargetRange={min:105,max:101};
    expect(()=>resolveCandidateReference(wire,packet,now+1)).toThrow();
  });
  it('accepts explicit non-PLACE without inventing a candidate or TP, and rejects dangling bindings',()=>{
    vi.spyOn(Date,'now').mockReturnValue(now+1);
    const {packet,wire}=referenceFixture();Object.assign(wire,{decision:'WAIT_FOR_PRICE',tradeSide:null,selectedCandidateId:null,
      candidateSetHash:null,candidateSetFactVersion:null,idealPrice:null,acceptablePriceRange:null,horizonMinutes:null,
      waitCondition:{operator:'LTE',price:99,validForMinutes:2},rejectLayer:'LOCATION'});
    expect(entryDecisionParse(wire,packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL)).toMatchObject({decision:'WAIT_FOR_PRICE',profitTakePlan:null,quantityUnits:null,candidateReferenceResolution:null});
    expect(()=>entryDecisionParse({...wire,candidateSetHash:'dangling'},packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL)).toThrow('non-PLACE');
  });
  it('preserves legacy V3.9.7 interpretation and rejects old output in an R1 request',()=>{
    const {packet,wire}=referenceFixture();const {candidateSetHash,candidateSetFactVersion,...fields}=wire;
    const legacy={...fields,schemaVersion:'V3.9.7',quantityUnits:null,profitTakePlan:{targetPrice:110,acceptableTargetRange:{min:109,max:111},targetHorizonMinutes:60,targetReason:'Legacy model target',evidenceRefs:[]}};
    expect(entryDecisionParse(legacy,packet).profitTakePlan!.targetPrice).toBe(110); // Do not silently replace a legacy target.
    expect(entryDecisionParse(legacy,packet).candidateReferenceResolution).toBeUndefined();
    expect(()=>entryDecisionParse(legacy,packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL)).toThrow('protocol does not match');
    expect(()=>entryDecisionParse({...legacy,profitTakePlan:{...legacy.profitTakePlan,acceptableTargetRange:{min:111,max:109}}},packet)).toThrow('target must be inside range');
    expect(()=>entryDecisionParse(wire,packet,'V3.9.7')).toThrow('protocol does not match');
  });
  it('keeps strict output branches free of model quantity/TP and requires bindings',()=>{
    for(const branch of EntryDecisionReferenceJsonSchema.oneOf){
      expect(branch.additionalProperties).toBe(false);
      expect(branch.required).not.toContain('quantityUnits');expect(branch.required).not.toContain('profitTakePlan');
      expect(branch.properties).not.toHaveProperty('quantityUnits');expect(branch.properties).not.toHaveProperty('profitTakePlan');
      expect(branch.required).toEqual(expect.arrayContaining(['selectedCandidateId','candidateSetHash','candidateSetFactVersion']));
      expect(branch.properties.schemaVersion).toEqual({const:ENTRY_CANDIDATE_REFERENCE_PROTOCOL});
    }
  });
});
