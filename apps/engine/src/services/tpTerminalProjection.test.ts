import {expect,it,vi} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TpGuardian} from './tpGuardian.js';
import {exitRuntimeHarness} from './v396ExitTestHarness.js';

async function fixture(){
 const runtime=exitRuntimeHarness(),now=Date.now(),subject={symbol:'XLMUSDT',side:'SHORT' as const,cycleId:'cycle-1'};
 const prepared=await runtime.prepareTakeProfit({requestKey:'tp-1',subject,quantityUnits:10,limitPrice:1,now,positionVersion:1,settingsVersion:247,riskGeneration:1,availableReduceUnits:10,remainingUnits:10,minNotional:1,tickSize:.01,stepSize:1,proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:now,positionSide:'SHORT'}});
 expect(prepared.clientOrderId).toBeTruthy();
 const state=new RuntimeState({takeProfit:{enabled:true}} as any),order:any={id:'tp-1',positionId:'closed-position',cycleId:'cycle-1',clientOrderId:prepared.clientOrderId,exchangeOrderId:'123',symbol:'XLMUSDT',side:'BUY',quantity:10,filledQuantity:0,price:1,status:'WORKING',createdAt:now,updatedAt:now};
 state.tpOrders.set(order.id,order);
 const report=(status:string,filled:number)=>({symbol:order.symbol,clientOrderId:order.clientOrderId,exchangeOrderId:'123',positionSide:'SHORT',status,originalQuantity:10,executedQuantity:filled,updateTime:now+1});
 return {runtime,state,order,report,now};
}
for(const [status,filled] of [['FILLED',10],['CANCELED',2],['EXPIRED',0],['REJECTED',0]] as const){
 it(`propagates ${status} to local orphan and replays it after a stale checkpoint restore`,async()=>{
  const x=await fixture(),events=new EventBus(),publish=vi.spyOn(events,'publish');new TpGuardian(x.state,{} as any,events,x.runtime);
  x.runtime.recordExitOrderReport('USER_DATA_WS',x.report(status,filled),x.now+1);
  expect(x.state.tpOrders.get(x.order.id)).toMatchObject({status,filledQuantity:filled,quantity:10-filled});
  expect(x.runtime.claimFor(x.order.clientOrderId)?.status).toBe('RELEASED');
  x.runtime.recordExitOrderReport('USER_DATA_WS',x.report(status,filled),x.now+2);
  expect(publish.mock.calls.filter(c=>c[0]==='TP_TERMINAL_FACT_PROJECTED')).toHaveLength(1);
  const restored=new RuntimeState({takeProfit:{enabled:true}} as any);restored.tpOrders.set(x.order.id,{...x.order});new TpGuardian(restored,{} as any,new EventBus(),x.runtime);
  expect(restored.tpOrders.get(x.order.id)?.status).toBe(status);x.runtime.close();
 });
}
it('does not close a different exchange identity or cycle from retained terminal evidence',async()=>{
 const x=await fixture();x.runtime.recordExitOrderReport('EXACT_ORDER',x.report('FILLED',10),x.now+1);
 for(const override of [{exchangeOrderId:'other'},{cycleId:'other'},{symbol:'BTCUSDT'},{quantity:99}]){
  const state=new RuntimeState({takeProfit:{enabled:true}} as any);state.tpOrders.set(x.order.id,{...x.order,...override});new TpGuardian(state,{} as any,new EventBus(),x.runtime);expect(state.tpOrders.get(x.order.id)?.status).toBe('WORKING');
 }
 x.runtime.close();
});
