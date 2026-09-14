import type {TradingQualityMetricBasis} from '@zdj/contracts';
import type {PathWindow} from './tradingEpisodeEvidence.js';
import {entryMetricEligible} from './tradingQualityEligibility.js';

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const pct=(from:number,to:number,side:'LONG'|'SHORT')=>(side==='LONG'?1:-1)*(to/from-1)*10_000;
export type EvidenceFlag='TRUE'|'FALSE'|'UNKNOWN';

export type CandidateShadowInput={candidateId:string;candidateSetId:string;symbol:string;legal:boolean;selected:boolean;rank:number;directionAligned:boolean|null;timingVerified:boolean|null;eventAgeMs:number|null;locationDistanceAtr:number|null;conservativePayoffBps:number|null;spreadBps:number|null;depthUsd:number|null;riskCapacity:boolean|null;observedAt:number};
export function boundedCandidateObservationPlan(input:{candidateSetId:string;candidates:CandidateShadowInput[];maxCandidates:number;windowMs:number;observedAt:number}){
  const legal=input.candidates.filter(c=>c.candidateSetId===input.candidateSetId&&c.legal).sort((a,b)=>a.rank-b.rank||a.symbol.localeCompare(b.symbol));
  const selected=legal.filter(c=>c.selected),others=legal.filter(c=>!c.selected),budget=Math.max(1,Math.floor(input.maxCandidates));
  const planned=[...selected,...others].slice(0,budget);
  return{candidateSetId:input.candidateSetId,observedAt:input.observedAt,observationUntil:input.observedAt+Math.max(1,input.windowMs),budget,planned:planned.map((row,index)=>({...row,inclusionOrder:index+1,inclusionProbability:legal.length<=budget?1:budget/legal.length})),excluded:legal.slice(budget).map(row=>({candidateId:row.candidateId,reason:'OBSERVATION_BUDGET_EXCEEDED'}))};
}

/** Lexicographic shadow ordering only. It never returns an order authorization. */
export function candidateShadowComparator(rows:CandidateShadowInput[]){
  const unknown=(v:unknown)=>v==null||!Number.isFinite(v as number);
  const key=(row:CandidateShadowInput)=>[
    row.legal?0:1,row.riskCapacity===true?0:row.riskCapacity===false?2:1,row.directionAligned===true?0:row.directionAligned===false?2:1,row.timingVerified===true?0:row.timingVerified===false?2:1,
    unknown(row.eventAgeMs)?Number.POSITIVE_INFINITY:row.eventAgeMs!,unknown(row.locationDistanceAtr)?Number.POSITIVE_INFINITY:Math.abs(row.locationDistanceAtr!),
    unknown(row.conservativePayoffBps)?Number.POSITIVE_INFINITY:-row.conservativePayoffBps!,unknown(row.spreadBps)?Number.POSITIVE_INFINITY:row.spreadBps!,unknown(row.depthUsd)?Number.POSITIVE_INFINITY:-row.depthUsd!,row.rank,row.symbol,
  ];
  const compare=(a:CandidateShadowInput,b:CandidateShadowInput)=>{const ka=key(a),kb=key(b);for(let i=0;i<ka.length;i++){if(ka[i]!<kb[i]!)return-1;if(ka[i]!>kb[i]!)return 1;}return 0;};
  return [...rows].sort(compare).map((row,index)=>({candidateId:row.candidateId,symbol:row.symbol,shadowRank:index+1,selected:row.selected,authorization:'NONE' as const,methodVersion:'V393-SELECTION-LEX-1'}));
}

export function selectionRegret(input:{chosenCandidateId:string;preselectedAlternativeId:string|null;observedOpportunityQuality:Record<string,number|null|undefined>}){
  const chosen=input.observedOpportunityQuality[input.chosenCandidateId],alt=input.preselectedAlternativeId?input.observedOpportunityQuality[input.preselectedAlternativeId]:null;
  return finite(chosen)&&finite(alt)?{status:'OBSERVED' as const,opportunityRegret:alt-chosen,chosenQuality:chosen,alternativeQuality:alt,basis:'OPPORTUNITY_QUALITY_NOT_PNL' as const}:{status:'UNKNOWN' as const,opportunityRegret:null,chosenQuality:finite(chosen)?chosen:null,alternativeQuality:finite(alt)?alt:null,basis:'OPPORTUNITY_QUALITY_NOT_PNL' as const};
}

