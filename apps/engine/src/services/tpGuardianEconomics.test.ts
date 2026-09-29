import { describe,expect,it,vi } from 'vitest';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { MockExchangeAdapter } from '../adapters/exchange/MockExchangeAdapter.js';
import { TpGuardian } from './tpGuardian.js';
import { PositionSchema } from '@zdj/contracts';
import { exitRuntimeHarness, manualJournalHarness, coordinatedExchange } from './v396ExitTestHarness.js';

const settings={takeProfit:{enabled:true,targetPriceMovePercent:.45,quantityPercent:100,tpEconomicsEnabled:true,minNetProfitUsd:5,minNetProfitRoiPct:0,feeSafetyBufferPct:10,exitFeeAssumption:'TAKER',slippageBufferPct:0,entryFeeRate:.0004,makerFeeRate:.0002,takerFeeRate:.0004}} as any;
const position=(id:string,markPrice:number)=>({cycleId:'cycle_test_1',id,symbol:'BTCUSDT',side:'LONG' as const,quantity:1,entryPrice:100,markPrice,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:Date.now(),firstObservedAt:Date.now(),entryTimeSource:'SYSTEM_FILL' as const,managementStatus:'AUTO_MANAGED' as const,humanManagedAt:null,tpStatus:'MISSING' as const,tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE' as const});
describe('TP economics enforcement',()=>{
  it('rejects an AI target that cannot meet the net floor and falls through to deterministic protection without chasing',async()=>{const state=new RuntimeState(settings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),place=vi.spyOn(exchange,'placeTakeProfit'),guardian=new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()),pos:any={...position('ai',100),profitTakePlan:{targetPrice:102,acceptableTargetRange:{min:101,max:103},targetHorizonMinutes:30,targetReason:'closed structure',evidenceRefs:[]}};state.positions.set(pos.id,pos);const now=Date.now();state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{'15m':{isClosed:true,barCloseTime:now-1,lastClosedBar:{closeTime:now-1,close:100},atrPercent:.5,recentSwingHigh:102,recentSwingLow:98}}} as any);await guardian.ensure(pos);const first=state.tpOrders.get(state.positions.get(pos.id)!.tpOrderId!)!;await guardian.ensure(state.positions.get(pos.id)!);expect(first.price).toBeGreaterThanOrEqual(102);expect(place).toHaveBeenCalledTimes(1);expect(state.positions.get(pos.id)?.profitTakePlanSource).not.toBe('AI');});
  it('keeps a legal evidence-backed AI TP inside its range and never chases an existing working TP',async()=>{const validSettings={...settings,takeProfit:{...settings.takeProfit,mode:'PRICE_MOVE_PERCENT',structureMinMovePercent:.45,structureMaxMovePercent:3,minNetProfitUsd:.01}},state=new RuntimeState(validSettings as any),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),place=vi.spyOn(exchange,'placeTakeProfit'),guardian=new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()),now=Date.now(),pos:any={...position('ai-valid',100),openedAt:now-1_000,profitTakePlan:{targetPrice:102,acceptableTargetRange:{min:101.5,max:102.5},targetHorizonMinutes:30,targetReason:'fresh closed 15m resistance',evidenceRefs:['15m:lastClosedBar']}};state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{'15m':{isClosed:true,barCloseTime:now-1,lastClosedBar:{closeTime:now-1,close:100},atrPercent:.5,recentSwingHigh:102,recentSwingLow:98}}} as any);await guardian.ensure(pos);const protectedPos=state.positions.get(pos.id)!,order=state.tpOrders.get(protectedPos.tpOrderId!)!;expect(order.price).toBe(102);expect(protectedPos.profitTakePlanSource).toBe('AI');state.snapshots.get(pos.symbol)!.quote.mark=103;state.snapshots.get(pos.symbol)!.quote.ask=103.1;await guardian.ensure(protectedPos);expect(state.tpOrders.get(protectedPos.tpOrderId!)!.price).toBe(102);expect(place).toHaveBeenCalledTimes(1);});
  it('allows a V3.9.5 economically-admitted AI TP below the legacy 1.2% distance floor',async()=>{
    const validSettings={...settings,takeProfit:{...settings.takeProfit,mode:'PRICE_MOVE_PERCENT',structureMinMovePercent:.45,structureMaxMovePercent:3,minNetProfitUsd:1}},state=new RuntimeState(validSettings as any),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),guardian=new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()),now=Date.now(),pos:any={...position('v395-ai',100),quantity:10,openedAt:now-1_000,economicAdmission:{version:'V3.9.5',mode:'ENFORCE',passed:true,validatedAt:now-2_000,expectedNetProfit:7,requiredNetProfit:1,reachProbability:.6,historicalHardMaxMovePercent:1.5,blockers:[]},profitTakePlan:{targetPrice:100.8,acceptableTargetRange:{min:100.7,max:100.9},targetHorizonMinutes:30,targetReason:'reachable economic target',evidenceRefs:['technical.15m.confirmed']}};
    state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{'15m':{isClosed:true,barCloseTime:now-1,lastClosedBar:{closeTime:now-1,close:100},atrPercent:.5,recentSwingHigh:101,recentSwingLow:99}}} as any);
    await guardian.ensure(pos);const protectedPos=state.positions.get(pos.id)!;expect(protectedPos.profitTakePlanSource).toBe('AI');expect(state.tpOrders.get(protectedPos.tpOrderId!)?.price).toBe(100.8);
  });
  it('raises a target to the net-profit floor before creating TP',async()=>{const state=new RuntimeState(settings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),guardian=new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()),pos=position('p',100);state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:Date.now()}} as any);await guardian.ensure(pos);const next=state.positions.get(pos.id)!;expect(next.tpStatus).toBe('PROTECTED');expect(next.tpEconomics?.expectedNetProfit).toBeGreaterThanOrEqual(next.tpEconomics?.requiredNetProfit??Infinity);expect(state.tpOrders.get(next.tpOrderId!)?.price).toBeGreaterThan(100.45);});
  it('recalculates a crossed target to a legal profitable maker TP',async()=>{const state=new RuntimeState(settings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),guardian=new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()),pos=position('p',106);state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:106,mark:106,bid:105.9,ask:106.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:Date.now()}} as any);await guardian.ensure(pos);const next=state.positions.get(pos.id)!;expect(next.tpStatus).toBe('PROTECTED');expect(state.tpOrders.get(next.tpOrderId!)!.price).toBeGreaterThan(106.1);expect(next.tpEconomics!.expectedNetProfit).toBeGreaterThanOrEqual(next.tpEconomics!.requiredNetProfit);});
  it('recomputes the cost floor when quantity changes',()=>{const state=new RuntimeState(settings),guardian=new TpGuardian(state,Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),new EventBus(),exitRuntimeHarness()),one=guardian.economicsFor(position('p',100),105),two=guardian.economicsFor({...position('p',100),quantity:2},105);expect(two.requiredNetProfit).toBe(one.requiredNetProfit);expect(two.expectedNetProfit).toBeGreaterThan(one.expectedNetProfit);});
  it('deduplicates repair failures behind bounded backoff',async()=>{const state=new RuntimeState(settings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),guardian=new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()),pos=position('p',100);state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:Date.now()}} as any);const place=vi.spyOn(exchange,'placeTakeProfit').mockRejectedValue(new Error('exchange unavailable'));await guardian.ensure(pos);await guardian.ensure(state.positions.get(pos.id)!);expect(place).toHaveBeenCalledTimes(1);expect(guardian.metrics().retryQueue).toBe(1);});
});


