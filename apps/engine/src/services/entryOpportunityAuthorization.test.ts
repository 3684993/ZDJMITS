import {describe,expect,it} from 'vitest';
import {EntryOrderSchema,EntryOpportunityAuthorizationSchema,type OpportunityEvidence} from '@zdj/contracts';
import {entryOpportunityAuthorizationBlock,resolveEntryOpportunityAuthorization} from './entryOpportunityAuthorization.js';

const eventTime=1_000_000;
const opportunity=():OpportunityEvidence=>({opportunityId:'opp-original',version:'facts-original',policyVersion:'policy-original',
  symbol:'BTCUSDT',direction:'LONG',setupType:'TREND_PULLBACK',structureAnchor:null,
  timingEvent:{id:'reclaim-original',status:'COMPLETED',time:eventTime,anchorPrice:100,timeframe:'1m',provenance:'technical.1m.confirmed'},
  eventTtlMs:300_000,authorizationTtlMs:90_000,positionObservationHorizonMs:900_000,
  locationFacts:{distanceAtr:0,atr:1},executablePriceBand:{min:99,max:101},structuralTarget:105,payoffSpaceBps:500,
  costs:{entryFeeBps:1,exitFeeBps:2,bufferBps:1},disposition:'ALLOW',blockers:[],releaseCondition:'fresh event',
  observedAt:eventTime+1000,expiresAt:eventTime+91_000,eventExpiresAt:eventTime+300_000,materialFactFingerprint:'facts-original'});
function input(elapsed=260_000){
  const e=opportunity(),now=eventTime+elapsed;
  return{opportunity:e,decision:{decision:'PLACE_LONG',tradeSide:'LONG' as const,timingEvent:{...e.timingEvent}},symbol:e.symbol,
    decisionCompletedAt:now,decisionExecutionExpiresAt:now+60_000,existingAbsoluteExpiresAt:now+120_000,now};
}

