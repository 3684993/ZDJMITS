import {describe,expect,it} from 'vitest';
import type {ExecutionFill,TradeRecord} from '@zdj/contracts';
import type {ExitTask} from './s04ExitCoordinator.js';
import {exitQuantityUnits} from './s04ExitCoordinator.js';
import {
  ACCEPTED_EXIT_EVIDENCE,exitFactsForRepair,planConservationRelabel,planCycleBackfill,planExitClaimConvergence,repairAuditRecord,
  type ExitEvidence,type ExitRepairRow,
} from './tradingLoopRepair.js';

/**
 * P0/P1/P2 repair acceptance. The repair module decides what a re-runnable data migration may touch,
 * so its tests are the guarantee that it cannot manufacture a terminal state: every row it declines
 * to change stays exactly as it is, and every row it changes is backed by an accepted exchange fact
 * whose identity still matches the durable task.
 *
 * The shapes replay the V3.9.6 audit findings: BR/NEAR/WLD take-profit orders the exchange had
 * already reported FILLED while their quantity claim stayed ACTIVE (R3), and TradeRecords keyed per
 * Entry order whose aggregated exit closed one physical holding (R4).
 */

const any=(value:unknown)=>value as any;
const SCOPE=(symbol:string,side='LONG',environment='TESTNET',account='binance-primary')=>JSON.stringify([environment,account,symbol,side]);
const now=1_760_000_000_000;

function task(over:Partial<ExitTask>&{clientOrderId:string;symbol:string}):ExitTask{
  const quantityUnits=over.quantityUnits??10,stepSize=over.stepSize??1;
  return any({taskId:`task_${over.clientOrderId}`,clientOrderId:over.clientOrderId,scope:SCOPE(over.symbol),
    cycleId:`cycle_${over.symbol}`,state:over.state??'WORKING',quantityUnits,stepSize,filledUnits:over.filledUnits??0,
    version:over.version??1,limitPrice:95,ownerVersion:1,planVersion:1,positionVersion:1,settingsVersion:219,riskGeneration:1,
    estimateHash:'e',decisionHash:'d',authorizationExpiresAt:now+15_000,deadline:now+300_000,createdAt:now-60_000,updatedAt:now-60_000,
    reasons:[],requestKey:null});
}
const claim=(task:ExitTask,status='ACTIVE')=>({id:`claim:${task.taskId}`,scope:task.scope,status,quantityUnits:task.quantityUnits,clientOrderId:task.clientOrderId});

function evidence(over:Partial<ExitEvidence>&{clientOrderId:string;symbol:string}):ExitEvidence{
  return{source:'BINANCE_EXACT_ORDER_TERMINAL',exchangeOrderId:'ex_1',positionSide:'LONG',originalQty:10,executedQty:10,
    exchangeStatus:'FILLED',observedAt:now,...over} as ExitEvidence;
}

const planFor=(tasks:ExitTask[],evidence:ExitEvidence[],over:Record<string,unknown>={})=>planExitClaimConvergence({
  tasks,claims:tasks.map(one=>claim(one)),evidence,environment:over.environment??'TESTNET',accountId:over.accountId??'binance-primary',
} as never);

const rowOf=(rows:ExitRepairRow[],clientOrderId:string)=>rows.find(row=>row.clientOrderId===clientOrderId)!;

