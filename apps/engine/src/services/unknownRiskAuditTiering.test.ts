import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';
import {advanceRemoteRiskAudit,hasVerifiedNoActiveRisk,historicalNoRiskEligible,remoteRiskAudit,remoteRiskAuditDeferred,resetRemoteRiskAudit,riskFactHash,shouldEmitNoRiskEvent,UNKNOWN_RISK_AUDIT_PROMOTE_AFTER,UNKNOWN_RISK_EVIDENCE_TIER_MS} from './entryRiskOccupancy.js';

const settings=()=>SystemSettingsSchema.parse({...defaults,appearance:{...defaults.appearance,theme:'BINANCE_NOIR'}});
const NO_RISK_SOURCES=['BINANCE_EXACT_ORDER_NOT_FOUND','BINANCE_OPEN_ORDERS_IDENTITY_ABSENT','BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT','BINANCE_LONG_SHORT_POSITION_ZERO'];
const localOrder=(now:number,over:any={})=>({id:'entry_fet',intentId:'intent_fet',clientOrderId:'ml_fet',exchangeOrderId:null,symbol:'FETUSDT',side:'LONG',quantity:10,price:1,filledQuantity:0,leverage:10,status:'UNKNOWN',createdAt:now-60_000,updatedAt:now-50_000,absoluteExpiresAt:now+60_000,repriceCount:0,reservationId:'r_fet',cycleId:'cycle_fet',reachability:1,...over} as any);
const reservation=(now:number,status='WORKING')=>({id:'r_fet',underlying:'FET',quoteAsset:'USDT',marginUsd:1,notionalUsd:10,planId:'p',intentId:'intent_fet',createdAt:now-60_000,expiresAt:now+60_000,status} as any);

function fixture(now:number,orders:any[]=[localOrder(now)]){
  const state=new RuntimeState(settings()),events:any[]=[];
  for(const order of orders)state.entryOrders.set(order.id,order);
  state.entryReservations.set('r_fet',reservation(now));
  const bus=new EventBus();bus.on('event',event=>events.push(event));
  const adapter:any={fetchOpenOrders:vi.fn(async()=>[]),fetchPositions:vi.fn(async()=>[]),findEntryByClientOrderId:vi.fn(async()=>null),
    fetchSymbolRiskFacts:vi.fn(async()=>({fills:[],orders:[]})),fetchSymbolTradeFacts:vi.fn(async()=>({fills:[],income:[],orders:[]}))};
  const service=new ReconciliationService(adapter,state,bus,{ensure:vi.fn()} as any);
  const auditFacts=()=>adapter.fetchSymbolRiskFacts.mock.calls.length+adapter.fetchSymbolTradeFacts.mock.calls.length;
  const unverifiedEvents=()=>events.filter(event=>event.type==='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED').length;
  const pass=async()=>{(service as any).lastFullOrderScanAt=0;(service as any).lastUnknownRiskScanAt=0;await service.run();};
  return{state,events,adapter,service,auditFacts,unverifiedEvents,pass};
}

const order=async(x:any,id='entry_fet')=>x.state.entryOrders.get(id) as any;

