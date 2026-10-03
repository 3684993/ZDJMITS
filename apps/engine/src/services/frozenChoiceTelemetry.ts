type FrozenCandidate={candidateId?:string;quantityUnits?:number;targetHorizonMinutes?:number;targetPrice?:number};
type ExecutionEnvelopeIdentity={version:string;symbol:string;createdAt:number;expiresAt:number;side:'LONG'|'SHORT'};
type FrozenChoiceConversionInput={evaluatedAt:number;prePrimaryFactIdentity:string;snapshotHash:string;side:'LONG'|'SHORT';executionEnvelopeIdentity:ExecutionEnvelopeIdentity;
  modelSelection:{selectedCandidateId?:string|null;quantityUnits:number;targetPrice:number;targetHorizonMinutes:number;horizonMinutes:number};
  modelVisibleQuantityRange:{min:number;max:number};candidateSet:{candidateSetHash:string;candidates:FrozenCandidate[];selection?:{offered:boolean;resolved?:{candidateId:string}}};
  conversion:'CONVERTED'|'REFUSED'|'NOT_ATTEMPTED'};
/** Sanitized, bounded observation of one pre-Primary frozen menu and its exact post-Primary validation. */
export function frozenChoiceConversionTelemetry(input:FrozenChoiceConversionInput):Record<string,unknown>{
  const candidates=input.candidateSet.candidates.slice(0,18),selected=input.modelSelection.selectedCandidateId
    ?input.candidateSet.candidates.find(row=>row.candidateId===input.modelSelection.selectedCandidateId)
    :input.candidateSet.candidates.find(row=>row.quantityUnits===input.modelSelection.quantityUnits
      &&row.targetHorizonMinutes===input.modelSelection.targetHorizonMinutes&&Math.abs(row.targetPrice-input.modelSelection.targetPrice)<=1e-9);
  const alternativeGeneratedCandidates=Math.max(0,input.candidateSet.candidates.length-(selected?1:0));
  return{schemaVersion:'V397-FROZEN-CANDIDATE-AUTHORITY-1',evaluatedAt:input.evaluatedAt,snapshotHash:input.snapshotHash.slice(0,160),
    candidateSetHash:String(input.candidateSet.candidateSetHash).slice(0,160),side:input.side,offerTiming:'PRE_PRIMARY_FROZEN',
    timingScopes:{prePrimaryVisible:'CANDIDATE_SET_FROZEN_PRE_PRIMARY',postPrimaryGenerated:'NOT_APPLICABLE'},
    prePrimaryVisibleAt:input.executionEnvelopeIdentity.createdAt,prePrimaryFactIdentity:String(input.prePrimaryFactIdentity).slice(0,160),
    postPrimaryValidatedAt:input.evaluatedAt,
    executionEnvelopeIdentity:{version:String(input.executionEnvelopeIdentity.version).slice(0,80),symbol:String(input.executionEnvelopeIdentity.symbol).slice(0,32),
      createdAt:input.executionEnvelopeIdentity.createdAt,expiresAt:input.executionEnvelopeIdentity.expiresAt,side:input.executionEnvelopeIdentity.side},
    candidateIdsPresentedToPrimary:candidates.map(row=>String(row.candidateId??'').slice(0,80)),candidateIdsPresentedToPrimaryStatus:'PRESENT',candidateIdsPresentedToPrimaryReason:'FROZEN_CANDIDATE_SET_IN_EXECUTION_ENVELOPE',
    modelVisibleQuantityRange:{min:input.modelVisibleQuantityRange.min,max:input.modelVisibleQuantityRange.max},
    generatedLegalCandidateCount:input.candidateSet.candidates.length,generatedLegalCandidateIds:candidates.map(row=>String(row.candidateId??'').slice(0,80)),
    generatedQuantityIntervals:candidates.map(row=>({candidateId:String(row.candidateId??'').slice(0,80),quantityUnits:{min:Number(row.quantityUnits??0),max:Number(row.quantityUnits??0)},
      targetPrice:Number(row.targetPrice??0),targetHorizonMinutes:Number(row.targetHorizonMinutes??0)})),
    selectedQuantityUnits:input.modelSelection.quantityUnits,selectedTargetPrice:input.modelSelection.targetPrice,
    selectedTargetHorizonMinutes:input.modelSelection.targetHorizonMinutes,selectedHorizonMinutes:input.modelSelection.horizonMinutes,
    selectedCandidateId:selected?.candidateId==null?null:String(selected.candidateId).slice(0,80),selectionInGeneratedSet:Boolean(selected),candidateSetSelectionMarkedOffered:Boolean(input.candidateSet.selection?.offered),
    alternativeGeneratedCandidates,refusalHasAlternativeLegalCandidate:input.conversion==='REFUSED'&&alternativeGeneratedCandidates>0,
    postPrimaryAlternativeExistsOnRefusal:input.conversion==='REFUSED'&&input.candidateSet.candidates.length>0&&!selected,
    conversion:input.conversion,
    reasonClass:input.conversion==='NOT_ATTEMPTED'?'PLAN_CONVERSION_NOT_ATTEMPTED':input.conversion==='CONVERTED'?'PLAN_ASSEMBLED':input.candidateSet.candidates.length?'PLAN_CONVERSION_REFUSED':'NO_LEGAL_CANDIDATE'};
}

/** The sink is deliberately behind a catch boundary so diagnostic storage cannot affect the plan path. */
export function publishFrozenChoiceConversionTelemetry(input:Parameters<typeof frozenChoiceConversionTelemetry>[0],publish:(payload:Record<string,unknown>)=>void){
  let payload:Record<string,unknown>|null=null;
  try{payload=frozenChoiceConversionTelemetry(input);publish(payload);}catch{/* construction and storage are both observational */}
  return payload;
}
