import {afterEach,describe,expect,it,vi} from 'vitest';
import type {OpportunityEvidence} from '@zdj/contracts';
import {harness,systemCandidateDecision} from './tradingQualityTestHarness.js';

afterEach(()=>vi.useRealTimers());
function setup(age=280_000){
  vi.useFakeTimers();const h=harness(),now=Date.now(),eventTime=now-age;
  const evidence:OpportunityEvidence={opportunityId:'original-opportunity',version:'original-facts',policyVersion:'policy-1',
    symbol:h.packet.symbol,direction:'LONG',setupType:'TREND_PULLBACK',structureAnchor:null,
    timingEvent:{id:'original-event',status:'COMPLETED',time:eventTime,anchorPrice:h.packet.market.quote.last,timeframe:'5m',provenance:'technical.5m.confirmed'},
    eventTtlMs:300000,authorizationTtlMs:90000,positionObservationHorizonMs:900000,locationFacts:{distanceAtr:0,atr:1},
    executablePriceBand:null,structuralTarget:null,payoffSpaceBps:null,costs:{entryFeeBps:1,exitFeeBps:2,bufferBps:1},
    disposition:'ALLOW',blockers:[],releaseCondition:'event',observedAt:now,expiresAt:now+20000,
    eventExpiresAt:eventTime+300000,materialFactFingerprint:'original-facts'};
  h.packet.opportunityEvidence=evidence;
  h.ai.decide.mockImplementation(async(packet:any)=>({runId:'original-run',decisionCompletedAt:Date.now(),
    decision:systemCandidateDecision(packet,h.supplied,'LONG',{timingEvent:{...packet.opportunityEvidence.timingEvent}})}));
  return {...h,evidence,now};
}
describe('event deadline through the full Entry pipeline',()=>{
  it('copies original evidence to intent/order and uses the shorter original deadline at dispatch',async()=>{
    const h=setup();await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    const intent=[...h.state.entryIntents.values()][0],order=[...h.state.entryOrders.values()][0];
    expect(intent.absoluteExpiresAt).toBe(h.now+20000);
    expect(intent.decisionExecutionExpiresAt).toBe(h.now+60000);
    expect(order.opportunityAuthorization).toEqual(intent.opportunityAuthorization);
    expect(order.opportunityAuthorization).toMatchObject({opportunityId:'original-opportunity',timingEventTime:h.now-280000,eventApplicable:true});
    vi.setSystemTime(h.now+20000);
    expect((h.coordinator as any).executionHardBlock(intent,order)).toBe('ENTRY_OPPORTUNITY_EVENT_EXPIRED');
  });
  it('rejects an already expired original event before reserving funds despite a fresh decision',async()=>{
    const h=setup(300000);await h.run();
    expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryReservations.size).toBe(0);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(JSON.stringify(h.events)).toContain('ENTRY_OPPORTUNITY_EVENT_EXPIRED');
  });
  it('does not impose LONG event evidence on an independently selected SHORT',async()=>{
    const h=setup(300000);
    h.ai.decide.mockImplementation(async(packet:any)=>({runId:'independent-short',
      decision:systemCandidateDecision(packet,h.supplied,'SHORT',{timingEvent:{...packet.opportunityEvidence.timingEvent}})}));
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect([...h.state.entryIntents.values()][0].opportunityAuthorization).toMatchObject({eventApplicable:false,applicability:'SIDE_NOT_APPLICABLE'});
  });
  it('rejects changed order lineage even when both clocks still have time',async()=>{
    const h=setup();await h.run();const intent=[...h.state.entryIntents.values()][0],order=[...h.state.entryOrders.values()][0];
    const changed={...order,opportunityAuthorization:{...order.opportunityAuthorization!,opportunityVersion:'changed'}};
    expect((h.coordinator as any).executionHardBlock(intent,changed)).toBe('ENTRY_OPPORTUNITY_IDENTITY_MISMATCH');
  });
});
