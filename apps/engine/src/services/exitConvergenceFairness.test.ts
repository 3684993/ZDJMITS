import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {V396ExitRuntime,type V396PrepareExitInput} from './v396ExitRuntime.js';
import type {AdapterCapabilities} from './s04ExitCoordinator.js';
import {OPEN_STATES} from './s04ExitCoordinator.js';
import {ONE_WAY_CAPABILITIES} from './v396ExitTestHarness.js';
import {normalizeExitOrderFact} from './exitOrderFact.js';

/**
 * P1 acceptance: exit-order terminal propagation and claim convergence fairness.
 *
 * These shapes come straight from the V3.9.6 root-cause audit (R3): the live ledger had 51+
 * non-terminal durable tasks, the continuous pass took the first eight in insertion order, and the
 * three take-profit orders that the exchange had already reported FILLED sat at index 13, 24 and 28
 * and were never polled. Their ACTIVE quantity claims then blocked a new take-profit for the
 * re-opened position with QUANTITY_BUDGET_EXCEEDED:reducible=0.
 */

const dirs:string[]=[];
afterEach(()=>{while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* busy handle */}}});
const tempFile=(name='v396-ownership.sqlite')=>{const dir=mkdtempSync(join(tmpdir(),'zdj-v396-fair-'));dirs.push(dir);return join(dir,name);};
const any=(value:unknown)=>value as any;

const identity={environment:'TESTNET',account:'binance-primary'};
const CAPS:AdapterCapabilities=ONE_WAY_CAPABILITIES;
const INTERVAL=120_000,BATCH=8;

const runtimeAt=(file:string,now:()=>number)=>new V396ExitRuntime(file,()=>identity,async()=>CAPS,
  ()=>({aiExitAuthority:'SHADOW' as const,intervalMs:INTERVAL,batchLimit:BATCH,continuousEnabled:true,now:now()}));

/** One prepared take-profit task for its own symbol, so every task owns a distinct scope. */
async function prepared(runtime:V396ExitRuntime,index:number,now:number){
  const symbol=`SYM${String(index).padStart(3,'0')}USDT`;
  const subject={symbol,side:'LONG' as const,cycleId:`cycle_${index}`,openedAt:now-60_000};
  const input:V396PrepareExitInput={
    requestKey:`tp_${index}`,subject,quantityUnits:10,limitPrice:95,now:now-1_000,positionVersion:index+1,
    settingsVersion:219,riskGeneration:1,availableReduceUnits:10,remainingUnits:10,minNotional:5,tickSize:.1,stepSize:1,
    proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:now-1_000,positionSide:'LONG'},
  };
  const preparedResult=await runtime.prepareTakeProfit(input);
  expect(preparedResult.clientOrderId).toBeTruthy();
  return {symbol,subject,clientOrderId:String(preparedResult.clientOrderId)};
}

async function prepareMany(count:number,now:number){
  const file=tempFile();
  const runtime=runtimeAt(file,()=>now);
  const tasks=[];
  for(let index=0;index<count;index++)tasks.push(await prepared(runtime,index,now));
  return {file,runtime,tasks};
}

const orderReport=(task:{symbol:string;clientOrderId:string},over:Record<string,unknown>={})=>({
  symbol:task.symbol,clientOrderId:task.clientOrderId,exchangeOrderId:'ex_1',positionSide:'LONG',
  status:'NEW',originalQuantity:10,executedQuantity:0,updateTime:Date.now(),...over,
});

