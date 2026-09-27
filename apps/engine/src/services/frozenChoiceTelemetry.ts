type FrozenCandidate={candidateId?:string;quantityUnits?:number;targetHorizonMinutes?:number;targetPrice?:number};
/** Sanitized, bounded observation only. Candidate IDs are generated after Primary responds; they were not part of its prompt. */
export function frozenChoiceConversionTelemetry(input:{evaluatedAt:number;snapshotHash:string;side:'LONG'|'SHORT';
  modelSelection:{quantityUnits:number;targetPrice:number;targetHorizonMinutes:number};
  modelVisibleQuantityRange:{min:number;max:number};candidateSet:{candidateSetHash:string;candidates:FrozenCandidate[];selection?:{offered:boolean;resolved?:{candidateId:string}}};
  conversion:'CONVERTED'|'REFUSED'|'NOT_ATTEMPTED'}):Record<string,unknown>{
  const candidates=input.candidateSet.candidates.slice(0,18),selected=candidates.find(row=>row.quantityUnits===input.modelSelection.quantityUnits
    &&row.targetHorizonMinutes===input.modelSelection.targetHorizonMinutes&&Math.abs(row.targetPrice-input.modelSelection.targetPrice)<=1e-9);
  return{schemaVersion:'V396-FROZEN-CHOICE-TELEMETRY-1',evaluatedAt:input.evaluatedAt,snapshotHash:input.snapshotHash.slice(0,160),
    candidateSetHash:String(input.candidateSet.candidateSetHash).slice(0,160),side:input.side,offerTiming:'POST_PRIMARY_VALIDATION',
    candidateIdsPresentedToPrimary:[],modelVisibleQuantityRange:{min:input.modelVisibleQuantityRange.min,max:input.modelVisibleQuantityRange.max},
    generatedLegalCandidateCount:input.candidateSet.candidates.length,generatedLegalCandidateIds:candidates.map(row=>String(row.candidateId??'').slice(0,80)),
    generatedQuantityIntervals:candidates.map(row=>({candidateId:String(row.candidateId??'').slice(0,80),quantityUnits:{min:Number(row.quantityUnits??0),max:Number(row.quantityUnits??0)},targetHorizonMinutes:Number(row.targetHorizonMinutes??0)})),
    selectedQuantityUnits:input.modelSelection.quantityUnits,selectedTargetHorizonMinutes:input.modelSelection.targetHorizonMinutes,
    selectedCandidateId:selected?.candidateId??null,selectionInGeneratedSet:Boolean(selected),selectionMarkedOffered:Boolean(input.candidateSet.selection?.offered),
    alternativeGeneratedCandidates:Math.max(0,input.candidateSet.candidates.length-(selected?1:0)),conversion:input.conversion,
    reasonClass:input.conversion==='CONVERTED'?'PLAN_ASSEMBLED':input.candidateSet.candidates.length?'PLAN_CONVERSION_REFUSED':'NO_LEGAL_CANDIDATE'};
}

/** The sink is deliberately behind a catch boundary so diagnostic storage cannot affect the plan path. */
export function publishFrozenChoiceConversionTelemetry(input:Parameters<typeof frozenChoiceConversionTelemetry>[0],publish:(payload:Record<string,unknown>)=>void){
  const payload=frozenChoiceConversionTelemetry(input);try{publish(payload);}catch{/* observational event sinks are best effort */}return payload;
}
