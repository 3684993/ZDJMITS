import {afterEach,describe,expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TpGuardian} from './tpGuardian.js';
import { exitRuntimeHarness, manualJournalHarness, coordinatedExchange } from './v396ExitTestHarness.js';

const settings=()=>SystemSettingsSchema.parse({...defaults,appearance:{...defaults.appearance,theme:'BINANCE_NOIR'}});
const position=(now:number)=>({id:'exchange_TESTUSDT_LONG',cycleId:'cycle_new',symbol:'TESTUSDT',side:'LONG',quantity:10,entryPrice:100,markPrice:100,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:now-60_000,firstObservedAt:now-60_000,entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'MISSING',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE'} as any);
const unknownTp=(now:number)=>({id:'tp_old',clientOrderId:'tp_old_client',exchangeOrderId:null,cycleId:'cycle_old',positionId:'exchange_TESTUSDT_LONG',symbol:'TESTUSDT',side:'SELL',quantity:10,price:101,status:'UNKNOWN',createdAt:now-60_000,updatedAt:now-60_000} as any);

afterEach(()=>{vi.useRealTimers();});

describe('UNKNOWN TP recovery',()=>{
  it('settles an orphan UNKNOWN TP only from an exact terminal exchange fact',async()=>{
    const now=Date.now(),state=new RuntimeState(settings()),bus=new EventBus(),events:any[]=[];bus.on('event',event=>events.push(event));
    const old=unknownTp(now);state.tpOrders.set(old.id,old);
    const exact=vi.fn(async()=>({...old,status:'FILLED',quantity:0,filledQuantity:10,exchangeOrderId:'exchange-99',updatedAt:now+1}));
    const report=vi.fn();
    const guardian=new TpGuardian(state,{findTakeProfitByClientOrderId:exact} as any,bus,{recordExitOrderReport:report} as any);
    await guardian.sweep();
    expect(state.tpOrders.get(old.id)).toMatchObject({status:'FILLED',quantity:0,filledQuantity:10,exchangeOrderId:'exchange-99'});
    expect(report).toHaveBeenCalledWith('EXACT_ORDER',expect.objectContaining({clientOrderId:old.clientOrderId,originalQuantity:10,executedQuantity:10,status:'FILLED'}),expect.any(Number));
    expect(events.some(event=>event.type==='TP_ORPHAN_TERMINAL_CONVERGED')).toBe(true);
    await guardian.sweep();expect(exact).toHaveBeenCalledTimes(1);
  });
  it('retains an orphan UNKNOWN TP when the exact exchange identity is absent',async()=>{
    const now=Date.now(),state=new RuntimeState(settings()),bus=new EventBus(),old=unknownTp(now);state.tpOrders.set(old.id,old);
    const report=vi.fn(),guardian=new TpGuardian(state,{findTakeProfitByClientOrderId:vi.fn(async()=>null)} as any,bus,{recordExitOrderReport:report} as any);
    await guardian.sweep();expect(state.tpOrders.get(old.id)?.status).toBe('UNKNOWN');expect(report).not.toHaveBeenCalled();
  });
  it('does not turn repeated absence into terminal proof for an uncertain write',async()=>{
    vi.useFakeTimers();const now=1_800_000_000_000;vi.setSystemTime(now);
    const state=new RuntimeState(settings()),bus=new EventBus(),events:any[]=[];bus.on('event',event=>events.push(event));const pos=position(now);state.positions.set(pos.id,pos);state.tpOrders.set('tp_old',unknownTp(now));
    state.snapshots.set('TESTUSDT',{symbol:'TESTUSDT',timestamp:now,quote:{bid:100,ask:100.1,mark:100,tickSize:.1,stepSize:.001,minQty:.001},technical:{}} as any);
    const exchange:any={...coordinatedExchange({liveQuantity:1e6}),findTakeProfitByClientOrderId:vi.fn(async()=>null),placeTakeProfit:vi.fn(async(order:any)=>({...order,exchangeOrderId:'new-exchange-id',status:'WORKING',updatedAt:Date.now()})),cancelTakeProfit:vi.fn()};
    const guardian=new TpGuardian(state,exchange,bus,exitRuntimeHarness());
    await guardian.ensure(pos);expect(exchange.findTakeProfitByClientOrderId).toHaveBeenCalledTimes(1);expect(exchange.placeTakeProfit).not.toHaveBeenCalled();expect(state.tpOrders.get('tp_old')?.status).toBe('UNKNOWN');expect(events.some(event=>event.type==='TP_UNKNOWN_ABSENCE_OBSERVED')).toBe(true);
    vi.setSystemTime(now+16_000);await guardian.ensure(state.positions.get(pos.id)!);expect(exchange.findTakeProfitByClientOrderId).toHaveBeenCalledTimes(2);expect(state.tpOrders.get('tp_old')?.status).toBe('UNKNOWN');expect(exchange.placeTakeProfit).not.toHaveBeenCalled();expect(events.some(event=>event.type==='TP_UNKNOWN_CONFIRMED_ABSENT')).toBe(false);
  });
  it('keeps UNKNOWN fail-closed when exact verification throws',async()=>{
    vi.useFakeTimers();const now=1_800_000_000_000;vi.setSystemTime(now);const state=new RuntimeState(settings()),bus=new EventBus(),events:any[]=[];bus.on('event',event=>events.push(event));const pos=position(now);state.positions.set(pos.id,pos);state.tpOrders.set('tp_old',unknownTp(now));
    const exchange:any={...coordinatedExchange({liveQuantity:1e6}),findTakeProfitByClientOrderId:vi.fn(async()=>{throw new Error('BINANCE_REQUEST_QUEUE_TIMEOUT');}),placeTakeProfit:vi.fn(),cancelTakeProfit:vi.fn()};const guardian=new TpGuardian(state,exchange,bus,exitRuntimeHarness());await guardian.ensure(pos);expect(state.tpOrders.get('tp_old')?.status).toBe('UNKNOWN');expect(exchange.placeTakeProfit).not.toHaveBeenCalled();expect(events.some(event=>event.type==='TP_UNKNOWN_VERIFY_FAILED')).toBe(true);
  });
});
