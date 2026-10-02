import type {EntryOpportunityAuthorization,OpportunityEvidence} from '@zdj/contracts';
import {entryDecisionClockBlock} from './entryDecisionClock.js';

const finiteTime=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const unknownIdentity=():EntryOpportunityAuthorization=>({schemaVersion:'V397-OPPORTUNITY-AUTHORIZATION-1',identityStatus:'UNKNOWN',
  opportunityId:null,opportunityVersion:null,policyVersion:null,observedAt:null,evidenceDirection:null,
  timingEventId:null,timingEventTime:null,eventTtlMs:null,eventExpiresAt:null,eventApplicable:false,applicability:'UNKNOWN'});

/** Only use frozen request evidence here. Never rebuild it from the current market or renew its time.
 *
 * const authorization=resolveEntryOpportunityAuthorization({opportunity:packet.opportunityEvidence,
 *   decision:d,symbol,...decisionClock,existingAbsoluteExpiresAt:otherDeadlinesMin,now});
 * if(!authorization.ok) reject(authorization.reason);
 * intent.opportunityAuthorization=authorization.identity;
 * intent.absoluteExpiresAt=authorization.absoluteExpiresAt;
 * Copy both fields unchanged to orders/replacements; recheck entryOpportunityAuthorizationBlock at dispatch.
 */
export function resolveEntryOpportunityAuthorization(input:{
  opportunity?:OpportunityEvidence|null;
  decision:{decision?:string|null;tradeSide?:'LONG'|'SHORT'|null;timingEvent?:unknown};
  symbol:string;decisionCompletedAt:number;decisionExecutionExpiresAt:number;existingAbsoluteExpiresAt:number;now?:number;
}){
  const now=input.now??Date.now(),e=input.opportunity;
  let identity=unknownIdentity();
  let absoluteExpiresAt=Math.min(input.existingAbsoluteExpiresAt,input.decisionExecutionExpiresAt);
  const result=(reason:string|null)=>({ok:reason===null,reason,identity,eventApplicable:identity.eventApplicable,
    eventExpiresAt:identity.eventApplicable?identity.eventExpiresAt:null,absoluteExpiresAt});
  const clockError=entryDecisionClockBlock(input,now);
  if(clockError)return result(clockError);
  if(!finiteTime(input.existingAbsoluteExpiresAt)||input.existingAbsoluteExpiresAt<=0)return result('ENTRY_ABSOLUTE_EXPIRY_INVALID');
  if(!e)return result(null); // Historical packets have no opportunity authority to reconstruct.
  const known=Boolean(e.opportunityId&&e.version&&e.policyVersion)&&finiteTime(e.observedAt);
  if(!known)return result(null);
  const event=e.timingEvent;
  const originalExpiry=event?.status==='COMPLETED'&&finiteTime(event.time)&&finiteTime(e.eventTtlMs)
    &&e.eventTtlMs>=1000&&e.eventTtlMs<=300000?event.time+e.eventTtlMs:null;
  identity={schemaVersion:'V397-OPPORTUNITY-AUTHORIZATION-1',identityStatus:'KNOWN',opportunityId:e.opportunityId,
    opportunityVersion:e.version,policyVersion:e.policyVersion,observedAt:e.observedAt,evidenceDirection:e.direction,
    timingEventId:event?.id&&event.id!=='NONE'?event.id:null,timingEventTime:finiteTime(event?.time)?event.time:null,
    eventTtlMs:originalExpiry===null?null:e.eventTtlMs,eventExpiresAt:originalExpiry,eventApplicable:false,applicability:'NOT_REFERENCED'};
  const d=input.decision,place=d.decision==='PLACE_LONG'||d.decision==='PLACE_SHORT';
  const reference=d.timingEvent as Partial<OpportunityEvidence['timingEvent']>|null|undefined;
  if(!place||!reference||(reference.id==='NONE'&&reference.status==='NONE'))return result(null);
  // A deterministic 15m hint must never become a veto on an independently selected model side.
  if(!e.direction||d.tradeSide!==e.direction){identity.applicability='SIDE_NOT_APPLICABLE';return result(null);}
  const invalid=(reason:string)=>{identity.applicability='INVALID_REFERENCE';return result(reason);};
  if(e.symbol!==input.symbol)return invalid('ENTRY_OPPORTUNITY_SYMBOL_MISMATCH');
  if(!reference.id||reference.id!==event?.id)return invalid('ENTRY_OPPORTUNITY_EVENT_UNKNOWN');
  const keys=['id','status','time','anchorPrice','timeframe','provenance'] as const;
  if(keys.some(key=>reference[key]!==event[key]))return invalid('ENTRY_OPPORTUNITY_EVENT_REFERENCE_MISMATCH');
  if(event.status!=='COMPLETED'||originalExpiry===null||Number(event.time)>e.observedAt||e.observedAt>now
    ||(e.eventExpiresAt!==undefined&&e.eventExpiresAt!==originalExpiry))return invalid('ENTRY_OPPORTUNITY_EVENT_CLOCK_INVALID');
  identity.eventApplicable=true;identity.applicability='REFERENCED_MATCHING_SIDE';
  absoluteExpiresAt=Math.min(absoluteExpiresAt,originalExpiry);
  return result(entryOpportunityAuthorizationBlock(identity,now));
}

/** Absent/UNKNOWN legacy identity cannot create or renew authority; the existing clocks still bind. */
export function entryOpportunityAuthorizationBlock(identity:EntryOpportunityAuthorization|undefined|null,now=Date.now()):string|null{
  if(!identity?.eventApplicable)return null;
  if(identity.identityStatus!=='KNOWN'||identity.applicability!=='REFERENCED_MATCHING_SIDE'||!identity.opportunityId
    ||!identity.opportunityVersion||!identity.policyVersion||!identity.timingEventId||!finiteTime(identity.observedAt)
    ||!finiteTime(identity.timingEventTime)||!finiteTime(identity.eventTtlMs)||identity.eventTtlMs<1000||identity.eventTtlMs>300000
    ||identity.timingEventTime>identity.observedAt||identity.observedAt>now
    ||identity.eventExpiresAt!==identity.timingEventTime+identity.eventTtlMs)return 'ENTRY_OPPORTUNITY_EVENT_CLOCK_INVALID';
  return now>=identity.eventExpiresAt?'ENTRY_OPPORTUNITY_EVENT_EXPIRED':null;
}
