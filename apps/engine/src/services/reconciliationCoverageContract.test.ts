import {describe,it,expect,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';

/**
 * Releasing active-risk capacity for an UNKNOWN Entry is only as good as the coverage proof
 * behind the negative answer. These cases pin the strict contract added in V3.9.6: a reader
 * that omits, short-reports or declares its window incomplete must keep the Entry occupying
 * capacity, even when every list it returned is empty. The releasing case echoes the
 * requested window back, exactly as the production adapter does.
 */
const settings=()=>SystemSettingsSchema.parse({...defaults,appearance:{...defaults.appearance,theme:'BINANCE_NOIR'}});
const emptyFacts={fills:[],income:[],orders:[]};

function harness(facts:(start:number,end:number)=>any){
  const now=Date.now();
  const state=new RuntimeState(settings());
  const events:any[]=[];
  state.entryOrders.set('entry_cov',{id:'entry_cov',clientOrderId:'ml_cov',exchangeOrderId:'777',symbol:'ATOMUSDT',side:'LONG',quantity:5,price:1,filledQuantity:0,leverage:10,status:'UNKNOWN',createdAt:now-1000,updatedAt:now-500,absoluteExpiresAt:now+60_000,repriceCount:0,intentId:'intent_cov',reservationId:'r_cov',reachability:1} as any);
  state.entryReservations.set('r_cov',{id:'r_cov',underlying:'ATOM',quoteAsset:'USDT',marginUsd:1,notionalUsd:5,planId:'p',intentId:'intent_cov',createdAt:now-1000,expiresAt:now+60_000,status:'WORKING'} as any);
  const bus=new EventBus();
  bus.on('event',event=>events.push(event));
  const adapter:any={fetchOpenOrders:vi.fn(async()=>[]),fetchPositions:vi.fn(async()=>[]),findEntryByClientOrderId:vi.fn(async()=>null),fetchSymbolTradeFacts:vi.fn(async(_symbol:string,start:number,end:number)=>facts(start,end))};
  return{now,state,events,adapter,service:new ReconciliationService(adapter,state,bus,{ensure:vi.fn()} as any)};
}

function stillOccupied(x:ReturnType<typeof harness>){
  expect(x.state.entryOrders.get('entry_cov') as any).toMatchObject({status:'UNKNOWN',activeRiskExposure:true});
  expect(x.state.entryReservations.get('r_cov')?.status).toBe('WORKING');
  expect(x.service.health().verifiedNoActiveRiskUnknownCount).toBe(0);
}

describe('no-active-risk coverage contract',()=>{
  it('fails closed when the reader reports no coverage window at all',async()=>{
    const x=harness(()=>({...emptyFacts,coverageComplete:true}));
    await x.service.run();
    stillOccupied(x);
    expect((x.state.entryOrders.get('entry_cov') as any).activeRiskEvidence).toBeFalsy();
    expect(x.events.some(event=>event.type==='ENTRY_ORDER_RISK_FACT_COVERAGE_INCOMPLETE'&&event.payload?.failClosed===true)).toBe(true);
  });

  it('fails closed when the reported window stops before the audit instant',async()=>{
    const x=harness((start,end)=>({...emptyFacts,coverageComplete:true,coverageStart:start,coverageEnd:end-5_000}));
    await x.service.run();
    stillOccupied(x);
  });

  it('fails closed when the reader declares its own window incomplete',async()=>{
    const x=harness((start,end)=>({...emptyFacts,coverageComplete:false,coverageStart:start,coverageEnd:end}));
    await x.service.run();
    stillOccupied(x);
  });

  it('fails closed when the reader starts later than the requested coverage',async()=>{
    const x=harness((start,end)=>({...emptyFacts,coverageComplete:true,coverageStart:start+60_000,coverageEnd:end}));
    await x.service.run();
    stillOccupied(x);
  });

  it('fails closed when the reader throws, including a request-budget exhaustion',async()=>{
    const x=harness(()=>{throw new Error('HISTORY_REQUEST_BUDGET_EXCEEDED');});
    await x.service.run();
    stillOccupied(x);
    expect(x.events.some(event=>event.type==='ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED')).toBe(true);
  });

  it('releases capacity only when the reader proves the window through the audit instant',async()=>{
    const x=harness((start,end)=>({...emptyFacts,coverageComplete:true,coverageStart:start,coverageEnd:end}));
    await x.service.run();
    const order:any=x.state.entryOrders.get('entry_cov');
    expect(order).toMatchObject({status:'UNKNOWN',exchangeTerminalStatus:'UNKNOWN',activeRiskExposure:false,activeRiskEvidence:{status:'VERIFIED_NO_ACTIVE_RISK'}});
    expect(order.activeRiskEvidence.sources).toEqual(expect.arrayContaining(['BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT','BINANCE_LONG_SHORT_POSITION_ZERO']));
    expect(x.state.entryReservations.get('r_cov')?.status).toBe('RELEASED');
    expect(x.service.health()).toMatchObject({historicalUnknownCount:1,activeRiskUnresolvedCount:0,verifiedNoActiveRiskUnknownCount:1});
  });
});
