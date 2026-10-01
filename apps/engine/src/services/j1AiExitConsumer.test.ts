import {describe,expect,it,vi} from 'vitest';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {EngineRuntime} from '../runtime/appRuntime.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {V396ExitRuntime,exitSubjectFromPosition} from './v396ExitRuntime.js';
import {AiExitAuthorityService} from './aiExitAuthority.js';
import {V396AiExitRunner,type AiExitPlanFacts} from './v396AiExitRunner.js';
import {assembleExitCostFacts} from './s03ExitCostFacts.js';
import {ONE_WAY_CAPABILITIES} from './v396ExitTestHarness.js';
import type {AdapterCapabilities} from './s04ExitCoordinator.js';

/**
 * J1: the AI exit consumer. What is being proved here is not that a model can price an exit, but
 * that nothing reaches the exchange unless the authority, the durable plan and every cost fact are
 * present - and that a refused or unacknowledged pass cannot be repeated into a second order.
 */

const any=(value:unknown)=>value as any;
const CAPS:AdapterCapabilities=ONE_WAY_CAPABILITIES;
const identity={environment:'TESTNET',account:'binance-primary'};
const CYCLE='cycle_ai_1';
const SCOPE=JSON.stringify([identity.environment,identity.account,'BTCUSDT','LONG']);

const settingsFor=(authority:'OFF'|'SHADOW'|'ENFORCE')=>({
  settingsVersion:20,
  connections:{exchange:{...identity,recvWindowMs:5_000}},
  positionManagement:{humanHandoffAfterMinutes:60,lossHandoffBars:4},
  takeProfit:{entryFeeRate:.0004,enabled:true,takerFeeRate:.0004,makerFeeRate:.0002,exitFeeAssumption:'TAKER',slippageBufferPct:.05,feeSafetyBufferPct:.02,minNetProfitUsd:.2,quantityPercent:100,structureMaxMovePercent:6},
  riskGovernance:{exitCoordination:{aiExitAuthority:authority,aiExitLossLimitUsd:10,aiExitMinNetProfitUsd:.2,aiExitAllowSmallLoss:true,aiExitAuthorizationTtlMs:15_000,
    continuousConvergenceEnabled:true,convergenceIntervalMs:120_000,convergenceBatchLimit:8}},
});

