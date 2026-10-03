import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {V396ExitRuntime} from './v396ExitRuntime.js';
import {ONE_WAY_CAPABILITIES} from './v396ExitTestHarness.js';
import {AiUsageLedger,aiUsageEventSetHash,aiUsageRowOf,tokenSavingRatio,type AiUsageRole,type AiUsageRow,type AiUsageStatus} from './aiUsageLedger.js';
import {PositionReviewScheduler,reviewTriggerKeyOf,type ReviewVersions} from './positionReviewScheduler.js';
import {PositionReviewRunner} from './positionReviewRunner.js';
import {buildPositionReviewPrompt,parsePositionReview} from './positionReviewPrompt.js';
import {attributeCycleOutcome,memoryCycleOf,returnSamples,retrieveTradeMemory} from './tradeMemoryRetriever.js';
import {memoryCycleOfRecord,reviewMemoryFor,tradeMemoryVersionOf} from './tradeMemoryService.js';
import {EventBus} from '../events/eventBus.js';

/**
 * J4 / S07 acceptance: bounded review, the usage ledger that survives failure, and trade memory that
 * refuses to count what it does not know.
 *
 * The recurring shape here is "the model said something convenient and the system still had to say
 * no": a human-owned cycle gets no routine call, a late answer is archived rather than applied, a
 * missing token count stays missing, an all-winner sample is reported as a coverage hole, and running
 * out of budget stops inference without ever stopping a deadline, a take-profit or a handoff.
 */

const dirs:string[]=[];
afterEach(()=>{while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* busy handle */}}});
const any=(value:unknown)=>value as any;
const identity={environment:'TESTNET',account:'binance-primary'};
const SUBJECT={symbol:'BTCUSDT',side:'LONG' as const,cycleId:'cycle_j4',openedAt:1_000};
const SCOPE=JSON.stringify([identity.environment,identity.account,'BTCUSDT','LONG']);
const NOW=1_800_000_000_000;
let sequence=0;
const usage=(inputTokens:number|null,outputTokens:number|null,over:{requestKey?:string;role?:AiUsageRole;status?:AiUsageStatus}={})=>aiUsageRowOf({
  requestKey:over.requestKey??`req_${++sequence}`,role:over.role??'ENTRY',status:over.status??'COMPLETED',
  inputTokens,outputTokens,promptHash:'ph',triggerReason:'TEST',symbol:'BTCUSDT',startedAt:NOW});

function versions(over:Partial<ReviewVersions>={}):ReviewVersions{
  return{planVersion:1,planRef:'plan_j4_v1',ownerVersion:1,positionVersion:1,settingsVersion:20,riskGeneration:11,
    snapshotHash:`v396r${'a'.repeat(64)}`,evidenceVersion:'bar-1',memoryVersion:'mem-1',...over};
}

/** The plan facts an exit reads, shaped exactly like `aiExitPlanFactsOf` so a drift in either is a red. */
function planFacts(over:Partial<{thesisInvalid:boolean;invalidationPredicate:string;invalidationEvidenceRefs:string[]}>={}){
  return{planRef:'plan_j4_v1',planVersion:1,thesisInvalid:over.thesisInvalid??false,
    invalidationPredicate:over.invalidationPredicate??'NO_PREDICATE',invalidationEvidenceRefs:over.invalidationEvidenceRefs??[],
    exitConditionMet:false,minNetProfitUsd:1,managementDeadline:3_600_000,horizonElapsed:false};
}

function fixture(settings:Partial<{normal:number;exception:number;failures:number;minInterval:number;ttl:number}>={}){
  const dir=mkdtempSync(join(tmpdir(),'zdj-v396-j4-'));dirs.push(dir);
  const exitRuntime=new V396ExitRuntime(join(dir,'v396-ownership.sqlite'),()=>identity,async()=>ONE_WAY_CAPABILITIES,()=>({aiExitAuthority:'OFF' as const}));
  const state:any={aiUsage:new Map(),aiUsageDroppedRows:0,positionReviews:new Map(),reviewBudgets:new Map(),tradePlans:new Map(),
    positions:new Map(),tradeRecords:new Map(),snapshots:new Map(),settings:{settingsVersion:20},runtimeControl:{capital:{generation:11}},riskLedger:null};
  const events=new EventBus();
  const seen:any[]=[];events.on('event',event=>seen.push(event));
  const ledger=new AiUsageLedger(state);
  const scheduler=new PositionReviewScheduler({
    ledger,
    settings:()=>({normalReviewsPerPlan:settings.normal??2,exceptionReviewsPerPlan:settings.exception??1,failureBudget:settings.failures??2,
      minIntervalMs:settings.minInterval??300_000,authorityTtlMs:settings.ttl??20_000}),
    ownerOf:(scope:string,cycleId:string)=>{const owner=exitRuntime.ownerOfScope(scope,cycleId);
      return owner?{ownerState:String(owner.ownerState),ownerVersion:Number(owner.ownerVersion),deadline:owner.deadline??null}:null;},
  });
  return{dir,exitRuntime,state,events,seen,ledger,scheduler};
}

/** A cycle genuinely under AI management, holding the durable deadline its plan was written with. */
function aiManaged(x:ReturnType<typeof fixture>,now=NOW){
  const owner=x.exitRuntime.fixManagementDeadline(SUBJECT,3_600_000,now-60_000,'plan_j4_v1')??x.exitRuntime.owner(SUBJECT);
  expect(owner.ownerState).toBe('AI_ACTIVE');
  return owner;
}

