import {describe,expect,it,vi} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';

const settings:any={takeProfit:{enabled:true,targetPriceMovePercent:.45,quantityPercent:100}};
const entry=(id:string,status:string,clientOrderId:string)=>({id,intentId:`intent-${id}`,cycleId:`cycle-${id}`,reservationId:null,clientOrderId,exchangeOrderId:`ex-${id}`,symbol:'BTCUSDT',side:'LONG',quantity:2,price:100,filledQuantity:0,leverage:5,status,createdAt:1,updatedAt:1,absoluteExpiresAt:1000,repriceCount:0,reachability:1});
describe('current open Entry order readback',()=>{
  it('keeps historical UNKNOWN out and maps exact remote activity to its local id',()=>{
    const state=new RuntimeState(settings),historical=entry('old','UNKNOWN','old-client'),local=entry('working','WORKING','working-client');
    state.entryOrders.set(historical.id,historical as any);state.entryOrders.set(local.id,local as any);
    const service:any=new ReconciliationService({fetchPositions:vi.fn(),fetchOpenOrders:vi.fn()} as any,state,new EventBus(),{ensure:vi.fn()} as any);
    service.lastFullOrderScanAt=Date.now();service.cachedOpenOrders=[{...local,id:local.clientOrderId,factSource:'BINANCE_OPEN_ORDERS',verifiedAt:service.lastFullOrderScanAt}];
    expect(service.currentOpenEntryOrders()).toMatchObject({status:'READY',items:[{id:'working',clientOrderId:'working-client'}]});
  });
  it('states when the last authoritative full scan is stale',()=>{
    const state=new RuntimeState(settings),service:any=new ReconciliationService({fetchPositions:vi.fn(),fetchOpenOrders:vi.fn()} as any,state,new EventBus(),{ensure:vi.fn()} as any);
    service.lastFullOrderScanAt=Date.now()-6*60_000;service.cachedOpenOrders=[];
    expect(service.currentOpenEntryOrders()).toMatchObject({status:'STALE',items:[]});
  });
});
