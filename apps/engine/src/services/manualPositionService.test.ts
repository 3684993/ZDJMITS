import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SystemSettingsSchema } from '@zdj/contracts';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { ManualPositionService } from './manualPositionService.js';
import { exitRuntimeHarness, manualJournalHarness, coordinatedExchange } from './v396ExitTestHarness.js';

async function fixture(){
  const raw=JSON.parse(await readFile(path.resolve(process.cwd(),'../..','config/settings.default.json'),'utf8'));
  raw.appearance={...raw.appearance,theme:'BINANCE_NOIR'};raw.connections.executionMode='TESTNET_ENABLED';
  const state=new RuntimeState(SystemSettingsSchema.parse(raw));state.account={...state.account,status:'READY',reason:null};
  const position:any={cycleId:'cycle_test_1',id:'exchange_FXSUSDT_SHORT',symbol:'FXSUSDT',side:'SHORT',quantity:1572.1,entryPrice:.31,markPrice:.30,leverage:5,unrealizedPnl:15.721,unrealizedPnlPercent:16,openedAt:Date.now(),firstObservedAt:Date.now(),entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PROTECTED',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'SYSTEM_CREATED'};
  state.positions.set(position.id,position);
  const quote={symbol:'FXSUSDT',last:.3,mark:.3,bid:.299,ask:.301,tickSize:.001,stepSize:.1,minQty:.1,minNotional:5,quoteVolumeUsd24h:1_000_000,priceChangePercent24h:0,tradeCount24h:100,ts:Date.now()};
  const exchange:any={...coordinatedExchange({liveQuantity:1e6}),fetchPositions:vi.fn(async()=>[{...position,quantity:1572.1}]),placeManualOrder:vi.fn(async(request:any)=>({id:request.internalOrderId,intentId:request.internalOrderId,clientOrderId:request.clientOrderId,exchangeOrderId:'exchange-manual-1',positionId:'',symbol:request.symbol,side:request.side,positionSide:request.positionSide,type:request.type,quantity:request.quantity,price:request.price,reduceOnly:request.reduceOnly,postOnly:request.postOnly,status:'WORKING',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now()}))};
  const market:any={snapshot:vi.fn(()=>undefined),cachedQuote:vi.fn(()=>undefined),freshQuote:vi.fn(async()=>quote),contractRules:vi.fn(async()=>({tickSize:quote.tickSize,stepSize:quote.stepSize,minQty:quote.minQty,minNotional:quote.minNotional}))};
  const tpOrder:any={id:'tp-existing',clientOrderId:'tp-existing',exchangeOrderId:'tp-exchange',positionId:position.id,symbol:position.symbol,side:'BUY',quantity:position.quantity,price:.29,status:'WORKING',createdAt:Date.now(),updatedAt:Date.now()};state.tpOrders.set(tpOrder.id,tpOrder);position.tpOrderId=tpOrder.id;
  const tp:any={suspend:vi.fn(),resume:vi.fn(),cancel:vi.fn(async(order:any)=>({...order,status:'CANCELED'})),place:vi.fn(),ensure:vi.fn(async()=>{})};
  return{state,position,quote,exchange,market,tp,reconcile:vi.fn(async()=>{})};
}

describe('Manual cache-only preview',()=>{
  it('uses a fresh zero-I/O cached WS quote without calling REST fallback',async()=>{
    const x=await fixture();x.market.cachedQuote.mockReturnValue(x.quote);
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const preview=await service.preview(x.position.id,true);
    expect(preview.emergency).toMatchObject({positionQty:1572.1,side:'BUY',limitPrice:.301,quoteSource:'WS'});
    expect(x.market.freshQuote).not.toHaveBeenCalled();
  });
});
describe('Manual stale-market tolerance',()=>{
  it('keeps preview available from stale cache and labels it as non-live',async()=>{
    const x=await fixture(),stale={...x.quote,ts:Date.now()-60_000};x.market.cachedQuote.mockReturnValue(stale);
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const preview=await service.preview(x.position.id,true);
    expect(preview).toMatchObject({quoteSource:'STALE_CACHE',quoteStale:true});
    expect(preview.warnings.join(' ')).toContain('行情缓存已过期');
    expect(x.market.freshQuote).not.toHaveBeenCalled();
  });
  it('allows an explicit manual limit to use recent cached contract filters when live quote REST fails',async()=>{
    const x=await fixture(),stale={...x.quote,ts:Date.now()-60_000};x.market.cachedQuote.mockReturnValue(stale);x.market.freshQuote.mockRejectedValue(new Error('REST unavailable'));
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const result=await service.execute(x.position.id,{action:'PLACE_LIMIT',quantity:100,price:.305,idempotencyKey:'stale-explicit-limit'});
    expect(result.intent.status).toBe('SUBMITTED');
    expect(x.exchange.placeManualOrder).toHaveBeenCalledWith(expect.objectContaining({symbol:'FXSUSDT',price:.305,quantity:100,reduceOnly:true}));
  });
  it('allows an explicit manual limit with no quote at all when authoritative contract filters are available',async()=>{
    const x=await fixture();x.market.cachedQuote.mockReturnValue(undefined);x.market.freshQuote.mockRejectedValue(new Error('REST quote unavailable'));
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const result=await service.execute(x.position.id,{action:'PLACE_LIMIT',quantity:100,price:.305,idempotencyKey:'static-rules-explicit-limit'});
    expect(result.intent.status).toBe('SUBMITTED');expect(x.market.contractRules).toHaveBeenCalledWith('FXSUSDT');
    expect(x.exchange.placeManualOrder).toHaveBeenCalledWith(expect.objectContaining({price:.305,quantity:100,reduceOnly:true}));
  });
  it('still fails closed for an automatic-price emergency close when no live quote exists',async()=>{
    const x=await fixture(),stale={...x.quote,ts:Date.now()-60_000};x.market.cachedQuote.mockReturnValue(stale);x.market.freshQuote.mockRejectedValue(new Error('REST unavailable'));
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    await expect(service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'needs-live-price'})).rejects.toThrow('MARKET_DATA_UNAVAILABLE');
  });
});
describe('Manual emergency close',()=>{
  it('uses REST fresh quote when the WS snapshot is unavailable and produces a full-position short BUY preview',async()=>{
    const x=await fixture(),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const preview=await service.preview(x.position.id);
    expect(preview.emergency).toMatchObject({positionQty:1572.1,side:'BUY',limitPrice:.301,quoteSource:'REST'});
  });
  it('refreshes remote position and quote on confirmation, ignores stale form values, and only submits reduce-only LIMIT',async()=>{
    const x=await fixture(),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,quantity:1,price:.9,idempotencyKey:'ec-confirm'});
    expect(x.exchange.placeManualOrder).toHaveBeenCalledWith(expect.objectContaining({symbol:'FXSUSDT',side:'BUY',positionSide:'SHORT',type:'LIMIT',quantity:1572.1,price:.301,reduceOnly:true,postOnly:false}));
    expect(x.reconcile).toHaveBeenCalledOnce();
  });
  it('fails closed when neither a fresh WS quote nor REST quote exists',async()=>{
    const x=await fixture();x.market.freshQuote.mockRejectedValue(new Error('REST unavailable'));
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    await expect(service.preview(x.position.id)).rejects.toThrow('MARKET_DATA_UNAVAILABLE');
    expect(x.exchange.placeManualOrder).not.toHaveBeenCalled();
  });
  it.each([
    ['gross and net loss',.3009],
    ['gross profit but fee-adjusted net loss',.3011],
  ])('allows confirmed human close with %s while keeping reduce-only LIMIT',async(_case,entryPrice)=>{
    const x=await fixture();x.position.entryPrice=entryPrice;x.exchange.fetchPositions.mockResolvedValue([{...x.position}]);
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const result=await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:`loss-${entryPrice}`});
    expect(result.intent.status).toBe('SUBMITTED');
    expect(x.exchange.placeManualOrder).toHaveBeenCalledWith(expect.objectContaining({side:'BUY',type:'LIMIT',quantity:1572.1,price:.301,reduceOnly:true,postOnly:false}));
  });
  it('allows a confirmed losing LONG close and never reverses the position',async()=>{
    const x=await fixture();Object.assign(x.position,{id:'exchange_FXSUSDT_LONG',side:'LONG',entryPrice:.31,tpOrderId:'tp-existing'});x.state.positions.clear();x.state.positions.set(x.position.id,x.position);const tp=[...x.state.tpOrders.values()][0]!;Object.assign(tp,{positionId:x.position.id,side:'SELL'});x.exchange.fetchPositions.mockResolvedValue([{...x.position}]);
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'loss-long'});
    expect(x.exchange.placeManualOrder).toHaveBeenCalledWith(expect.objectContaining({side:'SELL',positionSide:'LONG',quantity:x.position.quantity,reduceOnly:true}));
  });
  it('serializes concurrent clicks before refresh and submits exactly once',async()=>{
    const x=await fixture();let release!:(value:any)=>void;const pending=new Promise(resolve=>{release=resolve;});x.exchange.placeManualOrder.mockImplementation(async(request:any)=>pending.then(()=>({id:request.internalOrderId,intentId:'',clientOrderId:request.clientOrderId,exchangeOrderId:'one',positionId:'',symbol:request.symbol,side:request.side,positionSide:request.positionSide,type:'LIMIT',quantity:request.quantity,price:request.price,reduceOnly:true,postOnly:false,status:'WORKING',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now()})));
    const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()),first=service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'click-a'});await vi.waitFor(()=>expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce());const second=service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'click-b'});release(null);await first;expect((await second).replayed).toBe(true);expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();
  });
  it('replays an idempotency key without recanceling TP or resubmitting',async()=>{
    const x=await fixture(),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()),input={action:'EMERGENCY_CLOSE' as const,confirm:true,idempotencyKey:'same-key'};await service.execute(x.position.id,input);const replay=await service.execute(x.position.id,input);expect(replay.replayed).toBe(true);expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();expect(x.tp.cancel).toHaveBeenCalledOnce();
  });
  it('recovers a lost submission response by exact clientOrderId and forbids duplicate submit',async()=>{
    const x=await fixture();x.exchange.placeManualOrder.mockRejectedValue(new Error('timeout after write'));x.exchange.findManualByClientOrderId=vi.fn(async(request:any)=>({id:request.internalOrderId,intentId:'',clientOrderId:request.clientOrderId,exchangeOrderId:'recovered',positionId:x.position.id,symbol:request.symbol,side:request.side,positionSide:request.positionSide,type:'LIMIT',quantity:request.quantity,price:request.price,reduceOnly:true,postOnly:false,status:'WORKING',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now()}));const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()),input={action:'EMERGENCY_CLOSE' as const,confirm:true,idempotencyKey:'lost-response'};const first=await service.execute(x.position.id,input),replay=await service.execute(x.position.id,input);expect(first.intent.status).toBe('SUBMITTED');expect(replay.replayed).toBe(true);expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();expect(x.exchange.findManualByClientOrderId).toHaveBeenCalledOnce();
  });
  it('records UNKNOWN on an unprovable timeout and never retries that key',async()=>{
    const x=await fixture();x.exchange.placeManualOrder.mockRejectedValue(new Error('timeout'));x.exchange.findManualByClientOrderId=vi.fn(async()=>null);const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()),input={action:'EMERGENCY_CLOSE' as const,confirm:true,idempotencyKey:'unknown-submit'};const first=await service.execute(x.position.id,input),replay=await service.execute(x.position.id,input);expect(first.intent.status).toBe('UNKNOWN');expect(first.order.status).toBe('UNKNOWN');expect(replay.replayed).toBe(true);expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();expect(x.tp.ensure).toHaveBeenCalled();
  });
  it('restores TP protection after a definite exchange rejection',async()=>{
    const x=await fixture();x.exchange.placeManualOrder.mockRejectedValue(new Error('rejected'));x.exchange.findManualByClientOrderId=vi.fn(async(request:any)=>({id:request.internalOrderId,intentId:'',clientOrderId:request.clientOrderId,exchangeOrderId:'rejected',positionId:x.position.id,symbol:request.symbol,side:request.side,positionSide:request.positionSide,type:'LIMIT',quantity:request.quantity,price:request.price,reduceOnly:true,postOnly:false,status:'REJECTED',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now()}));const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());await expect(service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'rejected-submit'})).rejects.toThrow('EXCHANGE_ORDER_REJECTED');expect(x.tp.resume).toHaveBeenCalled();expect(x.tp.ensure).toHaveBeenCalledWith(expect.objectContaining({id:x.position.id}),true);
  });
  it('keeps a partial fill submitted and rebuilds protection for the remaining position',async()=>{
    const x=await fixture();x.exchange.placeManualOrder.mockImplementation(async(request:any)=>({id:request.internalOrderId,intentId:'',clientOrderId:request.clientOrderId,exchangeOrderId:'partial',positionId:x.position.id,symbol:request.symbol,side:request.side,positionSide:request.positionSide,type:'LIMIT',quantity:request.quantity,price:request.price,reduceOnly:true,postOnly:false,status:'PARTIALLY_FILLED',filledQuantity:500,createdAt:Date.now(),updatedAt:Date.now()}));x.reconcile.mockImplementation(async()=>{x.state.positions.set(x.position.id,{...x.position,quantity:1072.1});});const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()),result=await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'partial'});expect(result.intent.status).toBe('SUBMITTED');expect(x.tp.ensure).toHaveBeenCalledWith(expect.objectContaining({quantity:1072.1}),true);
  });
  it('marks completion only after reconciliation proves the position is gone',async()=>{
    const x=await fixture();x.exchange.placeManualOrder.mockImplementation(async(request:any)=>({id:request.internalOrderId,intentId:'',clientOrderId:request.clientOrderId,exchangeOrderId:'filled',positionId:x.position.id,symbol:request.symbol,side:request.side,positionSide:request.positionSide,type:'LIMIT',quantity:request.quantity,price:request.price,reduceOnly:true,postOnly:false,status:'FILLED',filledQuantity:request.quantity,createdAt:Date.now(),updatedAt:Date.now()}));x.reconcile.mockImplementation(async()=>{x.state.positions.delete(x.position.id);});const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()),result=await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'filled'});expect(result.intent.status).toBe('COMPLETED');expect(x.tp.ensure).not.toHaveBeenCalled();
  });
});


