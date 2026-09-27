import {describe,expect,it} from 'vitest';
import {frozenChoiceConversionTelemetry,publishFrozenChoiceConversionTelemetry} from './frozenChoiceTelemetry.js';

describe('frozen choice conversion telemetry',()=>{
  it('records bounded generated choices and model selection without presenting post-response IDs as prompt inputs',()=>{
    const data=frozenChoiceConversionTelemetry({evaluatedAt:10,prePrimaryFactIdentity:'pre-fact',snapshotHash:'snapshot',side:'LONG',executionEnvelopeIdentity:{version:'v1',symbol:'BTCUSDT',createdAt:8,expiresAt:50,side:'LONG'},
      modelSelection:{quantityUnits:20,targetPrice:101,targetHorizonMinutes:15,horizonMinutes:60},
      modelVisibleQuantityRange:{min:10,max:100},candidateSet:{candidateSetHash:'set',selection:{offered:true},candidates:[
        {candidateId:'one',quantityUnits:10,targetPrice:101,targetHorizonMinutes:15},{candidateId:'two',quantityUnits:20,targetPrice:101,targetHorizonMinutes:15}]},conversion:'CONVERTED'});
    expect(data).toMatchObject({schemaVersion:'V396-FROZEN-CHOICE-TELEMETRY-2',offerTiming:'POST_PRIMARY_VALIDATION',timingScopes:{prePrimaryVisible:'PRE_PRIMARY_VISIBLE',postPrimaryGenerated:'POST_PRIMARY_GENERATED'},
      executionEnvelopeIdentity:{version:'v1',symbol:'BTCUSDT',createdAt:8,expiresAt:50,side:'LONG'},prePrimaryVisibleAt:8,prePrimaryFactIdentity:'pre-fact',
      postPrimaryGeneratedAt:10,candidateIdsPresentedToPrimary:[],
      candidateIdsPresentedToPrimaryStatus:'NOT_APPLICABLE',candidateIdsPresentedToPrimaryReason:'IDS_NOT_YET_EXISTING',generatedLegalCandidateCount:2,
      modelVisibleQuantityRange:{min:10,max:100},selectedCandidateId:'two',selectedTargetPrice:101,selectedTargetHorizonMinutes:15,selectedHorizonMinutes:60,
      selectionInGeneratedSet:true,alternativeGeneratedCandidates:1,refusalHasAlternativeLegalCandidate:false,postPrimaryAlternativeExistsOnRefusal:false,conversion:'CONVERTED'});
    expect(data.generatedQuantityIntervals).toContainEqual({candidateId:'two',quantityUnits:{min:20,max:20},targetPrice:101,targetHorizonMinutes:15});
  });
  it('bounds candidate details and preserves out-of-set refusal as telemetry only',()=>{
    const candidates=Array.from({length:25},(_,i)=>({candidateId:String(i),quantityUnits:i+1,targetPrice:10,targetHorizonMinutes:15}));
    const data=frozenChoiceConversionTelemetry({evaluatedAt:10,prePrimaryFactIdentity:'pre-fact',snapshotHash:'x',side:'SHORT',executionEnvelopeIdentity:{version:'v1',symbol:'ETHUSDT',createdAt:8,expiresAt:50,side:'SHORT'},
      modelSelection:{quantityUnits:100,targetPrice:10,targetHorizonMinutes:15,horizonMinutes:30},
      modelVisibleQuantityRange:{min:1,max:100},candidateSet:{candidateSetHash:'x',candidates},conversion:'REFUSED'});
    expect(data).toMatchObject({timingScopes:{prePrimaryVisible:'PRE_PRIMARY_VISIBLE',postPrimaryGenerated:'POST_PRIMARY_GENERATED'},
      generatedLegalCandidateCount:25,selectionInGeneratedSet:false,selectedCandidateId:null,refusalHasAlternativeLegalCandidate:true,
      postPrimaryAlternativeExistsOnRefusal:true,conversion:'REFUSED'});
    expect((data.generatedLegalCandidateIds as unknown[])).toHaveLength(18);
  });
  it('checks selection mapping against the full post-Primary set even when the selected ID is beyond the detail bound',()=>{
    const candidates=Array.from({length:25},(_,i)=>({candidateId:String(i),quantityUnits:i+1,targetPrice:10,targetHorizonMinutes:15}));
    const data=frozenChoiceConversionTelemetry({evaluatedAt:10,prePrimaryFactIdentity:'pre-fact',snapshotHash:'x',side:'LONG',
      executionEnvelopeIdentity:{version:'v1',symbol:'BTCUSDT',createdAt:8,expiresAt:50,side:'LONG'},
      modelSelection:{quantityUnits:25,targetPrice:10,targetHorizonMinutes:15,horizonMinutes:30},modelVisibleQuantityRange:{min:1,max:100},
      candidateSet:{candidateSetHash:'x',candidates},conversion:'REFUSED'});
    expect(data).toMatchObject({generatedLegalCandidateCount:25,selectedCandidateId:'24',selectionInGeneratedSet:true,
      alternativeGeneratedCandidates:24,refusalHasAlternativeLegalCandidate:true,postPrimaryAlternativeExistsOnRefusal:false});
  });
  it('does not mutate the frozen inputs or change the telemetry payload when its sink fails',()=>{
    const input:any={evaluatedAt:10,prePrimaryFactIdentity:'pre-fact',snapshotHash:'snapshot',side:'LONG',executionEnvelopeIdentity:{version:'v1',symbol:'BTCUSDT',createdAt:8,expiresAt:50,side:'LONG'},
      modelSelection:{quantityUnits:20,targetPrice:101,targetHorizonMinutes:15,horizonMinutes:60},modelVisibleQuantityRange:{min:10,max:100},
      candidateSet:{candidateSetHash:'set',selection:{offered:true},candidates:[{candidateId:'two',quantityUnits:20,targetPrice:101,targetHorizonMinutes:15}]},conversion:'CONVERTED'},before=structuredClone(input);
    const payload=publishFrozenChoiceConversionTelemetry(input,()=>{throw new Error('diagnostic sink unavailable');});
    expect(payload).toEqual(frozenChoiceConversionTelemetry(input));expect(input).toEqual(before);
    expect(payload).toMatchObject({selectedQuantityUnits:20,selectedTargetPrice:101,selectedTargetHorizonMinutes:15,selectedHorizonMinutes:60,conversion:'CONVERTED'});
  });
});
