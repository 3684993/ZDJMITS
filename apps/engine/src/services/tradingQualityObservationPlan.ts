import {createHash} from 'node:crypto';

export type EvidenceLifecycle='CANDIDATE'|'ENTRY'|'POSITION'|'EXIT';
export type EvidenceMaturity='OPEN'|'MATURE'|'SPARSE'|'INTERRUPTED'|'UNKNOWN';
export type EvidenceEnvelope<T>={
  lifecycle:EvidenceLifecycle;subjectId:string;sourceIds:string[];sourceRevisionHash:string;metricVersion:string;computedAt:number;asOf:number;maturity:EvidenceMaturity;payload:T;
};
export type ObservationBudget={maxCandidateSets:number;maxCandidatesPerSet:number;maxActiveEntries:number;maxActivePositions:number;maxRecentExits:number;maxWritesPerMinute:number;maxQueuedWrites:number;retentionMs:number};
export const V393_DEFAULT_OBSERVATION_BUDGET:Readonly<ObservationBudget>=Object.freeze({maxCandidateSets:8,maxCandidatesPerSet:8,maxActiveEntries:64,maxActivePositions:100,maxRecentExits:64,maxWritesPerMinute:2400,maxQueuedWrites:2000,retentionMs:7*24*60*60_000});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function evidenceEnvelope<T>(input:{lifecycle:EvidenceLifecycle;subjectId:string;sourceIds:string[];sourceRevisions:unknown;metricVersion:string;computedAt:number;asOf:number;maturity:EvidenceMaturity;payload:T}):EvidenceEnvelope<T>{
  return{lifecycle:input.lifecycle,subjectId:input.subjectId,sourceIds:[...new Set(input.sourceIds)].sort(),sourceRevisionHash:digest(input.sourceRevisions),metricVersion:input.metricVersion,computedAt:input.computedAt,asOf:input.asOf,maturity:input.maturity,payload:input.payload};
}

export type ObservationDemand={candidateSets:number;candidatesPerSet:number;activeEntries:number;activePositions:number;recentExits:number;writesLastMinute:number;queuedWrites:number};
export function observationAdmission(demand:ObservationDemand,budget:ObservationBudget=V393_DEFAULT_OBSERVATION_BUDGET){
  const reasons:string[]=[];
  if(demand.candidateSets>budget.maxCandidateSets)reasons.push('CANDIDATE_SET_BUDGET_EXCEEDED');
  if(demand.candidatesPerSet>budget.maxCandidatesPerSet)reasons.push('CANDIDATE_PER_SET_BUDGET_EXCEEDED');
  if(demand.activeEntries>budget.maxActiveEntries)reasons.push('ENTRY_OBSERVATION_BUDGET_EXCEEDED');
  if(demand.activePositions>budget.maxActivePositions)reasons.push('POSITION_OBSERVATION_BUDGET_EXCEEDED');
  if(demand.recentExits>budget.maxRecentExits)reasons.push('EXIT_OBSERVATION_BUDGET_EXCEEDED');
  if(demand.writesLastMinute>=budget.maxWritesPerMinute)reasons.push('WRITE_RATE_BUDGET_EXCEEDED');
  if(demand.queuedWrites>=budget.maxQueuedWrites)reasons.push('WRITE_QUEUE_BUDGET_EXCEEDED');
  return{admitted:reasons.length===0,reasons,degradation:reasons.length?'EVIDENCE_DEGRADED' as const:'READY' as const,tradeAuthorizationImpact:'NONE' as const,tpImpact:'NONE' as const,reconciliationImpact:'NONE' as const};
}

export function observationRetentionCutoff(asOf:number,budget:ObservationBudget=V393_DEFAULT_OBSERVATION_BUDGET){return asOf-budget.retentionMs;}