describe('historical UNKNOWN remote risk audit tiering',()=>{
  beforeEach(()=>{vi.useFakeTimers({now:Date.now(),toFake:['Date']});});
  afterEach(()=>{vi.useRealTimers();});

  it('keeps tier 0 equal to the pre-tiering five minute evidence TTL',()=>{
    expect(UNKNOWN_RISK_EVIDENCE_TIER_MS[0]).toBe(5*60_000);
    expect(UNKNOWN_RISK_EVIDENCE_TIER_MS[UNKNOWN_RISK_EVIDENCE_TIER_MS.length-1]).toBe(30*60_000);
    expect(UNKNOWN_RISK_AUDIT_PROMOTE_AFTER).toBe(3);
  });

  it('audits a fresh UNKNOWN on every pass at the existing cadence',async()=>{
    const now=Date.now(),x=fixture(now);await x.pass();
    const row=await order(x),audit=remoteRiskAudit(row)!;
    expect(audit.tier).toBe(0);expect(audit.consecutive).toBe(1);
    expect(row.activeRiskEvidence.validUntil).toBe(now+5*60_000);
    expect(remoteRiskAuditDeferred(row,now+60_000)).toBe(false);
    expect(x.auditFacts()).toBe(1);
  });

  it('promotes a repeatedly identical historical no-risk proof into a longer audit interval',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();expect(x.auditFacts()).toBe(pass+1);}
    const row=await order(x),audit=remoteRiskAudit(row)!;
    expect(audit.consecutive).toBe(4);expect(audit.tier).toBe(1);
    expect(row.activeRiskEvidence.validUntil).toBeGreaterThan(Date.now()+10*60_000);
    expect(remoteRiskAuditDeferred(row,Date.now()+60_000)).toBe(true);
  });

  it('does not spend a remote audit on a promoted UNKNOWN before its next audit is due',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    const calls=x.auditFacts();
    for(let pass=0;pass<3;pass++){vi.advanceTimersByTime(60_000);await x.pass();}
    expect(x.auditFacts()).toBe(calls);
    expect((await order(x)).activeRiskExposure).toBe(false);
    expect(x.service.health().historicalUnknownCount).toBe(1);
  });

  it('never promotes a proof whose remote sources are incomplete',async()=>{
    const x=fixture(Date.now());
    x.adapter.fetchSymbolRiskFacts.mockResolvedValue({fills:[],orders:[]});
    await x.pass();
    const row=await order(x);
    row.activeRiskEvidence={...row.activeRiskEvidence,sources:row.activeRiskEvidence.sources.filter((source:string)=>source!=='BINANCE_USER_TRADES_IDENTITY_ABSENT')};
    x.state.entryOrders.set(row.id,row);
    expect(historicalNoRiskEligible(row,Date.now())).toBe(false);
    expect(remoteRiskAuditDeferred(row,Date.now()+60_000)).toBe(false);
  });

  it('reloads to fail-closed high frequency when the tombstone no longer matches',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    const promoted=await order(x);expect(remoteRiskAudit(promoted)!.tier).toBe(1);
    const tampered={...promoted,clientOrderId:'ml_rotted'};x.state.entryOrders.set(tampered.id,tampered);
    expect(hasVerifiedNoActiveRisk(tampered,Date.now())).toBe(false);
    expect(remoteRiskAuditDeferred(tampered,Date.now()+60_000)).toBe(false);
    const before=x.auditFacts();await x.pass();
    expect(x.auditFacts()).toBe(before+1);
    expect(remoteRiskAudit(await order(x))!.tier).toBe(0);
  });

  it('reactivates fail-closed when the identity reappears in open orders while deferred',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    expect(remoteRiskAudit(await order(x))!.tier).toBe(1);
    const remote={...localOrder(Date.now()),exchangeOrderId:'999',status:'WORKING',filledQuantity:0,factSource:'BINANCE_OPEN_ORDERS',verifiedAt:Date.now(),updatedAt:Date.now()} as any;
    x.adapter.fetchOpenOrders.mockResolvedValue([remote]);
    const calls=x.auditFacts();await x.pass();
    const row=await order(x);
    expect(row.status).toBe('WORKING');expect(row.activeRiskExposure).toBe(true);
    expect(x.auditFacts()).toBe(calls);
    expect(x.events.some(event=>event.type==='ENTRY_ORDER_NO_ACTIVE_RISK_CONFLICT')).toBe(true);
    expect(remoteRiskAudit(row)!.tier).toBe(0);
    expect(x.state.entryCapacity().inFlight).toBe(1);
  });

  it('reactivates fail-closed when a late user trade matches the deferred identity',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    x.adapter.fetchSymbolRiskFacts.mockResolvedValue({fills:[{clientOrderId:'ml_fet',orderId:'123',symbol:'FETUSDT',qty:10,price:1,executionTime:Date.now()}],orders:[]});
    vi.advanceTimersByTime(15*60_000+1_000);await x.pass();
    const row=await order(x);
    expect(row.activeRiskEvidence).toMatchObject({status:'CONFLICT',reason:'LATE_EXCHANGE_RISK_FACT_APPEARED'});
    expect(row.activeRiskEvidence.sources).toContain('USER_TRADES_IDENTITY_PRESENT');
    expect(row.activeRiskExposure).toBe(true);
    expect(remoteRiskAudit(row)!.tier).toBe(0);
    expect(x.state.entryCapacity().inFlight).toBe(1);
  });

  it('reactivates fail-closed when a position becomes attributable to the deferred entry cycle',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    const position={id:'exchange_FETUSDT_LONG',cycleId:'cycle_fet',symbol:'FETUSDT',side:'LONG',quantity:10,entryPrice:1,markPrice:1,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:Date.now(),firstObservedAt:Date.now(),entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PENDING',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE'} as any;
    x.state.positions.set(position.id,position);x.adapter.fetchPositions.mockResolvedValue([position]);
    vi.advanceTimersByTime(15*60_000+1_000);await x.pass();
    const row=await order(x);
    expect(row.activeRiskExposure).toBe(true);
    expect(row.activeRiskEvidence.sources).toContain('POSITION_ATTRIBUTED_TO_ENTRY');
    expect(remoteRiskAudit(row)!.tier).toBe(0);
  });

  it('emits one audit event per state change instead of one per identical pass',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    expect(x.unverifiedEvents()).toBe(2);
    // 6 further passes span ~3.1 h: only the hourly heartbeat and real tier changes may speak.
    for(let pass=0;pass<6;pass++){vi.advanceTimersByTime(30*60_000+1_000);await x.pass();}
    expect(x.unverifiedEvents()).toBeLessThanOrEqual(5);
    expect(x.unverifiedEvents()).toBeLessThan(10);
    const summary=x.events.filter(event=>event.type==='UNKNOWN_RISK_AUDIT_SUMMARY');
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.at(-1)!.payload).toMatchObject({auditsByTier:[expect.any(Number),expect.any(Number),expect.any(Number)]});
    expect(summary.at(-1)!.payload.tierIntervalMs).toEqual([...UNKNOWN_RISK_EVIDENCE_TIER_MS]);
  });

  it('publishes immediately when the verdict changes to conflict',async()=>{
    const x=fixture(Date.now());
    await x.pass();
    const first=(await order(x)).activeRiskEvidence;
    x.adapter.fetchSymbolRiskFacts.mockResolvedValue({fills:[{clientOrderId:'other',orderId:'77'}],orders:[{clientOrderId:'ml_fet',orderId:'88',symbol:'FETUSDT'}]});
    vi.advanceTimersByTime(5*60_000+1_000);await x.pass();
    expect((await order(x)).activeRiskEvidence).not.toMatchObject(first);
    const conflict=x.events.filter(event=>event.type==='ENTRY_ORDER_NO_ACTIVE_RISK_CONFLICT');
    expect(conflict.length).toBe(1);
    expect(conflict[0].payload).toMatchObject({failClosed:true,occupancyReleased:false});
  });

  it('cannot fail open after a restart when a persisted audit window outlives the proof',async()=>{
    const now=Date.now(),row={...localOrder(now),activeRiskExposure:false,
      activeRiskEvidence:{status:'VERIFIED_NO_ACTIVE_RISK',sources:NO_RISK_SOURCES,checkedAt:now-60*60_000,validUntil:now-30*60_000,identityTombstone:'ENTRY:FETUSDT:ml_fet',reason:'EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT'},
      remoteAudit:{tier:2,consecutive:9,nextAuditAt:now+20*60_000,factHash:riskFactHash({sources:NO_RISK_SOURCES,reason:'EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT'}),verifiedCount:9,lastAuditAt:now-60*60_000,lastEventAt:now-60*60_000,lastEmittedReason:'EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK'}} as any;
    const x=fixture(now,[row]);
    expect(hasVerifiedNoActiveRisk(row,now)).toBe(false);
    expect(remoteRiskAuditDeferred(row,now)).toBe(false);
    expect(x.state.entryCapacity().inFlight).toBe(1);
    await x.pass();
    expect(x.auditFacts()).toBe(1);
    const after=remoteRiskAudit(await order(x))!;
    expect(after.lastAuditAt).toBe(Date.now());
    expect(after.nextAuditAt).toBeGreaterThan(Date.now());
  });

  it('keeps releasing the durable claim for a deferred historical UNKNOWN',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(5*60_000+1_000);await x.pass();}
    x.state.entryReservations.set('r_fet',reservation(Date.now(),'WORKING'));
    vi.advanceTimersByTime(60_000);await x.pass();
    expect(x.state.entryReservations.get('r_fet')?.status).toBe('RELEASED');
    expect(x.state.entryCapacity()).toMatchObject({inFlight:0,used:0});
  });

  it('never drops a historical UNKNOWN row while deferring its audit',async()=>{
    const now=Date.now(),rows=[localOrder(now),localOrder(now,{id:'entry_gpt',clientOrderId:'ml_gpt',symbol:'GPTUSDT',intentId:'intent_gpt',reservationId:null})];
    const x=fixture(now,rows);
    for(let pass=0;pass<5;pass++){vi.advanceTimersByTime(6*60_000);await x.pass();}
    expect(x.service.health()).toMatchObject({historicalUnknownCount:2,activeRiskUnresolvedCount:0,verifiedNoActiveRiskUnknownCount:2,unresolvedDriftCount:0});
    expect(x.state.entryOrders.size).toBe(2);
  });

  it('audits a current submission at full frequency beside a deferred historical UNKNOWN',async()=>{
    const now=Date.now();
    const x=fixture(now,[localOrder(now,{id:'entry_old',clientOrderId:'ml_old',intentId:'intent_old',reservationId:null})]);
    for(let pass=0;pass<4;pass++){vi.advanceTimersByTime(6*60_000);await x.pass();}
    expect(remoteRiskAudit(await order(x,'entry_old'))!.tier).toBe(1);
    const fresh=localOrder(Date.now(),{id:'entry_new',clientOrderId:'ml_new',intentId:'intent_new',status:'SUBMITTING',reservationId:null});
    x.state.entryOrders.set(fresh.id,fresh);
    const calls=x.auditFacts(),unverified=x.unverifiedEvents();
    await x.pass();
    expect(x.auditFacts()).toBe(calls+1);
    expect(x.unverifiedEvents()).toBe(unverified+1);
    // Tier state is per order: the historical row stays deferred while the new identity is audited.
    expect(remoteRiskAudit(await order(x,'entry_old'))!.tier).toBe(1);
    expect(remoteRiskAuditDeferred(await order(x,'entry_old'),Date.now())).toBe(true);
    expect(remoteRiskAudit(await order(x,'entry_new'))!.tier).toBe(0);
    expect(remoteRiskAuditDeferred(await order(x,'entry_new'),Date.now())).toBe(false);
  });

  it('bounds retries when the audit request itself is blocked by the budget',async()=>{
    const x=fixture(Date.now());
    x.adapter.fetchSymbolRiskFacts.mockRejectedValue(new Error('BINANCE_TRANSPORT_BLOCKED:Binance request timed out'));
    await x.pass();
    expect(x.auditFacts()).toBe(1);
    const row=await order(x);
    expect(row.activeRiskExposure).toBe(true);
    expect(x.service.health()).toMatchObject({historicalUnknownCount:1,activeRiskUnresolvedCount:1,verifiedNoActiveRiskUnknownCount:0});
    await x.pass();
    expect(x.auditFacts()).toBe(2);
  });

  it('caps the worst-case active-risk detection latency at the highest tier interval',async()=>{
    const x=fixture(Date.now());
    for(let pass=0;pass<12;pass++){vi.advanceTimersByTime(31*60_000);await x.pass();}
    const row=await order(x),audit=remoteRiskAudit(row)!;
    expect(audit.tier).toBe(UNKNOWN_RISK_EVIDENCE_TIER_MS.length-1);
    expect(audit.nextAuditAt-audit.lastAuditAt).toBeLessThanOrEqual(UNKNOWN_RISK_EVIDENCE_TIER_MS.at(-1)!);
    const health=x.service.health();
    expect(health.unknownRiskAuditTierIntervalsMs).toEqual([...UNKNOWN_RISK_EVIDENCE_TIER_MS]);
    expect(health.unknownRiskLastAuditAt).toBe(audit.lastAuditAt);
    expect(health.unknownRiskNextAuditAt).toBe(audit.nextAuditAt);
  });

  it('exposes the audit state machine as pure predicates for the reconciliation caller',()=>{
    const now=1_000_000,fresh={sources:NO_RISK_SOURCES,reason:'R'};
    let audit=advanceRemoteRiskAudit(null,fresh,now);
    expect(audit).toMatchObject({tier:0,consecutive:1,nextAuditAt:now+5*60_000});
    audit=advanceRemoteRiskAudit(audit,fresh,now+5*60_000);expect(audit.consecutive).toBe(2);
    audit=advanceRemoteRiskAudit({...audit,nextAuditAt:now+10},fresh,now+20*60_000);expect(audit.consecutive).toBe(3);
    audit=advanceRemoteRiskAudit(audit,fresh,now+40*60_000);expect(audit.tier).toBe(1);
    audit=advanceRemoteRiskAudit(audit,{sources:[...NO_RISK_SOURCES,'EXTRA'],reason:'R'},now+70*60_000);
    expect(audit.consecutive).toBe(1);expect(audit.tier).toBe(0);
    const reset=resetRemoteRiskAudit(now);expect(reset).toMatchObject({tier:0,consecutive:0,nextAuditAt:now,factHash:null});
    expect(shouldEmitNoRiskEvent({} as any,audit,'REASON_X',now)).toBe(true);
    expect(shouldEmitNoRiskEvent({remoteAudit:{...audit,lastEventAt:now,lastEmittedReason:'REASON_X'}} as any,audit,'REASON_X',now+60_000)).toBe(false);
    expect(shouldEmitNoRiskEvent({remoteAudit:{...audit,lastEventAt:now,lastEmittedReason:'REASON_X'}} as any,audit,'REASON_Y',now+60_000)).toBe(true);
    expect(shouldEmitNoRiskEvent({remoteAudit:{...audit,lastEventAt:now,lastEmittedReason:'REASON_X'}} as any,audit,'REASON_X',now+61*60_000)).toBe(true);
  });
});