describe('V3.9.5 legacy position isolation',()=>{
  const shadowSettings={...settings,takeProfit:{...settings.takeProfit,mode:'PRICE_MOVE_PERCENT',structureMinMovePercent:.45,structureMaxMovePercent:3,minNetProfitUsd:1,minNetProfitRoiPct:0},tradeEconomics:{parameterProfile:'CUSTOM',admissionMode:'SHADOW',historicalTpReachabilityEnabled:true,minHistoricalReachProbability:.5,reachabilityLookbackBars:120,reachabilityMinSamples:30}} as any;
  const protectedLegacy=(id:string,managementStatus:'AUTO_MANAGED'|'HUMAN_MANAGED',tpPrice:number)=>({cycleId:'cycle_test_1',id,symbol:'BTCUSDT',side:'LONG' as const,quantity:10,entryPrice:100,markPrice:100.1,leverage:8,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:Date.now()-3_600_000,firstObservedAt:Date.now()-3_600_000,entryTimeSource:'SYSTEM_FILL' as const,managementStatus,humanManagedAt:managementStatus==='HUMAN_MANAGED'?Date.now()-1_000:null,tpStatus:'PROTECTED' as const,tpOrderId:'tp-legacy-'+id,tpLastVerifiedAt:Date.now(),tpCoverageSource:'BINANCE_OPEN_ORDER' as const,profitTakePlan:{targetPrice:tpPrice,acceptableTargetRange:{min:tpPrice-1,max:tpPrice+1},targetHorizonMinutes:60,targetReason:'legacy target',evidenceRefs:[]}});
  const snapshotAt=(now:number)=>({quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.99,ask:100.01,tickSize:.01,stepSize:.01,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{'15m':{isClosed:true,barCloseTime:now-1,lastClosedBar:{closeTime:now-1,close:100},atrPercent:.5,recentSwingHigh:101,recentSwingLow:99}}}) as any;
  it('never cancels, moves or rebuilds a legacy protected TP whose net profit is below the $1 floor',async()=>{
    const state=new RuntimeState(shadowSettings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),now=Date.now();
    const place=vi.spyOn(exchange,'placeTakeProfit'),cancel=vi.spyOn(exchange,'cancelTakeProfit');
    for(const managementStatus of ['AUTO_MANAGED','HUMAN_MANAGED'] as const){
      const pos:any=protectedLegacy('below-floor-'+managementStatus,managementStatus,100.05);
      state.positions.set(pos.id,pos);state.tpOrders.set(pos.tpOrderId,{id:pos.tpOrderId,positionId:pos.id,symbol:pos.symbol,side:'SELL',quantity:pos.quantity,price:100.05,status:'WORKING',createdAt:now,updatedAt:now} as any);
      state.snapshots.set(pos.symbol,snapshotAt(now));
    }
    const probe=new TpGuardian(state,Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),new EventBus(),exitRuntimeHarness());
    expect(probe.economicsFor(state.positions.get('below-floor-AUTO_MANAGED')!,100.05).expectedNetProfit).toBeLessThan(1);
    await new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()).sweep();
    expect(place).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();
    for(const id of ['below-floor-AUTO_MANAGED','below-floor-HUMAN_MANAGED']){
      const row=state.positions.get(id)!;
      expect(row.tpStatus).toBe('PROTECTED');expect(row.tpOrderId).toBe('tp-legacy-'+id);
      expect(state.tpOrders.get('tp-legacy-'+id)!.status).toBe('WORKING');expect(state.tpOrders.get('tp-legacy-'+id)!.price).toBe(100.05);
    }
    expect(state.positions.get('below-floor-HUMAN_MANAGED')!.managementStatus).toBe('HUMAN_MANAGED');
    expect(guardianMetricsUnchanged(state)).toBe(true);
  });
  it('P5: without a configured move floor a position keeps the 0.45% target instead of a hidden 1.2%',async()=>{
    const state=new RuntimeState(shadowSettings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),now=Date.now();
    const pos:any={...protectedLegacy('no-evidence','AUTO_MANAGED',100.8),tpStatus:'MISSING' as const,tpOrderId:null};
    state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,snapshotAt(now));
    await new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()).ensure(pos);
    const next=state.positions.get(pos.id)!;
    expect(next.tpStatus).toBe('PROTECTED');
    const placed=state.tpOrders.get(next.tpOrderId!)!;
    // The old build pushed any full position out to a 1.2% move; P5 made that a configured number and
    // the default is zero, so the deterministic fallback lands on the published 0.45% target move.
    expect(placed.price).toBeCloseTo(100.45,6);
    expect(placed.price).toBeLessThan(101.2);
    expect(next.tpEconomics?.targetProvenance?.minMoveFloorSource).toBe('DEFAULT_ZERO');
    expect(next.tpEconomics?.targetProvenance?.fellBackFrom).toBe('AI');
  });

  it('P5: an explicitly configured move floor is still honoured and is reported',async()=>{
    const state=new RuntimeState({...shadowSettings,takeProfit:{...shadowSettings.takeProfit,fullPositionMinMovePercent:1.2}}),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),now=Date.now();
    const pos:any={...protectedLegacy('no-evidence','AUTO_MANAGED',100.8),tpStatus:'MISSING' as const,tpOrderId:null};
    state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,snapshotAt(now));
    await new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()).ensure(pos);
    const next=state.positions.get(pos.id)!;
    expect(state.tpOrders.get(next.tpOrderId!)!.price).toBeGreaterThanOrEqual(101.2);
    expect(next.tpEconomics?.targetProvenance?.minMoveFloorSource).toBe('CONFIGURED');
  });

  it('P5: an authorized model target is not pushed away by the profit floor, and the shortfall is reported',async()=>{
    const state=new RuntimeState(shadowSettings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),now=Date.now();
    // A $5 notional position cannot net the configured $1 floor at its authorized 0.45% target.
    const pos:any={...protectedLegacy('authorized','AUTO_MANAGED',100.45),quantity:0.05,tpStatus:'MISSING' as const,tpOrderId:null,
      profitTakePlan:{targetPrice:100.45,acceptableTargetRange:{min:100.4,max:100.6},targetHorizonMinutes:120,targetReason:'STRUCTURE_MEASURED',evidenceRefs:['15m:closed']}};
    state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,snapshotAt(now));
    await new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness()).ensure(pos);
    const next=state.positions.get(pos.id)!;
    expect(next.profitTakePlanSource).toBe('AI');
    const economics=next.tpEconomics as any;
    expect(economics.expectedNetProfit).toBeLessThan(economics.requiredNetProfit);
    expect(economics.status).toBe('TP_LOW_NET_TARGET_KEPT');
    expect(economics.economicWarning).toMatchObject({shortfallUsd:expect.any(Number)});
    expect(economics.targetProvenance).toMatchObject({authorizedPresent:true,authorizedValid:true,authorizedPrice:100.45,finalPrice:100.45,fellBackFrom:null,profitFloorDisposition:'WARN_AND_KEEP'});
    // The row the guardian just wrote has to survive the durable schema. Positions are parsed on
    // startup, so an undeclared status or key here does not lose a field - it stops the Engine boot.
    const roundTrip=PositionSchema.parse(next);
    expect(roundTrip.tpEconomics?.status).toBe('TP_LOW_NET_TARGET_KEPT');
    expect(roundTrip.tpEconomics?.targetProvenance?.profitFloorDisposition).toBe('WARN_AND_KEEP');
    expect(roundTrip.tpEconomics?.targetProvenance?.authorizedPrice).toBe(100.45);
    expect(roundTrip.tpEconomics?.economicWarning).not.toBeNull();
  });
  const guardianMetricsUnchanged=(state:RuntimeState)=>{const active=[...state.tpOrders.values()].filter(o=>o.status==='WORKING');return active.length===state.positions.size;};
});

