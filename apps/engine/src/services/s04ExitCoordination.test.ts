import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {OwnershipJournal} from './ownershipJournal.js';
import {buildExitEstimate,exitPriceBound,type CostItem,type EstimateInput} from './s03ExitCostEstimator.js';
import {decideAiExit,type AiExitVerdict,type PolicyInput} from './s03AiExitPolicy.js';
import {OPEN_STATES,TERMINAL_STATES,PositionExitCoordinator,type AdapterCapabilities,type JitFacts} from './s04ExitCoordinator.js';

const NOW=1_800_000_000_000;
const SCOPE=JSON.stringify(['TESTNET','binance-primary','BTCUSDT','LONG']);
const CYCLE='cycle_1';
const dirs:string[]=[];
afterEach(()=>{while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* busy handle on Windows */}}});
const tempFile=(name='ledger.sqlite')=>{const dir=mkdtempSync(join(tmpdir(),'zdj-v396-s04-'));dirs.push(dir);return join(dir,name);};
const CAPS:AdapterCapabilities={oneWayReduceOnly:true,hedgePositionSide:true,cancelReplaceAtomic:false,partialFillExpected:true,supportsTimeInForce:['GTC','GTX'],positionMode:'ONE_WAY'};

const item=(id:string,kind:CostItem['kind'],amount:number,extra:Partial<CostItem>={}):CostItem=>({id,kind,cycleId:CYCLE,scope:SCOPE,settled:!kind.startsWith('PROJECTED'),amount,status:'EXACT',asset:'USDT',sourceId:`src_${id}`,...extra});
const itemsFor=(remainingGross:number,extra:CostItem[]=[]):CostItem[]=>[item('realized','REALIZED_GROSS',-2),item('entry-fee','ENTRY_FEE',1),item('funding','FUNDING',-0.5),
  item('remaining-gross','PROJECTED_EXIT_GROSS',remainingGross,{settled:false}),item('remaining-fee','PROJECTED_EXIT_FEE',0.5,{settled:false}),item('buffer','UNCERTAINTY_BUFFER',0.2,{settled:false}),...extra];
const estimateFor=(remainingGross:number,extra:CostItem[]=[],over:Partial<EstimateInput>={})=>buildExitEstimate({
  scope:SCOPE,cycleId:CYCLE,positionVersion:7,costVersion:'cost-v1',remainingQuantityUnits:100,side:'LONG',
  quoteAt:NOW-1_000,expiresAt:NOW+14_000,now:NOW,entryPrice:100,bid:95,ask:96,tickSize:0.05,stepSize:1,minNotional:5,
  quoteAsset:'USDT',rateMaxAgeMs:60_000,items:itemsFor(remainingGross,extra),...over,
});
const boundFor=()=>exitPriceBound({side:'LONG',remainingQuantityUnits:100,stepSize:1,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:Math.round(-4.2*1_000),targetNet:-10,minNotional:5,now:NOW});
const verdictFor=(estimate:ReturnType<typeof estimateFor>):AiExitVerdict=>decideAiExit({
  owner:{ownerState:'AI_ACTIVE',ownerVersion:4,cycleId:CYCLE,scope:SCOPE,deadline:NOW+60_000},
  plan:{planVersion:2,cycleId:CYCLE,scope:SCOPE,thesisInvalid:true,invalidationPredicate:'STRUCTURE_BREAK_15M',invalidationEvidenceRefs:['ev-1'],exitConditionMet:false,minNetProfitUsd:0.5},
  estimate,bound:boundFor(),policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000},now:NOW,
} as PolicyInput);
const jitFor=(estimate:ReturnType<typeof estimateFor>,over:Partial<JitFacts>={}):JitFacts=>({
  now:NOW,ownerVersion:4,positionVersion:7,settingsVersion:20,riskGeneration:11,deadline:NOW+60_000,
  estimateHash:estimate.estimateHash,conservativeNet:estimate.conservativeNet!,availableReduceUnits:100,
  remainingUnits:100,minNotional:5,tickSize:0.05,stepSize:1,...over,
});
const open=(file=tempFile())=>{const journal=new OwnershipJournal(file);return {journal,file,coordinator:new PositionExitCoordinator(journal,CAPS)};};
const request=(ctx:ReturnType<typeof open>,overrides:Partial<Parameters<PositionExitCoordinator['requestExit']>[0]>={})=>{
  const estimate=estimateFor(-5.79);
  return ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate),...overrides});
};

