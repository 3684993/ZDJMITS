import {describe,it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EntryIntentSchema,TradingQualityPolicySchema} from '@zdj/contracts';
import {harness} from './tradingQualityTestHarness.js';
import {buildOpportunityEvidence,revalidateOpportunity,validateOpportunityDecision} from './opportunityEvidence.js';
import {TradingQualityCollector} from './tradingQualityCollector.js';
import {PositionService} from './positionService.js';
import {EntryCoordinator} from './entryCoordinator.js';
import {entryDecisionParse} from './aiFabric.js';
import {buildCompactBrainPrompt} from '@zdj/core';

afterEach(()=>vi.restoreAllMocks());
function ready(){
  const h=harness(),now=Date.now(),m=h.state.snapshots.get(h.packet.symbol)!;
  h.state.settings.tradingQuality=TradingQualityPolicySchema.parse({mode:'ENFORCE'});
  Object.assign(m.quote,{bid:100,ask:100.01,last:100,mark:100,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,ts:now});
  m.orderBook={...m.orderBook,ts:now,bids:[[100,10000]],asks:[[100.01,10000]]};
  for(const [tf,period] of [['15m',900000],['5m',300000],['1m',60000]] as const){
    Object.assign(m.technical[tf],{trend:'UP',ema8:100,ema21:99,ema55:98,emaSlope21:1,atr14:2,atrPercent:2,recentSwingHigh:110,recentSwingLow:95,
      isClosed:true,asOf:now-1000,barCloseTime:now-1000,receivedAt:now,lastClosedBar:{openTime:now-1000-period+1,closeTime:now-1000,open:99.5,high:101,low:99,close:100.5,volume:100}});
  }
  h.packet.market={...h.packet.market,...m};
  h.ai.decide.mockImplementation(async(packet:any)=>{
    const e=packet.opportunityEvidence;
    expect(e).toBeDefined();
    return {runId:'quality-run',decision:{...h.supplied,decision:'PLACE_LONG',tradeSide:'LONG',direction:'LONG',opportunityType:e.setupType,timingEvent:e.timingEvent,
      idealPrice:100,acceptablePriceRange:{min:99.99,max:100.01},horizonMinutes:1}};
  });
  return {...h,m,now};
}