describe('P0 exit claim convergence repair plan',()=>{
  it('converges a durable WORKING task the exchange reports FILLED',()=>{
    const one=task({clientOrderId:'v396xbr',symbol:'BRUSDT'});
    const result=planFor([one],[evidence({clientOrderId:'v396xbr',symbol:'BRUSDT'})]);
    expect(rowOf(result.rows,'v396xbr')).toMatchObject({action:'CONVERGE_TERMINAL',taskState:'WORKING',claimStatus:'ACTIVE',reason:'EXCHANGE_TERMINAL_FILLED'});
    expect(result.summary).toMatchObject({CONVERGE_TERMINAL:1,KEEP_UNKNOWN:0,total:1});
  });

  it('replays the audited tail-starved trio and leaves the un-evidenced task UNKNOWN',()=>{
    const tasks=[task({clientOrderId:'v396xbr',symbol:'BRUSDT'}),task({clientOrderId:'v396xnear',symbol:'NEARUSDT'}),task({clientOrderId:'v396xwld',symbol:'WLDUSDT'})];
    const result=planFor(tasks,[
      evidence({clientOrderId:'v396xbr',symbol:'BRUSDT'}),
      evidence({clientOrderId:'v396xnear',symbol:'NEARUSDT',exchangeStatus:'CANCELED',executedQty:0}),
    ]);
    expect(rowOf(result.rows,'v396xbr').action).toBe('CONVERGE_TERMINAL');
    expect(rowOf(result.rows,'v396xnear')).toMatchObject({action:'CONVERGE_TERMINAL',reason:'EXCHANGE_TERMINAL_CANCELED'});
    expect(rowOf(result.rows,'v396xwld')).toMatchObject({action:'KEEP_UNKNOWN',reason:'NO_ACCEPTED_EXCHANGE_EVIDENCE'});
    expect(result.rows.filter(row=>row.action==='KEEP_UNKNOWN').length).toBe(1);
  });

  it('refuses to trust a local order row that merely says FILLED',()=>{
    const one=task({clientOrderId:'v396xlocal',symbol:'BTCUSDT'});
    const result=planFor([one],[evidence({clientOrderId:'v396xlocal',symbol:'BTCUSDT',source:'LOCAL_ORDER_TABLE' as never})]);
    expect(rowOf(result.rows,'v396xlocal')).toMatchObject({action:'KEEP_UNKNOWN',evidence:null,reason:'UNACCEPTED_EVIDENCE_SOURCE:LOCAL_ORDER_TABLE'});
    expect(ACCEPTED_EXIT_EVIDENCE).not.toContain('LOCAL_ORDER_TABLE');
  });

  it('keeps UNKNOWN when the fact is from another symbol, another account, or another quantity',()=>{
    const one=task({clientOrderId:'v396xsym',symbol:'BRUSDT'});
    const two=task({clientOrderId:'v396xacct',symbol:'NEARUSDT'});
    const three=task({clientOrderId:'v396xqty',symbol:'WLDUSDT',quantityUnits:20,stepSize:1});
    const result=planFor([one,two,three],[
      evidence({clientOrderId:'v396xsym',symbol:'ETHUSDT'}),
      evidence({clientOrderId:'v396xacct',symbol:'NEARUSDT'}),
      evidence({clientOrderId:'v396xqty',symbol:'WLDUSDT',originalQty:10,executedQty:10}),
    ],{accountId:'binance-primary'});
    expect(rowOf(result.rows,'v396xsym').reason).toBe('EVIDENCE_SYMBOL_MISMATCH:ETHUSDT');
    expect(rowOf(result.rows,'v396xacct').action).toBe('CONVERGE_TERMINAL');
    expect(rowOf(result.rows,'v396xqty').reason).toBe('QUANTITY_IDENTITY_MISMATCH:10!=20');
    for(const row of [rowOf(result.rows,'v396xsym'),rowOf(result.rows,'v396xqty')])expect(row.action).toBe('KEEP_UNKNOWN');
  });

  it('refuses a repair whose scope belongs to another environment or account than the run identity',()=>{
    const production=task({clientOrderId:'v396xprod',symbol:'BTCUSDT'});
    production.scope=SCOPE('BTCUSDT','LONG','PRODUCTION','binance-primary');
    const result=planFor([production],[evidence({clientOrderId:'v396xprod',symbol:'BTCUSDT'})],{environment:'TESTNET'});
    expect(rowOf(result.rows,'v396xprod')).toMatchObject({action:'KEEP_UNKNOWN',reason:'EVIDENCE_SCOPE_MISMATCH'});
    // Same guard in the other direction: a TESTNET task is not repaired by a PRODUCTION run.
    const testnet=task({clientOrderId:'v396xtest',symbol:'BTCUSDT'});
    expect(rowOf(planFor([testnet],[evidence({clientOrderId:'v396xtest',symbol:'BTCUSDT'})],{environment:'PRODUCTION'}).rows,'v396xtest').reason).toBe('EVIDENCE_SCOPE_MISMATCH');
  });

  it('converges a non-terminal exchange answer without releasing the claim',()=>{
    const one=task({clientOrderId:'v396xnew',symbol:'BTCUSDT'});
    const result=planFor([one],[evidence({clientOrderId:'v396xnew',symbol:'BTCUSDT',exchangeStatus:'NEW',executedQty:0})]);
    expect(rowOf(result.rows,'v396xnew')).toMatchObject({action:'CONVERGE_NON_TERMINAL',reason:'EXCHANGE_NON_TERMINAL_NEW'});
    expect(rowOf(result.rows,'v396xnew').evidence).toMatchObject({executedQty:0});
  });

  it('leaves a partial fill, an over-fill and a contradictory FILLED arithmetic unproven',()=>{
    const partial=task({clientOrderId:'v396xpart',symbol:'AUSDT'});
    const over=task({clientOrderId:'v396xover',symbol:'BUSDT'});
    const short=task({clientOrderId:'v396xshort',symbol:'CUSDT'});
    const result=planFor([partial,over,short],[
      evidence({clientOrderId:'v396xpart',symbol:'AUSDT',exchangeStatus:'PARTIALLY_FILLED',executedQty:4}),
      evidence({clientOrderId:'v396xover',symbol:'BUSDT',originalQty:12,executedQty:12}),
      evidence({clientOrderId:'v396xshort',symbol:'CUSDT',exchangeStatus:'FILLED',executedQty:6}),
    ]);
    expect(rowOf(result.rows,'v396xpart').action).toBe('CONVERGE_NON_TERMINAL');
    expect(rowOf(result.rows,'v396xover').reason).toBe('QUANTITY_IDENTITY_MISMATCH:12!=10');
    expect(rowOf(result.rows,'v396xshort').action).toBe('KEEP_UNKNOWN');
    expect(rowOf(result.rows,'v396xshort').reason).toBe('FILLED_WITHOUT_FULL_FILL_UNITS:6!=10');
    // The same contradiction the live normalizer refuses, so a repair can never write it either.
    expect(exitFactsForRepair(result.rows,[partial,over,short],
      [evidence({clientOrderId:'v396xpart',symbol:'AUSDT',exchangeStatus:'PARTIALLY_FILLED',executedQty:4}),
        evidence({clientOrderId:'v396xover',symbol:'BUSDT',originalQty:12,executedQty:12}),
        evidence({clientOrderId:'v396xshort',symbol:'CUSDT',exchangeStatus:'FILLED',executedQty:6})],
      {environment:'TESTNET',accountId:'binance-primary'}).map(fact=>fact.clientOrderId)).toEqual(['v396xpart']);
  });

  it('never rewrites an already terminal task',()=>{
    const done=task({clientOrderId:'v396xfilled',symbol:'BTCUSDT',state:'FILLED'});
    expect(rowOf(planFor([done],[evidence({clientOrderId:'v396xfilled',symbol:'BTCUSDT'})]).rows,'v396xfilled')).toMatchObject({action:'NO_OP',reason:'TASK_ALREADY_TERMINAL'});
  });

  it('drops a task whose scope is not the canonical four-part identity',()=>{
    const broken=task({clientOrderId:'v396xbroken',symbol:'BTCUSDT'});
    broken.scope='BTCUSDT';
    expect(rowOf(planFor([broken],[evidence({clientOrderId:'v396xbroken',symbol:'BTCUSDT'})]).rows,'v396xbroken').reason).toBe('TASK_SCOPE_UNPARSEABLE');
  });

  it('builds repair facts through the same normalizer every live reader uses',()=>{
    const one=task({clientOrderId:'v396xfact',symbol:'BRUSDT'});
    const rows=planFor([one],[evidence({clientOrderId:'v396xfact',symbol:'BRUSDT'})]).rows;
    const facts=exitFactsForRepair(rows,[one],[evidence({clientOrderId:'v396xfact',symbol:'BRUSDT'})],{environment:'TESTNET',accountId:'binance-primary'});
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({clientOrderId:'v396xfact',symbol:'BRUSDT',state:'FILLED',source:'STARTUP_RECOVERY',
      eventId:`REPAIR:${one.taskId}:BINANCE_EXACT_ORDER_TERMINAL:1`});
    expect(facts[0].coverage.proof).toContain('REPAIR_PLAN:CONVERGE_TERMINAL');
    // A declined row produces no fact at all, so a repair cannot write what the plan refused.
    const declined=planFor([one],[evidence({clientOrderId:'v396xfact',symbol:'ETHUSDT'})]).rows;
    expect(exitFactsForRepair(declined,[one],[evidence({clientOrderId:'v396xfact',symbol:'ETHUSDT'})],{environment:'TESTNET',accountId:'binance-primary'})).toEqual([]);
  });

  it('keeps quantity-unit identity on a fractional step size',()=>{
    const one=task({clientOrderId:'v396xfraction',symbol:'ETHUSDT',quantityUnits:250,stepSize:.01});
    expect(exitQuantityUnits(2.5,.01)).toBe(250);
    expect(rowOf(planFor([one],[evidence({clientOrderId:'v396xfraction',symbol:'ETHUSDT',originalQty:2.5,executedQty:2.5})]).rows,'v396xfraction').action).toBe('CONVERGE_TERMINAL');
    // A quantity that is not a whole step unit is not the same budget and must not release the claim.
    expect(rowOf(planFor([one],[evidence({clientOrderId:'v396xfraction',symbol:'ETHUSDT',originalQty:2.505,executedQty:2.505})]).rows,'v396xfraction').action).toBe('KEEP_UNKNOWN');
  });
});

