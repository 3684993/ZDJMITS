import {expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';

it('uses lean risk facts and does not full-scan UNKNOWN state every 15 seconds',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const state=new RuntimeState(SystemSettingsSchema.parse(defaults)),now=Date.now();
    state.entryOrders.set('entry_x',{id:'entry_x',clientOrderId:'ml_x',exchangeOrderId:'123',symbol:'XLMUSDT',side:'SHORT',quantity:10,price:1,filledQuantity:0,leverage:20,status:'UNKNOWN',createdAt:now-1000,updatedAt:now-500,absoluteExpiresAt:now+60_000,repriceCount:0,intentId:'i',reachability:1} as any);
    const adapter:any={fetchPositions:vi.fn(async()=>[]),fetchOpenOrders:vi.fn(async()=>[]),findEntryByClientOrderId:vi.fn(async()=>null),fetchSymbolTradeFacts:vi.fn(async()=>({fills:[],income:[],orders:[]})),fetchSymbolRiskFacts:vi.fn(async()=>({fills:[],orders:[]}))};
    const service=new ReconciliationService(adapter,state,new EventBus(),{ensure:vi.fn()} as any);
    await service.run();
    expect(adapter.fetchSymbolRiskFacts).toHaveBeenCalledOnce();expect(adapter.fetchSymbolTradeFacts).not.toHaveBeenCalled();expect(adapter.fetchOpenOrders).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);await service.run();
    expect(adapter.fetchOpenOrders).toHaveBeenCalledOnce();expect(adapter.fetchSymbolRiskFacts).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(45_001);await service.run();
    expect(adapter.fetchOpenOrders).toHaveBeenCalledTimes(2);expect(adapter.fetchSymbolRiskFacts).toHaveBeenCalledTimes(2);
  }finally{vi.useRealTimers();}
});