/** The state a position gets when protection was established without ever granting AI authority. */
function handoffPending(x:ReturnType<typeof fixture>){
  x.exitRuntime.ensureGuardianMandate(SUBJECT,95,NOW-1_000);
  return x.exitRuntime.owner(SUBJECT);
}

const reserve=(x:ReturnType<typeof fixture>,over:Partial<ReviewVersions>={},at=NOW,trigger:'SCHEDULED'|'PREDICATE'|'MANUAL_REQUEST'='SCHEDULED')=>
  x.scheduler.reserve({positionId:'pos_j4',cycleId:SUBJECT.cycleId,scope:SCOPE,versions:versions(over),trigger,now:at});

describe('S07-T01 human-managed cycles get zero routine model calls',()=>{
  it('refuses a HANDOFF_PENDING cycle before spending anything, and records that the call was zero',()=>{
    const x=fixture();
    expect(handoffPending(x).ownerState).toBe('HANDOFF_PENDING');
    const result=reserve(x);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe('OWNER_NOT_REVIEWABLE:HANDOFF_PENDING');
    expect(any(result).zeroRoutineCall).toBe(true);
    expect(x.ledger.rows()).toHaveLength(0);
    expect(x.scheduler.state()).toHaveLength(0);
  });

  it('permits evidence-only review after human takeover without restoring execution authority',()=>{
    const x=fixture();aiManaged(x);
    expect(reserve(x,{},NOW).granted).toBe(true);
    x.exitRuntime.recordHumanTakeover(SUBJECT,'OPERATOR_TOOK_OVER',NOW+1_000);
    const owner=x.exitRuntime.owner(SUBJECT)!;
    const after=reserve(x,{positionVersion:2,ownerVersion:owner.ownerVersion},NOW+400_000);
    expect(after.granted).toBe(true);
    expect(any(after).ticket).toMatchObject({reviewOnly:true,ownerVersion:owner.ownerVersion});
  });

  it('treats an untracked cycle as not AI-owned rather than as a default authority',()=>{
    const x=fixture();
    expect(reserve(x).reason).toBe('OWNER_UNTRACKED');
    expect(x.ledger.rows()).toHaveLength(0);
  });
});

describe('S07-T03 identical facts never cost a second request',()=>{
  it('deduplicates the same fact set and keeps the spent budget where it was',()=>{
    const x=fixture();aiManaged(x);
    expect(reserve(x).granted).toBe(true);
    const again=reserve(x);
    expect(again.granted).toBe(false);
    expect(again.reason).toBe('REVIEW_FACTS_UNCHANGED');
    expect(any(again).deduplicated).toBe(true);
    expect(x.scheduler.state()[0].used).toBe(1);
  });

  it('caps routine reviews at the configured number, so the bound exists in fact',()=>{
    const x=fixture({normal:2});aiManaged(x);
    expect(reserve(x,{},NOW).granted).toBe(true);
    expect(reserve(x,{positionVersion:2},NOW+400_000).granted).toBe(true);
    const third=reserve(x,{positionVersion:3},NOW+800_000);
    expect(third.granted).toBe(false);
    expect(third.reason).toBe('REVIEW_BUDGET_EXHAUSTED');
    expect(x.scheduler.state()[0].used).toBe(2);
  });

  it('refuses to compress two requests inside the minimum interval',()=>{
    const x=fixture({minInterval:300_000});aiManaged(x);
    expect(reserve(x,{},NOW).granted).toBe(true);
    expect(reserve(x,{positionVersion:2},NOW+30_000).reason).toBe('REVIEW_MIN_INTERVAL_NOT_ELAPSED');
  });

  it('counts a failure against a separate budget and stops asking a dead endpoint',()=>{
    const x=fixture({normal:8,failures:2});aiManaged(x);
    for(const index of [0,1]){
      const ticket=any(reserve(x,{positionVersion:index+1},NOW+index*400_000)).ticket;
      expect(ticket).toBeTruthy();
      x.scheduler.accept(ticket,{now:ticket.reservedAt+10,usage:{inputTokens:null,outputTokens:null},
        status:'FAILED',promptHash:'missing-prompt-hash'});
    }
    expect(reserve(x,{positionVersion:9},NOW+2_000_000).reason).toBe('REVIEW_FAILURE_BUDGET_EXHAUSTED');
    // A call that never reached a model refunds its review slot, so the stop above is the failure
    // budget doing its job rather than a count of attempts.
    const budget=x.scheduler.state()[0];
    expect(budget.failures).toBe(2);
    expect(budget.used).toBe(0);
    const rows=x.ledger.forBudget(budget.budgetKey);
    expect(rows).toHaveLength(2);
    expect(rows.every(row=>row.status==='FAILED')).toBe(true);
  });
});

describe('S07-T04 any fact that could change the answer invalidates the previous one',()=>{
  it.each([['riskGeneration',12],['snapshotHash',`v396r${'b'.repeat(64)}`],['settingsVersion',21],['memoryVersion','mem-2'],
    ['evidenceVersion','bar-2'],['planVersion',2],['positionVersion',4]])('a changed %s produces a different trigger key',(field,value)=>{
    const base=reviewTriggerKeyOf({scope:SCOPE,cycleId:SUBJECT.cycleId,versions:versions(),now:NOW});
    const moved=reviewTriggerKeyOf({scope:SCOPE,cycleId:SUBJECT.cycleId,versions:versions({[field]:value} as Partial<ReviewVersions>),now:NOW});
    expect(moved).not.toBe(base);
  });

  it('refuses an owner version that moved between the read and the reservation',()=>{
    const x=fixture();aiManaged(x);
    expect(reserve(x,{ownerVersion:7}).reason).toBe('OWNER_VERSION_DRIFT');
  });

  it('refuses a review after the management deadline, which is not a renewal channel',()=>{
    const x=fixture();
    x.exitRuntime.fixManagementDeadline(SUBJECT,60_000,NOW-60_000,'plan_j4_v1');
    expect(reserve(x,{},NOW+120_000).reason).toBe('AI_MANAGEMENT_DEADLINE_ELAPSED');
  });
});