const fill=(over:Partial<ExecutionFill>&{fillId:string;tradeId:string;symbol:string;side:'BUY'|'SELL';qty:number;executionTime:number}):ExecutionFill=>any({
  orderId:`o_${over.fillId}`,clientOrderId:`c_${over.fillId}`,cycleId:over.cycleId??null,positionSide:'LONG',direction:'LONG',price:100,
  realizedPnl:0,commission:.1,commissionAsset:'USDT',commissionUsd:.1,maker:true,source:'EXCHANGE_AUDIT',attributionStatus:'SYSTEM_ATTRIBUTED',...over,
});

const record=(over:Partial<TradeRecord>&{tradeId:string}):TradeRecord=>any({symbol:'BTCUSDT',direction:'LONG',status:'OPEN',
  cycleId:over.tradeId,linkedFillIds:[],remainingQty:null,quantity:0,entryAveragePrice:100,createdAt:now,updatedAt:now,...over});

describe('P2 physical-cycle backfill plan',()=>{
  it('assigns three entry orders to one physical holding and closes it on the aggregated exit',()=>{
    const fills=[
      fill({fillId:'f1',tradeId:'t1',symbol:'BTCUSDT',side:'BUY',qty:2,executionTime:now-90_000}),
      fill({fillId:'f2',tradeId:'t2',symbol:'BTCUSDT',side:'BUY',qty:2,executionTime:now-80_000}),
      fill({fillId:'f3',tradeId:'t3',symbol:'BTCUSDT',side:'BUY',qty:2,executionTime:now-70_000}),
      fill({fillId:'f4',tradeId:'t4',symbol:'BTCUSDT',side:'SELL',qty:6,executionTime:now-60_000}),
    ];
    const plan=planCycleBackfill({fills,records:[record({tradeId:'t1',linkedFillIds:['f1']}),record({tradeId:'t2',linkedFillIds:['f2']}),record({tradeId:'t3',linkedFillIds:['f3']})]});
    const cycle='pcycle_BTCUSDT_LONG_t1';
    expect([...new Set(plan.assignments.map(row=>row.physicalCycleId))]).toEqual([cycle]);
    expect(plan.assignments.map(row=>row.entryLotId)).toEqual(['o_f1','o_f2','o_f3',null]);
    expect(plan.assignments.map(row=>row.reason)).toEqual(['CYCLE_OPENED_ON_THIS_FILL',null,null,'CYCLE_CLOSED_ON_THIS_FILL']);
    expect(plan.summary).toEqual({fills:4,assigned:4,cycles:1,unproven:0,inconsistent:0});
    expect(plan.superseded).toHaveLength(3);
    expect(plan.superseded[0]).toMatchObject({oldTradeId:'t1',oldCycleId:'t1',newPhysicalCycleId:cycle,
      reason:'ENTRY_ORDER_KEYED_RECORD_SPANS_ONE_PHYSICAL_HOLDING'});
    expect(plan.unproven).toEqual([]);
  });

  it('reopens a cycle after a proven zero and keeps LONG and SHORT apart',()=>{
    const fills=[
      fill({fillId:'a1',tradeId:'ta1',symbol:'BTCUSDT',side:'BUY',qty:3,executionTime:now-100_000}),
      fill({fillId:'a2',tradeId:'ta2',symbol:'BTCUSDT',side:'SELL',qty:3,executionTime:now-90_000}),
      fill({fillId:'a3',tradeId:'ta3',symbol:'BTCUSDT',side:'BUY',qty:4,executionTime:now-80_000}),
      fill({fillId:'s1',tradeId:'ts1',symbol:'BTCUSDT',side:'SELL',qty:5,executionTime:now-70_000,positionSide:'SHORT',direction:'SHORT' as never}),
    ];
    const plan=planCycleBackfill({fills,records:[]});
    expect(plan.summary.cycles).toBe(3);
    expect(plan.assignments.find(row=>row.fillId==='a1')?.physicalCycleId).toBe('pcycle_BTCUSDT_LONG_ta1');
    expect(plan.assignments.find(row=>row.fillId==='a3')?.physicalCycleId).toBe('pcycle_BTCUSDT_LONG_ta3');
    expect(plan.assignments.find(row=>row.fillId==='a3')?.openedAt).toBe(now-80_000);
    expect(plan.assignments.find(row=>row.fillId==='s1')?.physicalCycleId).toBe('pcycle_BTCUSDT_SHORT_ts1');
    expect(plan.unproven.map(row=>row.reason)).toEqual(['HOLDING_STILL_OPEN_AT_LAST_FILL','HOLDING_STILL_OPEN_AT_LAST_FILL']);
    expect(plan.superseded).toEqual([]);
  });

  it('reports a negative running quantity instead of inventing a boundary',()=>{
    const fills=[
      fill({fillId:'b1',tradeId:'tb1',symbol:'ETHUSDT',side:'BUY',qty:1,executionTime:now-50_000}),
      fill({fillId:'b2',tradeId:'tb2',symbol:'ETHUSDT',side:'SELL',qty:3,executionTime:now-40_000}),
    ];
    const plan=planCycleBackfill({fills,records:[]});
    expect(plan.inconsistent).toEqual([{symbol:'ETHUSDT',side:'LONG',physicalCycleId:'pcycle_ETHUSDT_LONG_tb1',remainingQty:-2,fillId:'b2'}]);
    // The contradictory exit gets no cycle id, so the apply step has nothing to write for it.
    expect(plan.assignments.map(row=>row.fillId)).toEqual(['b1']);
    expect(plan.assignments.map(row=>row.reason)).toEqual(['CYCLE_OPENED_ON_THIS_FILL']);
    expect(plan.unproven).toEqual([{symbol:'ETHUSDT',side:'LONG',tradeId:'tb2',reason:'EXIT_LARGER_THAN_RUNNING_QUANTITY'}]);
    expect(plan.summary).toEqual({fills:2,assigned:1,cycles:1,unproven:1,inconsistent:1});
  });

  it('leaves an exit with no opening fill unproven rather than backdating a cycle',()=>{
    const plan=planCycleBackfill({fills:[
      fill({fillId:'z1',tradeId:'tz1',symbol:'SOLUSDT',side:'SELL',qty:2,executionTime:now-30_000}),
      fill({fillId:'z2',tradeId:'tz2',symbol:'SOLUSDT',side:'BUY',qty:2,executionTime:now-20_000}),
    ],records:[]});
    expect(plan.assignments).toEqual([]);
    expect(plan.summary).toEqual({fills:2,assigned:0,cycles:0,unproven:2,inconsistent:0});
    expect(plan.unproven.map(row=>row.reason)).toEqual(['EXIT_WITHOUT_OPENING_FILL','LEDGER_UNTRUSTED_AFTER:EXIT_WITHOUT_OPENING_FILL']);
  });

  it('names the audited record shape it supersedes without deleting anything',()=>{
    const fills=[
      fill({fillId:'r1',tradeId:'tr1',symbol:'BNBUSDT',side:'BUY',qty:6,executionTime:now-30_000}),
      fill({fillId:'r2',tradeId:'tr2',symbol:'BNBUSDT',side:'SELL',qty:6,executionTime:now-20_000}),
    ];
    const records=[record({tradeId:'tr1',cycleId:'cycle_entry1',linkedFillIds:['r1'],remainingQty:-6}),
      record({tradeId:'tr2',cycleId:'pcycle_BNBUSDT_LONG_tr1',linkedFillIds:['r2']})];
    const plan=planCycleBackfill({fills,records});
    expect(plan.superseded).toEqual([{oldTradeId:'tr1',oldCycleId:'cycle_entry1',newPhysicalCycleId:'pcycle_BNBUSDT_LONG_tr1',
      reason:'QUANTITY_NEGATIVE_UNDER_ENTRY_ORDER_KEYING'}]);
    const longOnly=planCycleBackfill({fills,records:[record({tradeId:'tr1',cycleId:'cycle_entry1',linkedFillIds:['r1'],remainingQty:6})]});
    expect(longOnly.superseded[0].reason).toBe('ENTRY_ORDER_KEYED_RECORD_SPANS_ONE_PHYSICAL_HOLDING');
    // A record already keyed on the physical cycle is left alone, so re-running the repair is a no-op.
    const already=planCycleBackfill({fills,records:[record({tradeId:'tr1',cycleId:'pcycle_BNBUSDT_LONG_tr1',linkedFillIds:['r1']})]});
    expect(already.superseded).toEqual([]);
    // The same for a record whose additive `positionCycleId` was written by an earlier apply: its
    // legacy cycleId stays, but the plan must not list it again.
    const repaired=planCycleBackfill({fills,records:[record({tradeId:'tr1',cycleId:'cycle_entry1',linkedFillIds:['r1'],positionCycleId:'pcycle_BNBUSDT_LONG_tr1'})]});
    expect(repaired.superseded).toEqual([]);
  });

  it('is deterministic and re-runnable: the same inputs yield the identical plan',()=>{
    const fills=[
      fill({fillId:'d1',tradeId:'td1',symbol:'XRPUSDT',side:'BUY',qty:10,executionTime:now-40_000}),
      fill({fillId:'d2',tradeId:'td2',symbol:'XRPUSDT',side:'BUY',qty:10,executionTime:now-39_000}),
      fill({fillId:'d3',tradeId:'td3',symbol:'XRPUSDT',side:'SELL',qty:20,executionTime:now-30_000}),
    ];
    const records=[record({tradeId:'td1',linkedFillIds:['d1']}),record({tradeId:'td2',linkedFillIds:['d2']})];
    const first=planCycleBackfill({fills,records});
    expect(first.superseded.map(row=>row.oldTradeId)).toEqual(['td1','td2']);
    expect(planCycleBackfill({fills:[...fills].reverse(),records:[...records].reverse()})).toEqual(first);
    expect(JSON.stringify(first)).toBe(JSON.stringify(planCycleBackfill({fills,records})));
  });

  it('ignores fills with no exchange trade identity and still assigns them to the holding',()=>{
    const plan=planCycleBackfill({fills:[
      fill({fillId:'n1',tradeId:'',symbol:'ADAUSDT',side:'BUY',qty:5,executionTime:now-10_000}),
    ],records:[]});
    expect(plan.assignments[0]).toMatchObject({fillId:'n1',physicalCycleId:'pcycle_ADAUSDT_LONG_',tradeId:''});
    expect(plan.unproven).toEqual([{symbol:'ADAUSDT',side:'LONG',tradeId:null,reason:'HOLDING_STILL_OPEN_AT_LAST_FILL'}]);
  });
});

