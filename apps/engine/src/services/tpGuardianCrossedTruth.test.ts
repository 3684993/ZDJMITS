import {expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TpGuardian} from './tpGuardian.js';
import { exitRuntimeHarness, manualJournalHarness, coordinatedExchange } from './v396ExitTestHarness.js';

function fixture(crossed:boolean){
  const state=new RuntimeState(SystemSettingsSchema.parse(defaults)),now=Date.now();
  const position:any={id:'p1',cycleId:'c1',symbol:'XLMUSDT',side:'SHORT',quantity:10,entryPrice:1,markPrice:.98,leverage:20,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:now-60_000,firstObservedAt:now-60_000,entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PROTECTED',tpOrderId:'tp1',tpLastVerifiedAt:now-120_000,tpCoverageSource:'BINANCE_OPEN_ORDER'};
  const tp:any={id:'tp1',clientOrderId:'tp_x',exchangeOrderId:'1',cycleId:'c1',positionId:'p1',symbol:'XLMUSDT',side:'BUY',quantity:10,price:.99,status:'WORKING',createdAt:now-180_000,updatedAt:now-120_000};
  state.positions.set(position.id,position);state.tpOrders.set(tp.id,tp);state.snapshots.set(position.symbol,{symbol:position.symbol,quote:{bid:.98,ask:crossed?.985:.995,mark:.98,last:.98,tickSize:.001,stepSize:1,minQty:1,minNotional:1,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{},orderBook:{bids:[],asks:[],ts:now},derivatives:{},dataCompleteness:1,listingAgeDays:100} as any);
  const exact=vi.fn(async()=>({...tp,status:'WORKING',updatedAt:Date.now()}));
  const exchange:any={...coordinatedExchange({liveQuantity:1e6}),findTakeProfitByClientOrderId:exact,cancelTakeProfit:vi.fn(),placeTakeProfit:vi.fn()};
  return{state,position,tp,exact,guardian:new TpGuardian(state,exchange,new EventBus(),exitRuntimeHarness())};
}

it('marks a crossed still-open TP pending and bounds exact verification to one request per 30s',async()=>{const x=fixture(true),previous=x.position.tpLastVerifiedAt;await x.guardian.ensure(x.position);await x.guardian.ensure(x.state.positions.get('p1')!);expect(x.exact).toHaveBeenCalledOnce();expect(x.state.positions.get('p1')).toMatchObject({tpStatus:'PENDING',tpOrderId:'tp1'});expect(x.state.positions.get('p1')!.tpLastVerifiedAt).toBeGreaterThan(previous);});

it('does not manufacture a new verification timestamp from an untouched local WORKING TP',async()=>{const x=fixture(false),previous=x.position.tpLastVerifiedAt;await x.guardian.ensure(x.position);expect(x.exact).not.toHaveBeenCalled();expect(x.state.positions.get('p1')).toMatchObject({tpStatus:'PROTECTED',tpOrderId:'tp1',tpLastVerifiedAt:previous});});


it.each(['CANCELED','EXPIRED','REJECTED'] as const)('retains exact remote %s after a lost TP ACK, including partial executions',async(status)=>{
 const x=fixture(false);x.state.tpOrders.clear();const runtime=exitRuntimeHarness();
 const placeTakeProfit=vi.fn(async()=>{throw new Error('Binance request timed out');});
 const findExitByClientOrderId=vi.fn(async(input:any)=>({state:'FOUND',order:{symbol:x.tp.symbol,clientOrderId:input.clientOrderId,exchangeOrderId:'terminal-1',status,originalQuantity:10,executedQuantity:2,updateTime:Date.now()}}));
 const exchange:any={...coordinatedExchange({liveQuantity:10}),placeTakeProfit,findExitByClientOrderId};
 const guardian=new TpGuardian(x.state,exchange,new EventBus(),runtime);
 const result=await guardian.place({...x.tp,status:'NEW'},{stepSize:1,tickSize:.001});
 expect(result).toMatchObject({status,filledQuantity:2});expect(runtime.task(result.clientOrderId!)?.state).toBe(status);
 expect(placeTakeProfit).toHaveBeenCalledOnce();expect(findExitByClientOrderId).toHaveBeenCalledOnce();
});

it.each([{symbol:'BTCUSDT'},{clientOrderId:'wrong_identity'},{originalQuantity:20},{executedQuantity:1.5},{exchangeOrderId:''},{positionSide:'LONG'}])('keeps mismatched exact recovery facts uncertain: %j',async(mismatch)=>{
 const x=fixture(false);x.state.tpOrders.clear();const runtime=exitRuntimeHarness(),placeTakeProfit=vi.fn(async()=>{throw new Error('Binance request timed out');});
 const findExitByClientOrderId=vi.fn(async(input:any)=>({state:'FOUND',order:{symbol:x.tp.symbol,clientOrderId:input.clientOrderId,exchangeOrderId:'terminal-1',status:'CANCELED',originalQuantity:10,executedQuantity:2,updateTime:Date.now(),...mismatch}}));
 const guardian=new TpGuardian(x.state,{...coordinatedExchange({liveQuantity:10}),placeTakeProfit,findExitByClientOrderId} as any,new EventBus(),runtime);
 await expect(guardian.place({...x.tp,status:'NEW'},{stepSize:1,tickSize:.001})).rejects.toThrow('TP_EXACT_RECOVERY_FACT_UNVERIFIED');
 const clientId=findExitByClientOrderId.mock.calls[0]![0].clientOrderId;expect(runtime.task(clientId)?.state).toBe('UNKNOWN');expect(x.state.tpOrders.get(x.tp.id)?.status).toBe('UNKNOWN');expect(placeTakeProfit).toHaveBeenCalledOnce();
});