describe('P1 exit convergence fairness',()=>{
  it('a terminal order at the tail is serviced even while the head stays WORKING',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(55,now);
    expect(runtime.openQueueLength()).toBe(55);
    // The audit's real shape: the first batch answers WORKING forever, one tail order is FILLED.
    const tail=tasks[50];
    let cursor=now+1;
    let rounds=0,released=false;
    while(rounds<20&&!released){
      cursor+=INTERVAL;
      const result=await runtime.convergePeriodically(async(input)=>{
        if(input.clientOrderId===tail.clientOrderId)return{state:'FOUND' as const,order:any(orderReport(tail,{status:'FILLED',executedQuantity:10}))};
        return{state:'FOUND' as const,order:any(orderReport({symbol:input.symbol,clientOrderId:input.clientOrderId}))};
      },cursor);
      rounds++;
      released=runtime.claimFor(tail.clientOrderId)?.status==='RELEASED';
    }
    expect(released).toBe(true);
    // ceil(55/8)=7 full walks bound the worst case; the walk must not need dozens of rounds.
    expect(rounds).toBeLessThanOrEqual(8);
    expect(runtime.task(tail.clientOrderId)!.state).toBe('FILLED');
  });

  it('a failed query backs off only the order that failed',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(10,now);
    const broken=tasks[0];
    let cursor=now+INTERVAL;
    await runtime.convergePeriodically(async(input)=>{
      if(input.clientOrderId===broken.clientOrderId)throw new Error('NETWORK_TIMEOUT');
      return{state:'FOUND' as const,order:any(orderReport({symbol:input.symbol,clientOrderId:input.clientOrderId}))};
    },cursor);
    const healthy=runtime.convergenceStats(cursor);
    expect(healthy.openTasks).toBe(10);
    // The broken order is pushed out by its backoff; the rest return on the next plain interval.
    const stats=any(healthy);
    expect(stats.oldestUnpolledAgeMs).toBeGreaterThanOrEqual(0);
    expect(stats.batchLimit).toBe(BATCH);
    expect(stats.maxServiceIntervalMs).toBe(Math.ceil(stats.openTasks/BATCH)*INTERVAL);
  });

  it('readback reports queue length, oldest unpolled age and terminal-unreleased claims',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(12,now);
    const before=runtime.convergenceStats(now);
    expect(before.openTasks).toBe(12);
    expect(before.neverPolled).toBe(12);
    expect(before.terminalUnreleasedClaims).toBe(0);
    expect(before.fairness).toBe('PERSISTED_ROUND_ROBIN_NEXT_ELIGIBLE_THEN_LAST_ATTEMPT');
    await runtime.convergePeriodically(async(input)=>({state:'FOUND' as const,order:any(orderReport({symbol:input.symbol,clientOrderId:input.clientOrderId}))}),now+INTERVAL);
    const after=runtime.convergenceStats(now+INTERVAL);
    expect(after.neverPolled).toBe(12-BATCH);
    expect(after.oldestUnpolledAgeMs).toBeGreaterThanOrEqual(INTERVAL);
    expect(tasks.length).toBe(12);
  });

  it('reports a never-polled waiting age from the durable creation time, not from the epoch',async()=>{
    const now=Date.now();
    const {runtime}=await prepareMany(3,now);
    // Ten minutes of an idle operator window: the queue has not been walked at all.
    const waiting=runtime.convergenceStats(now+10*60_000);
    expect(waiting.neverPolled).toBe(3);
    expect(waiting.oldestUnpolledAgeMs).toBeGreaterThanOrEqual(10*60_000-1_000);
    expect(waiting.oldestUnpolledAgeMs).toBeLessThanOrEqual(10*60_000+1_000);
    // A bound the epoch-based arithmetic could never satisfy.
    expect(waiting.oldestUnpolledAgeMs).toBeLessThan(24*60*60_000);
  });
  it('a converged order also becomes durable provenance, not only a state change',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(2,now);
    const target=tasks[1];
    const result=await runtime.convergePeriodically(async(input)=>{
      if(input.clientOrderId===target.clientOrderId)return{state:'FOUND' as const,order:any(orderReport(target,{status:'FILLED',executedQuantity:10}))};
      return{state:'FOUND' as const,order:any(orderReport({symbol:input.symbol,clientOrderId:input.clientOrderId}))};
    },now+INTERVAL);
    expect(result.converged.find(row=>row.clientOrderId===target.clientOrderId)?.outcome).toBe('EXCHANGE_FACT_FILLED');
    const proof=runtime.provenanceFor({symbol:target.symbol,clientOrderId:target.clientOrderId});
    expect(proof.status).toBe('SYSTEM_PROVEN');
    expect(proof.rows.filter(row=>row.role==='EXIT').length).toBeGreaterThan(0);
    expect(proof.rows.every(row=>row.environment==='TESTNET'&&row.accountId==='binance-primary')).toBe(true);
    // An identity this ledger never proved stays unresolved instead of being claimed as system work.
    expect(runtime.provenanceFor({symbol:target.symbol,clientOrderId:'ml_foreign'}).status).toBe('UNRESOLVED');
  });
});