describe('V3.9 unknown TP submission',()=>{
  it('persists an uncertain identity and never retries it as a fresh TP after service recreation',async()=>{
    const state=new RuntimeState(settings),exchange=Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),events=new EventBus(),pos=position('unknown',100);
    state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{mark:100,bid:99.99,ask:100.01,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5}} as any);
    const place=vi.spyOn(exchange,'placeTakeProfit').mockRejectedValue(new Error('response lost'));
    await new TpGuardian(state,exchange,events,exitRuntimeHarness()).ensure(pos);
    expect([...state.tpOrders.values()]).toHaveLength(1);expect([...state.tpOrders.values()][0]!.status).toBe('UNKNOWN');
    const restored=new TpGuardian(state,exchange,events,exitRuntimeHarness());await restored.ensure(state.positions.get(pos.id)!,true);
    expect(place).toHaveBeenCalledOnce();expect(restored.metrics().protected).toBe(0);
  });
  it('does not count a PROTECTED label with missing or wrong-quantity order as coverage',()=>{
    const state=new RuntimeState(settings),p={...position('p',100),tpStatus:'PROTECTED' as const};state.positions.set(p.id,p);
    const guardian=new TpGuardian(state,Object.assign(new MockExchangeAdapter(),coordinatedExchange({liveQuantity:1e6})),new EventBus(),exitRuntimeHarness());expect(guardian.metrics().protected).toBe(0);
    state.tpOrders.set('tp',{id:'tp',positionId:p.id,symbol:p.symbol,side:'SELL',quantity:.1,status:'WORKING'} as any);expect(guardian.metrics().protected).toBe(0);expect(guardian.metrics().qtyMismatch).toBe(1);
  });
});
