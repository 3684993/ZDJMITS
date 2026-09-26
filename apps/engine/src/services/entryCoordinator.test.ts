import {getBinanceRequestBudget} from '../adapters/binance/requestBudget.js';
import { describe,expect,it,vi } from 'vitest';
import { RuntimeState } from '../state/runtimeState.js';import { EventBus } from '../events/eventBus.js';import { EntryCoordinator, RISK_ADMISSION_VERDICT_TTL_MS } from './entryCoordinator.js';import { PositionService } from './positionService.js';import type { EntryIntent,EntryOrder,SystemSettings } from '@zdj/contracts';
const settings={entry:{reviewIntervalSeconds:5,maxReprices:12,minReachability:.1,makerOffsetTicks:0},portfolio:{maxPendingEntries:6,maxPositions:12}} as unknown as SystemSettings;
const intent={id:'i',symbol:'BTCUSDT',side:'LONG',confidence:.8,idealPrice:100,acceptablePriceRange:{min:99,max:101},horizonMinutes:5,leverage:20,createdAt:1,absoluteExpiresAt:2,packetId:'p',brainRunId:'r'} as EntryIntent;
const order={id:'o',exchangeOrderId:'x',symbol:'BTCUSDT',side:'LONG',quantity:2,price:100,filledQuantity:.4,leverage:20,status:'PARTIALLY_FILLED',createdAt:1,updatedAt:1,absoluteExpiresAt:2,repriceCount:0,intentId:'i',reachability:.8} as EntryOrder;
describe('Entry Manager chain',()=>{
  it('cancels remaining quantity at the absolute TTL and persists confirmed exchange terminal facts before releasing risk',async()=>{const state=new RuntimeState(settings);state.entryIntents.set(intent.id,intent);state.entryOrders.set(order.id,order);state.entryReservations.set('r',{id:'r',underlying:'BTC',quoteAsset:'USDT',marginUsd:10,notionalUsd:100,planId:'p',createdAt:1,expiresAt:Date.now()+60_000,status:'WORKING'} as any);state.entryOrders.set(order.id,{...order,reservationId:'r'});const cancelEntry=vi.fn(async(o:EntryOrder)=>({...o,status:'CANCELED' as const}));const entry=new EntryCoordinator(state,{} as never,{} as never,{cancelEntry} as never,new EventBus());await entry.reviewPending();expect(cancelEntry).toHaveBeenCalledOnce();expect(state.entryOrders.get('o')).toMatchObject({status:'CANCELED',exchangeTerminalStatus:'CANCELED',activeRiskExposure:false,activeRiskEvidence:null});expect(state.entryReservations.get('r')?.status).toBe('RELEASED');});
  it('keeps UNKNOWN cancellation outcomes fail-closed and retains reservation occupancy',async()=>{const state=new RuntimeState(settings);state.entryIntents.set(intent.id,intent);state.entryOrders.set(order.id,{...order,reservationId:'r'});state.entryReservations.set('r',{id:'r',underlying:'BTC',quoteAsset:'USDT',marginUsd:10,notionalUsd:100,planId:'p',createdAt:1,expiresAt:Date.now()+60_000,status:'WORKING'} as any);const cancelEntry=vi.fn(async(o:EntryOrder)=>({...o,status:'UNKNOWN' as const}));const entry=new EntryCoordinator(state,{} as never,{} as never,{cancelEntry} as never,new EventBus());await entry.reviewPending();expect(state.entryOrders.get('o')).toMatchObject({status:'UNKNOWN',exchangeTerminalStatus:'UNKNOWN',activeRiskExposure:true,activeRiskEvidence:null});expect(state.entryReservations.get('r')?.status).toBe('WORKING');expect(state.entryCapacity()).toMatchObject({inFlight:1});});
  it('opens only the actually filled partial quantity',()=>{const state=new RuntimeState(settings);const position=new PositionService(state,new EventBus()).onEntryFilled(order);expect(position.quantity).toBe(.4);expect(state.account.availableUsd).toBe(0);});
  it('keeps the single-flight compatibility hook open while cooldown remains per candidate',()=>{const state=new RuntimeState(settings);const entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus());expect((entry as any).cadenceReady(Date.now())).toBe(true);});
  it('isolates a failed symbol lifecycle without blocking another ready symbol',()=>{const state=new RuntimeState(settings);const entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus());(entry as any).transition('USELESSUSDT','AI_FAILURE_COOLDOWN','AI_SCHEMA_INVALID',{nextEligibleAt:Date.now()+1000});expect((entry as any).lifecycleRunnable('USELESSUSDT')).toBe(false);expect((entry as any).lifecycleRunnable('BULLAUSDT')).toBe(true);});
  it('recovers an accepted-but-disconnected submit by stable client id without a second order',async()=>{const state=new RuntimeState(settings),remote=new Map<string,EntryOrder>(),placeEntry=vi.fn(async(o:EntryOrder)=>{remote.set(o.clientOrderId!,{...o,status:'WORKING',exchangeOrderId:'exchange-1'});throw new Error('socket disconnected');}),findEntryByClientOrderId=vi.fn(async(o:EntryOrder)=>remote.get(o.clientOrderId!)??null),entry=new EntryCoordinator(state,{} as never,{} as never,{placeEntry,findEntryByClientOrderId} as never,new EventBus());(entry as any).executionHardBlock=()=>null;const liveIntent={...intent,id:'stable-intent',absoluteExpiresAt:Date.now()+60_000,aiAuthorizationExpiresAt:Date.now()+60_000,reservationId:'r'} as EntryIntent,prepared=(entry as any).preparedOrder(liveIntent,1,100,.8);const placed=await (entry as any).submitExactlyOnce(liveIntent,prepared);expect(placed.exchangeOrderId).toBe('exchange-1');expect(placeEntry).toHaveBeenCalledOnce();expect(prepared.clientOrderId).toBe((entry as any).preparedOrder(liveIntent,1,100,.8).clientOrderId);});
  it('keeps the same order identity across restart recovery from UNKNOWN',async()=>{const state=new RuntimeState(settings),ids:string[]=[],remote=new Map<string,EntryOrder>(),adapter={placeEntry:vi.fn(async(o:EntryOrder)=>{ids.push(o.clientOrderId!);throw new Error('timeout');}),findEntryByClientOrderId:vi.fn(async(o:EntryOrder)=>remote.get(o.clientOrderId!)??null)},first=new EntryCoordinator(state,{} as never,{} as never,adapter as never,new EventBus());(first as any).executionHardBlock=()=>null;const liveIntent={...intent,id:'restart-intent',absoluteExpiresAt:Date.now()+60_000,aiAuthorizationExpiresAt:Date.now()+60_000,reservationId:'r'} as EntryIntent,prepared=(first as any).preparedOrder(liveIntent,1,100,.8);await expect((first as any).submitExactlyOnce(liveIntent,prepared)).rejects.toThrow('ENTRY_SUBMISSION_UNKNOWN');const persisted=JSON.parse(JSON.stringify(state.entryOrders.get(prepared.id))) as EntryOrder;remote.set(persisted.clientOrderId!,{...persisted,status:'WORKING',exchangeOrderId:'exchange-after-restart'});const restarted=new EntryCoordinator(state,{} as never,{} as never,adapter as never,new EventBus());(restarted as any).executionHardBlock=()=>null;const recovered=await (restarted as any).submitExactlyOnce(liveIntent,persisted);expect(recovered.exchangeOrderId).toBe('exchange-after-restart');expect(ids).toEqual([persisted.clientOrderId]);});
  it.each(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'])('blocks a new Primary for the occupied underlying while remote status is %s',status=>{const state=new RuntimeState(settings),entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus());state.entryOrders.set('remote',{...order,status,symbol:'BTCUSDT'} as EntryOrder);expect((entry as any).primaryOccupancyBlock('BTCUSDC')).toBe('UNDERLYING_ENTRY_EXISTS');expect((entry as any).stopPrimaryForOccupancy('BTCUSDC','AFTER_PRIMARY_SLOT')).toBe(true);expect(state.candidateLifecycle.get('BTCUSDC')).toMatchObject({status:'ENTRY_WORKING',reason:'UNDERLYING_ENTRY_EXISTS'});});
  it('clears a previous run attribution when a new Primary lease starts',()=>{const state=new RuntimeState(settings),entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus());state.candidateLifecycle.set('BTCUSDT',{symbol:'BTCUSDT',status:'READY',runId:'airun_old'} as any);(entry as any).transition('BTCUSDT','PRIMARY_QUEUED','WAITING_PRIMARY_SLOT');expect(state.candidateLifecycle.get('BTCUSDT')).toMatchObject({runId:null,previousRunId:'airun_old'});});
  it('keeps Primary idle until its BTC and ETH EIP regime dependencies exist',()=>{const state=new RuntimeState(settings),entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus());state.snapshots.set('XRPUSDC',{} as any);expect((entry as any).eipDependenciesPresent('XRPUSDC')).toBe(false);state.snapshots.set('BTCUSDT',{} as any);state.snapshots.set('ETHUSDT',{} as any);expect((entry as any).eipDependenciesPresent('XRPUSDC')).toBe(true);});
});