describe('S07-T02 an answer that arrives after the authority moved is archived, not applied',()=>{
  const ticketOf=(x:ReturnType<typeof fixture>,at=NOW)=>any(reserve(x,{},at)).ticket;

  it('keeps the budget spent when the answer arrived late but real',()=>{
    const x=fixture({ttl:20_000});aiManaged(x);const ticket=ticketOf(x);
    const applied=x.scheduler.accept(ticket,{now:ticket.expiresAt+1,
      usage:{inputTokens:1_200,outputTokens:80},status:'COMPLETED',promptHash:'ph'});
    expect(applied.usable).toBe(false);
    expect(applied.reason).toBe('REVIEW_AUTHORITY_WINDOW_CLOSED');
    expect(applied.archived).toBe(true);
    expect(x.scheduler.state()[0].used).toBe(1);
    expect(x.ledger.rows()).toHaveLength(1);
  });

  it('refuses a verdict whose ownership moved during the model call',()=>{
    const x=fixture();aiManaged(x);const ticket=ticketOf(x);
    x.exitRuntime.recordHumanTakeover(SUBJECT,'OPERATOR_TOOK_OVER',NOW+1_000);
    const applied=x.scheduler.accept(ticket,{now:ticket.reservedAt+5_000,
      usage:{inputTokens:1_200,outputTokens:80},status:'COMPLETED',promptHash:'ph'});
    expect(applied.usable).toBe(false);
    expect(applied.reason).toBe('OWNER_AUTHORITY_CHANGED:HUMAN_MANAGED');
  });

  it('re-reads ownership from the journal instead of believing what the caller reports',()=>{
    const read:{owner:{ownerState:string;ownerVersion:number;deadline:number|null}|null}={owner:{ownerState:'AI_ACTIVE',ownerVersion:1,deadline:NOW+3_600_000}};
    const state:any={aiUsage:new Map(),aiUsageDroppedRows:0};
    const ledger=new AiUsageLedger(state);
    const scheduler=new PositionReviewScheduler({ledger,
      settings:()=>({normalReviewsPerPlan:2,exceptionReviewsPerPlan:1,failureBudget:2,minIntervalMs:300_000,authorityTtlMs:20_000}),
      ownerOf:()=>read.owner});
    const ticket=any(scheduler.reserve({positionId:'pos_j4',cycleId:SUBJECT.cycleId,scope:SCOPE,versions:versions(),trigger:'SCHEDULED',now:NOW})).ticket;
    // The management authority moved while the model was thinking.
    read.owner={ownerState:'AI_ACTIVE',ownerVersion:2,deadline:NOW+3_600_000};
    const applied=scheduler.accept(ticket,{now:ticket.reservedAt+1_000,usage:{inputTokens:1_200,outputTokens:80},
      status:'COMPLETED',promptHash:'ph'});
    expect(applied.reason).toBe('OWNER_VERSION_CHANGED_DURING_MODEL_CALL');
    expect(applied.usable).toBe(false);
    read.owner=null;
    expect(scheduler.accept(ticket,{now:ticket.reservedAt+1_000,usage:{inputTokens:1,outputTokens:1},status:'COMPLETED',promptHash:'ph'}).reason)
      .toBe('OWNER_UNTRACKED_AT_CALLBACK');
  });

  it('refuses the instant the deadline passes while the call is in flight',()=>{
    const x=fixture({ttl:7_200_000});
    x.exitRuntime.fixManagementDeadline(SUBJECT,3_600_000,NOW-60_000,'plan_j4_v1');
    const ticket=any(x.scheduler.reserve({positionId:'pos_j4',cycleId:SUBJECT.cycleId,scope:SCOPE,versions:versions(),trigger:'SCHEDULED',now:NOW})).ticket;
    const applied=x.scheduler.accept(ticket,{now:ticket.reservedAt+3_700_000,
      usage:{inputTokens:1_200,outputTokens:80},status:'COMPLETED',promptHash:'ph'});
    expect(applied.reason).toBe('AI_MANAGEMENT_DEADLINE_ELAPSED_DURING_MODEL_CALL');
  });

  it('finalizes the row the reservation opened, so one request is one row',()=>{
    const x=fixture();aiManaged(x);const ticket=ticketOf(x);
    expect(x.ledger.rows()[0]).toMatchObject({status:'RUNNING',usageStatus:'UNKNOWN',role:'REVIEW'});
    expect(x.ledger.totals().computable).toBe(false);
    x.scheduler.accept(ticket,{now:ticket.reservedAt+10,usage:{inputTokens:900,outputTokens:40},status:'COMPLETED',promptHash:'ph'});
    expect(x.ledger.rows()).toHaveLength(1);
    expect(x.ledger.rows()[0]).toMatchObject({status:'COMPLETED',usageStatus:'EXACT'});
  });

  it('a restart never refunds a budget that was already spent',()=>{
    const x=fixture();aiManaged(x);
    const ticket=ticketOf(x);
    x.scheduler.accept(ticket,{now:ticket.reservedAt+10,usage:{inputTokens:1,outputTokens:1},status:'COMPLETED',promptHash:'ph'});
    const persisted=JSON.parse(JSON.stringify(x.scheduler.serialize()));
    const restarted=fixture();aiManaged(restarted);
    restarted.scheduler.restore(persisted);
    expect(restarted.scheduler.state()[0].used).toBe(1);
    expect(reserve(restarted).reason).toBe('REVIEW_FACTS_UNCHANGED');
  });
});

