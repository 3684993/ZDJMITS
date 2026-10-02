import {describe,expect,it} from 'vitest';
import {executionTruthProjection} from './projections.js';

/**
 * The execution-truth split the audit asked for, asserted on the projection itself. Each check has to
 * say which fact it is standing on, and an absence must read as an absence: a ledger that was never
 * read and a ledger that was read and found nothing are different answers, and only the first one may
 * be called UNKNOWN-by-omission.
 */

const record=(over:any)=>({tradeId:over.tradeId??`tr_${Math.random().toString(36).slice(2)}`,symbol:'BTCUSDT',direction:'LONG',
  status:'CLOSED',ledgerConservation:'CONSERVED',fundingAttributionStatus:'UNKNOWN',integrityFlags:[],...over});

const stub=(over:{records?:any[];funding?:any}={})=>({
  state:{tradeRecords:new Map((over.records??[]).map(row=>[row.tradeId,row])),positions:new Map(),entryOrders:new Map(),
    tpOrders:new Map(),manualOrders:new Map(),settings:{riskGovernance:{}}},
  health:()=>[],
  fundingIncomeCoverage:()=>over.funding??null,
} as never) as any;

describe('P7 execution truth split',()=>{
  it('answers eight separate questions instead of one HEALTHY label',()=>{
    const truth=executionTruthProjection(stub(),1_000) as any;
    expect(Object.keys(truth).sort()).toEqual(['activeCommissions','evaluatedAt','exchangeIngestion','exitClaimConvergence','fillCycleConservation',
      'fundingCoverage','orderTerminalParity','positionCoverage','reviewAuthority','reviewCycles','takeProfitCoverage']);
    for(const key of ['exchangeIngestion','orderTerminalParity','exitClaimConvergence','takeProfitCoverage','positionCoverage','fillCycleConservation','fundingCoverage','reviewAuthority'])
      expect(truth[key].status, key).toBeTruthy();
  });

  it('separates an unattached income reader from a completed read that found nothing',()=>{
    const never=executionTruthProjection(stub({funding:{complete:false,rows:0,coveredSinceMs:null,coveredUntilMs:null}}),1_000) as any;
    expect(never.fundingCoverage).toMatchObject({status:'UNKNOWN',incomeRows:0,coverageComplete:false,lastSync:null});
    expect(never.fundingCoverage.detail).toContain('lastSync=NEVER_RAN');

    const skipped=executionTruthProjection(stub({funding:{complete:false,rows:0,lastSync:{at:900,rows:0,failures:0,symbolsScanned:0,skipped:'INCOME_READER_UNAVAILABLE'}}}),1_000) as any;
    expect(skipped.fundingCoverage.lastSync).toMatchObject({skipped:'INCOME_READER_UNAVAILABLE'});
    expect(skipped.fundingCoverage.detail).toContain('lastSync=INCOME_READER_UNAVAILABLE');

    const emptyButProved=executionTruthProjection(stub({funding:{complete:true,rows:0,coveredSinceMs:1,coveredUntilMs:900,
      lastSync:{at:900,rows:0,failures:0,symbolsScanned:40,skipped:null}}}),1_000) as any;
    expect(emptyButProved.fundingCoverage).toMatchObject({status:'HEALTHY',coverageComplete:true,
      lastSync:{rows:0,failures:0,symbolsScanned:40}});
    expect(emptyButProved.fundingCoverage.detail).toContain('lastSync=rows 0/failures 0/symbols 40');
    // The never-ran shape is complete enough for the snapshot schema to accept it.
    const neverShape=executionTruthProjection(stub({funding:{complete:false,rows:0,coveredSinceMs:null,coveredUntilMs:null,
      lastSync:{at:null,rows:0,failures:0,symbolsScanned:0,skipped:'NEVER_RAN'}}}),1_000) as any;
    expect(neverShape.fundingCoverage.lastSync).toMatchObject({at:null,rows:0,skipped:'NEVER_RAN'});
  });

  it('counts an open holding as conserved and only alarms on a contradiction',()=>{
    const truth=executionTruthProjection(stub({records:[
      record({tradeId:'flat'}),record({tradeId:'open',status:'OPEN',ledgerConservation:'CONSERVED'}),
      record({tradeId:'bad',status:'PARTIALLY_CLOSED',ledgerConservation:'UNCONSERVED'}),
      record({tradeId:'negative',status:'INCOMPLETE',ledgerConservation:'LEDGER_INCONSISTENT',integrityFlags:['LEDGER_INCONSISTENT']}),
      record({tradeId:'noFill',ledgerConservation:undefined}),
    ]}),1_000) as any;
    expect(truth.fillCycleConservation).toMatchObject({status:'DEGRADED',ledgerInconsistent:1,unconserved:1,conserved:2,openConserved:1,unproven:1});
    expect(truth.fillCycleConservation.detail).toContain('conserved=2(open 1/closed 1)');
  });

  it('splits active commissions into four answers and never merges an unresolved local row',()=>{
    const runtime=stub();
    runtime.state.entryOrders.set('e1',{id:'e1',symbol:'BTCUSDT',status:'WORKING',exchangeOrderId:'x1',factSource:'BINANCE_OPEN_ORDERS'} as never);
    runtime.state.tpOrders.set('t1',{id:'t1',symbol:'BTCUSDT',status:'WORKING',exchangeOrderId:'t9',factSource:'BINANCE_EXACT_ORDER'} as never);
    runtime.state.manualOrders.set('m1',{id:'m1',symbol:'BTCUSDT',status:'WORKING',exchangeOrderId:null,factSource:'LOCAL'} as never);
    runtime.state.tpOrders.set('t2',{id:'t2',symbol:'ETHUSDT',status:'UNKNOWN',exchangeOrderId:null} as never);
    const commissions=(executionTruthProjection(runtime,1_000) as any).activeCommissions;
    expect(commissions).toMatchObject({remoteConfirmedEntry:1,remoteConfirmedTakeProfit:1,manual:1,localUnresolvedUnknown:1});
    expect(commissions.remoteConfirmedTakeProfit+commissions.localUnresolvedUnknown).toBeGreaterThanOrEqual(2);
  });

  it('reports the review authority from the runner and the scheduler together, not a label',()=>{
    const runtime=stub();
    runtime.positionReviewRunner={lastOutcome:()=>({lastTickAt:800,lastVerdictAt:700,lastDecision:'HOLD',lastReason:null,usable:true,enabled:true,
      considered:4,reserved:1,completed:3,discarded:0,failed:0,skippedReason:null})};
    runtime.positionReviewScheduler={reviewReadback:()=>({due:2,exhausted:0,failureBlocked:0,rows:[]}),dueCount:()=>2};
    const review=(executionTruthProjection(runtime,1_000) as any).reviewAuthority;
    expect(review.status).toBe('DISABLED');
    expect(review.lastOutcome).toMatchObject({enabled:true,considered:4,completed:3,due:2});
    expect(review.lastOutcome.lastOutcome).toBeUndefined();
  });

  it('counts only actionable 60/90 minute milestones as scheduled due',()=>{
    const runtime=stub();
    runtime.state.settings.riskGovernance.exitCoordination={positionReviewEnabled:true};
    runtime.positionReviewRunner={lastOutcome:()=>null};
    runtime.positionReviewScheduler={reviewReadback:()=>({due:9,exhausted:0,failureBlocked:0,rows:[]}),dueCount:()=>9};
    runtime.state.positions.set('before60',{id:'before60',symbol:'BTCUSDT',cycleId:'c1',reviewTimeline:{
      thesisDueAt:2_000,thesisAttemptedAt:null,thesisStatus:'PENDING',timeStopDueAt:3_000,timeStopAttemptedAt:null,timeStopStatus:'PENDING',timeStopDecision:null}} as never);
    expect((executionTruthProjection(runtime,1_999) as any).reviewAuthority.scheduledDue).toBe(0);
    expect((executionTruthProjection(runtime,2_000) as any).reviewAuthority.scheduledDue).toBe(1);
    // At 90m the time-stop decision replaces the unattempted thesis review; it is one obligation.
    expect((executionTruthProjection(runtime,3_000) as any).reviewAuthority.scheduledDue).toBe(1);
    runtime.state.positions.set('before60',{...(runtime.state.positions.get('before60') as any),reviewTimeline:{
      ...(runtime.state.positions.get('before60') as any).reviewTimeline,thesisStatus:'MISSED',timeStopStatus:'APPLIED',timeStopDecision:'HOLD'}} as never);
    expect((executionTruthProjection(runtime,3_001) as any).reviewAuthority.scheduledDue).toBe(0);
  });
});