it('terminates an unsent prepared order when capacity changes before the wire call',async()=>{const state=new RuntimeState(settings),placeEntry=vi.fn(),entry=new EntryCoordinator(state,{} as never,{} as never,{placeEntry} as never,new EventBus());(entry as any).executionHardBlock=()=> 'RISK_MAX_POSITIONS';const prepared=(entry as any).preparedOrder(intent,1,100,1);await expect((entry as any).submitExactlyOnce(intent,prepared)).rejects.toThrow('RISK_MAX_POSITIONS');expect(state.entryOrders.get(prepared.id)).toMatchObject({status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'});expect(placeEntry).not.toHaveBeenCalled();});

it('fails the final Entry guard under Binance pressure before checking allocation facts',()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=getBinanceRequestBudget('TESTNET','entry-guard-test');budget.observe(200,'2300',undefined);
 const state=new RuntimeState(settings),entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus());expect((entry as any).executionHardBlock(intent)).toBe('BINANCE_BUDGET_SATURATED');
 }finally{vi.useRealTimers();}
});


describe('Primary trigger provenance',()=>{
  it('retains the release cause through queue/start and replaces it at the next READY',()=>{
    const state=new RuntimeState(settings),entry=new EntryCoordinator(state,{} as never,{} as never,{} as never,new EventBus()),move=(status:string,reason:string)=>(entry as any).transition('BTCUSDT',status,reason);
    expect(move('PRIMARY_QUEUED','SCHEDULER_DISPATCH').triggerReason).toBe('FIRST_REVIEW');
    move('READY','PERMISSION_CHANGED');move('PRIMARY_QUEUED','SCHEDULER_DISPATCH');
    expect(move('PRIMARY_RUNNING','PRIMARY_START').triggerReason).toBe('PERMISSION_CHANGED');
    move('READY','DECISION_CONTEXT_CHANGED');move('PRIMARY_QUEUED','WAITING_PRIMARY_SLOT');
    expect(move('PRIMARY_RUNNING','PRIMARY_START').triggerReason).toBe('DECISION_CONTEXT_CHANGED');
  });
});

describe('A: the current risk-admission verdict is bounded and self-clearing',()=>{
  const coordinator=()=>new EntryCoordinator(new RuntimeState(settings),{} as never,{} as never,{} as never,new EventBus());
  it('records the leading reason and its full set for the newest cycle only',()=>{
    const entry=coordinator();
    (entry as any).recordRiskAdmissionVerdict('PORTFOLIO_RISK_ADMISSION','HUMAN_ACK_OVERDUE',
      ['HUMAN_ACK_OVERDUE','HUMAN_ACK_OVERDUE','HUMAN_POTENTIAL_NOTIONAL_LIMIT'],['MAX_GROSS_NOTIONAL'],'TAOUSDT','run-1','plan-1');
    const verdict=entry.riskAdmissionVerdict(Date.now());
    expect(verdict).toMatchObject({code:'HUMAN_ACK_OVERDUE',stage:'PORTFOLIO_RISK_ADMISSION',symbol:'TAOUSDT',brainRunId:'run-1',allocationPlanId:'plan-1'});
    expect(verdict?.reasons).toEqual(['HUMAN_ACK_OVERDUE','HUMAN_POTENTIAL_NOTIONAL_LIMIT']);
  });
  it('expires so an old refusal can never stay the primary reason, and a cleared verdict reads as none',()=>{
    const entry=coordinator();
    (entry as any).recordRiskAdmissionVerdict('PORTFOLIO_RISK_ADMISSION','HUMAN_POTENTIAL_NOTIONAL_LIMIT',['HUMAN_POTENTIAL_NOTIONAL_LIMIT'],[],'WLDUSDT',null,'plan-2');
    expect(entry.riskAdmissionVerdict(Date.now()+RISK_ADMISSION_VERDICT_TTL_MS+1)).toBeNull();
    expect(entry.riskAdmissionVerdict(Date.now()+RISK_ADMISSION_VERDICT_TTL_MS-1_000)).not.toBeNull();
    (entry as any).state.lastRiskAdmissionVerdict=null;
    expect(entry.riskAdmissionVerdict(Date.now())).toBeNull();
  });
});