function fixture(authority:'OFF'|'SHADOW'|'ENFORCE',over:{plan?:AiExitPlanFacts|null;commissionUsd?:number|null;fundingStatus?:string;depth?:number|null;deadlineMinutes?:number;planRef?:string|null}={}){
  const now=Date.now();
  const state=new RuntimeState(any(settingsFor(authority)));
  state.runtimeControl={capital:{generation:11,evaluatedAt:now,nextRecheckAt:now+300_000}} as never;
  const position=any({id:'p1',symbol:'BTCUSDT',side:'LONG',quantity:10,entryPrice:100,markPrice:99.9,leverage:5,openedAt:now-600_000,firstObservedAt:now-600_000,
    cycleId:CYCLE,managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PROTECTED',profitTakePlan:null});
  state.positions.set('p1',position);
  // P6: depth is now walked from the real order book, so the fixture supplies one instead of the
  // `quote.depthNotionalUsd` field no production path ever filled.
  const bookQuantity=over.depth===null?0:Number(over.depth??50_000)/99.9;
  state.snapshots.set('BTCUSDT',{symbol:'BTCUSDT',quote:{symbol:'BTCUSDT',last:99.95,mark:99.9,bid:99.9,ask:100.1,tickSize:.1,stepSize:1,minQty:1,minNotional:5,ts:now-500},
    orderBook:{symbol:'BTCUSDT',ts:now-400,sequence:1,bids:[[99.9,bookQuantity],[99.8,bookQuantity]],asks:[[100.1,bookQuantity],[100.2,bookQuantity]]}} as never);
  state.executionFills.push(any({fillId:'f1',tradeId:'t1',orderId:'eo1',clientOrderId:'ec1',cycleId:CYCLE,symbol:'BTCUSDT',direction:'LONG',side:'BUY',positionSide:'LONG',
    executionTime:now-600_000,qty:10,price:100,realizedPnl:0,commission:.4,commissionAsset:'USDT',commissionUsd:over.commissionUsd===undefined?.4:over.commissionUsd,maker:true,source:'EXCHANGE_AUDIT',attributionStatus:'SYSTEM_ATTRIBUTED'}));
  state.tradeRecords.set('tr1',any({tradeId:'tr1',symbol:'BTCUSDT',cycleId:CYCLE,status:'OPEN',direction:'LONG',quantity:10,entryAveragePrice:100,
    funding:.02,fundingAttributionStatus:over.fundingStatus??'EXACT'}));
  const exitRuntime=new V396ExitRuntime(':memory:',()=>identity,async()=>CAPS,()=>({aiExitAuthority:authority,intervalMs:120_000,batchLimit:8,continuousEnabled:true}));
  const events=new EventBus();
  const published:string[]=[];
  events.on('event',event=>published.push(event.type));
  const subject=exitSubjectFromPosition(position);
  if(authority!=='OFF')exitRuntime.fixManagementDeadline(subject,(over.deadlineMinutes??60)*60_000,now-600_000,over.planRef===null?null:(over.planRef??'plan_ai_1'));
  const placeManualOrder=vi.fn(async(order:any)=>({...order,status:'NEW',filledQuantity:0,exchangeOrderId:'xo1',updatedAt:Date.now()}));
  const proveReduction=vi.fn(async()=>({kind:'ONE_WAY_REDUCE_ONLY' as const,checkedAt:Date.now(),positionSide:'LONG' as const,liveQuantity:10}));
  const findExitByClientOrderId=vi.fn(async()=>({state:'ABSENT' as const,reason:'-2013'}));
  const adapter=any({placeManualOrder,proveReduction,findExitByClientOrderId,placeTakeProfit:vi.fn(),cancelTakeProfit:vi.fn()});
  const authorityService=new AiExitAuthorityService(exitRuntime,()=>authority);
  const plan:AiExitPlanFacts|null=over.plan===undefined?{planRef:'plan_ai_1',planVersion:3,thesisInvalid:true,invalidationPredicate:'STRUCTURE_BREAK_15M',
    invalidationEvidenceRefs:['ev_bar_close'],exitConditionMet:false,minNetProfitUsd:.2}:over.plan;
  const runner=new V396AiExitRunner({state,events,exitRuntime,authority:authorityService,adapter,planOf:()=>plan,identity:()=>identity});
  return {now,state,position,subject,exitRuntime,events,published,runner,placeManualOrder,proveReduction,findExitByClientOrderId,authorityService,adapter};
}

describe('J1 S03 cost fact assembly',()=>{
  it('refuses to price an exit whose fee, funding or record facts are missing',()=>{
    const base=fixture('ENFORCE');
    const source=(over:Record<string,unknown>={})=>({
      now:base.now,scope:SCOPE,cycleId:CYCLE,symbol:'BTCUSDT',side:'LONG' as const,positionVersion:1,remainingQuantityUnits:10,stepSize:1,tickSize:.1,minNotional:5,
      entryPrice:100,bid:99.9,ask:100.1,quoteAt:base.now-500,expiresAt:base.now+15_000,rateMaxAgeMs:60_000,costVersion:'cost-1',quoteAsset:'USDT',fx:null,
      record:[...base.state.tradeRecords.values()][0],fills:[...base.state.executionFills],
      fees:{takerRate:.0004,makerRate:.0002,assumption:'TAKER' as const,uncertaintyBufferBps:5},depthNotionalUsd:50_000,...over,
    });
    expect(assembleExitCostFacts(source()).ready).toBe(true);
    expect(assembleExitCostFacts(source({record:null})).blockers).toContain('CYCLE_RECORD_UNPROVEN');
    expect(assembleExitCostFacts(source({fills:base.state.executionFills.map(fill=>({...fill,cycleId:'other_cycle'}))})).blockers
      .join('|')).toMatch(/FOREIGN_CYCLE_FACT|ENTRY_FILL_UNPROVEN/);
    const noFee=assembleExitCostFacts(source({fills:base.state.executionFills.map(fill=>({...fill,commissionUsd:null}))}));
    expect(noFee.ready).toBe(false);
    expect(noFee.blockers).toContain('ENTRY_FEE_UNKNOWN');
    expect(noFee.statuses.entryFee).toBe('UNKNOWN');
    const unknownFunding=assembleExitCostFacts(source({record:{...[...base.state.tradeRecords.values()][0],fundingAttributionStatus:'UNKNOWN',funding:null}}));
    expect(unknownFunding.blockers).toContain('FUNDING_ATTRIBUTION_UNKNOWN');
    expect(assembleExitCostFacts(source({depthNotionalUsd:null})).blockers).toContain('EXIT_DEPTH_INSUFFICIENT');
    expect(assembleExitCostFacts(source({depthNotionalUsd:5})).blockers).toContain('EXIT_DEPTH_INSUFFICIENT');
    expect(assembleExitCostFacts(source({fees:null})).blockers).toContain('FEE_MODEL_UNPROVEN');
    const foreignRecord=assembleExitCostFacts(source({record:{...[...base.state.tradeRecords.values()][0],cycleId:'other'}}));
    expect(foreignRecord.blockers.join('|')).toMatch(/FOREIGN_CYCLE_FACT:record/);
  });

  it('treats a proven absence of exit fills as zero, not as an unknown',()=>{
    const base=fixture('ENFORCE');
    const facts=assembleExitCostFacts({now:base.now,scope:SCOPE,cycleId:CYCLE,symbol:'BTCUSDT',side:'LONG',positionVersion:1,remainingQuantityUnits:10,
      stepSize:1,tickSize:.1,minNotional:5,entryPrice:100,bid:99.9,ask:100.1,quoteAt:base.now-500,expiresAt:base.now+15_000,rateMaxAgeMs:60_000,
      costVersion:'cost-1',quoteAsset:'USDT',fx:null,record:[...base.state.tradeRecords.values()][0],fills:[...base.state.executionFills],
      fees:{takerRate:.0004,makerRate:.0002,assumption:'TAKER',uncertaintyBufferBps:5},depthNotionalUsd:50_000});
    expect(facts.ready).toBe(true);
    expect(facts.coverage.exitFills).toBe(0);
    expect(facts.statuses.gross).toBe('EXACT');
    const items=facts.input!.items.filter(row=>row.kind==='REALIZED_GROSS'||row.kind==='PRIOR_EXIT_FEE');
    expect(items.map(row=>row.status)).toEqual(['EXACT','EXACT']);
    expect(items.map(row=>row.amount??0).reduce((a,b)=>a+b,0)).toBe(0);
  });
});

describe('J1 AI exit consumer',()=>{
  it('OFF performs no proof, no decision and no exchange write',async()=>{
    const x=fixture('OFF');
    const report=await x.runner.tick();
    expect(report).toMatchObject({authority:'OFF',considered:0,evaluated:0,prepared:0,submitted:0});
    expect(x.placeManualOrder).not.toHaveBeenCalled();
    expect(x.proveReduction).not.toHaveBeenCalled();
    expect(x.exitRuntime.tasksNeedingQuery()).toHaveLength(0);
  });

  it('a legacy AUTO_MANAGED position without a durable AI owner is never considered',async()=>{
    const x=fixture('ENFORCE',{planRef:null});
    expect(x.exitRuntime.owner(x.subject)!.ownerState).toBe('HANDOFF_PENDING');
    const report=await x.runner.tick();
    expect(report.considered).toBe(0);
    expect(x.placeManualOrder).not.toHaveBeenCalled();
  });

  it('ENFORCE without a durable TradePlan refuses instead of inventing an invalidation signal',async()=>{
    const x=fixture('ENFORCE',{plan:null});
    expect(x.exitRuntime.owner(x.subject)!.ownerState).toBe('AI_ACTIVE');
    const report=await x.runner.tick();
    expect(report.submitted).toBe(0);
    expect(report.blocked[0].reasons).toContain('AI_PLAN_UNPROVEN');
    expect(x.published).toContain('AI_EXIT_PLAN_UNPROVEN');
    expect(x.placeManualOrder).not.toHaveBeenCalled();
  });

  it('ENFORCE with a proven plan and complete cost facts submits exactly one reduce-only limit exit',async()=>{
    const x=fixture('ENFORCE');
    const report=await x.runner.tick();
    expect(report).toMatchObject({authority:'ENFORCE',considered:1,evaluated:1,prepared:1,submitted:1});
    expect(x.placeManualOrder).toHaveBeenCalledTimes(1);
    const order=x.placeManualOrder.mock.calls[0][0];
    expect(order).toMatchObject({symbol:'BTCUSDT',side:'SELL',positionSide:'LONG',type:'LIMIT',reduceOnly:true,postOnly:false,quantity:10});
    expect(Number(order.price)).toBeGreaterThan(0);
    const tasks=x.exitRuntime.tasksNeedingQuery();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].clientOrderId).toBe(order.clientOrderId);
    expect(x.exitRuntime.task(order.clientOrderId)!.state).toBe('WORKING');
    expect(x.published).toContain('AI_EXIT_SUBMITTED');
    const replay=await x.runner.tick();
    expect(replay.submitted).toBe(0);
    expect(x.placeManualOrder).toHaveBeenCalledTimes(1);
  });

  it('an unproven fee or funding fact blocks the exit with the reason the accounting is missing',async()=>{
    for(const over of [{commissionUsd:null},{fundingStatus:'UNKNOWN'}] as const){
      const x=fixture('ENFORCE',over as never);
      const report=await x.runner.tick();
      expect(report.submitted).toBe(0);
      expect(report.blocked[0].reasons.join('|')).toMatch(/ENTRY_FEE_UNKNOWN|FUNDING_ATTRIBUTION_UNKNOWN/);
      expect(x.published).toContain('AI_EXIT_FACTS_INCOMPLETE');
      expect(x.placeManualOrder).not.toHaveBeenCalled();
    }
  });

  it('an expired management deadline withdraws AI authority without touching protection',async()=>{
    const x=fixture('ENFORCE',{deadlineMinutes:1});
    const owner=x.exitRuntime.owner(x.subject)!;
    expect(owner.ownerState).toBe('AI_ACTIVE');
    expect(owner.deadline).toBeLessThan(x.now);
    const report=await x.runner.tick();
    expect(report.submitted).toBe(0);
    expect(report.blocked[0].reasons).toContain('AI_MANAGEMENT_EXPIRED');
    expect(x.exitRuntime.mandate(x.subject)).toBeNull();
    expect(x.placeManualOrder).not.toHaveBeenCalled();
  });

  it('SHADOW records the decision it has no authority to act on',async()=>{
    const x=fixture('SHADOW');
    const report=await x.runner.tick();
    expect(report).toMatchObject({authority:'SHADOW',evaluated:1,shadow:1,prepared:0,submitted:0});
    expect(x.published).toContain('AI_EXIT_SHADOW_DECISION');
    expect(x.proveReduction).not.toHaveBeenCalled();
    expect(x.placeManualOrder).not.toHaveBeenCalled();
    expect(x.exitRuntime.tasksNeedingQuery()).toHaveLength(0);
    expect(x.authorityService.shadowEntries()).toHaveLength(1);
  });

  it('a lost acknowledgement keeps the order identity and never sends a second time',async()=>{
    const x=fixture('ENFORCE');
    x.placeManualOrder.mockRejectedValueOnce(new Error('ETIMEDOUT on the wire'));
    const first=await x.runner.tick();
    expect(first.submitted).toBe(0);
    expect(first.blocked[0].reasons).toContain('AI_EXIT_SUBMIT_UNACKED');
    const task=x.exitRuntime.tasksNeedingQuery();
    expect(task).toHaveLength(1);
    expect(x.exitRuntime.task(task[0].clientOrderId)!.state).toBe('UNKNOWN');
    const second=await x.runner.tick();
    expect(second.submitted).toBe(0);
    expect(x.placeManualOrder).toHaveBeenCalledTimes(1);
  });

  it('a human takeover that lands between prepare and submit stops the write',async()=>{
    const x=fixture('ENFORCE');
    const original=x.exitRuntime.transitionByClientOrderId.bind(x.exitRuntime);
    let flipped=false;
    vi.spyOn(x.exitRuntime,'transitionByClientOrderId').mockImplementation((clientOrderId:string,next:any,now:number,reason:string)=>{
      if(!flipped){flipped=true;x.exitRuntime.recordHumanTakeover(x.subject,'MANUAL_SUBMISSION',Date.now());}
      return original(clientOrderId,next,now,reason);
    });
    const report=await x.runner.tick();
    expect(report.submitted).toBe(0);
    expect(report.blocked[0].reasons).toContain('AI_EXIT_SUBMIT_REFUSED');
    expect(x.placeManualOrder).not.toHaveBeenCalled();
    expect(x.exitRuntime.owner(x.subject)!.ownerState).toBe('HUMAN_MANAGED');
  });
});