describe('S07-T08 usage is either reported or UNKNOWN, and an answer cannot carry entry authority',()=>{
  it('records a missing server usage as UNKNOWN and refuses to compute a total from it',()=>{
    const x=fixture();aiManaged(x);const ticket=any(reserve(x)).ticket;
    x.scheduler.accept(ticket,{now:ticket.reservedAt+10,usage:{inputTokens:null,outputTokens:null},
      status:'COMPLETED',promptHash:'ph'});
    const row=x.ledger.rows()[0];
    expect(row.usageStatus).toBe('UNKNOWN');
    expect(row.inputTokens).toBeNull();
    expect(row.outputTokens).toBeNull();
    const totals=x.ledger.totals();
    expect(totals.computable).toBe(false);
    expect(totals.totalTokens).toBeNull();
    expect(totals.unknownUsage).toBe(1);
  });

  it('marks a length-truncated answer as truncated and counts it as a failure',()=>{
    const x=fixture();aiManaged(x);const ticket=any(reserve(x)).ticket;
    x.scheduler.accept(ticket,{now:ticket.reservedAt+10,usage:{inputTokens:4_000,outputTokens:600},
      status:'TRUNCATED',finishReason:'length',promptHash:'ph'});
    expect(x.ledger.rows()[0].truncated).toBe(true);
    expect(x.ledger.totals().failures).toBe(1);
    expect(x.scheduler.state()[0].failures).toBe(1);
    // A truncated answer did reach the model, so it is not refunded.
    expect(x.scheduler.state()[0].used).toBe(1);
  });

  it('finalizes a row once and never lets a late duplicate overwrite the answer',()=>{
    const ledger=new AiUsageLedger({aiUsage:new Map(),aiUsageDroppedRows:0});
    const base={requestKey:'req_final',role:'ENTRY' as const,promptHash:'ph',triggerReason:'TEST',symbol:'BTCUSDT',startedAt:NOW};
    ledger.record(aiUsageRowOf({...base,status:'RUNNING'}));
    expect(ledger.record(aiUsageRowOf({...base,status:'COMPLETED',inputTokens:10,outputTokens:2})).written).toBe(true);
    const late=ledger.record(aiUsageRowOf({...base,status:'RUNNING'}));
    expect(late.written).toBe(false);
    expect(late.reason).toBe('USAGE_EVENT_ALREADY_FINALIZED');
    expect(ledger.rows()[0].status).toBe('COMPLETED');
  });

  it('rejects a review answer that smuggles entry fields, and one that asks for an exit with no evidence',()=>{
    expect(()=>parsePositionReview({decision:'PLACE_LONG',tradeSide:'LONG',quantityUnits:3,reason:'x'})).toThrow(/ENTRY_AUTHORITY/);
    expect(()=>parsePositionReview({decision:'EXIT_PROPOSAL',reason:'structure broke'})).toThrow(/REVIEW_EVIDENCE_MISSING/);
    expect(()=>parsePositionReview({decision:'REVERSE_NOW',reason:'x'})).toThrow(/REVIEW_DECISION_UNSUPPORTED/);
    expect(()=>parsePositionReview({decision:'HOLD'})).toThrow(/REVIEW_REASON_MISSING/);
    expect(parsePositionReview({decision:'HOLD',reason:'plan intact',evidenceRefs:[]})).toMatchObject({decision:'HOLD'});
    expect(parsePositionReview({decision:'REDUCE_PROPOSAL',reason:'depth deteriorated',evidenceRefs:['depth.fact']})).toMatchObject({decision:'REDUCE_PROPOSAL'});
  });

  it('keeps the review prompt explicit about what the model may not do',()=>{
    const request:any={symbol:'BTCUSDT',cycleId:SUBJECT.cycleId,positionId:'pos_j4',planRef:'plan_j4_v1',planVersion:1,reviewNumber:1,
      at:NOW,ownerVersion:1,triggerKey:'trg_x',factsHash:'fh',position:{side:'LONG',entryPrice:100,quantity:1,markPrice:99,
        unrealizedPnlUsd:-1,openedAt:NOW-60_000,managementDeadlineAt:NOW+3_540_000,remainingMs:3_540_000},
      plan:{side:'LONG',quantityUnits:1,entryReferencePrice:100,targetPrice:110,targetHorizonMinutes:60,thesis:'holds above 95',
        invalidationPredicate:'CLOSED_BAR_BREAKS_LEVEL',predicateEvidenceRefs:['ev-1'],minNetProfitUsd:1,maxRealizedLossUsd:10},
      budget:{normalReviewsPerPlan:2,exceptionReviewsPerPlan:1,used:0},memory:[]};
    const packet=any({symbol:'BTCUSDT',packetId:'pkt_1',createdAt:NOW,expiresAt:NOW+60_000,
      market:{quote:{ts:NOW,bid:99,ask:101,last:100,mark:100},technical:{},orderBook:{ts:NOW,bids:[[99,1]],asks:[[101,1]]},derivatives:{}},
      microstructure:{reachableBand1m:[99,101],spreadBps:2,bidDepthUsd5:99,askDepthUsd5:101,imbalance:0},
      executionEnvelope:{side:'LONG',maxQuantityUnits:3}});
    const prompt=buildPositionReviewPrompt(packet,request);
    expect(prompt).toContain('no order permission, no sizing permission');
    expect(prompt).toContain('"decision":"HOLD|REDUCE_PROPOSAL|EXIT_PROPOSAL|HANDOFF"');
    expect(prompt).toContain('not a review trigger');
    expect(prompt).toContain('plan_j4_v1');
  });

  it('evicts the oldest rows past its capacity and says so, instead of pretending to be history',()=>{
    const state={aiUsage:new Map<string,AiUsageRow>(),aiUsageDroppedRows:0};
    const ledger=new AiUsageLedger(state,3);
    for(const index of [1,2,3,4,5])ledger.record(aiUsageRowOf({requestKey:`req_${index}`,role:'ENTRY',status:'COMPLETED',
      inputTokens:10,outputTokens:5,promptHash:'ph',triggerReason:'TEST',symbol:'BTCUSDT',startedAt:NOW+index}));
    expect(ledger.rows()).toHaveLength(3);
    expect(ledger.droppedRows()).toBe(2);
    expect(ledger.truncated()).toBe(true);
    expect(ledger.totals().computable).toBe(false);
    expect(ledger.totals().droppedRows).toBe(2);
  });
});