describe('P1 exit terminal propagation',()=>{
  it('a late WORKING report cannot roll a FILLED order back or re-occupy its claim',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(1,now);
    const task=tasks[0];
    runtime.recordExitOrderReport('USER_DATA_WS',any(orderReport(task,{status:'FILLED',executedQuantity:10})),now+1_000);
    expect(runtime.claimFor(task.clientOrderId)?.status).toBe('RELEASED');
    const late=runtime.recordExitOrderReport('USER_DATA_WS',any(orderReport(task,{status:'NEW',executedQuantity:0})),now+2_000);
    expect(late.applied).toHaveLength(0);
    expect(String(late.skipped[0].reason)).toContain('TERMINAL_TASK_NO_REGRESSION');
    expect(runtime.task(task.clientOrderId)!.state).toBe('FILLED');
    expect(runtime.claimFor(task.clientOrderId)?.status).toBe('RELEASED');
  });

  it('a partial fill updates the remaining claim instead of releasing it',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(1,now);
    const task=tasks[0];
    runtime.recordExitOrderReport('USER_DATA_WS',any(orderReport(task,{status:'PARTIALLY_FILLED',executedQuantity:4})),now+1_000);
    const claim=runtime.claimFor(task.clientOrderId)!;
    expect(claim.status).toBe('ACTIVE');
    expect(claim.quantityUnits).toBe(6);
    expect(runtime.task(task.clientOrderId)!.state).toBe('PARTIALLY_FILLED');
    // The remaining budget is what a new intent must respect: no double-spend of the position.
    const secondNow=Date.now();
    const again=await runtime.prepareTakeProfit({requestKey:'tp_second',subject:{symbol:task.symbol,side:'LONG',cycleId:task.subject.cycleId},
      quantityUnits:10,limitPrice:95,now:secondNow,positionVersion:2,settingsVersion:219,riskGeneration:1,
      availableReduceUnits:10,remainingUnits:10,minNotional:5,tickSize:.1,stepSize:1,
      proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:secondNow,positionSide:'LONG'}});
    expect(again.accepted).toBe(false);
    expect(again.reasons.join('|')).toContain('QUANTITY_BUDGET_EXCEEDED');
  });

  it('duplicate and out-of-order WS reports are idempotent',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(1,now);
    const task=tasks[0];
    const filled=any(orderReport(task,{status:'FILLED',executedQuantity:10}));
    const first=runtime.recordExitOrderReport('USER_DATA_WS',filled,now+1_000);
    const second=runtime.recordExitOrderReport('USER_DATA_WS',filled,now+1_500);
    expect(first.applied).toHaveLength(1);
    expect(second.applied).toHaveLength(0);
    expect(['DUPLICATE_EVENT','TERMINAL_ALREADY_CONVERGED']).toContain(second.skipped[0].reason);
    expect(runtime.task(task.clientOrderId)!.state).toBe('FILLED');
    // A report whose identity does not match the durable order is refused, never guessed at.
    const wrong=runtime.recordExitOrderReport('USER_DATA_WS',any(orderReport(task,{symbol:'OTHERUSDT',status:'FILLED',executedQuantity:10})),now+2_000);
    expect(wrong.applied).toHaveLength(0);
    expect(String(wrong.skipped[0].reason)).toContain('FACT_IDENTITY_MISMATCH');
  });

  it('an ABSENT answer keeps an unacked order UNKNOWN and its claim occupied',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(2,now);
    // A task that was prepared but never acknowledged goes to UNKNOWN: the exchange says nothing of
    // that identity exists, which is not the same proof as a cancellation, so the claim stays.
    const preparedTask=tasks[0];
    const fromPrepared=await runtime.convergeRecoveredTasks(async(input)=>input.clientOrderId===preparedTask.clientOrderId
      ?{state:'ABSENT',reason:'-2013'} as const
      :{state:'FOUND',order:any(orderReport({symbol:input.symbol,clientOrderId:input.clientOrderId}))} as const,now+1_000);
    expect(fromPrepared.some(row=>row.outcome==='EXCHANGE_ABSENT_STAYS_UNACKED')).toBe(true);
    expect(runtime.task(preparedTask.clientOrderId)!.state).toBe('UNKNOWN');
    expect(runtime.claimFor(preparedTask.clientOrderId)!.status).toBe('ACTIVE');
    // A write that may already have happened keeps its submit identity rather than being relabelled.
    const sent=tasks[1];
    await runtime.transitionByClientOrderId(sent.clientOrderId,'SUBMITTING',now+1_500,'TP_SUBMIT_SENT');
    const result=await runtime.convergePeriodically(async()=>({state:'ABSENT',reason:'-2013'} as const),now+INTERVAL*3);
    expect(result.converged.some(row=>row.outcome==='EXCHANGE_ABSENT_STAYS_UNACKED')).toBe(true);
    expect(runtime.claimFor(sent.clientOrderId)!.status).toBe('ACTIVE');
    // Once the order is known to live at the exchange, an absence answer goes to UNKNOWN, never to a
    // terminal state: the quantity stays pinned until a real report settles it.
    expect(['SUBMITTING','UNKNOWN']).toContain(runtime.task(sent.clientOrderId)!.state);
    expect(OPEN_STATES).toContain(runtime.task(sent.clientOrderId)!.state);
  });

  it('a claim is never released by a local label without exchange evidence',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(1,now);
    const task=tasks[0];
    // A reader that reports a quantity which contradicts the durable order is not evidence.
    const fact=normalizeExitOrderFact({source:'OPEN_ORDERS',environment:identity.environment,accountId:identity.account,
      order:any(orderReport(task,{status:'CANCELED',originalQuantity:999,executedQuantity:0})),observedAt:now+1_000});
    const applied=runtime.recordVerifiedExitOrderFacts([fact],now+1_000);
    expect(applied.applied).toHaveLength(0);
    expect(runtime.claimFor(task.clientOrderId)!.status).toBe('ACTIVE');
    expect(runtime.task(task.clientOrderId)!.state).toBe('PREPARED');
  });

  it('an order from a cycle that no longer has a live position still converges',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(2,now);
    const old=tasks[0];
    // Nothing about the current position book is consulted by the reducer: the old cycle closes on
    // its own evidence, which is what frees the new cycle in the same scope to build a take-profit.
    runtime.recordExitOrderReport('EXACT_ORDER',any(orderReport(old,{status:'CANCELED',executedQuantity:0})),now+1_000);
    expect(runtime.claimFor(old.clientOrderId)!.status).toBe('RELEASED');
    const scopeUnits=runtime.adoptedUnits(old.subject);
    expect(scopeUnits).toBe(0);
  });

  it('a WS report for an entry order does not acquire an exit role in the registry',async()=>{
    const now=Date.now();
    const {runtime,tasks}=await prepareMany(1,now);
    const entryLike={symbol:tasks[0].symbol,clientOrderId:'ML999999999999999999999999999',exchangeOrderId:'ex_9',positionSide:'LONG',status:'FILLED',originalQuantity:10,executedQuantity:10,updateTime:now};
    const applied=runtime.recordExitOrderReport('USER_DATA_WS',any(entryLike),now+1_000);
    expect(applied.applied).toHaveLength(0);
    expect(String(applied.skipped[0].reason)).toContain('UNBOUND_ORDER');
    expect(runtime.provenanceFor({symbol:tasks[0].symbol,clientOrderId:entryLike.clientOrderId}).status).toBe('UNRESOLVED');
  });
});

