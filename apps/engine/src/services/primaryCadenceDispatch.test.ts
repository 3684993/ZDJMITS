import {expect,it,vi} from 'vitest';
import {harness} from './tradingQualityTestHarness.js';
import {decisionContextKey,decisionSettingsContext,noEdgeReviewFacts} from './decisionContext.js';
import {buildQuantityHorizonCandidates} from './quantityHorizonCandidates.js';

it('schema failure releases the analysis lease and the next legal symbol dispatches without waiting for that failure cooldown',async()=>{
  const h=harness(),symbol=h.packet.symbol,next='BTCUSDT',market:any=structuredClone(h.packet.market);market.symbol=next;
  h.state.snapshots.set(next,market);h.state.snapshots.set('ETHUSDT',market);
  h.state.universe.push({...h.state.universe[0],symbol:next,rank:2,underlyingAsset:'BTC',residentEligible:true} as any);
  (h.state.marginTierCoverage as any).tiersBySymbol[next]=[{notionalFloor:0,notionalCap:null,initialLeverage:20}];
  h.ai.decide.mockRejectedValueOnce(Error('AI_SCHEMA_INVALID: acceptablePriceRange')).mockImplementationOnce(async(p:any)=>({decision:h.candidateDecision(p,'LONG'),runId:'next-symbol'}));
  await h.run();expect(h.state.candidateLifecycle.get(symbol)?.status).toBe('AI_FAILURE_COOLDOWN');expect((h.coordinator as any).active.size).toBe(0);
  (h.coordinator as any).eip={build:(s:string,envelope:any)=>({...h.packet,symbol:s,market:s===next?market:h.packet.market,executionEnvelope:envelope})};
  (h.ai as any).probePrimaryIfDue=async()=>{};
  (h.ai as any).setIdleContext=()=>{};
  await h.coordinator.processPool();await vi.waitFor(()=>expect(h.ai.decide).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(h.exchange.placeEntry).toHaveBeenCalledOnce());
  expect(h.events.filter(x=>x.type==='ANALYSIS_DISPATCH_INTENT').at(-1)?.symbol).toBe(next);expect(h.state.candidateLifecycle.get(symbol)?.status).toBe('AI_FAILURE_COOLDOWN');
});
it('an unchanged valid context stays deduplicated while an explicit no-edge TTL may release it',()=>{
  const h=harness(),symbol=h.packet.symbol,coord=h.coordinator as any,caps=coord.routeCapabilities(symbol);
  const key=decisionContextKey({market:h.packet.market,settingsContext:decisionSettingsContext(h.state.settings),...caps});
  h.state.candidateLifecycle.set(symbol,{status:'READY',decisionContextKey:key,nextReviewAt:Date.now()-1});expect(coord.lifecycleRunnable(symbol)).toBe(false);
  h.state.candidateLifecycle.set(symbol,{status:'READY',decisionContextKey:key,noEdgeReview:{facts:noEdgeReviewFacts({market:h.packet.market,...caps}),expiresAt:Date.now()-1}});expect(coord.lifecycleRunnable(symbol)).toBe(true);expect(h.state.candidateLifecycle.get(symbol)?.triggerReason).toBe('NO_EDGE_TTL_EXPIRED');
});
it('Review persists exact cancellation in the Entry journal before releasing reservation occupancy',async()=>{
  const h=harness();await h.run();const order=[...h.state.entryOrders.values()][0]!,intent=h.state.entryIntents.get(order.intentId)!;
  h.state.eips.set(order.symbol,h.packet);const save=vi.fn((record:any)=>{expect(record.order.exchangeTerminalStatus).toBe('CANCELED');expect(h.state.entryReservations.get(order.reservationId)?.status).toBe('WORKING');});
  (h.coordinator as any).journal={save};(h.ai as any).reviewDedicated=()=>true;(h.ai as any).reviewPendingEntry=async()=>({decision:'CANCEL'});h.exchange.findEntryByClientOrderId.mockResolvedValue(order);
  (h.coordinator as any).schedulePendingEntryReview(order,intent,h.packet.market,Date.now()+30000);
  await vi.waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(h.state.entryReservations.get(order.reservationId)?.status).toBe('RELEASED');
});
it.each(['LONG','SHORT'] as const)('offers only inward-aligned frozen %s prices for the BNB historical fractional interval',side=>{
  const h=harness(),set=buildQuantityHorizonCandidates({symbol:'BNBUSDC',side,now:Date.now(),candidateSchemaVersion:'V397-PLAN-CANDIDATE-1',risk:null,quote:{bid:743.1,ask:743.11,tickSize:.01,stepSize:.01,minQty:.01,minNotional:5,minEntryPrice:743.001876315681,maxEntryPrice:743.218123684319},leverage:10,envelope:{executable:true,maxQuantityUnits:1000,minQuantityUnits:135,maxNotionalUsd:7430,maxMarginUsd:743,minimumInitialMarginQuote:100},envelopeExpiresAt:Date.now()+180000,factVersion:'historical-numeric-projection',settings:h.state.settings,candles:()=>[],managementDurationMs:60000});
  expect(set.candidates.length).toBeGreaterThan(0);for(const c of set.candidates){expect(c.sizingProof?.executableEntryRange).toEqual({min:743.01,max:743.21});expect(c.entryReferencePrice).toBe(side==='SHORT'?743.01:743.21);expect(c.entryReferencePrice/.01).toBeCloseTo(Math.round(c.entryReferencePrice/.01),7);expect(c.quantityUnits*.01*743.21).toBeLessThanOrEqual(7430);expect(c.quantityUnits*.01*743.21/c.leverage).toBeLessThanOrEqual(743);}
});

it('journal save failure does not release reservation or expose terminal in-memory order',async()=>{
 const h=harness();await h.run();const order=[...h.state.entryOrders.values()][0]!,intent=h.state.entryIntents.get(order.intentId)!;h.state.eips.set(order.symbol,h.packet);
 (h.coordinator as any).journal={save:vi.fn(()=>{throw Error('SQLITE_FULL');})};(h.ai as any).reviewDedicated=()=>true;(h.ai as any).reviewPendingEntry=async()=>({decision:'CANCEL'});h.exchange.findEntryByClientOrderId.mockResolvedValue(order);
 (h.coordinator as any).schedulePendingEntryReview(order,intent,h.packet.market,Date.now()+30000);
 await vi.waitFor(()=>expect(h.events.some(e=>e.type==='PENDING_ENTRY_REVIEW_FAILED')).toBe(true));expect(h.state.entryReservations.get(order.reservationId)?.status).toBe('WORKING');expect(h.state.entryOrders.get(order.id)?.status).toBe('WORKING');expect(h.events.some(e=>e.type==='PENDING_ENTRY_REVIEW_ACTION_CONVERGED')).toBe(false);
});