export function executableMarkout(input:{side:'LONG'|'SHORT';fillPrice:number;quantity:number;bid:number|null;ask:number|null;entryFeeUsd:number|null;exitFeeBoundUsd:number|null;fundingUsd?:number|null;basis:'EXECUTABLE_EX_FUNDING'|'EXECUTABLE_WITH_FUNDING'}){
  const exit=input.side==='LONG'?input.bid:input.ask,notional=input.fillPrice*input.quantity;
  const eligibility=entryMetricEligible(input.basis as TradingQualityMetricBasis,{exactEntryAttribution:true,anchorKnown:finite(input.fillPrice)&&input.fillPrice>0,horizonMature:true,pathComplete:true,executableQuoteComplete:finite(exit)&&exit>0,entryCostComplete:finite(input.entryFeeUsd),exitCostBoundComplete:finite(input.exitFeeBoundUsd),fundingHorizonComplete:input.basis==='EXECUTABLE_EX_FUNDING'||finite(input.fundingUsd)});
  if(!eligibility.eligible||!finite(exit)||notional<=0)return{eligible:false,valueBps:null,reasons:eligibility.reasons};
  const priceMove=pct(input.fillPrice,exit,input.side),cost=((input.entryFeeUsd??0)+(input.exitFeeBoundUsd??0)-(input.basis==='EXECUTABLE_WITH_FUNDING'?(input.fundingUsd??0):0))/notional*10_000;
  return{eligible:true,valueBps:priceMove-cost,reasons:[]};
}

export function entryQualityView(input:{episodeId:string;path:PathWindow[];immediate?:any;eventAgeMs?:number|null;fillToIdealBps?:number|null;repriceCount?:number|null;adverseFirst?:string;timeToPositive?:{priceMs:number|null;netMs:number|null;netStatus:string};q1?:EvidenceFlag;q2?:EvidenceFlag;q3?:EvidenceFlag;q4?:EvidenceFlag;q5?:EvidenceFlag;q6?:EvidenceFlag}){
  const mature=input.path.filter(p=>p.coverage==='COMPLETE');
  return{episodeId:input.episodeId,methodVersion:'V393-ENTRY-1',horizons:mature.map(p=>({horizonMs:p.horizonMs,priceMarkoutBps:p.lastSignedBps,sampledMaeBps:p.maeBps,sampledMfeBps:p.mfeBps,sampleCount:p.sampleCount,maxGapMs:p.maxGapMs})),eventAgeMs:input.eventAgeMs??null,fillToIdealBps:input.fillToIdealBps??null,repriceCount:input.repriceCount??0,adverseFirst:input.adverseFirst??'DATA_UNAVAILABLE',timeToPositive:input.timeToPositive??null,rootCauseVector:{Q1:input.q1??'UNKNOWN',Q2:input.q2??'UNKNOWN',Q3:input.q3??'UNKNOWN',Q4:input.q4??'UNKNOWN',Q5:input.q5??'UNKNOWN',Q6:input.q6??'UNKNOWN'},authorization:'NONE' as const};
}

export function positionQualityView(input:{cycleId:string;unrealizedPnl:number;underwaterMs:number;holdingMs:number;maeBps:number|null;mfeBps:number|null;tpReachable:boolean|null;opportunityFresh:boolean|null;profitAvailable:boolean|null;humanManaged?:boolean}){
  const findings:string[]=[];
  if(input.unrealizedPnl<0)findings.push(input.underwaterMs>15*60_000?'LOSING_INVENTORY':'UNDERWATER_NORMAL');else findings.push('HEALTHY_HOLD');
  if(input.opportunityFresh===false)findings.push('STALE_OPPORTUNITY');
  if(input.tpReachable===true)findings.push('TP_REACHABLE');
  if(input.profitAvailable===true)findings.push('PROFIT_AVAILABLE');
  if(input.humanManaged)findings.push('HUMAN_HANDOFF_REQUIRED');
  if(input.tpReachable==null||input.opportunityFresh==null)findings.push('ECONOMIC_UNKNOWN');
  return{cycleId:input.cycleId,findings:[...new Set(findings)],holdingMs:input.holdingMs,underwaterMs:input.underwaterMs,maeBps:input.maeBps,mfeBps:input.mfeBps,authorization:'NONE' as const,lossExitAuthorized:false};
}