describe('real EntryCoordinator opportunity authorization',()=>{
  it('builds before Primary and carries identity through allocation, submit and schema recovery',async()=>{
    const h=ready();await h.run();expect(h.exchange.placeEntry,JSON.stringify(h.events.filter(e=>/FAILED|BLOCKED/.test(e.type)))).toHaveBeenCalledOnce();
    const i=[...h.state.entryIntents.values()][0];expect(i.opportunityEvidence.timingEvent.status).toBe('COMPLETED');
    expect(EntryIntentSchema.parse(JSON.parse(JSON.stringify(i))).opportunityEvidence).toEqual(i.opportunityEvidence);
    expect(h.events.findIndex(e=>e.type==='TRADING_QUALITY_OPPORTUNITY')).toBeLessThan(h.events.findIndex(e=>e.type==='TRADING_QUALITY_PRIMARY_LINK'));
  });
  it('the actual Primary prompt and parser require the supplied completed event',()=>{
    const h=ready(),e=buildOpportunityEvidence(h.m,h.state.settings,h.now),packet={...h.packet,opportunityEvidence:e};
    const d={action:'FINAL',schemaVersion:'V3.9.2',decision:'PLACE_LONG',structureDirection:'LONG',tradeSide:'LONG',opportunityType:e.setupType,marketRegime:'TREND',confidence:.8,idealPrice:100,acceptablePriceRange:{min:99.99,max:100.01},horizonMinutes:1,waitCondition:null,directionReason:'facts',timingReason:'facts',entryLocationReason:'facts',reason:'facts',entryInvalidation:'ENTRY_ONLY',timingEvent:e.timingEvent};
    expect(buildCompactBrainPrompt(packet)).toContain(e.opportunityId);
    expect(entryDecisionParse(d,packet).tradeSide).toBe('LONG');
    expect(()=>entryDecisionParse({...d,timingEvent:{...e.timingEvent,time:e.timingEvent.time!+1}},packet)).toThrow('PRIMARY_EVENT_NOT_VERIFIED');
    expect(()=>entryDecisionParse({...d,timingEvent:null},packet)).toThrow('PRIMARY_EVENT_NOT_VERIFIED');
  });
  it('cannot forge completion or a price band even with a valid PLACE shape',async()=>{
    const h=ready(),original=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async(...args:any[])=>{const r:any=await (original as any)(...args);r.decision.timingEvent={...r.decision.timingEvent,time:1};return r;});
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.state.entryIntents.size).toBe(0);
  });
  it.each(['expiry','price','structure','payoff','policy'] as const)('revalidates %s after Primary latency before wire submit',async(kind)=>{
    const h=ready();h.exchange.setLeverage.mockImplementation(async()=>{
      if(kind==='expiry')for(const i of h.state.entryIntents.values())i.opportunityEvidence.expiresAt=1;
      if(kind==='price')for(const i of h.state.entryIntents.values())i.opportunityEvidence.executablePriceBand={min:101,max:102};
      if(kind==='structure')h.m.technical['15m'].trend='DOWN';
      if(kind==='payoff')h.m.technical['15m'].recentSwingHigh=100;
      if(kind==='policy')h.state.settings.tradingQuality!.policyVersion='changed';
    });await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
  });
  it('WAIT creates no intent and fresh evaluation creates new authorization',async()=>{
    const h=ready(),place=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockResolvedValueOnce({runId:'wait-run',decision:{...h.supplied,decision:'WAIT_FOR_PRICE',structureDirection:'LONG',tradeSide:null,waitCondition:{operator:'LTE',price:100,validForMinutes:1},reason:'wait'}} as any);
    await h.run();expect(h.state.entryIntents.size).toBe(0);expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.candidateLifecycle.get(h.packet.symbol).waitContext.orderAuthorization).toBe(false);
    h.ai.decide.mockImplementation(place);await h.run();expect(h.ai.decide).toHaveBeenCalledTimes(2);expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('pending invalidation retains UNKNOWN risk, and never replaces an expired order',async()=>{
    const h=ready();await h.run();const i=[...h.state.entryIntents.values()][0];i.opportunityEvidence.expiresAt=1;
    h.exchange.cancelEntry.mockImplementation(async(o:any)=>({...o,status:'UNKNOWN'}));
    await h.coordinator.reviewPending();expect(h.exchange.cancelEntry).toHaveBeenCalled();
    expect(h.state.entryReservations.get(i.reservationId).status).toBe('WORKING');
    expect([...h.state.entryOrders.values()][0].status).toBe('UNKNOWN');
  });
  it('revalidates changed replacement price independently of original legal price',()=>{
    const h=ready(),e=buildOpportunityEvidence(h.m,h.state.settings,h.now);
    expect(revalidateOpportunity(e,h.m,h.state.settings,100,h.now,1)).toBeNull();
    expect(revalidateOpportunity(e,h.m,h.state.settings,110,h.now,1)).toBe('OPPORTUNITY_PRICE_OUTSIDE_BAND');
    h.state.settings.tradingQuality!.maxLocationAtr=10;const wider=buildOpportunityEvidence(h.m,h.state.settings,h.now);
    expect(revalidateOpportunity(wider,h.m,h.state.settings,109.99,h.now,1)).toBe('OPPORTUNITY_PAYOFF_INSUFFICIENT');
    expect(validateOpportunityDecision({decision:'PLACE_LONG',tradeSide:'LONG',opportunityType:e.setupType,timingEvent:null},e)).toBe('PRIMARY_EVENT_NOT_VERIFIED');
  });
  it.each([101,102.44])('real reviewPending checks payoff at proposed reprice %s',async(nextPrice)=>{
    const h=ready();h.m.technical['15m'].recentSwingHigh=102.45;
    const original=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async(...args:any[])=>{const r:any=await original(...args);r.decision.acceptablePriceRange={min:98.5,max:102.5};return r;});
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    const o=[...h.state.entryOrders.values()][0];o.updatedAt=Date.now()-10000;h.state.settings.entry.nearMarket.enabled=true;h.m.recentTradedPrices=[{price:nextPrice,lastSeenAt:Date.now()}];
    Object.assign(h.m.quote,{bid:nextPrice,ask:nextPrice+.01,last:nextPrice,mark:nextPrice,ts:Date.now()});
    h.m.orderBook={...h.m.orderBook,ts:Date.now(),bids:[[nextPrice,10000]],asks:[[nextPrice+.01,10000]]};
    const replace=vi.fn(async(order:any,price:number)=>({...order,price,status:'WORKING'}));(h.exchange as any).replaceEntry=replace;
    await h.coordinator.reviewPending();
    if(nextPrice===101)expect(replace).toHaveBeenCalledOnce();else expect(replace).not.toHaveBeenCalled();
  });
  it('restored execution wait cannot reuse an expired PLACE and missing intent cannot release UNKNOWN',async()=>{
    const h=ready();await h.run();const i=[...h.state.entryIntents.values()][0],o=[...h.state.entryOrders.values()][0];
    i.opportunityEvidence.expiresAt=1;o.status='NEW';o.exchangeOrderId=null;
    h.state.candidateLifecycle.set(i.symbol,{status:'WAIT_EXECUTION_RANGE',executionWait:{intentId:i.id,reservationId:i.reservationId}});
    await (h.coordinator as any).resumeExecutionWaits(Date.now());expect(h.exchange.placeEntry).toHaveBeenCalledTimes(1);expect(o.clientOrderId).toBeTruthy();
    o.status='UNKNOWN';h.state.entryOrders.set(o.id,o);h.state.entryReservations.get(i.reservationId).status='WORKING';h.state.entryIntents.delete(i.id);
    h.state.candidateLifecycle.set(i.symbol,{status:'WAIT_EXECUTION_RANGE',executionWait:{intentId:i.id,reservationId:i.reservationId}});
    await (h.coordinator as any).resumeExecutionWaits(Date.now());expect(h.state.entryReservations.get(i.reservationId).status).toBe('WORKING');
  });
  it('recovers UNKNOWN with same identity even after opportunity expiry without a new submit',async()=>{
    const h=ready();await h.run();const i=[...h.state.entryIntents.values()][0],o=[...h.state.entryOrders.values()][0];
    i.opportunityEvidence.expiresAt=1;o.status='UNKNOWN';
    h.exchange.findEntryByClientOrderId.mockResolvedValue({...o,status:'WORKING',exchangeOrderId:'remote'} as any);
    const restarted=new EntryCoordinator(h.state,{} as any,{} as any,h.exchange as any,h.bus);
    const result=await (restarted as any).submitExactlyOnce(EntryIntentSchema.parse(JSON.parse(JSON.stringify(i))),o);
    expect(result.clientOrderId).toBe(o.clientOrderId);expect(h.exchange.placeEntry).toHaveBeenCalledTimes(1);
  });
  it('evidence storage failure blocks ENFORCE before Primary but does not block OFF',async()=>{
    const h=ready();(h.state as any).tradingQualityEvidenceReady=false;await h.run();expect(h.ai.decide).not.toHaveBeenCalled();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    const off=harness();(off.state as any).tradingQualityEvidenceReady=false;await off.run();expect(off.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('processPool wakes WAIT on a fresh event and obtains a new Primary decision',async()=>{
    const h=ready();h.ai.decide.mockResolvedValueOnce({runId:'waiting',decision:{...h.supplied,decision:'WAIT_FOR_PRICE',structureDirection:'LONG',tradeSide:null,waitCondition:{operator:'LTE',price:100,validForMinutes:1},reason:'wait'}} as any);
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    (h.ai as any).probePrimaryIfDue=vi.fn(async()=>{});(h.ai as any).setIdleContext=vi.fn();
    h.state.snapshots.set('BTCUSDT',{...h.m,symbol:'BTCUSDT'});h.state.snapshots.set('ETHUSDT',{...h.m,symbol:'ETHUSDT'});
    await h.coordinator.processPool();await new Promise(resolve=>setImmediate(resolve));
    expect(h.events.some(e=>e.type==='ENTRY_WAIT_TRIGGERED'&&e.payload.orderAuthorization===false)).toBe(true);
    expect(h.ai.decide).toHaveBeenCalledTimes(2);expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('OFF keeps accepted baseline authorization unchanged',async()=>{
    const h=harness();await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();expect([...h.state.entryIntents.values()][0].opportunityEvidence).toBeUndefined();
  });
});

describe('prospective runtime evidence collection',()=>{
  it('same symbol reopened in the same millisecond keeps separate position cycles and exact fills',()=>{
    const h=ready(),service=new PositionService(h.state,h.bus),symbol=h.packet.symbol;
    const p:any={id:'remote-stable-id',symbol,side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:10,openedAt:h.now,firstObservedAt:h.now};
    const fill=(n:number,exit=false)=>({fillId:`f${n}`,symbol,side:exit?'SELL' as const:'BUY' as const,positionSide:'LONG' as const,orderId:`order${n}`,clientOrderId:exit?`tp_${n}`:`ml_${n}`,tradeId:`t${n}`,executionTime:h.now,qty:1,price:exit?102:100,realizedPnl:exit?2:0,commission:.01,commissionAsset:'USDT',maker:true});
    h.state.positions.set(p.id,p);service.observeRemotePosition(p);service.recordExchangeFill(fill(1));service.recordExchangeFill(fill(2,true));service.onReconciledClose(p,'TP');
    const first=[...h.state.tradeRecords.values()][0];expect(first.entryQty).toBe(1);
    service.observeRemotePosition(p);service.recordExchangeFill(fill(3));service.recordExchangeFill(fill(4,true));service.onReconciledClose(p,'TP');
    const records=[...h.state.tradeRecords.values()];expect(records).toHaveLength(2);expect(records[0].cycleId).not.toBe(records[1].cycleId);
    expect(records[1].entryQty).toBe(1);expect(records[1].linkedFillIds).toEqual(expect.arrayContaining(['f3','f4']));expect(records[1].linkedFillIds).not.toContain('f1');
  });
  it('automatically persists fills/episodes, samples fresh quote timestamps and survives reopen',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-evidence-')),h=ready(),file=path.join(dir,'evidence.sqlite');
    let collector=new TradingQualityCollector(file,h.state,h.bus);
    try{
      h.exchange.placeEntry.mockImplementation(async(o:any)=>({...o,status:'WORKING',exchangeOrderId:'ex-quality'}));await h.run();
      const order=[...h.state.entryOrders.values()][0],positions=new PositionService(h.state,h.bus);
      const f={fillId:'f1',symbol:order.symbol,side:'BUY' as const,positionSide:'LONG' as const,orderId:'ex-quality',clientOrderId:order.clientOrderId!,tradeId:'t1',executionTime:h.now,qty:order.quantity/2,price:100,realizedPnl:0,commission:.01,commissionAsset:'USDT',maker:true};
      positions.recordExchangeFill(f);positions.recordExchangeFill(f);collector.tick(h.now);
      const first=collector.report().episodes[0];expect(first.fillIds).toHaveLength(1);expect(first.completeFillAt).toBeNull();expect(first.firstFillVwap).toBe(100);
      positions.recordExchangeFill({...f,fillId:'f2',tradeId:'t2',executionTime:h.now+1000,price:102});
      for(let dt=1000;dt<=35000;dt+=1000){h.m.quote.ts=h.now+dt;h.m.quote.mark=dt<10000?99:101;collector.tick(h.now+dt);}
      let ep=collector.report().episodes[0];expect(ep.completeFillAt).toBe(h.now+1000);expect(ep.firstFillVwap).toBe(100);expect(ep.fillVwap).toBe(101);
      expect(ep.path[0]).toMatchObject({coverage:'COMPLETE',sampleCount:31});expect(ep.path[0].maeBps).toBeCloseTo(100);
      expect(ep.path[1].coverage).toBe('IMMATURE');expect(ep.netPnl).toBeNull();
      collector.close();collector=new TradingQualityCollector(file,h.state,h.bus);collector.tick(h.now+40000);ep=collector.report().episodes[0];
      expect(ep.opportunityVersion).toBe(first.opportunityVersion);expect(ep.fillIds).toHaveLength(2);expect(collector.health().status).toBe('READY');
      expect(collector.report().funnel.candidates).toBeGreaterThan(0);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });
});