describe('token saving is measured on a frozen event set or not at all',()=>{
  const baseline=[usage(4_000,900,{requestKey:'b1'}),usage(3_800,800,{requestKey:'b2'})];
  const bounded=[usage(1_200,300,{requestKey:'b1'}),usage(1_400,320,{requestKey:'b2'})];

  it('refuses to compare two different event sets',()=>{
    const result=tokenSavingRatio(baseline,bounded,{baselineHash:aiUsageEventSetHash(baseline),boundedHash:aiUsageEventSetHash(bounded)});
    expect(result.status).toBe('NOT_MEASURED');
    expect(result.reason).toBe('EVENT_SET_NOT_FROZEN');
    expect(result.savingPct).toBeNull();
  });

  it('reports NOT_MEASURED when either side failed to report usage',()=>{
    const partial=[usage(null,null,{requestKey:'u1'}),usage(3_800,800,{requestKey:'u2'})];
    const frozen=aiUsageEventSetHash(baseline);
    const result=tokenSavingRatio(partial,bounded,{baselineHash:frozen,boundedHash:frozen});
    expect(result.reason).toBe('USAGE_UNREPORTED');
    expect(result.savingPct).toBeNull();
  });

  it('reports NOT_MEASURED when the ledger had to drop rows',()=>{
    const frozen=aiUsageEventSetHash(baseline);
    const result=tokenSavingRatio(baseline,bounded,{baselineHash:frozen,boundedHash:frozen,baselineDroppedRows:1});
    expect(result.status).toBe('NOT_MEASURED');
    expect(result.reason).toBe('EVENT_SET_TRUNCATED');
  });

  it('passes only on a real 30 percent reduction over the same frozen set, and fails honestly below it',()=>{
    const frozen='set_frozen_for_this_test';
    const passing=tokenSavingRatio(baseline,bounded,{baselineHash:frozen,boundedHash:frozen});
    expect(passing.status).toBe('PASS');
    expect(passing.savingPct).toBeGreaterThan(30);
    const weak=[usage(3_000,700,{requestKey:'w1'}),usage(2_900,600,{requestKey:'w2'})];
    expect(tokenSavingRatio(baseline,weak,{baselineHash:frozen,boundedHash:frozen}).status).toBe('FAIL');
  });
});

