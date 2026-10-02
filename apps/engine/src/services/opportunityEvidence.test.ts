import {expect,it} from 'vitest';
import {TradingQualityPolicySchema} from '@zdj/contracts';
import {harness} from './tradingQualityTestHarness.js';
import {buildOpportunityEvidence} from './opportunityEvidence.js';

it('retains the original event identity and event deadline when the same closed event is observed again',()=>{
  const h=harness(),m=h.state.snapshots.get(h.packet.symbol)!,now=Date.now(),closedAt=now-1000;
  h.state.settings.tradingQuality=TradingQualityPolicySchema.parse({mode:'SHADOW',eventTtlMs:300_000,authorizationTtlMs:90_000});
  Object.assign(m.quote,{last:100,bid:100,ask:100.01,ts:now});m.orderBook.ts=now;
  for(const [tf,period] of [['1m',60000],['5m',300000],['15m',900000]] as const)
    Object.assign(m.technical[tf],{trend:'UP',ema8:100,ema21:99,atr14:2,recentSwingHigh:110,recentSwingLow:95,
      isClosed:true,barCloseTime:closedAt,receivedAt:now,lastClosedBar:{openTime:closedAt-period+1,closeTime:closedAt,
        open:99.5,high:101,low:99,close:100.5,volume:100}});
  const original=buildOpportunityEvidence(m,h.state.settings,now),again=buildOpportunityEvidence(m,h.state.settings,now+10_000);
  expect(original.timingEvent.status).toBe('COMPLETED');
  expect(again).toMatchObject({opportunityId:original.opportunityId,version:original.version,eventExpiresAt:closedAt+300_000,
    timingEvent:original.timingEvent,observedAt:now+10_000});
  expect(again.expiresAt).toBe(original.expiresAt+10_000);
  expect(original.eventExpiresAt).toBe(again.eventExpiresAt);
});

it('does not give an unverified/missing event a synthetic event expiry',()=>{
  const h=harness(),m=h.state.snapshots.get(h.packet.symbol)!;
  for(const tf of ['1m','5m'] as const)m.technical[tf].isClosed=false;
  const e=buildOpportunityEvidence(m,h.state.settings);
  expect(e.timingEvent.time).toBeNull();expect(e.eventExpiresAt).toBeNull();
});
