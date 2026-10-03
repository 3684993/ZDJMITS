import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {V396ExitRuntime,exitSubjectFromPosition,type V396PrepareExitInput} from './v396ExitRuntime.js';
import {AiExitAuthorityService} from './aiExitAuthority.js';
import {PositionExitCoordinator,type AdapterCapabilities} from './s04ExitCoordinator.js';
import {OwnershipJournal} from './ownershipJournal.js';
import {buildExitEstimate,exitPriceBound,type CostItem,type EstimateInput} from './s03ExitCostEstimator.js';
import {decideAiExit,type PolicyInput} from './s03AiExitPolicy.js';
import {ONE_WAY_CAPABILITIES} from './v396ExitTestHarness.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TpGuardian} from './tpGuardian.js';
import {coordinatedExchange} from './v396ExitTestHarness.js';

/**
 * J1 acceptance: continuous convergence, adoption, fixed FIRST_FILL management deadline, real-cost
 * AI verdicts behind an explicit OFF-by-default authority, and a JIT re-check next to the wire call.
 */

const dirs:string[]=[];
afterEach(()=>{while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* busy handle */}}});
const tempFile=(name='v396-ownership.sqlite')=>{const dir=mkdtempSync(join(tmpdir(),'zdj-v396-j1-'));dirs.push(dir);return join(dir,name);};
const any=(value:unknown)=>value as any;

const identity={environment:'TESTNET',account:'binance-primary'};
const SUBJECT={symbol:'BTCUSDT',side:'LONG' as const,cycleId:'cycle_j1',openedAt:1_000};
const SCOPE=JSON.stringify([identity.environment,identity.account,'BTCUSDT','LONG']);
const CAPS:AdapterCapabilities=ONE_WAY_CAPABILITIES;

function runtime(authority:'OFF'|'SHADOW'|'ENFORCE'='OFF',extra:Partial<V396PrepareExitInput>={}){
  const state={authority};
  const exitRuntime=new V396ExitRuntime(':memory:',()=>identity,async()=>CAPS,()=>({
    aiExitAuthority:state.authority,intervalMs:120_000,batchLimit:8,continuousEnabled:true,
  }));
  return {exitRuntime,state};
}
const exitInput=(over:Partial<V396PrepareExitInput>={}):V396PrepareExitInput=>{
  // This is one proof snapshot: a second clock read could put checkedAt after input.now.
  const now=Date.now();
  return{
  requestKey:'intent_j1',subject:SUBJECT,quantityUnits:10,limitPrice:95,now,positionVersion:7,settingsVersion:20,riskGeneration:11,
  availableReduceUnits:10,remainingUnits:10,minNotional:5,tickSize:.1,stepSize:1,
  proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:now,positionSide:'LONG'},...over,
};};
const NOW=1_800_000_000_000;
const item=(id:string,kind:CostItem['kind'],amount:number,extra:Partial<CostItem>={}):CostItem=>({id,kind,cycleId:SUBJECT.cycleId,scope:SCOPE,settled:!kind.startsWith('PROJECTED'),amount,status:'EXACT',asset:'USDT',sourceId:`src_${id}`,...extra});
const modelEstimate=(over:Partial<EstimateInput>={})=>buildExitEstimate({scope:SCOPE,cycleId:SUBJECT.cycleId,positionVersion:7,costVersion:'cost-v1',remainingQuantityUnits:10,side:'LONG',
  quoteAt:NOW-1_000,expiresAt:NOW+14_000,now:NOW,entryPrice:100,bid:95,ask:96,tickSize:.1,stepSize:1,minNotional:5,quoteAsset:'USDT',rateMaxAgeMs:60_000,
  items:[item('realized','REALIZED_GROSS',-2),item('entry-fee','ENTRY_FEE',1),item('funding','FUNDING',-0.5),
    item('rg','PROJECTED_EXIT_GROSS',-5.79,{settled:false}),item('rf','PROJECTED_EXIT_FEE',.5,{settled:false}),item('buf','UNCERTAINTY_BUFFER',.2,{settled:false})],...over});
