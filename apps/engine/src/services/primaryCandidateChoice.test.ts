import {expect,it} from 'vitest';
import {entryDecisionParse} from './aiFabric.js';
import {materializePrimaryChoice,primaryChoiceJsonSchema,PRIMARY_CHOICE_PROTOCOL} from './primaryCandidateChoice.js';
import {harness} from './tradingQualityTestHarness.js';
const setup=()=>{
  const h=harness(),now=Date.now(),p:any={...h.packet,symbol:'BNBUSDC'};
  const candidate={candidateId:'historical-short-projection',side:'SHORT',entryReferencePrice:743.01,quantityUnits:135,leverage:10,targetPrice:741.6,acceptableTargetRange:{min:741.44,max:741.6},targetHorizonMinutes:15,sizingProof:{executableEntryRange:{min:743.01,max:743.21}}};
  p.executionEnvelope={symbol:'BNBUSDC',createdAt:now-1,expiresAt:now+180000,exchange:{tickSize:.01},SHORT:{executable:true,candidateSetHash:'frozen-hash',planCandidates:[candidate]},LONG:{executable:false,candidateSetHash:'empty',planCandidates:[]}};
  const raw:any={action:'FINAL',schemaVersion:'V3.9.7',executionSelection:PRIMARY_CHOICE_PROTOCOL,candidateSetHash:'frozen-hash',decision:'PLACE_SHORT',tradeSide:'SHORT',structureDirection:'SHORT',selectedCandidateId:candidate.candidateId,horizonMinutes:3,opportunityType:'TREND_RESUMPTION',marketRegime:'RANGE',confidence:.65,waitCondition:null,directionReason:'market evidence',timingReason:'closed bar timing',entryLocationReason:'selected frozen candidate',reason:'independent short conclusion',entryInvalidation:'original thesis invalidation',supportingEvidenceRefs:['technical.15m.confirmed'],rejectLayer:'NONE',blockingCondition:'',releaseCondition:'',timingEvent:null};
  return {p,raw,candidate};
};
it('materializes only the selected exact frozen row and leaves the source packet and choice immutable',()=>{
  const {p,raw,candidate}=setup(),before=JSON.stringify({p,raw});const d=entryDecisionParse(raw,p);expect(d.idealPrice).toBe(743.01);expect(d.acceptablePriceRange).toEqual(candidate.sizingProof.executableEntryRange);expect(d.tradeSide).toBe('SHORT');expect(d.quantityUnits).toBeNull();expect(d.horizonMinutes).toBe(3);expect(d.profitTakePlan?.targetPrice).toBe(741.6);expect(JSON.stringify({p,raw})).toBe(before);
  const grammar:any=primaryChoiceJsonSchema(p);expect(grammar.oneOf[1].properties.selectedCandidateId.enum).toEqual([candidate.candidateId]);expect(grammar.oneOf[1].properties.idealPrice).toBeUndefined();expect(grammar.oneOf[1].properties.horizonMinutes).toEqual({type:'integer',minimum:1,maximum:5});
});
it('keeps the actual BNB numeric schema failure invalid instead of converting an archived malformed price into PLACE',()=>{
  const {p,raw}=setup(),{executionSelection,candidateSetHash,...legacy}=raw;
  expect(()=>entryDecisionParse({...legacy,quantityUnits:null,idealPrice:743,acceptablePriceRange:{min:743.001876315681,max:743.218123684319},horizonMinutes:1,profitTakePlan:{targetPrice:741.6,acceptableTargetRange:{min:741.44,max:741.6},targetHorizonMinutes:15,targetReason:'historical numeric projection',evidenceRefs:[]}},p)).toThrow('min <= idealPrice <= max required');
});
it.each([{selectedCandidateId:'another'},{candidateSetHash:'stale'},{tradeSide:'LONG'},{idealPrice:743},{quantityUnits:999},{profitTakePlan:{targetPrice:999}},{horizonMinutes:0},{horizonMinutes:6},{horizonMinutes:1.5}])('refuses contradictory or unauthorized choice fields %j',patch=>{const {p,raw}=setup();expect(()=>materializePrimaryChoice({...raw,...patch},p)).toThrow('AI_OUTPUT_INVALID');});
it('rejects expired/cross-symbol/non-tick/empty-tick candidates and never guesses another id',()=>{
  const {p,raw}=setup();p.executionEnvelope.expiresAt=Date.now()-1;expect(()=>materializePrimaryChoice(raw,p)).toThrow();p.executionEnvelope.expiresAt=Date.now()+1000;p.executionEnvelope.symbol='ETHUSDT';expect(()=>materializePrimaryChoice(raw,p)).toThrow();p.executionEnvelope.symbol='BNBUSDC';p.executionEnvelope.SHORT.planCandidates[0].entryReferencePrice=743.0018763157;expect(()=>materializePrimaryChoice(raw,p)).toThrow('legal tick');
});
it('retains non-PLACE directionlessness without inventing a candidate or TP',()=>{const {p,raw}=setup();const d=entryDecisionParse({...raw,decision:'NO_DIRECTION_EDGE',opportunityType:'NONE',tradeSide:null,selectedCandidateId:null,candidateSetHash:null,horizonMinutes:null},p);expect(d.idealPrice).toBeNull();expect(d.profitTakePlan).toBeNull();expect(d.horizonMinutes).toBeNull();});

it.each([1,2,3,4,5])('preserves the explicitly chosen Entry horizon %i minutes without conflating it with TP horizon',minutes=>{
  const {p,raw,candidate}=setup();const decision=entryDecisionParse({...raw,horizonMinutes:minutes},p);
  expect(decision.horizonMinutes).toBe(minutes);
  expect(decision.profitTakePlan?.targetHorizonMinutes).toBe(candidate.targetHorizonMinutes);
  expect(decision.idealPrice).toBe(candidate.entryReferencePrice);
});
it('does not silently infer a one-minute order lifetime from an absent model field',()=>{
  const {p,raw}=setup();const {horizonMinutes,...missing}=raw;
  expect(()=>materializePrimaryChoice(missing,p)).toThrow('Entry authorization horizon');
});