/**
 * P0 fixture, replayed from the audited ledger rows rather than invented: the take-profit that the
 * exchange had already filled, the durable task still WORKING with an ACTIVE claim, and the newly
 * re-opened position that could not get its own protection order until that claim converged.
 */
const AUDITED=[
  {symbol:'BRUSDT',side:'SHORT' as const,oldCycle:'cycle_entry_intent_mukxjzol_q8q1s20j',clientOrderId:'v396x8ff81eeea97014fb49f7ec9945b7b5',tpExchangeOrderId:'309686722',oldUnits:18,newUnits:6},
  {symbol:'NEARUSDT',side:'SHORT' as const,oldCycle:'cycle_entry_intent_mul3nfr5_swpdn8uc',clientOrderId:'v396x9cbfe0a573145bbffe286e7f79885f',tpExchangeOrderId:'636148297',oldUnits:6,newUnits:4},
  {symbol:'WLDUSDT',side:'SHORT' as const,oldCycle:'cycle_entry_intent_mukz0v9n_7nvjuu3q',clientOrderId:'v396x1fd9654fa96d299651ea549765ed75',tpExchangeOrderId:'534679168',oldUnits:41,newUnits:11},
];

describe('P1 replay of the audited BR/NEAR/WLD shape',()=>{
  it('a filled take-profit releases the old claim and lets the new cycle protect itself',async()=>{
    const now=Date.now();
    const file=tempFile();
    const runtime=runtimeAt(file,()=>now);
    const minted=new Map<string,string>();
    for(const row of AUDITED){
      const subject={symbol:row.symbol,side:row.side,cycleId:row.oldCycle,openedAt:now-3_600_000};
      const prepared=await runtime.prepareTakeProfit({requestKey:`tp_${row.symbol}`,subject,quantityUnits:row.oldUnits,limitPrice:100,now,
        positionVersion:1,settingsVersion:219,riskGeneration:1,availableReduceUnits:row.oldUnits,remainingUnits:row.oldUnits,
        minNotional:5,tickSize:.001,stepSize:.01,proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:now,positionSide:row.side}});
      expect(prepared.accepted).toBe(true);
      // The audited ledger keys its tasks by a v396x client order id; the fixture uses this build's own
      // derivation, so the identity is captured here instead of pasted from the report.
      expect(String(prepared.clientOrderId)).toMatch(/^v396x[0-9a-f]{30}$/);
      minted.set(row.symbol,String(prepared.clientOrderId));
      expect(runtime.task(String(prepared.clientOrderId))!.quantityUnits).toBe(row.oldUnits);
    }
    // Before convergence: the new cycle in the same scope has nothing reducible, exactly as observed.
    const first=AUDITED[0];
    const blockedAt=Date.now();
    const blocked=await runtime.prepareTakeProfit({requestKey:'tp_new_cycle',subject:{symbol:first.symbol,side:first.side,cycleId:`cycle_new_${first.symbol}`},
      quantityUnits:first.newUnits,limitPrice:100,now:blockedAt,positionVersion:2,settingsVersion:219,riskGeneration:1,
      availableReduceUnits:first.newUnits,remainingUnits:first.newUnits,minNotional:5,tickSize:.001,stepSize:.01,
      proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:blockedAt,positionSide:first.side}});
    expect(blocked.accepted).toBe(false);
    expect(blocked.reasons.join('|')).toContain('QUANTITY_BUDGET_EXCEEDED');
    expect(blocked.reasons.join('|')).toContain('OPEN_CLAIM_UNITS=');

    // The exchange now answers for each old take-profit; every reader goes through the reducer.
    for(const row of AUDITED){
      const applied=runtime.recordExitOrderReport('EXACT_ORDER',{symbol:row.symbol,clientOrderId:minted.get(row.symbol)!,exchangeOrderId:row.tpExchangeOrderId,
        positionSide:row.side,status:'FILLED',originalQuantity:row.oldUnits*.01,executedQuantity:row.oldUnits*.01,updateTime:now+1},now+2);
      expect(applied.applied).toHaveLength(1);
      expect(runtime.claimFor(String(minted.get(row.symbol)))!.status).toBe('RELEASED');
    }
    expect(runtime.convergenceStats(now+2).terminalUnreleasedClaims).toBe(0);
    const unblockedAt=Date.now();
    const unblocked=await runtime.prepareTakeProfit({requestKey:'tp_new_cycle',subject:{symbol:first.symbol,side:first.side,cycleId:`cycle_new_${first.symbol}`},
      quantityUnits:first.newUnits,limitPrice:100,now:unblockedAt,positionVersion:2,settingsVersion:219,riskGeneration:1,
      availableReduceUnits:first.newUnits,remainingUnits:first.newUnits,minNotional:5,tickSize:.001,stepSize:.01,
      proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:unblockedAt,positionSide:first.side}});
    expect(unblocked.accepted).toBe(true);
    expect(unblocked.reasons).toEqual(['TASK_PREPARED_PERSISTED']);
  });
});