/** The full S03 policy input: real cost facts, no synthetic stand-in for a model verdict. */
const policyInputOf=(ownerVersion:number,deadline:number)=>({
  owner:{ownerState:'AI_ACTIVE' as const,ownerVersion,cycleId:SUBJECT.cycleId,scope:SCOPE,deadline},
  plan:{planVersion:2,cycleId:SUBJECT.cycleId,scope:SCOPE,thesisInvalid:true,invalidationPredicate:'STRUCTURE_BREAK_15M',invalidationEvidenceRefs:['ev-1'],exitConditionMet:false,minNetProfitUsd:.5},
  estimate:modelEstimate(),
  bound:exitPriceBound({side:'LONG',remainingQuantityUnits:10,stepSize:1,tickSize:.1,entryPrice:100,exitFeeRate:.0004,fixedNetMilli:Math.round(-4.2*1_000),targetNet:-10,minNotional:5,now:NOW}),
  policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000},
});
const modelVerdict=(ownerVersion:number,deadline=NOW+60_000)=>decideAiExit({...policyInputOf(ownerVersion,deadline),now:NOW} as PolicyInput);

function aiActiveOwner(exitRuntime:V396ExitRuntime,now=Date.now()){
  return exitRuntime.fixManagementDeadline(SUBJECT,3_600_000,now-60_000,'plan_j1')??exitRuntime.owner(SUBJECT);
}

describe('J1 AI exit authority',()=>{
  it('defaults to OFF: no decision, no prepared task, no exchange submit',async()=>{
    const {exitRuntime,state}=runtime('OFF');
    const service=new AiExitAuthorityService(exitRuntime,()=>state.authority);
    let submits=0;
    const exchange=any({placeTakeProfit:vi.fn(async()=>{submits++;return{};})});
    const result=await service.evaluate({subject:SUBJECT,policyInput:policyInputOf(1,NOW+60_000),exit:exitInput(),now:NOW});
    expect(service.currentAuthority()).toBe('OFF');
    expect(result).toMatchObject({attempted:false,accepted:false,submitRequired:false,reasons:['AI_EXIT_AUTHORITY_OFF']});
    expect(exitRuntime.tasksNeedingQuery()).toHaveLength(0);
    expect(submits).toBe(0);
    expect(exchange.placeTakeProfit).not.toHaveBeenCalled();
  });

  it('SHADOW records the model decision but prepares and submits nothing',async()=>{
    const {exitRuntime,state}=runtime('SHADOW');
    const service=new AiExitAuthorityService(exitRuntime,()=>state.authority);
    const result=await service.evaluate({subject:SUBJECT,policyInput:policyInputOf(1,NOW+60_000),exit:exitInput(),now:NOW});
    expect(result).toMatchObject({attempted:false,accepted:false,submitRequired:false,reasons:['AI_EXIT_AUTHORITY_SHADOW']});
    expect(result.shadowDecision).not.toBeNull();
    expect(service.shadowEntries()).toHaveLength(1);
    expect(service.shadowEntries()[0].reasons).toContain('SHADOW_NO_AUTHORITY');
    expect(exitRuntime.tasksNeedingQuery()).toHaveLength(0);
  });

  it('ENFORCE still refuses an untracked cycle, a synthetic verdict and a non-AI owner',async()=>{
    const untracked=await new V396ExitRuntime(':memory:',()=>identity,async()=>CAPS,()=>({aiExitAuthority:'ENFORCE' as const}))
      .prepareAiExit(exitInput(),modelVerdict(1));
    expect(untracked.reasons).toContain('AI_EXIT_OWNER_UNTRACKED');

    const {exitRuntime}=runtime('ENFORCE');
    const synthetic=await exitRuntime.prepareManual(exitInput({requestKey:'manual_intent_1'}));
    expect(synthetic.accepted).toBe(true);
    const gate=await exitRuntime.prepareAiExit(exitInput(),modelVerdict(1));
    expect(gate.accepted).toBe(false);
    expect(gate.reasons[0]).toMatch(/^AI_EXIT_OWNER_NOT_AI/);
    const owner=exitRuntime.owner(SUBJECT);
    const notModel=await exitRuntime.prepareAiExit(exitInput(),{...modelVerdict(owner!.ownerVersion),provenance:'SYNTHETIC_MAINTENANCE'} as never);
    expect(notModel.reasons).toContain('AI_EXIT_VERDICT_NOT_MODEL_COST_MODEL');
    const wrongAuthority=await new V396ExitRuntime(':memory:',()=>identity,async()=>CAPS,()=>({aiExitAuthority:'OFF' as const}))
      .prepareAiExit(exitInput(),modelVerdict(1));
    expect(wrongAuthority.reasons).toContain('AI_EXIT_AUTHORITY_OFF');
  });

  it('ENFORCE with a live AI owner and a real cost verdict prepares exactly one submit',async()=>{
    const {exitRuntime,state}=runtime('ENFORCE');
    const service=new AiExitAuthorityService(exitRuntime,()=>state.authority);
    const owner=aiActiveOwner(exitRuntime,NOW);
    expect(owner.ownerState).toBe('AI_ACTIVE');
    const verdict=modelVerdict(owner.ownerVersion,Number(owner.deadline));
    const prepared=await service.evaluate({subject:SUBJECT,policyInput:policyInputOf(owner.ownerVersion,Number(owner.deadline)),
      exit:exitInput({requestKey:verdict.decisionHash}),now:NOW});
    expect(prepared).toMatchObject({attempted:true,authority:'ENFORCE',accepted:true,submitRequired:true});
    expect(prepared.reasons).toContain('TASK_PREPARED_PERSISTED');
    expect(exitRuntime.tasksNeedingQuery()).toHaveLength(1);
    const replay=await exitRuntime.prepareAiExit(exitInput({requestKey:verdict.decisionHash}),verdict);
    expect(replay.accepted).toBe(false);
    expect(replay.reasons).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
    expect(replay.clientOrderId).toBe(prepared.clientOrderId);
    const drifted=await exitRuntime.prepareAiExit(exitInput({requestKey:'other'}),{...verdict,ownerVersion:verdict.ownerVersion+1} as never);
    expect(drifted.reasons).toContain('AI_EXIT_OWNER_DRIFT');
    const expired=await new V396ExitRuntime(':memory:',()=>identity,async()=>CAPS,()=>({aiExitAuthority:'ENFORCE' as const}))
      .prepareAiExit(exitInput(),{...verdict,ownerVersion:owner.ownerVersion} as never);
    expect(expired.reasons).toContain('AI_EXIT_OWNER_UNTRACKED');
  });
});