export function exitQualityView(input:{cycleId:string;realizedNetExFunding:number|null;canonicalNet:number|null;mfeSameBasis:number|null;exitPostMarkoutBps:Record<string,number|null>;partialFillCount:number;feeUsd:number|null}){
  const capture=finite(input.realizedNetExFunding)&&finite(input.mfeSameBasis)&&input.mfeSameBasis>0?input.realizedNetExFunding/input.mfeSameBasis:null;
  const findings:string[]=[];if(capture!=null&&capture>=.8)findings.push('GOOD_CAPTURE');if(capture!=null&&capture<.5)findings.push('MISSED_REALIZATION');if(finite(input.feeUsd)&&finite(input.realizedNetExFunding)&&Math.abs(input.realizedNetExFunding)>0&&input.feeUsd>Math.abs(input.realizedNetExFunding)*.25)findings.push('EXIT_COST_DRAG');if(!findings.length)findings.push('UNKNOWN');
  return{cycleId:input.cycleId,mfeToRealizedCapture:capture,postExitMarkoutBps:input.exitPostMarkoutBps,partialFillCount:input.partialFillCount,findings,authorization:'NONE' as const};
}

export type WorkingOrderSurvivalInput={status:'NEW'|'SUBMITTING'|'UNKNOWN'|'WORKING'|'PARTIALLY_FILLED'|'FILLED'|'CANCELED'|'EXPIRED'|'REJECTED';opportunityValid:boolean|null;ttlExpired:boolean;cancelRequested:boolean;cancelAcknowledged:boolean;filledQuantity:number;quantity:number};
export function workingOrderSurvivalAdvisory(input:WorkingOrderSurvivalInput){
  const terminal=['FILLED','CANCELED','EXPIRED','REJECTED'].includes(input.status);if(terminal)return{advisory:'NOOP',releaseReservation:true,acceptLateFill:true,mayResubmit:false};
  if(input.status==='UNKNOWN')return{advisory:'RECONCILE_ONLY',releaseReservation:false,acceptLateFill:true,mayResubmit:false};
  if(input.cancelRequested&&!input.cancelAcknowledged)return{advisory:'AWAIT_CANCEL_ACK',releaseReservation:false,acceptLateFill:true,mayResubmit:false};
  if(input.ttlExpired||input.opportunityValid===false)return{advisory:'REQUEST_CANCEL',releaseReservation:false,acceptLateFill:true,mayResubmit:false};
  return{advisory:'KEEP_WORKING',releaseReservation:false,acceptLateFill:true,mayResubmit:false};
}

export const V393_ENTRY_ENFORCE_ENABLED=false as const;
export const V393_PROFIT_REALIZATION_ENABLED=false as const;
export function authorizationEconomicFacts(input:{entryFeeUsd:number|null;fundingAttributedUsd:number|null;remainingQty:number;executablePrice:number|null;exitFeeUpperBoundUsd:number|null;uncertaintyBufferUsd:number|null;conservativeGrossPnlUsd:number|null;quoteFresh:boolean}){
  const known=[input.entryFeeUsd,input.fundingAttributedUsd,input.executablePrice,input.exitFeeUpperBoundUsd,input.uncertaintyBufferUsd,input.conservativeGrossPnlUsd].every(finite);
  const conservativeNet=known?input.conservativeGrossPnlUsd!-input.entryFeeUsd!-input.exitFeeUpperBoundUsd!+input.fundingAttributedUsd!-input.uncertaintyBufferUsd!:null;
  const evidenceReady=known&&input.remainingQty>0&&input.quoteFresh&&conservativeNet!>0;
  return{evidenceReady,conservativeNet,authorization:'DISABLED' as const,featureEnabled:V393_PROFIT_REALIZATION_ENABLED,reasons:[...(!known?['ECONOMIC_FACTS_INCOMPLETE']:[]),...(input.remainingQty<=0?['NO_REMAINING_QTY']:[]),...(!input.quoteFresh?['QUOTE_STALE']:[]),...(known&&conservativeNet!<=0?['CONSERVATIVE_NET_NOT_POSITIVE']:[]),'POLICY_NOT_AUTHORIZED']};
}