describe('J1 runtime consumer',()=>{
  it('binds the management deadline in the same turn as the fill and never re-fixes it',async()=>{
    process.env.ZDJ_DATA_MODE='mock';process.env.ZDJ_AI_MODE='mock';process.env.ZDJ_TRADING_ADAPTER='mock';
    const root=path.resolve(process.cwd(),'../..');
    const dir=await mkdtemp(path.join(tmpdir(),'zdj-v396-j1-runtime-'));
    try{
      const runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:dir});
      const openedAt=Date.now()-120_000;
      const position=any({id:'p_j1',symbol:'BTCUSDT',side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:5,openedAt,firstObservedAt:openedAt,
        cycleId:'cycle_runtime',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PENDING',
        profitTakePlan:{targetPrice:101,targetHorizonMinutes:30,targetReason:'structure',evidenceRefs:['15m:close'],acceptableTargetRange:{min:100.5,max:102}}});
      runtime.state.positions.set('p_j1',position);
      const fixed:any[]=[];
      runtime.events.on('event',event=>{if(event.type==='AI_MANAGEMENT_DEADLINE_FIXED')fixed.push(event.payload);});
      runtime.events.publish('POSITION_OPENED',position,'BTCUSDT');
      const minutes=Number((runtime.state.settings as any).positionManagement.humanHandoffAfterMinutes);
      const subject=exitSubjectFromPosition(position);
      const owner=runtime.exitRuntime!.owner(subject)!;
      expect(Number.isSafeInteger(minutes)&&minutes>0).toBe(true);
      expect(owner.ownerState).toBe('AI_ACTIVE');
      expect(owner.deadline).toBe(openedAt+minutes*60_000);
      expect(fixed).toHaveLength(1);
      runtime.state.positions.set('p_j1',{...position,openedAt:openedAt+900_000});
      expect(runtime.fixFirstFillDeadlines().fixed).toBe(0);
      expect(runtime.exitRuntime!.owner(subject)!.deadline).toBe(openedAt+minutes*60_000);
      const report=await runtime.aiExitRunner!.tick();
      expect(report).toMatchObject({authority:'ENFORCE',considered:0,evaluated:0,submitted:0});
      runtime.stop();
    }finally{await rm(dir,{recursive:true,force:true}).catch(()=>null);}
  },40_000);
});

it('fee safety percent is a fraction of fees, not notional; zero slippage remains valid',()=>{
  const state=new RuntimeState(any(settingsFor('SHADOW')));
  state.settings.takeProfit={...state.settings.takeProfit,entryFeeRate:.0004,takerFeeRate:.0004,feeSafetyBufferPct:10,slippageBufferPct:0};
  const runner=new V396AiExitRunner(any({state}));
  expect((runner as any).fees().uncertaintyBufferBps).toBeCloseTo(.8,9);
});