describe('S07-T05/T06/T07 memory counts what happened and names what it does not know',()=>{
  const cycle=(over:Partial<Parameters<typeof memoryCycleOf>[0]>={})=>memoryCycleOf({
    cycleId:'c1',scope:'BTCUSDT',symbol:'BTCUSDT',direction:'LONG',openedAt:NOW-3_600_000,closedAt:NOW-3_000_000,
    netPnlUsd:12,fundingStatus:'EXACT',feeCompleteness:'COMPLETE',...over} as Parameters<typeof memoryCycleOf>[0]);

  it('keeps funding-unknown, fee-partial and unclosed cycles out of the realized denominator without hiding them',()=>{
    const rows=[cycle({cycleId:'ok'}),cycle({cycleId:'funding-unknown',fundingStatus:'UNKNOWN'}),
      cycle({cycleId:'fees-partial',feeCompleteness:'PARTIAL'}),cycle({cycleId:'open',closedAt:null,netPnlUsd:-80}),
      cycle({cycleId:'closed-unknown',netPnlUsd:null})];
    const samples=returnSamples(rows);
    expect(samples.realized.map(row=>row.cycleId)).toEqual(['ok']);
    expect(samples.censored.map(row=>row.cycleId)).toEqual(['open']);
    expect(samples.unknownNet.map(row=>row.cycleId)).toEqual(['funding-unknown','fees-partial','closed-unknown']);
    const retrieval=retrieveTradeMemory(rows,{limit:1});
    expect(retrieval.coverage.realizedSamples).toBe(1);
    expect(retrieval.reasons).toContain('RIGHT_CENSORED_EXCLUDED:1');
    expect(retrieval.reasons).toContain('UNKNOWN_NET_EXCLUDED:3');
    // The deep unclosed loss is visible as a cycle and absent from the mean: it is never a zero.
    expect(rows.find(row=>row.cycleId==='open')?.netPnlUsd).toBeNull();
  });

  it('deduplicates the same cycle instead of letting one result count twice',()=>{
    const first=cycle({cycleId:'dup',netPnlUsd:5});
    const retrieval=retrieveTradeMemory([first,cycle({cycleId:'dup',netPnlUsd:5}),
      cycle({cycleId:'dup-flagged',netPnlUsd:5,duplicateOf:first.memoryId}),cycle({cycleId:'other',netPnlUsd:-4})],{limit:2});
    expect(retrieval.coverage.duplicatesRemoved).toBe(2);
    expect(retrieval.entries.filter(row=>row.cycleId==='dup')).toHaveLength(1);
  });

  it('S07-T06: a winners-only match is reported as a missing counter-example, not as support',()=>{
    const retrieval=retrieveTradeMemory([cycle({cycleId:'w1',netPnlUsd:9}),cycle({cycleId:'w2',netPnlUsd:4}),
      cycle({cycleId:'w3',netPnlUsd:1}),cycle({cycleId:'short-loss',direction:'SHORT',netPnlUsd:-7})],{direction:'LONG',limit:3});
    expect(retrieval.status).toBe('NO_COUNTER_EXAMPLE');
    expect(retrieval.reasons).toContain('NO_COUNTER_EXAMPLE_IN_MATCHED_SAMPLE');
    expect(retrieval.coverage).toMatchObject({winners:3,losers:0,counterExamples:0});
    expect(retrieval.entries.every(row=>Number(row.netPnlUsd)>0)).toBe(true);
  });

  it('S07-T06: with a real loser in the match the Top-3 has to show both sides',()=>{
    const retrieval=retrieveTradeMemory([cycle({cycleId:'w1',netPnlUsd:9}),cycle({cycleId:'l1',netPnlUsd:-6}),
      cycle({cycleId:'w2',netPnlUsd:3})],{limit:3});
    expect(retrieval.status).toBe('READY');
    expect(retrieval.entries.map(row=>row.cycleId).sort()).toEqual(['l1','w1','w2']);
  });

  it('S07-T06: an under-filled match says so rather than padding itself with what it has',()=>{
    const thin=retrieveTradeMemory([cycle({cycleId:'only',netPnlUsd:2})],{limit:3});
    expect(thin.reasons).toContain('INSUFFICIENT_MATCHED_SAMPLES:1<3');
    expect(thin.entries).toHaveLength(1);
    // One winner and one loser is a real pair, but it is still not three examples.
    const pair=retrieveTradeMemory([cycle({cycleId:'w1',netPnlUsd:2}),cycle({cycleId:'l1',netPnlUsd:-3})],{limit:3});
    expect(pair.status).toBe('INSUFFICIENT_SAMPLES');
    expect(pair.entries.map(row=>row.cycleId).sort()).toEqual(['l1','w1']);
  });

  it('S07-T07: the handoff bridge keeps the AI result, the human increment and the total as three numbers',()=>{
    const handoff=cycle({cycleId:'h1',netPnlUsd:-30,handoffAt:NOW-1_000,handoffMarkUsd:-30,finalOwner:'HUMAN'});
    const bridge=attributeCycleOutcome({cycle:handoff,netAtCutoverUsd:-30,finalNetUsd:-180});
    expect(bridge).toMatchObject({computable:true,aiAttributedUsd:-30,humanIncrementUsd:-150,cycleTotalUsd:-180});
    expect(bridge.reasons).toEqual(['CUTOVER_BRIDGE_APPLIED']);
  });

  it('S07-T07: without a proven cutover mark the split is not computable, so nothing is claimed',()=>{
    const bridge=attributeCycleOutcome({cycle:cycle({cycleId:'h2',netPnlUsd:-30,handoffAt:NOW-1_000,handoffMarkUsd:null}),
      netAtCutoverUsd:null,finalNetUsd:-180});
    expect(bridge.computable).toBe(false);
    expect(bridge.reasons).toEqual(['CUTOVER_MARK_UNPROVEN']);
    expect(bridge.aiAttributedUsd).toBeNull();
  });

  it('S07-T07: a cycle the AI closed alone attributes the whole result to the AI',()=>{
    expect(attributeCycleOutcome({cycle:cycle({cycleId:'a1',netPnlUsd:-12,handoffAt:null}),netAtCutoverUsd:null,finalNetUsd:-12}))
      .toMatchObject({computable:true,aiAttributedUsd:-12,humanIncrementUsd:0,reasons:['NO_HANDOFF_AI_OWNED_WHOLE_CYCLE']});
  });

  it('derives memory from the accounting record and never upgrades an unknown funding fact',()=>{
    const record:any={tradeId:'t1',symbol:'BTCUSDT',direction:'LONG',cycleId:'c1',openedAt:NOW-3_600_000,closedAt:NOW-3_000_000,
      status:'CLOSED',netPnl:14,fundingAttributionStatus:'UNKNOWN',feeCompleteness:'COMPLETE',closeReason:'TP',canonical:true};
    const row=memoryCycleOfRecord(record);
    expect(row.outcome).toBe('UNKNOWN_NET');
    expect(row.netPnlUsd).toBeNull();
    expect(row.provenance).toContain('TRADE_RECORD:t1');
  });

  it('the review read of memory excludes the cycle being reviewed and versions the store',()=>{
    const records:any[]=[
      {tradeId:'t1',symbol:'BTCUSDT',direction:'LONG',cycleId:'win',openedAt:NOW-7_000_000,closedAt:NOW-6_000_000,status:'CLOSED',
        netPnl:9,fundingAttributionStatus:'EXACT',feeCompleteness:'COMPLETE',canonical:true},
      {tradeId:'t2',symbol:'BTCUSDT',direction:'SHORT',cycleId:'loss',openedAt:NOW-5_000_000,closedAt:NOW-4_000_000,status:'CLOSED',
        netPnl:-9,fundingAttributionStatus:'EXACT',feeCompleteness:'COMPLETE',canonical:true},
      {tradeId:'t3',symbol:'BTCUSDT',direction:'LONG',cycleId:'now',openedAt:NOW-2_000_000,closedAt:null,status:'OPEN',
        netPnl:null,fundingAttributionStatus:'EXACT',feeCompleteness:'COMPLETE',canonical:true}];
    const long=reviewMemoryFor(records,{direction:'LONG',excludeCycleId:'now'});
    expect(long.entries.map(row=>row.cycleId)).not.toContain('now');
    expect(long.coverage.matched).toBe(1);
    const before=tradeMemoryVersionOf(records);
    expect(tradeMemoryVersionOf(records)).toBe(before);
    expect(tradeMemoryVersionOf([...records,{...records[0],tradeId:'t4',cycleId:'t4',netPnl:3}])).not.toBe(before);
  });
});

