import {describe,expect,it} from 'vitest';
import {frozenChoiceConversionTelemetry,publishFrozenChoiceConversionTelemetry} from './frozenChoiceTelemetry.js';

describe('frozen choice conversion telemetry',()=>{
  it('records bounded generated choices and model selection without presenting post-response IDs as prompt inputs',()=>{
    const data=frozenChoiceConversionTelemetry({evaluatedAt:10,snapshotHash:'snapshot',side:'LONG',modelSelection:{quantityUnits:20,targetPrice:101,targetHorizonMinutes:15},
      modelVisibleQuantityRange:{min:10,max:100},candidateSet:{candidateSetHash:'set',selection:{offered:true},candidates:[
        {candidateId:'one',quantityUnits:10,targetPrice:101,targetHorizonMinutes:15},{candidateId:'two',quantityUnits:20,targetPrice:101,targetHorizonMinutes:15}]},conversion:'CONVERTED'});
    expect(data).toMatchObject({offerTiming:'POST_PRIMARY_VALIDATION',candidateIdsPresentedToPrimary:[],generatedLegalCandidateCount:2,
      selectedCandidateId:'two',selectionInGeneratedSet:true,alternativeGeneratedCandidates:1,conversion:'CONVERTED'});
  });
  it('bounds candidate details and preserves out-of-set refusal as telemetry only',()=>{
    const candidates=Array.from({length:25},(_,i)=>({candidateId:String(i),quantityUnits:i+1,targetPrice:10,targetHorizonMinutes:15}));
    const data=frozenChoiceConversionTelemetry({evaluatedAt:10,snapshotHash:'x',side:'SHORT',modelSelection:{quantityUnits:100,targetPrice:10,targetHorizonMinutes:15},
      modelVisibleQuantityRange:{min:1,max:100},candidateSet:{candidateSetHash:'x',candidates},conversion:'REFUSED'});
    expect(data).toMatchObject({generatedLegalCandidateCount:25,selectionInGeneratedSet:false,selectedCandidateId:null,conversion:'REFUSED'});
    expect((data.generatedLegalCandidateIds as unknown[])).toHaveLength(18);
  });
  it('does not mutate the frozen inputs or change the telemetry payload when its sink fails',()=>{
    const input:any={evaluatedAt:10,snapshotHash:'snapshot',side:'LONG',modelSelection:{quantityUnits:20,targetPrice:101,targetHorizonMinutes:15},modelVisibleQuantityRange:{min:10,max:100},
      candidateSet:{candidateSetHash:'set',selection:{offered:true},candidates:[{candidateId:'two',quantityUnits:20,targetPrice:101,targetHorizonMinutes:15}]},conversion:'CONVERTED'},before=structuredClone(input);
    const payload=publishFrozenChoiceConversionTelemetry(input,()=>{throw new Error('diagnostic sink unavailable');});
    expect(payload).toEqual(frozenChoiceConversionTelemetry(input));expect(input).toEqual(before);
    expect(payload).toMatchObject({selectedQuantityUnits:20,selectedTargetHorizonMinutes:15,conversion:'CONVERTED'});
  });
});