describe('P2 conservation re-label plan',()=>{
  const cycleFills=(symbol:string,cycleId:string,rows:Array<{fillId:string;side:'BUY'|'SELL';qty:number}>):ExecutionFill[]=>rows.map(row=>fill(any({
    fillId:row.fillId,tradeId:`t_${row.fillId}`,symbol,side:row.side,qty:row.qty,executionTime:now,cycleId,
  })));
  const openRecord=over=>record(any({tradeId:'rec_open',symbol:'ETHUSDT',direction:'LONG',status:'OPEN',cycleId:'cyc_1',
    entryOrderIds:['o1'],linkedFillIds:['e1'],remainingQty:6,ledgerConservation:null,...over}));

  it('re-labels an open holding that the old rule wrongly called UNCONSERVED',()=>{
    const fills=cycleFills('ETHUSDT','cyc_1',[{fillId:'e1',side:'BUY',qty:6}]);
    const plan=planConservationRelabel({records:[openRecord({ledgerConservation:'UNCONSERVED'})],fills});
    expect(plan.rows).toEqual([{tradeId:'rec_open',from:'UNCONSERVED',to:'CONSERVED',reason:'REDERIVED_FROM_1_FILLS'}]);
    expect(plan.summary).toEqual({records:1,relabelled:1,alreadyCorrect:0,unproven:0});
  });

  it('leaves a correct label alone so a re-run is a no-op',()=>{
    const fills=cycleFills('ETHUSDT','cyc_1',[{fillId:'e1',side:'BUY',qty:6}]);
    const once=planConservationRelabel({records:[openRecord({ledgerConservation:'UNCONSERVED'})],fills});
    const relabelled=[openRecord({ledgerConservation:once.rows[0].to})];
    expect(planConservationRelabel({records:relabelled,fills})).toEqual({rows:[],summary:{records:1,relabelled:0,alreadyCorrect:1,unproven:0}});
  });

  it('reports a trade that says CLOSED without a flat ledger, and a negative ledger as inconsistent',()=>{
    const partFilled=cycleFills('ETHUSDT','cyc_1',[{fillId:'e1',side:'BUY',qty:6},{fillId:'x1',side:'SELL',qty:4}]);
    expect(planConservationRelabel({records:[openRecord({status:'CLOSED'})],fills:partFilled}).rows[0]).toMatchObject({to:'UNCONSERVED'});
    const overshoot=cycleFills('ETHUSDT','cyc_1',[{fillId:'e1',side:'BUY',qty:6},{fillId:'x1',side:'SELL',qty:9}]);
    expect(planConservationRelabel({records:[openRecord({status:'PARTIALLY_CLOSED'})],fills:overshoot}).rows[0]).toMatchObject({to:'LEDGER_INCONSISTENT'});
  });

  it('does not invent a label when no fill belongs to the cycle',()=>{
    const plan=planConservationRelabel({records:[openRecord({ledgerConservation:'CONSERVED'})],fills:cycleFills('SOLUSDT','other',[{fillId:'e9',side:'BUY',qty:1}])});
    expect(plan.rows).toEqual([]);
    expect(plan.summary).toEqual({records:1,relabelled:0,alreadyCorrect:0,unproven:1});
  });

  it('is order-stable and only ever reports the label as the thing it changes',()=>{
    const fills=cycleFills('ETHUSDT','cyc_1',[{fillId:'e1',side:'BUY',qty:6}]);
    const records=[openRecord({tradeId:'rec_b',ledgerConservation:'UNCONSERVED'}),openRecord({tradeId:'rec_a',ledgerConservation:'UNCONSERVED'})];
    const plan=planConservationRelabel({records,fills});
    expect(plan.rows.map(row=>row.tradeId)).toEqual(['rec_a','rec_b']);
    expect(JSON.stringify(planConservationRelabel({records:[...records].reverse(),fills:[...fills].reverse()})))
      .toBe(JSON.stringify(plan));
    expect(Object.keys(plan.rows[0]).sort()).toEqual(['from','reason','to','tradeId']);
  });
});

describe('P0 repair audit record',()=>{
  it('records the mode, the exact identities touched and what stayed UNKNOWN',()=>{
    const base={job:'exit-claim-convergence',environment:'TESTNET',accountId:'binance-primary',
      plan:{rows:[{clientOrderId:'v396xbr'}]},identityKeys:['v396xbr'],leftUnknown:['v396xwld:NO_ACCEPTED_EXCHANGE_EVIDENCE']};
    const preview=repairAuditRecord({...base,preview:true});
    const applied=repairAuditRecord({...base,preview:false,applied:{released:1}});
    expect(preview).toMatchObject({kind:'V396_TRADING_LOOP_REPAIR',mode:'PREVIEW',applied:null,leftUnknown:base.leftUnknown});
    expect(applied).toMatchObject({mode:'APPLY',applied:{released:1}});
    expect(applied.idempotencyKey).toBe('exit-claim-convergence:TESTNET:binance-primary:v396xbr');
    expect(preview.idempotencyKey).toBe(applied.idempotencyKey);
    expect(JSON.stringify(preview)).not.toMatch(/apiSecret|apiKey|secret|token/i);
  });
});