describe('persistent human full-close goals',()=>{
  it('cancels an old partial close, refreshes remainder and submits exactly one continuation',async()=>{
    const x=await fixture(),bus=new EventBus(),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,bus,x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    const first=await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'goal'});
    const old=x.state.manualOrders.get(first.order.id)!;old.createdAt=Date.now()-31000;
    x.exchange.cancelManualOrder=vi.fn(async(o:any)=>({...o,status:'CANCELED',filledQuantity:572.1}));
    x.exchange.fetchPositions.mockResolvedValue([{...x.position,quantity:1000}]);
    await service.resumeExitGoals();expect(x.exchange.cancelManualOrder).toHaveBeenCalledOnce();expect(x.exchange.placeManualOrder).toHaveBeenCalledTimes(2);expect(x.exchange.placeManualOrder.mock.calls[1][0].quantity).toBe(1000);
    const serialized=x.state.serialize();expect(serialized.manualExitGoals).toHaveLength(1);
    await new ManualPositionService(x.state,x.market,x.exchange,x.tp,bus,x.reconcile,manualJournalHarness() as any,exitRuntimeHarness()).resumeExitGoals();expect(x.exchange.placeManualOrder).toHaveBeenCalledTimes(2);
    x.state.manualExitGoals.get(x.position.id)!.nextAttemptAt=0;x.exchange.fetchPositions.mockResolvedValue([]);await service.resumeExitGoals();expect(x.state.manualExitGoals.size).toBe(0);
  });
  it('keeps a close queued when cancellation of an existing add is unknown',async()=>{
    const x=await fixture(),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
    // Historical add imported from before V3.9.8: new ADD requests are now forbidden.
    x.state.manualOrders.set('old-add',{id:'old-add',intentId:'old-add',clientOrderId:'old-add',symbol:x.position.symbol,side:'SELL',positionSide:'SHORT',quantity:100,filledQuantity:0,status:'UNKNOWN',createdAt:Date.now(),updatedAt:Date.now()} as any);
    x.state.manualIntents.set('old-add',{id:'old-add',positionId:x.position.id,action:'ADD',idempotencyKey:'old-add'} as any);
    x.exchange.cancelManualOrder=vi.fn(async(o:any)=>({...o,status:'UNKNOWN'}));
    const close=await service.execute(x.position.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'close'});expect(close.reason).toBe('EXIT_QUEUED_BEHIND_ACTIVE_TASK');
    await service.resumeExitGoals();expect(x.exchange.placeManualOrder).not.toHaveBeenCalled();expect(x.state.manualExitGoals.get(x.position.id)?.lastReason).toBe('WAITING_EXACT_CANCEL_CONFIRMATION');
  });
});

it('rejects even confirmed HUMAN ADD before takeover, quote refresh, TP cancel or exchange writes',async()=>{
 const x=await fixture(),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,new EventBus(),x.reconcile,manualJournalHarness() as any,exitRuntimeHarness());
 await expect(service.execute(x.position.id,{action:'ADD',confirm:true,quantity:100,idempotencyKey:'forbidden-add'})).rejects.toThrow('NO_SEPARATE_ADD');
 expect(x.position.managementStatus).toBe('AUTO_MANAGED');expect(x.state.manualIntents.size).toBe(0);
 expect(x.exchange.placeManualOrder).not.toHaveBeenCalled();expect(x.exchange.fetchPositions).not.toHaveBeenCalled();
 expect(x.market.freshQuote).not.toHaveBeenCalled();expect(x.tp.cancel).not.toHaveBeenCalled();expect(x.tp.suspend).not.toHaveBeenCalled();
});