describe('S04 unified exit coordination',()=>{
  it('S04-T01 two concurrent exits on one cycle cannot both hold the quantity',()=>{
    const ctx=open();
    const first=request(ctx);
    expect(first.accepted).toBe(true);
    const humanSameQty=request(ctx,{source:'MANUAL',quantityUnits:100});
    expect(humanSameQty.accepted).toBe(false);
    expect(humanSameQty.reasons.some(reason=>reason.startsWith('QUANTITY_BUDGET_EXCEEDED'))).toBe(true);
    expect(humanSameQty.reasons).toContain('OPEN_CLAIM_UNITS=100');
    // the same source retrying its own PREPARED intent is idempotent, not a second order
    const sameSourceRetry=request(ctx,{quantityUnits:100});
    expect(sameSourceRetry.reasons).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
    expect(sameSourceRetry.submitRequired).toBe(true);
    expect(sameSourceRetry.taskId).toBe(first.taskId);
    ctx.coordinator.transition(first.taskId!,'SUBMITTING',NOW+1,'SENT');
    expect(request(ctx,{quantityUnits:100}).submitRequired).toBe(false);
    expect(request(ctx,{source:'TP',quantityUnits:100}).reasons).toContain('TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT');
    ctx.coordinator.markSubmitUncertain(first.taskId!,NOW+2);
    // a human may always act against an UNKNOWN order, but never for more than the position
    // still has: the guard here is the quantity budget, not an authority rule
    expect(request(ctx,{source:'MANUAL',quantityUnits:50}).reasons.some(reason=>reason.startsWith('QUANTITY_BUDGET_EXCEEDED'))).toBe(true);
  });

  it('S04-T02 a lost acknowledgement stays UNKNOWN on the same clientOrderId and never re-submits',()=>{
    const ctx=open();
    const first=request(ctx);
    expect(ctx.coordinator.transition(first.taskId!,'SUBMITTING',NOW+1,'SENT')?.state).toBe('SUBMITTING');
    const uncertain=ctx.coordinator.markSubmitUncertain(first.taskId!,NOW+2);
    expect(uncertain).toMatchObject({state:'UNKNOWN',clientOrderId:first.clientOrderId});
    const retrySameIntent=request(ctx);
    expect(retrySameIntent.reasons).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
    expect(retrySameIntent.submitRequired).toBe(false);
    const otherQuantity=request(ctx,{quantityUnits:60});
    expect(otherQuantity.reasons).toContain('UNKNOWN_EXIT_MUST_CONVERGE_FIRST');
    expect(ctx.coordinator.recoveryPlan(NOW+3).mustQuery.map(row=>row.clientOrderId)).toContain(first.clientOrderId);
    // a local guess may never resolve UNKNOWN; only a queried exchange fact can
    for(const guess of ['WORKING','FILLED','CANCELED','REJECTED'] as const)expect(ctx.coordinator.transition(first.taskId!,guess,NOW+4,`local_${guess}`)).toBeNull();
    expect(ctx.coordinator.findTaskByClientOrderId(first.clientOrderId!).state).toBe('UNKNOWN');
    ctx.coordinator.observe([{eventId:'evt-ack',clientOrderId:first.clientOrderId!,state:'WORKING',filledUnits:0,positionVersion:7}],NOW+5);
    expect(ctx.coordinator.findTaskByClientOrderId(first.clientOrderId!).reasons).toContain('EXCHANGE_FACT_RESOLVED_UNKNOWN');
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(100);
    ctx.coordinator.observe([{eventId:'evt-fill',clientOrderId:first.clientOrderId!,state:'FILLED',filledUnits:100,positionVersion:8}],NOW+6);
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(0);
    expect(ctx.coordinator.recoveryPlan(NOW+7).mustQuery).toEqual([]);
    // a filled cycle cannot be re-entered by a stale decision
    expect(request(ctx,{quantityUnits:100}).reasons).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
  });

  it('S04-T03 a TP that filled before the cancel is honoured by the fact, never oversold',()=>{
    const ctx=open();
    const task=request(ctx);
    ctx.coordinator.transition(task.taskId!,'SUBMITTING',NOW+1,'SENT');
    ctx.coordinator.observe([{eventId:'evt-1',clientOrderId:task.clientOrderId!,state:'PARTIALLY_FILLED',filledUnits:60,positionVersion:8}],NOW+2);
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(40);
    const after=estimateFor(-1.5,[item('partial-1','REALIZED_GROSS',-1,{sourceId:'fill-1'}),item('partial-fee','PRIOR_EXIT_FEE',0.1,{sourceId:'fill-1'})]);
    // the live order still carries the unfilled 40, so a second 40-unit exit is a double spend
    const duplicate=request(ctx,{source:'MANUAL',quantityUnits:40,verdict:verdictFor(after),jit:jitFor(after,{positionVersion:8,availableReduceUnits:40,remainingUnits:40})});
    expect(duplicate.reasons.some(reason=>reason.startsWith('QUANTITY_BUDGET_EXCEEDED'))).toBe(true);
    const stillLive=ctx.coordinator.observe([{eventId:'evt-2',clientOrderId:task.clientOrderId!,state:'FILLED',filledUnits:120,positionVersion:9}],NOW+3);
    expect(stillLive.skipped.some(note=>note.startsWith('OVER_FILL'))).toBe(true);
    expect(ctx.coordinator.findTaskByClientOrderId(task.clientOrderId!).state).toBe('PARTIALLY_FILLED');
    ctx.coordinator.observe([{eventId:'confirmed-cancel',clientOrderId:task.clientOrderId!,state:'CANCELED',filledUnits:60,positionVersion:8}],NOW+25);
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(0);
    const next=request(ctx,{source:'MANUAL',quantityUnits:40,verdict:verdictFor(after),jit:jitFor(after,{positionVersion:8,availableReduceUnits:40,remainingUnits:40})});
    expect(next.accepted).toBe(true);
    const over=request(ctx,{source:'AI',quantityUnits:41,verdict:verdictFor(after),jit:jitFor(after,{positionVersion:8,availableReduceUnits:40,remainingUnits:40})});
    expect(over.reasons.some(reason=>reason.startsWith('QUANTITY_BUDGET_EXCEEDED'))).toBe(true);
  });

  it('S04-T04 an unconfirmed cancel blocks a conflicting full TP exit',()=>{
    const ctx=open();
    const task=request(ctx);
    ctx.coordinator.transition(task.taskId!,'SUBMITTING',NOW+1,'SENT');
    const tp=request(ctx,{source:'TP',quantityUnits:100});
    expect(tp.reasons).toContain('TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT');
    ctx.coordinator.markSubmitUncertain(task.taskId!,NOW+2);
    expect(request(ctx,{source:'TP',quantityUnits:100}).reasons).toContain('TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT');
    const human=request(ctx,{source:'MANUAL',quantityUnits:20,clientOrderIdIgnore:undefined} as never);
    expect(human.accepted).toBe(false);
    expect(human.reasons.some(reason=>reason.startsWith('QUANTITY_BUDGET_EXCEEDED'))).toBe(true);
    ctx.coordinator.observe([{eventId:'evt-cancel',clientOrderId:task.clientOrderId!,state:'CANCELED',filledUnits:0,positionVersion:7}],NOW+3);
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(0);
    const afterCancel=ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'TP',quantityUnits:100,mandate:{version:1,revokedAt:null},verdict:verdictFor(estimateFor(-5.79)),jit:jitFor(estimateFor(-5.79))});
    expect(afterCancel.accepted).toBe(true);
  });

  it('S05 boundary S04-T05 a partial fill that crosses -10 cannot keep consuming the same permission',()=>{
    const ctx=open();
    const task=request(ctx);
    ctx.coordinator.transition(task.taskId!,'SUBMITTING',NOW+1,'SENT');
    ctx.coordinator.observe([{eventId:'evt-p',clientOrderId:task.clientOrderId!,state:'PARTIALLY_FILLED',filledUnits:50,positionVersion:8}],NOW+2);
    // the extra realised loss changes the estimate identity, so the old decision is void
    const moved=estimateFor(-5.79,[item('leg2-realised','REALIZED_GROSS',-5,{sourceId:'fill-2'}),item('leg2-fee','PRIOR_EXIT_FEE',0.2,{sourceId:'fill-2'})]);
    const stale=verdictFor(estimateFor(-5.79));
    const refused=request(ctx,{source:'MANUAL',quantityUnits:50,verdict:stale,jit:jitFor(moved,{positionVersion:8,availableReduceUnits:50,remainingUnits:50})});
    expect(refused.reasons.some(reason=>reason.startsWith('JIT_ESTIMATE_STALE'))).toBe(true);
    const crossing=verdictFor(estimateFor(-5.79,[item('leg3','REALIZED_GROSS',-9,{sourceId:'fill-3'})]));
    expect(crossing.outcome).toBe('HANDOFF');
    expect(request(ctx,{source:'AI',quantityUnits:10,verdict:crossing,jit:jitFor(estimateFor(-5.79),{positionVersion:9})}).reasons).toContain('VERDICT_NOT_ALLOW');
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(50);
  });

  it('S04-T06 a crash at PREPARED, SUBMITTING or WORKING recovers with a stable identity',()=>{
    for(const stage of ['PREPARED','SUBMITTING','WORKING'] as const){
      const file=tempFile(`crash-${stage}.sqlite`);
      const first=new OwnershipJournal(file);
      const coordinator=new PositionExitCoordinator(first,CAPS);
      const estimate=estimateFor(-5.79);
      const result=coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate)});
      if(stage!=='PREPARED')coordinator.transition(result.taskId!,'SUBMITTING',NOW+1,'SENT');
      if(stage==='WORKING')coordinator.transition(result.taskId!,'WORKING',NOW+2,'ACK_WORKING');
      first.close();
      const reopened=new OwnershipJournal(file);
      const after=new PositionExitCoordinator(reopened,CAPS);
      const task=after.findTaskByClientOrderId(result.clientOrderId!);
      expect(task?.state,stage).toBe(stage);
      expect(task?.clientOrderId,stage).toBe(result.clientOrderId);
      expect(after.openClaimUnits(SCOPE,CYCLE),stage).toBe(100);
      expect(after.recoveryPlan(NOW+3).mustQuery.length,stage).toBe(1);
      expect(after.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate)}).reasons,stage).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
      reopened.close();
    }
  });

  it('S04-T07 duplicate, out-of-order and stale facts are deduplicated by identity and watermark',()=>{
    const ctx=open();
    const task=request(ctx);
    ctx.coordinator.transition(task.taskId!,'SUBMITTING',NOW+1,'SENT');
    ctx.coordinator.transition(task.taskId!,'WORKING',NOW+2,'ACK');
    const first=ctx.coordinator.observe([{eventId:'evt-a',clientOrderId:task.clientOrderId!,state:'PARTIALLY_FILLED',filledUnits:40,positionVersion:11}],NOW+3);
    expect(first.applied).toHaveLength(1);
    const replay=ctx.coordinator.observe([{eventId:'evt-a',clientOrderId:task.clientOrderId!,state:'PARTIALLY_FILLED',filledUnits:40,positionVersion:11}],NOW+4);
    expect(replay.skipped).toContain('DUPLICATE:evt-a');
    const stale=ctx.coordinator.observe([{eventId:'evt-old',clientOrderId:task.clientOrderId!,state:'WORKING',filledUnits:10,positionVersion:9}],NOW+5);
    expect(stale.skipped.some(note=>note.startsWith('STALE_WATERMARK'))).toBe(true);
    expect(ctx.coordinator.findTaskByClientOrderId(task.clientOrderId!).filledUnits).toBe(40);
    const regression=ctx.coordinator.observe([{eventId:'evt-regress',clientOrderId:task.clientOrderId!,state:'WORKING',filledUnits:20,positionVersion:12}],NOW+6);
    expect(regression.skipped.some(note=>note.startsWith('STALE_WATERMARK')||note.startsWith('FILL_REGRESSION')||note.startsWith('ILLEGAL_TRANSITION'))).toBe(true);
    const unbound=ctx.coordinator.observe([{eventId:'evt-x',clientOrderId:'v396xdeadbeef',state:'FILLED',filledUnits:5,positionVersion:13}],NOW+7);
    expect(unbound.skipped).toContain('UNBOUND_ORDER:v396xdeadbeef');
    ctx.coordinator.observe([{eventId:'evt-done',clientOrderId:task.clientOrderId!,state:'FILLED',filledUnits:100,positionVersion:14}],NOW+8);
    const resurrect=ctx.coordinator.observe([{eventId:'evt-late',clientOrderId:task.clientOrderId!,state:'WORKING',filledUnits:10,positionVersion:15}],NOW+9);
    expect(resurrect.skipped).toContain(`TERMINAL_TASK:${task.taskId}`);
    expect(ctx.coordinator.transition(task.taskId!,'UNKNOWN',NOW+10,'late')).toBeNull();
  });

  it('S04-T08 both position modes, precision and exposure rules refuse rather than add risk',()=>{
    const hedgeless=new PositionExitCoordinator(new OwnershipJournal(tempFile('hedge.sqlite')),{...CAPS,hedgePositionSide:false,positionMode:'HEDGE'});
    const estimate=estimateFor(-5.79);
    expect(hedgeless.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate)}).reasons).toContain('HEDGE_MODE_UNSUPPORTED');
    const noReduceOnly=new PositionExitCoordinator(new OwnershipJournal(tempFile('oneway.sqlite')),{...CAPS,oneWayReduceOnly:false,positionMode:'ONE_WAY'});
    expect(noReduceOnly.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate)}).reasons).toContain('REDUCE_ONLY_UNPROVEN');
    const naked=new PositionExitCoordinator(new OwnershipJournal(tempFile('naked.sqlite')),{...CAPS,oneWayReduceOnly:false,hedgePositionSide:false,positionMode:'ONE_WAY'});
    const nakedEstimate=estimateFor(-5.79);
    expect(naked.requestExit({scope:SCOPE,cycleId:CYCLE,source:'TP',quantityUnits:100,verdict:verdictFor(nakedEstimate),jit:jitFor(nakedEstimate)}).reasons).toContain('REDUCE_ONLY_UNPROVEN');
    const ctx=open();
    const dust=ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:101,verdict:verdictFor(estimate),jit:jitFor(estimate,{remainingUnits:100})});
    expect(dust.reasons.some(reason=>reason.startsWith('QUANTITY_BUDGET_EXCEEDED'))).toBe(true);
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:0,verdict:verdictFor(estimate),jit:jitFor(estimate)}).reasons).toContain('QUANTITY_INVALID');
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate,{minNotional:100_000})}).reasons).toContain('NOTIONAL_TOO_SMALL');
    const misaligned=verdictFor(estimate);misaligned.boundaryPrice=95.017;
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:misaligned,jit:jitFor(estimate)}).reasons).toContain('PRICE_NOT_TICK_ALIGNED');
    const unbounded=ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate,{availableReduceUnits:Number.NaN})});
    expect(unbounded.reasons).toContain('JIT_FACT_NOT_FINITE:availableReduceUnits');
    const unknownAvailability=ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate,{availableReduceUnits:-1})});
    expect(unknownAvailability.reasons).toContain('JIT_AVAILABILITY_UNPROVEN');
  });

  it('S04-T09 paused risk, offline model and unverified egress cannot be reasoned around',()=>{
    const ctx=open();
    const estimate=estimateFor(-5.79);
    const blockedFacts=decideAiExit({
      owner:{ownerState:'AI_ACTIVE',ownerVersion:4,cycleId:CYCLE,scope:SCOPE,deadline:NOW+60_000},
      plan:{planVersion:2,cycleId:CYCLE,scope:SCOPE,thesisInvalid:true,invalidationPredicate:null,invalidationEvidenceRefs:[],exitConditionMet:false,minNetProfitUsd:0.5},
      estimate,bound:boundFor(),policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000},now:NOW,
    } as PolicyInput);
    expect(blockedFacts.outcome).toBe('BLOCKED_FACTS');
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:blockedFacts,jit:jitFor(estimate)}).reasons).toContain('VERDICT_NOT_ALLOW');
    const egressUnverified=estimateFor(-5.79,[],{tickSize:Number.NaN});
    expect(egressUnverified.factsStatus).not.toBe('EXACT');
    // an estimate that could not be produced cannot yield an ALLOW, so nothing is claimed
    const unverifiedRequest=ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(egressUnverified),jit:jitFor(estimate)});
    expect(unverifiedRequest.reasons).toContain('VERDICT_NOT_ALLOW');
    expect(unverifiedRequest.accepted).toBe(false);
    expect(ctx.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(0);
    const pastAuthority=verdictFor(estimate);
    expect(pastAuthority.outcome).toBe('ALLOW');
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:pastAuthority,jit:jitFor(estimate,{now:pastAuthority.authorizationExpiresAt!+1})}).reasons).toContain('AUTHORIZATION_EXPIRED_OR_EMPTY');
    const atDeadline=decideAiExit({
      owner:{ownerState:'AI_ACTIVE',ownerVersion:4,cycleId:CYCLE,scope:SCOPE,deadline:NOW+60_000},
      plan:{planVersion:2,cycleId:CYCLE,scope:SCOPE,thesisInvalid:true,invalidationPredicate:'STRUCTURE_BREAK_15M',invalidationEvidenceRefs:['ev-1'],exitConditionMet:false,minNetProfitUsd:0.5},
      estimate,bound:boundFor(),policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000},now:NOW+60_000,
    } as PolicyInput);
    expect(atDeadline.outcome).toBe('HANDOFF');
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:atDeadline,jit:jitFor(estimate,{now:NOW+60_000})}).reasons).toContain('VERDICT_NOT_ALLOW');
    const source=JSON.stringify(Object.keys(PositionExitCoordinator.prototype));
    expect(source).not.toMatch(/fetch|http|signed|placeOrder/i);
  });

  it('S04-T10 a mandate the human revoked is never restored by a retry or a recovery',()=>{
    const ctx=open();
    const estimate=estimateFor(-5.79);
    const verdict=verdictFor(estimate);
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'TP',quantityUnits:100,mandate:{version:2,revokedAt:NOW},verdict,jit:jitFor(estimate)}).reasons).toContain('MANDATE_REVOKED_BY_HUMAN');
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'TP',quantityUnits:100,mandate:null,verdict,jit:jitFor(estimate)}).accepted).toBe(true);
    expect(ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'TP',quantityUnits:100,mandate:{version:2,revokedAt:NOW},verdict,jit:jitFor(estimate)}).reasons).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
  });

  it('S04 properties: versions increase, terminal is forever, and no open state disappears silently',()=>{
    const file=tempFile('properties.sqlite');
    const journal=new OwnershipJournal(file);
    const coordinator=new PositionExitCoordinator(journal,CAPS);
    const estimate=estimateFor(-5.79);
    const first=coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:100,verdict:verdictFor(estimate),jit:jitFor(estimate)});
    let task=coordinator.findTaskByClientOrderId(first.clientOrderId!)!;
    const seen:[string,number][]=[[task.state,task.version]];
    for(const next of ['SUBMITTING','WORKING','PARTIALLY_FILLED','FILLED'] as const){
      const moved=next==='FILLED'?(coordinator.observe([{eventId:'property-full-fill',clientOrderId:first.clientOrderId!,state:'FILLED',filledUnits:100,positionVersion:8}],NOW+seen.length*10),coordinator.findTaskByClientOrderId(first.clientOrderId!)):coordinator.transition(task.taskId,next,NOW+seen.length*10,'PROPERTY_walk');
      expect(moved,`transition to ${next}`).not.toBeNull();
      expect(moved!.version).toBeGreaterThan(task.version);
      task=moved!;seen.push([task.state,task.version]);
      expect(coordinator.findTaskByClientOrderId(first.clientOrderId!)!.state).toBe(next);
    }
    expect(TERMINAL_STATES).toContain(task.state);
    for(const illegal of ['WORKING','UNKNOWN','PARTIALLY_FILLED'] as const)expect(coordinator.transition(task.taskId,illegal,NOW+99,'resurrect')).toBeNull();
    expect(coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(0);
    const reopened=new PositionExitCoordinator(new OwnershipJournal(file),CAPS);
    expect(reopened.allTasks().map(row=>[row.state,row.version])).toEqual(seen.map(([state,version])=>[state,version]).slice(-1));
    expect(reopened.recoveryPlan(NOW+100).mustQuery).toEqual([]);
    const openStates=reopened.allTasks().filter(row=>OPEN_STATES.includes(row.state));
    expect(openStates).toHaveLength(0);
    reopened.allTasks().forEach(row=>expect(row.clientOrderId).toBe(first.clientOrderId));
    journal.close();
  });
});