describe('original opportunity event clock and immutable lineage',()=>{
  it('binds a referenced event to its original 300-second deadline, separately from the 60-second decision clock',()=>{
    const args=input(),before=structuredClone(args),r=resolveEntryOpportunityAuthorization(args);
    expect(r).toMatchObject({ok:true,eventApplicable:true,eventExpiresAt:1_300_000,absoluteExpiresAt:1_300_000,
      identity:{identityStatus:'KNOWN',opportunityId:'opp-original',opportunityVersion:'facts-original',policyVersion:'policy-original',
        timingEventTime:1_000_000,eventTtlMs:300_000,observedAt:1_001_000}});
    expect(args).toEqual(before);
    expect(args.decisionExecutionExpiresAt).toBe(1_320_000);
    // The old observation authorization expired at 1,091,000; it is not the PLACE clock.
    expect(args.opportunity.expiresAt).toBeLessThan(args.now);
  });
  it.each([30_000,280_000])('never extends a shorter existing authorization at event age %s',elapsed=>{
    const args=input(elapsed);args.existingAbsoluteExpiresAt=args.now+5000;
    expect(resolveEntryOpportunityAuthorization(args).absoluteExpiresAt).toBe(args.now+5000);
    args.existingAbsoluteExpiresAt=args.now+120_000;
    expect(resolveEntryOpportunityAuthorization(args).absoluteExpiresAt).toBe(Math.min(args.now+60_000,eventTime+300_000));
  });
  it('rejects at the original event deadline and cannot renew it during retry or recovery',()=>{
    const bound=resolveEntryOpportunityAuthorization(input(299_999));
    expect(bound.ok).toBe(true);
    const restored=EntryOpportunityAuthorizationSchema.parse(JSON.parse(JSON.stringify(bound.identity)));
    expect(entryOpportunityAuthorizationBlock(restored,1_299_999)).toBeNull();
    expect(entryOpportunityAuthorizationBlock(restored,1_300_000)).toBe('ENTRY_OPPORTUNITY_EVENT_EXPIRED');
    expect(resolveEntryOpportunityAuthorization(input(300_000))).toMatchObject({ok:false,reason:'ENTRY_OPPORTUNITY_EVENT_EXPIRED'});
  });
  it.each(['null','none','non-place','other-side'] as const)('does not add event authority for %s',kind=>{
    const args=input(400_000);
    if(kind==='null')args.decision.timingEvent=null;
    if(kind==='none')args.decision.timingEvent={id:'NONE',status:'NONE'} as any;
    if(kind==='non-place')args.decision.decision='WAIT_FOR_PRICE';
    if(kind==='other-side')Object.assign(args.decision,{decision:'PLACE_SHORT',tradeSide:'SHORT'});
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:true,eventApplicable:false,eventExpiresAt:null,absoluteExpiresAt:args.now+60_000});
  });
  it('does not invent identity or a new gate for an old packet without opportunity evidence',()=>{
    const args=input();delete args.opportunity;
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:true,eventApplicable:false,
      identity:{identityStatus:'UNKNOWN',opportunityId:null,opportunityVersion:null,timingEventId:null,eventExpiresAt:null}});
    expect(entryOpportunityAuthorizationBlock(undefined,Number.MAX_SAFE_INTEGER)).toBeNull();
  });
  it('rejects an explicit unknown event on the applicable side without fabricating a new event',()=>{
    const args=input();args.decision.timingEvent.id='unknown';
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:false,reason:'ENTRY_OPPORTUNITY_EVENT_UNKNOWN',
      identity:{timingEventId:'reclaim-original',applicability:'INVALID_REFERENCE',eventApplicable:false}});
  });
  it.each([{time:eventTime+1},{anchorPrice:101},{timeframe:'5m'},{provenance:'invented'},{status:'PENDING'}])('rejects changed event facts %j',change=>{
    const args=input();Object.assign(args.decision.timingEvent,change);
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:false,reason:'ENTRY_OPPORTUNITY_EVENT_REFERENCE_MISMATCH'});
  });
  it.each(['future-event','future-observation','extended-expiry','invalid-ttl','symbol'] as const)('does not accept invalid original evidence: %s',kind=>{
    const args=input();
    if(kind==='future-event'){args.opportunity.timingEvent.time=args.now+1;args.decision.timingEvent.time=args.now+1;}
    if(kind==='future-observation')args.opportunity.observedAt=args.now+1;
    if(kind==='extended-expiry')args.opportunity.eventExpiresAt!+=1;
    if(kind==='invalid-ttl')args.opportunity.eventTtlMs=300001;
    if(kind==='symbol')args.opportunity.symbol='ETHUSDT';
    expect(resolveEntryOpportunityAuthorization(args).ok).toBe(false);
  });
  it('retains original clocks when reading older evidence without the explicit event expiry field',()=>{
    const args=input();delete args.opportunity.eventExpiresAt;
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:true,eventExpiresAt:eventTime+300_000});
  });
  it('cannot use an event to reset or widen the decision execution clock',()=>{
    const args=input();args.decisionExecutionExpiresAt+=1;
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:false,reason:'ENTRY_DECISION_CLOCK_INVALID'});
    args.decisionExecutionExpiresAt-=1;args.now=args.decisionExecutionExpiresAt;
    expect(resolveEntryOpportunityAuthorization(args)).toMatchObject({ok:false,reason:'ENTRY_DECISION_EXECUTION_EXPIRED'});
  });
  it('round-trips new lineage while preserving a historical order without invented lineage',()=>{
    const order={id:'old-order',exchangeOrderId:'remote',symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,filledQuantity:1,
      leverage:1,status:'FILLED',createdAt:1000,updatedAt:2000,absoluteExpiresAt:5000,repriceCount:0,intentId:'old-intent',reachability:1};
    const old=EntryOrderSchema.parse(order);
    expect(Object.hasOwn(old,'opportunityAuthorization')).toBe(false);
    expect(old.status).toBe('FILLED');expect(old.absoluteExpiresAt).toBe(5000);
    const identity=resolveEntryOpportunityAuthorization(input()).identity;
    expect(EntryOrderSchema.parse({...order,opportunityAuthorization:identity}).opportunityAuthorization).toEqual(identity);
  });
});