describe('S07-A/B production consumer: the review tick',()=>{
  function runnerFixture(over:Partial<{normal:number;failures:number;ttl:number;enabled:boolean}>={}){
    const x=fixture({normal:over.normal,failures:over.failures,ttl:over.ttl});
    aiManaged(x);
    x.state.positions.set('pos_j4',{id:'pos_j4',symbol:SUBJECT.symbol,side:SUBJECT.side,cycleId:SUBJECT.cycleId,openedAt:SUBJECT.openedAt,
      quantity:1,entryPrice:100,markPrice:99,unrealizedPnl:-1,firstObservedAt:SUBJECT.openedAt});
    const plan={planId:'plan_j4_v1',planVersion:1,cycleId:SUBJECT.cycleId,scope:SCOPE,symbol:SUBJECT.symbol,side:'LONG',quantityUnits:1,
      entryReferencePrice:100,targetPrice:110,targetHorizonMinutes:60,managementDurationMs:3_600_000,thesis:'structure holds above 95',
      invalidationPredicate:'CLOSED_BAR_BREAKS_LEVEL',predicateEvidenceRefs:['ev-1'],minNetProfitUsd:1,maxRealizedLossUsd:10};
    x.state.tradePlans.set(plan.planId,plan);
    const review=vi.fn(async()=>({decision:'HOLD',runId:'airun_1',usage:{inputTokens:1_400,outputTokens:60},promptHash:'ph',latencyMs:900}));
    const runner=new PositionReviewRunner({state:x.state,events:x.events,exitRuntime:x.exitRuntime,scheduler:x.scheduler,
      settings:()=>({positionReviewEnabled:over.enabled!==false,normalReviewsPerPlan:over.normal??2,exceptionReviewsPerPlan:1,
        reviewFailureBudget:over.failures??2,reviewMinIntervalMs:300_000,reviewAuthorityTtlMs:20_000}),
      evidenceVersion:()=>'bar-1',memoryVersion:()=>'mem-1',review});
    return{...x,runner,review,plan};
  }

  it('does nothing at all when the switch is off, which is the shipped default',async()=>{
    const x=runnerFixture({enabled:false});
    expect(await x.runner.tick(NOW)).toMatchObject({enabled:false,considered:0,reserved:0});
    expect(x.review).not.toHaveBeenCalled();
    expect(x.ledger.rows()).toHaveLength(0);
  });

  it('makes exactly one call for one fact set and deduplicates the next pass',async()=>{
    const x=runnerFixture();
    expect(await x.runner.tick(NOW)).toMatchObject({considered:1,reserved:1,completed:1,failed:0});
    expect(await x.runner.tick(NOW+60_000)).toMatchObject({considered:1,reserved:0,deduplicated:1});
    expect(x.review).toHaveBeenCalledTimes(1);
    expect(x.ledger.rows()).toHaveLength(1);
    expect(x.ledger.rows()[0]).toMatchObject({role:'REVIEW',status:'COMPLETED',usageStatus:'EXACT'});
    expect(x.seen.find(event=>event.type==='POSITION_REVIEW_APPLIED')?.payload).toMatchObject({decision:'HOLD',usable:true,
      writableAuthority:'REVIEW_EVIDENCE_ONLY'});
  });

  it('reviews a HUMAN-managed cycle as evidence only, without execution authority',async()=>{
    const x=runnerFixture();
    x.exitRuntime.recordHumanTakeover(SUBJECT,'OPERATOR_TOOK_OVER',NOW);
    expect(await x.runner.tick(NOW)).toMatchObject({enabled:true,considered:1,reserved:1,zeroRoutineCalls:0,completed:1,failed:0});
    expect(x.review).toHaveBeenCalledOnce();
    expect(x.ledger.rows()).toHaveLength(1);
    expect(x.seen.find(event=>event.type==='POSITION_REVIEW_ONLY_AUTHORITY')?.payload).toMatchObject({executionAuthority:false,reason:'HUMAN_MANAGED_REVIEW_EVIDENCE_ONLY'});
    expect(x.seen.find(event=>event.type==='POSITION_REVIEW_APPLIED')?.payload).toMatchObject({writableAuthority:'REVIEW_EVIDENCE_ONLY'});
  });

  it('S07-T09: a dead endpoint spends review budget, records the failure and changes no order or deadline',async()=>{
    const x=runnerFixture();
    x.review.mockRejectedValueOnce(new Error('AI_PRIMARY_CIRCUIT_OPEN'));
    const before=x.exitRuntime.owner(SUBJECT);
    expect(await x.runner.tick(NOW)).toMatchObject({reserved:1,completed:0,failed:1});
    const failed=x.seen.find(event=>event.type==='POSITION_REVIEW_FAILED');
    expect(failed.payload).toMatchObject({engineRestartTriggered:false,orderSent:false,reason:'AI_PRIMARY_CIRCUIT_OPEN',reviewFailures:1});
    const after=x.exitRuntime.owner(SUBJECT);
    expect(after.deadline).toBe(before.deadline);
    expect(after.ownerState).toBe('AI_ACTIVE');
    expect(x.ledger.rows()[0]).toMatchObject({status:'FAILED',usageStatus:'UNKNOWN',role:'REVIEW'});
    expect(x.scheduler.state()[0].failures).toBe(1);
  });

  it('does not poison a review budget for the known pre-inference envelope defect',async()=>{
    const x=runnerFixture();
    x.review.mockRejectedValueOnce(new Error('PRE_AI_EXECUTION_ENVELOPE_MISSING'));
    expect(await x.runner.tick(NOW)).toMatchObject({reserved:1,failed:1});
    expect(x.scheduler.state()[0]).toMatchObject({used:0,failures:0});
    expect(x.seen.find(event=>event.type==='POSITION_REVIEW_FAILED')?.payload)
      .toMatchObject({reason:'PRE_AI_EXECUTION_ENVELOPE_MISSING',reviewFailures:0,orderSent:false});
  });

  it('checkpoints the spent budget into the runtime state the writer serializes',async()=>{
    const x=runnerFixture();
    await x.runner.tick(NOW);
    expect([...x.state.reviewBudgets.values()]).toEqual([expect.objectContaining({cycleId:SUBJECT.cycleId,planRef:'plan_j4_v1',used:1})]);
  });

  it('discards a late answer and keeps it out of the exit evidence',async()=>{
    const x=runnerFixture();
    x.review.mockImplementationOnce(async()=>{
      x.exitRuntime.recordHumanTakeover(SUBJECT,'OPERATOR_TOOK_OVER',NOW+1);
      return{decision:'EXIT_PROPOSAL',runId:'airun_late',usage:{inputTokens:1_400,outputTokens:60},promptHash:'ph',latencyMs:900};
    });
    expect(await x.runner.tick(NOW)).toMatchObject({reserved:1,completed:0,discarded:1});
    expect(x.state.positionReviews.get(SUBJECT.cycleId).latest.usable).toBe(false);
    const facts=planFacts({invalidationPredicate:'CLOSED_BAR_BREAKS_LEVEL',invalidationEvidenceRefs:['ev-1']});
    const merged=PositionReviewRunner.planFactsWithReview(facts,PositionReviewRunner.usableVerdict(x.state,
      {cycleId:SUBJECT.cycleId,planRef:'plan_j4_v1',planVersion:1,maxAgeMs:300_000,now:Date.now()}));
    expect(merged).toBe(facts);
    expect(x.seen.find(event=>event.type==='POSITION_REVIEW_DISCARDED')?.payload).toMatchObject({archived:true,usable:false});
  });

  it('only an exit proposal moves the exit evidence, and a handoff never closes anything',()=>{
    const facts=planFacts();
    const verdict=(decision:string)=>({cycleId:SUBJECT.cycleId,scope:SCOPE,planRef:'plan_j4_v1',planVersion:1,decision,usable:true,
      reason:'REVIEW_RESULT_APPLICABLE',at:Date.now(),runId:'airun_9',ownerVersion:1,triggerKey:'trg_9'});
    expect(PositionReviewRunner.planFactsWithReview(facts,verdict('HANDOFF'))).toMatchObject({thesisInvalid:false,reviewDecision:'HANDOFF'});
    expect(PositionReviewRunner.planFactsWithReview(facts,verdict('EXIT_PROPOSAL')))
      .toMatchObject({thesisInvalid:true,invalidationEvidenceRefs:['review:airun_9']});
    expect(PositionReviewRunner.planFactsWithReview(facts,verdict('HOLD'))).toMatchObject({thesisInvalid:false});
  });

  it('a verdict for the previous plan version is not evidence for the new one',()=>{
    const x=runnerFixture();
    x.runner.addVerdict({cycleId:SUBJECT.cycleId,scope:SCOPE,planRef:'plan_j4_v1',planVersion:1,decision:'EXIT_PROPOSAL',usable:true,
      reason:'REVIEW_RESULT_APPLICABLE',at:Date.now(),runId:'airun_old',ownerVersion:1,triggerKey:'trg_old'});
    const read=(planVersion:number,cycleId=SUBJECT.cycleId)=>PositionReviewRunner.usableVerdict(x.state,
      {cycleId,planRef:'plan_j4_v1',planVersion,maxAgeMs:600_000,now:Date.now()});
    expect(read(2)).toBeNull();
    expect(read(1,'another_cycle')).toBeNull();
    expect(read(1)?.decision).toBe('EXIT_PROPOSAL');
  });
});