describe('J1 continuous convergence and claim release',()=>{
  async function preparedTask(){
    const {exitRuntime}=runtime('OFF');
    exitRuntime.recordHumanTakeover(SUBJECT,'MANUAL_SUBMISSION',Date.now());
    const prepared=await exitRuntime.prepareManual(exitInput({requestKey:'converge_intent'}));
    expect(prepared.accepted).toBe(true);
    return {exitRuntime,clientOrderId:String(prepared.clientOrderId)};
  }

  it('the pass is low-frequency, bounded and never resubmits',async()=>{
    const {exitRuntime,clientOrderId}=await preparedTask();
    const query=vi.fn(async()=>({state:'ABSENT',reason:'-2013'} as const));
    expect(await exitRuntime.convergeRecoveredTasks(query)).toHaveLength(1);
    const first=await exitRuntime.convergePeriodically(query);
    expect(first.due).toBe(true);
    if(first.due)expect(first.attempted).toBeGreaterThanOrEqual(1);
    const second=await exitRuntime.convergePeriodically(query);
    expect(second).toMatchObject({due:false,reason:'CONVERGENCE_NOT_DUE'});
    expect(query.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('without a terminal exchange fact the claim stays occupied and the task stays unacked',async()=>{
    const {exitRuntime,clientOrderId}=await preparedTask();
    const task=exitRuntime.task(clientOrderId);
    expect(any(task).state).toBe('PREPARED');
    const absent=await exitRuntime.convergeRecoveredTasks(async()=>({state:'ABSENT',reason:'-2013'} as const));
    expect(absent[0].outcome).toBe('EXCHANGE_ABSENT_STAYS_UNACKED');
    expect(any(exitRuntime.task(clientOrderId)).state).not.toBe('CANCELED');
    const failed=await exitRuntime.convergeRecoveredTasks(async()=>{throw new Error('network');});
    expect(failed[0].outcome).toBe('QUERY_FAILED_STAYS_UNACKED');
    const cancelled=await exitRuntime.convergeRecoveredTasks(async()=>({state:'FOUND',order:{symbol:'BTCUSDT',clientOrderId,exchangeOrderId:'ex_1',status:'CANCELED',originalQuantity:10,executedQuantity:0,positionSide:'BOTH'}} as const));
    expect(cancelled[0].outcome).toBe('EXCHANGE_FACT_CANCELED');
    expect(any(exitRuntime.task(clientOrderId)).state).toBe('CANCELED');
    expect(exitRuntime.tasksNeedingQuery()).toHaveLength(0);
  });

  it('a fabricated or mismatched exchange fact cannot terminalise the claim',async()=>{
    const {exitRuntime,clientOrderId}=await preparedTask();
    const bad=await exitRuntime.convergeRecoveredTasks(async()=>({state:'FOUND',order:{symbol:'ETHUSDT',clientOrderId,exchangeOrderId:'x',status:'CANCELED',originalQuantity:10,executedQuantity:0,positionSide:'BOTH'}} as const));
    // P1 names the refusal instead of collapsing every contradiction into one label; the guarantee the
    // test carries is that the fact is refused and the claim is not terminalised.
    expect(String(bad[0].outcome).startsWith('OBSERVE_REFUSED:')).toBe(true);
    expect(String(bad[0].outcome)).toContain('IDENTITY');
    const wrongAccount=await exitRuntime.convergeRecoveredTasks(async()=>({state:'FOUND',order:{symbol:'BTCUSDT',clientOrderId:'v396xother',exchangeOrderId:'x',status:'FILLED',originalQuantity:10,executedQuantity:10,positionSide:'BOTH'}} as const));
    expect(String(wrongAccount[0].outcome).startsWith('OBSERVE_REFUSED:')).toBe(true);
    expect(any(exitRuntime.task(clientOrderId)).state).toBe('PREPARED');
  });
});

describe('J1 adoption, deadline and JIT',()=>{
  it('prepares one coherent proof snapshot across clock ticks but still rejects a future proof',async()=>{
    const {exitRuntime}=runtime('OFF');
    let tick=Date.now();
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>tick++);
    try{
      const input=exitInput({requestKey:'ticking-clock'});
      const future=await exitRuntime.prepareManual({...input,proof:{...input.proof,checkedAt:input.now+1}});
      expect(future).toMatchObject({accepted:false,clientOrderId:null,reasons:['REDUCTION_PROOF_UNPROVEN']});
      const prepared=await exitRuntime.prepareManual(input);
      expect(prepared.accepted,prepared.reasons.join('|')).toBe(true);
      expect(prepared.clientOrderId).toBeTruthy();
    }finally{clock.mockRestore();exitRuntime.close();}
  });

  it('an exit row without a complete identity is adopted conservatively and blocks a new TP',async()=>{
    const state=new RuntimeState(any({portfolio:{maxPositions:10},riskGovernance:{}}));
    const position=any({id:'p1',symbol:'BTCUSDT',side:'LONG',quantity:1,entryPrice:90,markPrice:100,leverage:5,openedAt:Date.now(),firstObservedAt:Date.now(),cycleId:'cycle_j1',tpStatus:'MISSING',tpOrderId:null});
    state.positions.set('p1',position);
    state.snapshots.set('BTCUSDT',{symbol:'BTCUSDT',quote:{symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.1,stepSize:1,minQty:1,minNotional:5,ts:Date.now()}} as never);
    const exitRuntime=new V396ExitRuntime(':memory:',()=>identity,async()=>CAPS,()=>({aiExitAuthority:'OFF' as const}));
    state.tpOrders.set('legacy_tp',any({id:'legacy_tp',positionId:'p1',symbol:'BTCUSDT',side:'SELL',quantity:1,price:101,status:'WORKING',clientOrderId:'',cycleId:'cycle_j1',exchangeOrderId:null,createdAt:Date.now(),updatedAt:Date.now()}));
    const exchange=any({...coordinatedExchange({liveQuantity:1}),placeTakeProfit:vi.fn(async(o:any)=>({...o,status:'WORKING'}))});
    const tp=new TpGuardian(state,exchange,new EventBus(),exitRuntime);
    const replacement=any({id:'new_tp',clientOrderId:null,exchangeOrderId:null,cycleId:'cycle_j1',positionId:'p1',symbol:'BTCUSDT',side:'SELL',quantity:1,price:101,status:'WORKING',createdAt:Date.now(),updatedAt:Date.now()});
    await expect(tp.place(replacement,{stepSize:1,tickSize:.1})).rejects.toThrow(/TP_EXIT_ADOPTION_REQUIRED/);
    expect(exchange.placeTakeProfit,'a TP with an unverified identity must be adopted before any new submit',).not.toHaveBeenCalled();
    expect(exitRuntime.tasksNeedingQuery(),'the refusal may not leave a prepared claim behind',).toHaveLength(0);
    expect(exitRuntime.adoptedUnits(exitSubjectFromPosition(position))).toBeGreaterThan(0);
    const blockers=exitRuntime.adoptRemoteExit({subject:exitSubjectFromPosition(position),clientOrderId:null,quantityUnits:1,source:'TP',evidenceRef:null});
    expect(blockers.adopted).toBe(false);
    expect(blockers.blockers).toEqual(expect.arrayContaining(['CLIENT_ORDER_ID_MISSING','EXCHANGE_EVIDENCE_MISSING']));
    const complete=exitRuntime.adoptRemoteExit({subject:exitSubjectFromPosition(position),clientOrderId:'remote_1',quantityUnits:1,source:'TP',evidenceRef:'exch_1'});
    expect(complete.adopted).toBe(true);
    expect(exitRuntime.settleAdoptedExit({subject:exitSubjectFromPosition(position),clientOrderId:'remote_1',terminal:false})).toBe(false);
    expect(exitRuntime.adoptedUnits(exitSubjectFromPosition(position))).toBeGreaterThan(0);
    expect(exitRuntime.settleAdoptedExit({subject:exitSubjectFromPosition(position),clientOrderId:'remote_1',terminal:true})).toBe(true);
  });

  it('the management deadline is fixed by the first fill and never extended',()=>{
    const {exitRuntime}=runtime('OFF');
    const first=exitRuntime.fixManagementDeadline(SUBJECT,600_000,1_000);
    expect(first?.deadline).toBe(601_000);
    const late=exitRuntime.fixManagementDeadline(SUBJECT,600_000,9_000_000);
    expect(late?.deadline).toBe(601_000);
    const restart=exitRuntime.fixManagementDeadline(SUBJECT,7_200_000,500_000);
    expect(restart?.deadline).toBe(601_000);
    expect(exitRuntime.fixManagementDeadline(SUBJECT,0,1_000)).toBeNull();
    expect(exitRuntime.fixManagementDeadline(SUBJECT,NaN,1_000)).toBeNull();
  });

  it('JIT next to the wire refuses a stale proof, a missing task and a terminalised task',async()=>{
    const {exitRuntime}=runtime('OFF');
    exitRuntime.recordHumanTakeover(SUBJECT,'MANUAL_SUBMISSION',Date.now());
    const prepared=await exitRuntime.prepareManual(exitInput({requestKey:'jit_intent'}));
    expect(prepared.accepted,prepared.reasons.join('|')).toBe(true);
    const clientOrderId=String(prepared.clientOrderId);
    expect(exitRuntime.jitBeforeSubmit({subject:SUBJECT,clientOrderId,proofCheckedAt:Date.now(),now:Date.now()}).allowed).toBe(true);
    expect(exitRuntime.jitBeforeSubmit({subject:SUBJECT,clientOrderId,proofCheckedAt:Date.now()-60_000,now:Date.now()}).blockers).toContain('REDUCTION_PROOF_EXPIRED');
    expect(exitRuntime.jitBeforeSubmit({subject:SUBJECT,clientOrderId:'v396xmissing',proofCheckedAt:Date.now(),now:Date.now()}).blockers).toContain('PREPARED_TASK_MISSING');
    expect(exitRuntime.jitBeforeSubmit({subject:SUBJECT,clientOrderId,proofCheckedAt:Date.now(),now:Date.now()-600_000}).blockers).toContain('JIT_WINDOW_STALE');
    expect(exitRuntime.transitionByClientOrderId(clientOrderId,'SUBMITTING',Date.now(),'SENT')).not.toBeNull();
    expect(any(exitRuntime.task(clientOrderId)).state).toBe('SUBMITTING');
    // A submitted task is only freed by an exchange fact, never by the local label.
    expect(exitRuntime.transitionByClientOrderId(clientOrderId,'CANCELED',Date.now(),'LOCAL_GUESS')).toBeNull();
    expect(exitRuntime.observe({eventId:'FILL_THEN_CANCEL',clientOrderId,state:'CANCELED',filledUnits:0,positionVersion:7},Date.now()).applied).toHaveLength(1);
    expect(any(exitRuntime.task(clientOrderId)).state).toBe('CANCELED');
    expect(exitRuntime.jitBeforeSubmit({subject:SUBJECT,clientOrderId,proofCheckedAt:Date.now(),now:Date.now()}).blockers).toContain('TASK_NOT_SUBMITTABLE:CANCELED');
    expect(exitRuntime.tasksNeedingQuery()).toHaveLength(0);
  });
});
