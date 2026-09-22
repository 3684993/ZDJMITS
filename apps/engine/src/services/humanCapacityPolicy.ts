import type {PortfolioRiskSnapshot} from './portfolioRiskSnapshot.js';

export interface HumanCapacityProfile{
  maxHumanPositions:number;
  maxHumanNotionalUsd:number;
  maxPendingHandoffs:number;
  maxAckAgeMs:number;
}

export interface HumanCapacityDecision{
  executable:boolean;
  protectionAllowed:true;
  blockers:string[];
  humanManagedPositions:number;
  pendingHandoffs:number;
  aiActivePositions:number;
  potentialHandoffSlots:number;
  potentialHandoffNotionalUsd:number;
  overdueHandoffs:string[];
}

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);

/**
 * S05-D. Every AI_ACTIVE position pre-reserves one worst-case handoff slot. Existing
 * HUMAN_MANAGED/HANDOFF_PENDING risk is never discounted. Capacity exhaustion blocks only
 * new risk; protection remains allowed.
 */
export function evaluateHumanCapacity(input:{snapshot:PortfolioRiskSnapshot;profile:HumanCapacityProfile;now:number;candidateNotionalUsd?:number;candidateAlreadyCounted?:boolean}):HumanCapacityDecision{
  const {snapshot,profile}=input,blockers:string[]=[];
  const validProfile=Number.isSafeInteger(profile.maxHumanPositions)&&profile.maxHumanPositions>=0&&finite(profile.maxHumanNotionalUsd)&&profile.maxHumanNotionalUsd>=0&&Number.isSafeInteger(profile.maxPendingHandoffs)&&profile.maxPendingHandoffs>=0&&finite(profile.maxAckAgeMs)&&profile.maxAckAgeMs>=0;
  if(!validProfile)blockers.push('HUMAN_CAPACITY_PROFILE_INVALID');
  if(!snapshot.complete)blockers.push('PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE');
  if(!finite(input.now)||input.now<0)blockers.push('HUMAN_CAPACITY_TIME_INVALID');
  const candidateNotionalUsd=input.candidateNotionalUsd??0;
  if(!finite(candidateNotionalUsd)||candidateNotionalUsd<0)blockers.push('CANDIDATE_NOTIONAL_INVALID');

  const positions=snapshot.exposures.filter(row=>row.kind==='POSITION'&&row.notionalUsd>0);
  const human=positions.filter(row=>row.ownerState==='HUMAN_MANAGED');
  const pending=positions.filter(row=>row.ownerState==='HANDOFF_PENDING');
  if(pending.some(row=>!finite(row.handoffAt)||Number(row.handoffAt)<0||Number(row.handoffAt)>input.now||row.acknowledgedAt!=null&&(!finite(row.acknowledgedAt)||Number(row.acknowledgedAt)<Number(row.handoffAt)||Number(row.acknowledgedAt)>input.now)))blockers.push('HUMAN_HANDOFF_TIME_UNPROVEN');
  const ai=positions.filter(row=>row.ownerState==='AI_ACTIVE');
  const overdue=pending.filter(row=>row.acknowledgedAt==null&&row.handoffAt!=null&&finite(input.now)&&input.now-row.handoffAt>profile.maxAckAgeMs).map(row=>row.id).sort();
  const humanManagedPositions=human.length,pendingHandoffs=pending.length,aiActivePositions=ai.length;
  const potentialHandoffSlots=humanManagedPositions+pendingHandoffs+aiActivePositions;
  const potentialHandoffNotionalUsd=[...human,...pending,...ai].reduce((sum,row)=>sum+row.notionalUsd,0);

  if(validProfile){
    if(pendingHandoffs>profile.maxPendingHandoffs)blockers.push('HUMAN_PENDING_HANDOFF_LIMIT');
    if(overdue.length)blockers.push('HUMAN_ACK_OVERDUE');
    // A caller whose candidate is already inside the snapshot must not be charged the slot twice.
    const reservedSlots=potentialHandoffSlots+(input.candidateAlreadyCounted?0:1);
    if(reservedSlots>profile.maxHumanPositions)blockers.push('HUMAN_POTENTIAL_SLOT_LIMIT');
    if(potentialHandoffNotionalUsd+Math.max(0,candidateNotionalUsd)>profile.maxHumanNotionalUsd)blockers.push('HUMAN_POTENTIAL_NOTIONAL_LIMIT');
  }

  const unique=[...new Set(blockers)].sort();
  return {executable:unique.length===0,protectionAllowed:true,blockers:unique,humanManagedPositions,pendingHandoffs,aiActivePositions,potentialHandoffSlots,potentialHandoffNotionalUsd,overdueHandoffs:overdue};
}
