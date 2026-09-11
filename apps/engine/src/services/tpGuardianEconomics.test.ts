import { describe,expect,it,vi } from 'vitest';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { MockExchangeAdapter } from '../adapters/exchange/MockExchangeAdapter.js';
import { TpGuardian } from './tpGuardian.js';

const settings={takeProfit:{enabled:true,targetPriceMovePercent:.45,quantityPercent:100,tpEconomicsEnabled:true,minNetProfitUsd:5,minNetProfitRoiPct:0,feeSafetyBufferPct:10,exitFeeAssumption:'TAKER',slippageBufferPct:0,entryFeeRate:.0004,makerFeeRate:.0002,takerFeeRate:.0004}} as any;
const position=(id:string,markPrice:number)=>({id,symbol:'BTCUSDT',side:'LONG' as const,quantity:1,entryPrice:100,markPrice,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:Date.now(),firstObservedAt:Date.now(),entryTimeSource:'SYSTEM_FILL' as const,managementStatus:'AUTO_MANAGED' as const,humanManagedAt:null,tpStatus:'MISSING' as const,tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE' as const});
describe('TP economics enforcement',()=>{
  it('rejects an AI target that cannot meet the net floor and falls through to deterministic protection without chasing',async()=>{const state=new RuntimeState(settings),exchange=new MockExchangeAdapter(),place=vi.spyOn(exchange,'placeTakeProfit'),guardian=new TpGuardian(state,exchange,new EventBus()),pos:any={...position('ai',100),profitTakePlan:{targetPrice:102,acceptableTargetRange:{min:101,max:103},targetHorizonMinutes:30,targetReason:'closed structure',evidenceRefs:[]}};state.positions.set(pos.id,pos);const now=Date.now();state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{'15m':{isClosed:true,barCloseTime:now-1,lastClosedBar:{closeTime:now-1,close:100},atrPercent:.5,recentSwingHigh:102,recentSwingLow:98}}} as any);await guardian.ensure(pos);const first=state.tpOrders.get(state.positions.get(pos.id)!.tpOrderId!)!;await guardian.ensure(state.positions.get(pos.id)!);expect(first.price).toBeGreaterThanOrEqual(102);expect(place).toHaveBeenCalledTimes(1);expect(state.positions.get(pos.id)?.profitTakePlanSource).not.toBe('AI');});
  it('raises a target to the net-profit floor before creating TP',async()=>{const state=new RuntimeState(settings),exchange=new MockExchangeAdapter(),guardian=new TpGuardian(state,exchange,new EventBus()),pos=position('p',100);state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:Date.now()}} as any);await guardian.ensure(pos);const next=state.positions.get(pos.id)!;expect(next.tpStatus).toBe('PROTECTED');expect(next.tpEconomics?.expectedNetProfit).toBeGreaterThanOrEqual(next.tpEconomics?.requiredNetProfit??Infinity);expect(state.tpOrders.get(next.tpOrderId!)?.price).toBeGreaterThan(100.45);});
  it('recalculates a crossed target to a legal profitable maker TP',async()=>{const state=new RuntimeState(settings),exchange=new MockExchangeAdapter(),guardian=new TpGuardian(state,exchange,new EventBus()),pos=position('p',106);state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:106,mark:106,bid:105.9,ask:106.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:Date.now()}} as any);await guardian.ensure(pos);const next=state.positions.get(pos.id)!;expect(next.tpStatus).toBe('PROTECTED');expect(state.tpOrders.get(next.tpOrderId!)!.price).toBeGreaterThan(106.1);expect(next.tpEconomics!.expectedNetProfit).toBeGreaterThanOrEqual(next.tpEconomics!.requiredNetProfit);});
  it('recomputes the cost floor when quantity changes',()=>{const state=new RuntimeState(settings),guardian=new TpGuardian(state,new MockExchangeAdapter(),new EventBus()),one=guardian.economicsFor(position('p',100),105),two=guardian.economicsFor({...position('p',100),quantity:2},105);expect(two.requiredNetProfit).toBe(one.requiredNetProfit);expect(two.expectedNetProfit).toBeGreaterThan(one.expectedNetProfit);});
  it('deduplicates repair failures behind bounded backoff',async()=>{const state=new RuntimeState(settings),exchange=new MockExchangeAdapter(),guardian=new TpGuardian(state,exchange,new EventBus()),pos=position('p',100);state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:Date.now()}} as any);const place=vi.spyOn(exchange,'placeTakeProfit').mockRejectedValue(new Error('exchange unavailable'));await guardian.ensure(pos);await guardian.ensure(state.positions.get(pos.id)!);expect(place).toHaveBeenCalledTimes(1);expect(guardian.metrics().retryQueue).toBe(1);});
});


describe('V3.9 unknown TP submission',()=>{
  it('persists an uncertain identity and never retries it as a fresh TP after service recreation',async()=>{
    const state=new RuntimeState(settings),exchange=new MockExchangeAdapter(),events=new EventBus(),pos=position('unknown',100);
    state.positions.set(pos.id,pos);state.snapshots.set(pos.symbol,{quote:{mark:100,bid:99.99,ask:100.01,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5}} as any);
    const place=vi.spyOn(exchange,'placeTakeProfit').mockRejectedValue(new Error('response lost'));
    await new TpGuardian(state,exchange,events).ensure(pos);
    expect([...state.tpOrders.values()]).toHaveLength(1);expect([...state.tpOrders.values()][0]!.status).toBe('UNKNOWN');
    const restored=new TpGuardian(state,exchange,events);await restored.ensure(state.positions.get(pos.id)!,true);
    expect(place).toHaveBeenCalledOnce();expect(restored.metrics().protected).toBe(0);
  });
  it('does not count a PROTECTED label with missing or wrong-quantity order as coverage',()=>{
    const state=new RuntimeState(settings),p={...position('p',100),tpStatus:'PROTECTED' as const};state.positions.set(p.id,p);
    const guardian=new TpGuardian(state,new MockExchangeAdapter(),new EventBus());expect(guardian.metrics().protected).toBe(0);
    state.tpOrders.set('tp',{id:'tp',positionId:p.id,symbol:p.symbol,side:'SELL',quantity:.1,status:'WORKING'} as any);expect(guardian.metrics().protected).toBe(0);expect(guardian.metrics().qtyMismatch).toBe(1);
  });
});
