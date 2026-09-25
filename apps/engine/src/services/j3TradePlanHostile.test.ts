import {describe,expect,it,vi} from 'vitest';
import {TradePlanSchema, type TradePlan} from '@zdj/contracts';
import {createQuantityHorizonCandidates} from './quantityHorizonCandidates.js';
import {aiExitPlanFactsOf,assembleTradePlan,assertPlanSupersede,cycleLossBudget,evaluatePlanEvidence,executedPlanRecord,planIdOf} from './tradePlanService.js';
import {RuntimeState} from '../state/runtimeState.js';
import {harness} from './tradingQualityTestHarness.js';

/**
 * J2/S06 acceptance: a plan is a computed, durable, immutable statement of what was chosen and why.
 * Every case below tries to make the plan look better than the facts - bigger size, longer horizon,
 * borrowed evidence, a rewritten prediction after the fill.
 */

const any=(value:unknown)=>value as any;
const NOW=1_800_000_000_000;
const riskFacts={capitalAtRiskUsd:100,grossNotionalAfterUsd:1_000,longNotionalAfterUsd:1_000,shortNotionalAfterUsd:0,
  clusterNotionalUsd:1_000,clusterNotionalAfterUsd:1_000,limitingConstraints:[] as string[],riskGeneration:7,
  snapshotHash:`v396r${'a'.repeat(64)}`,profileVersion:`v396r${'b'.repeat(64)}`,humanSlotsAfter:1};

const baseSettings=(over:Record<string,any>={})=>any({takeProfit:{entryFeeRate:.0002,takerFeeRate:.0004,makerFeeRate:.0002,exitFeeAssumption:'TAKER',
    slippageBufferPct:.05,feeSafetyBufferPct:.02,minNetProfitUsd:1,minNetProfitRoiPct:.1,structureMaxMovePercent:6},
  tradeEconomics:{admissionMode:'ENFORCE',historicalTpReachabilityEnabled:true,reachabilityLookbackBars:180,reachabilityMinSamples:30,
    minHistoricalReachProbability:.2,standardTpHorizons:[15,60,240]},...over});

/** A closed 15m series whose last bar closes now, so reachability has a real sample to measure. */
function candles(moves:number[]){
  let price=100;const rows=moves.map((move,index)=>{
    const high=price*(1+Math.abs(move)/100),low=price*(1-Math.abs(move)/100),close=price*(1+move/100);
    price=close;return{high,low,close,closeTime:NOW-(moves.length-index-1)*900_000,openTime:NOW-(moves.length-index)*900_000};
  });
  return()=>rows;
}
const sample=()=>candles(new Array(300).fill(4));

function candidates(over:{settings?:any;quote?:any;envelope?:any;selection?:any;candles?:any;side?:'LONG'|'SHORT'}={}){
  const candleSource=over.candles;
  const quote={bid:99.9,ask:100.1,tickSize:.1,stepSize:1,minQty:1,minNotional:5,...over.quote};
  const envelope={maxQuantityUnits:50,maxNotionalUsd:5_000,maxMarginUsd:500,executable:true,...over.envelope};
  return createQuantityHorizonCandidates({symbol:'BTCUSDT',side:over.side??'LONG',now:NOW,quote,leverage:10,envelope,envelopeExpiresAt:NOW+120_000,
    factVersion:`facts-${Object.keys(over).join(',')}`,risk:riskFacts,settings:over.settings??baseSettings(),
    candles:candleSource??sample(),managementDurationMs:24*3_600_000,selection:over.selection,
    // echoed so a follow-up set can be rebuilt with the same inputs
    ...{quote,settings:over.settings??baseSettings(),candleSource},} as any);
}

const selectionFor=(candidate:any,over:Record<string,any>={})=>({decision:candidate.side==='LONG'?'PLACE_LONG':'PLACE_SHORT',side:candidate.side,
  quantityUnits:candidate.quantityUnits,targetPrice:candidate.targetPrice,targetHorizonMinutes:candidate.targetHorizonMinutes,
  thesis:'15m structure holds above the reclaimed level',invalidationPredicate:'CLOSED_BAR_BREAKS_LEVEL',predicateLevel:95,
  predicateEvidenceRefs:['bar:BTCUSDT:15m'],counterEvidenceRefs:[],releaseCondition:null,modelRunId:'run_1',promptVersion:'V3.9.3',
  modelConfidence:.9,horizonMinutes:3,...over});

/** The realistic path: the caller's triple goes into the generator, which offers it or refuses it. */
const setWithSelection=(resolver:any,candidate:any,over:Record<string,any>={})=>candidates({
  quote:resolver.quote,settings:resolver.settings??baseSettings(),candles:resolver.candleSource,
  side:candidate.side,selection:{quantityUnits:candidate.quantityUnits,targetPrice:candidate.targetPrice,
    targetHorizonMinutes:candidate.targetHorizonMinutes,...(over.setSelection??{})}}).set;

const planInput=(set:any,candidate:any,over:Record<string,any>={})=>({selection:selectionFor(candidate,over.selection??{}),candidateSet:setWithSelection(set,candidate,over.selection??{}),
  scope:JSON.stringify(['TESTNET','binance-primary','BTCUSDT','LONG']),cycleId:'cycle_j3',symbol:'BTCUSDT',leverage:10,
  minNetProfitUsd:1,maxRealizedLossUsd:10,factVersion:'facts-j3',now:NOW,...over});

describe('S06 candidate generation',()=>{
  it('S06-T01 a side without capacity is refused, never switched to the side with more room',()=>{
    const blocked=candidates({envelope:{executable:false,riskHeadroom:{blockers:['MAX_DIRECTION_NOTIONAL']},maxQuantityUnits:0,maxNotionalUsd:0,maxMarginUsd:0}});
    expect(blocked.set.noTradeReasons).toContain('SIDE_NOT_EXECUTABLE');
    expect(blocked.set.candidates).toEqual([]);
    const computed=blocked.compute({quantityUnits:1,targetHorizonMinutes:60,targetPrice:104});
    expect(computed.candidate).toBeNull();
    expect(computed.refusals.join('|')).toMatch(/SIDE_NOT_EXECUTABLE/);
  });

  it('S06-T02 the minimum size either clears its own profit floor or the answer is NO_TRADE',()=>{
    const rich=candidates();
    expect(rich.set.candidates.length).toBeGreaterThan(0);
    // A hard profit floor the arithmetic itself cannot reach (the whole 1x-3x price band still fails
    // it) is NO_TRADE, and the refused set offers no quantity at all: sizing is never grown to chase
    // the floor (S06-T02). A requirement that is only beyond what the sample ever moved is the
    // statistical ceiling, and is named that way instead - see S06-T06.
    const unreachable=candidates({settings:baseSettings({takeProfit:{...baseSettings().takeProfit,minNetProfitUsd:1e9}})});
    expect(unreachable.set.candidates).toEqual([]);
    expect(unreachable.set.noTradeReasons).toContain('MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY');
    expect(unreachable.set.noTradeReasons.join('|')).toMatch(/MIN_NET_PROFIT_USD=.*ATTAINED_NET_PROFIT_USD=/);
    expect(unreachable.set.feasibleQuantityUnits).toEqual({min:0,max:0});
    expect(unreachable.set.statisticalEvidence??[]).toEqual([]);
    // A generous sample and a reachable floor keep the smallest legal size offered.
    expect(rich.set.candidates[0].quantityUnits).toBe(rich.set.feasibleQuantityUnits.min);
  });

  it('S06-T04 a SHADOW statistical ceiling is evidence, never a silent hard veto',()=>{
    // The tight sample makes the historical ceiling smaller than the price the profit floor needs,
    // while the profit floor itself is satisfied: exactly the case the account lost 26 PLACE decisions to.
    const tight=candles(new Array(300).fill(.02));
    const shadow=candidates({settings:baseSettings({tradeEconomics:{...baseSettings().tradeEconomics,admissionMode:'SHADOW'}}),candles:tight});
    const refused=shadow.set.noTradeReasons.join('|');
    expect(refused).not.toMatch(/NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY|NO_EXECUTABLE_CANDIDATE/);
    expect(refused).not.toMatch(/HISTORICAL_TARGET_CEILING_EXCEEDED/);
    // The candidate survives, is still the smallest legal size, and says out loud that the sample
    // does not support its target. Recording it is not the same as claiming the sample supports it.
    const row=shadow.set.candidates[0];
    expect(row).toBeTruthy();
    expect(row.quantityUnits).toBe(shadow.set.feasibleQuantityUnits.min);
    expect(row.executable).toBe(true);
    expect(row.economics.targetVsStatisticalCeiling).toBe('BEYOND');
    expect(shadow.set.statisticalEvidence??[]).toContain('HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY');
    const bounds=shadow.set.bounds?.[0];
    expect(bounds && bounds.maxTargetPrice!=null && bounds.minTargetPrice>bounds.maxTargetPrice).toBe(true);
    // A SHADOW refusal is never smuggled in as a blocker either, so no consumer can read it as a veto.
    expect(row.blockers).toEqual([]);
  });

  it('S06-T05 the same ceiling still refuses outright once the account runs ENFORCE',()=>{
    const tight=candles(new Array(300).fill(.02));
    const enforced=candidates({candles:tight});
    expect(enforced.set.candidates).toEqual([]);
    expect(enforced.set.noTradeReasons.join('|')).toMatch(/HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY/);
    // The profit numbers are not printed as if they had failed: they belong to the other reason.
    expect(enforced.set.noTradeReasons.join('|')).not.toMatch(/MIN_PROFIT_FLOOR_UNMET/);
    // And the model's own choice on that side is refused for the same named reason, not another.
    const selection=enforced.compute({quantityUnits:1,targetHorizonMinutes:15,targetPrice:100.2});
    expect(selection.candidate).toBeNull();
    expect(selection.refusals.join('|')).toMatch(/STATISTICAL_BOUND|CEILING/);
  });

  it('S06-T06 the two refusals are never conflated: profit floor and statistical ceiling are named apart',()=>{
    // Ceiling exceeded, profit satisfied.
    const ceiling=candidates({candles:candles(new Array(300).fill(.02)),
      settings:baseSettings({tradeEconomics:{...baseSettings().tradeEconomics,admissionMode:'ENFORCE'}})});
    const ceilingText=ceiling.set.noTradeReasons.join('|');
    expect(ceilingText).toMatch(/HISTORICAL_TARGET_CEILING_EXCEEDED/);
    expect(ceilingText).not.toMatch(/MIN_PROFIT_FLOOR_UNMET|NO_PROFITABLE_COMBINATION/);
    // Profit unmet in arithmetic, ceiling irrelevant: the only case allowed to quote the profit numbers.
    const profit=candidates({settings:baseSettings({takeProfit:{...baseSettings().takeProfit,minNetProfitUsd:1e9}})});
    const profitText=profit.set.noTradeReasons.join('|');
    expect(profitText).toMatch(/MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY/);
    expect(profitText).toMatch(/MIN_NET_PROFIT_USD=.*ATTAINED_NET_PROFIT_USD=/);
    expect(profitText).not.toMatch(/CEILING/);
    // Nothing in either case is a message of the shape "attained >= minimum, therefore no trade".
    for(const set of [ceiling.set,profit.set]){
      const attained=set.noTradeReasons.find(row=>row.startsWith('ATTAINED_NET_PROFIT_USD='));
      const minimum=set.noTradeReasons.find(row=>row.startsWith('MIN_NET_PROFIT_USD='));
      if(attained&&minimum){
        expect(Number(attained.split('=')[1])).toBeLessThan(Number(minimum.split('=')[1]));
        expect(set.noTradeReasons.join('|')).not.toMatch(/NO_PROFITABLE_COMBINATION/);
      }
    }
  });

  it('S06-T07 a SHADOW selection the sample does not support is offered, with the evidence named',()=>{
    // Live 2026-09-25 00:23: a PLACE_SHORT was refused at TRADE_PLAN with an empty reason list. This is
    // that path: the model asked for the smallest legal size at a target the historical sample does
    // not support, the profit floor itself is satisfied, and the account runs SHADOW.
    const tight=candles(new Array(300).fill(.02));
    const shadowSettings=baseSettings({tradeEconomics:{...baseSettings().tradeEconomics,admissionMode:'SHADOW'}});
    const offered=candidates({settings:shadowSettings,candles:tight}).set;
    const row=offered.candidates[0];
    expect(row).toBeTruthy();
    const selection={quantityUnits:row.quantityUnits,targetHorizonMinutes:row.targetHorizonMinutes,targetPrice:row.targetPrice};
    const asked=candidates({settings:shadowSettings,candles:tight,selection}).set;
    expect(asked.selection?.offered, 'a SHADOW ceiling is evidence; it may not veto the model triple silently').toBe(true);
    expect(asked.selection?.refusals).toEqual([]);
    expect(asked.statisticalEvidence?.join('|')).toMatch(/SELECTION_TARGET_BEYOND_STATISTICAL_CEILING|BEYOND_STATISTICAL/i);
    expect(asked.selection?.resolved?.candidateId).toBeTruthy();
    // ENFORCE keeps its authority over exactly this selection, named as the ceiling it is.
    const enforced=candidates({settings:baseSettings(),candles:tight,selection}).set;
    expect(enforced.selection?.offered).toBe(false);
    expect(enforced.selection?.refusals.join('|')).toMatch(/STATISTICAL_BOUND|CEILING/);
    expect(enforced.selection?.refusals.length).toBeGreaterThan(0);
  });

  it('S06-T08 a selection is never refused without a reason that can be shown to an operator',()=>{
    const tight=candles(new Array(300).fill(.02));
    const shadowSettings=baseSettings({tradeEconomics:{...baseSettings().tradeEconomics,admissionMode:'SHADOW'}});
    const row=candidates({settings:shadowSettings,candles:tight}).set.candidates[0];
    const cases:Array<Record<string,any>>=[
      // The triple the generator itself offered is the case that must never come back unexplained.
      {selection:{quantityUnits:row.quantityUnits,targetHorizonMinutes:row.targetHorizonMinutes,targetPrice:row.targetPrice},candles:tight},
      {selection:{quantityUnits:0,targetHorizonMinutes:15,targetPrice:104}},
      {selection:{quantityUnits:1,targetHorizonMinutes:15,targetPrice:104}},
      {selection:{quantityUnits:25,targetHorizonMinutes:7,targetPrice:104}},
      {selection:{quantityUnits:25,targetHorizonMinutes:15,targetPrice:100.2},candles:tight},
      {selection:{quantityUnits:25,targetHorizonMinutes:15,targetPrice:1},candles:tight},
      {selection:{quantityUnits:25,targetHorizonMinutes:15,targetPrice:104},candles:tight},
    ];
    for(const over of cases){
      for(const admissionMode of ['SHADOW','ENFORCE'] as const){
        const set=candidates({settings:baseSettings({tradeEconomics:{...baseSettings().tradeEconomics,admissionMode}}),
          ...(over.candles?{candles:over.candles}:{})
          ,selection:over.selection}).set;
        if(set.selection&&set.selection.offered===false)
          expect(set.selection.refusals.length,`${admissionMode} ${JSON.stringify(over.selection)} refused silently`).toBeGreaterThan(0);
      }
    }
  });

  it('S06-T03 confidence is never a probability, and a missing sample is named',()=>{
    const noSample=candidates({candles:()=>new Array(5).fill({high:100,low:99,close:99.5,closeTime:NOW-900_000,openTime:NOW-1_800_000})});
    expect(noSample.set.noTradeReasons.join('|')+JSON.stringify(noSample.set.candidates.map(row=>row.economics.expectedNetPnlAtHorizonStatus)))
      .toMatch(/INSUFFICIENT_SAMPLE|NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY|TP_REACHABILITY_INSUFFICIENT_SAMPLE/);
    const shadowed=candidates({settings:baseSettings({tradeEconomics:{...baseSettings().tradeEconomics,admissionMode:'SHADOW'}})});
    const row=shadowed.set.candidates[0];
    expect(row).toBeTruthy();
    expect(['INSUFFICIENT_SAMPLE','VERIFIED']).toContain(row.economics.expectedNetPnlAtHorizonStatus);
    expect(row.economics.modelConfidenceIsAuthority).toBe(false);
    if(row.economics.expectedNetPnlAtHorizonStatus==='INSUFFICIENT_SAMPLE'){
      expect(row.economics.expectedNetPnlAtHorizonUsd).toBeNull();
      expect(row.economics.reachProbability).toBeNull();
    }
  });

  it('a selection is validated and recomputed; the model cannot state something outside it',()=>{
    const set=candidates();
    const offered=set.compute({quantityUnits:25,targetHorizonMinutes:60,targetPrice:104});
    expect(offered.candidate).toBeTruthy();
    const sameAgain=set.compute({quantityUnits:25,targetHorizonMinutes:60,targetPrice:104});
    expect(sameAgain.candidate!.candidateId).toBe(offered.candidate!.candidateId);
    const tooBig=set.compute({quantityUnits:5_000,targetHorizonMinutes:60,targetPrice:104});
    expect(tooBig.refusals.join('|')).toMatch(/CANDIDATE_QUANTITY_EXCEEDS_ENVELOPE|CANDIDATE_QUANTITY_OUTSIDE_ENVELOPE/);
    const outOfRange=set.compute({quantityUnits:25,targetHorizonMinutes:60,targetPrice:400});
    expect(outOfRange.refusals.join('|')).toMatch(/CANDIDATE_TARGET_BEYOND_STATISTICAL_BOUND/);
    const belowFloor=set.compute({quantityUnits:25,targetHorizonMinutes:60,targetPrice:100.2});
    expect(belowFloor.refusals.join('|')).toMatch(/CANDIDATE_TARGET_BELOW_PROFIT_FLOOR|ECONOMIC_MIN_NET_PROFIT_UNMET/);
    expect(set.compute({quantityUnits:25,targetHorizonMinutes:37,targetPrice:104}).refusals).toContain('CANDIDATE_HORIZON_UNSUPPORTED:37');
  });

  it('the ladder starts at the smallest size the exchange minimum notional allows',()=>{
    const tiny=candidates({quote:{bid:.026_16,ask:.026_17,tickSize:.000_01,stepSize:1,minQty:1,minNotional:5},
      envelope:{maxQuantityUnits:100_000,maxNotionalUsd:5_000,maxMarginUsd:500,executable:true}});
    expect(tiny.set.feasibleQuantityUnits.min).toBeGreaterThan(1);
    expect(tiny.set.candidates.every(row=>row.notionalUsd>=5-1e-9)).toBe(true);
  });
});

describe('S06 plan assembly and verification',()=>{
  const pickExecutable=(set:any)=>{const first=(set.set??set).candidates.find((row:any)=>row.executable)??(set.set??set).candidates[0];return first;};

  it('S06-T06 the three horizons are separate fields and a mis-filled one is refused',()=>{
    const set=candidates(),candidate=pickExecutable(set);
    const swapped=assembleTradePlan({...planInput(set,candidate,{selection:{...selectionFor(candidate),targetHorizonMinutes:candidate.targetHorizonMinutes}})});
    expect(swapped.plan?.entryTtlMinutes).toBeLessThanOrEqual(swapped.plan?.targetHorizonMinutes as number);
    expect(TradePlanSchema.safeParse({...swapped.plan,managementDurationMs:60_000}).success).toBe(false);
    expect(TradePlanSchema.safeParse({...swapped.plan,entryTtlMinutes:1_440}).success).toBe(false);
    const waitWithSize=TradePlanSchema.safeParse({...swapped.plan,side:'WAIT',quantityUnits:1});
    expect(waitWithSize.success).toBe(false);
    if(!waitWithSize.success)expect(waitWithSize.error.issues.map(issue=>issue.message).join('|')).toMatch(/WAIT_PLAN_/);
  });

  it('S06-T08 a stated parameter that widens authority is refused, not clamped',()=>{
    const set=candidates(),candidate=pickExecutable(set);
    const widenInput=planInput(set,candidate,{selection:{...selectionFor(candidate),quantityUnits:candidate.quantityUnits+5}});
    const widened=assembleTradePlan(widenInput);
    expect(widened.plan,JSON.stringify({refusals:widened.refusals,planUnits:widened.plan?.quantityUnits,stated:candidate.quantityUnits+5,chosen:candidate.quantityUnits})).toBeNull();
    expect(widened.refusals.join('|')).toMatch(/PLAN_PARAMETER_OUTSIDE_CANDIDATE:quantityUnits|CANDIDATE_QUANTITY_EXCEEDS_ENVELOPE/);
    const invented=assembleTradePlan(planInput(set,candidate,{selection:{...selectionFor(candidate),targetPrice:candidate.targetPrice*1.001}}));
    expect(invented.plan,JSON.stringify(invented.refusals)).toBeNull();
    expect(invented.refusals.join('|')).toMatch(/PLAN_PARAMETER_OUTSIDE_CANDIDATE:targetPrice|CANDIDATE_TARGET_BEYOND_STATISTICAL_BOUND/);
    const codePredicate=assembleTradePlan(planInput(set,candidate,{selection:{...selectionFor(candidate),invalidationPredicate:'eval(process.exit())'}}));
    expect(codePredicate.plan,JSON.stringify(codePredicate.refusals)).toBeNull();
    expect(codePredicate.refusals).toContain('PLAN_PREDICATE_UNSUPPORTED');
    const notACandidate=assembleTradePlan(planInput(set,candidate,{selection:{...selectionFor(candidate),selectedCandidateId:'cand_forged'}}));
    expect(notACandidate.plan,JSON.stringify(notACandidate.refusals)).toBeNull();
    expect(notACandidate.refusals.join('|')).toMatch(/PLAN_CANDIDATE_ID_FORGED|PLAN_SELECTION_NOT_IN_CANDIDATE_SET/);
  });

  it('S06-T04 evidence is checked for symbol, closure and age; a stale bar cannot support a plan',()=>{
    const set=candidates(),candidate=pickExecutable(set);
    const assembled=assembleTradePlan(planInput(set,candidate));
    expect(assembled.plan).toBeTruthy();
    const plan=assembled.plan as TradePlan;
    const stale=evaluatePlanEvidence(plan,{now:NOW+600_000,facts:[{symbol:'BTCUSDT',timeframe:'15m',isClosed:true,barCloseTime:NOW-500_000,maxAgeMs:60_000,appliesToSymbol:'BTCUSDT'}],
      resolve:ref=>({symbol:'BTCUSDT',timeframe:'15m',closedAt:NOW-500_000,observedAt:NOW-500_000,ref})});
    expect(stale.ready).toBe(false);
    expect(stale.unusable[0].reason).toMatch(/PLAN_EVIDENCE_STALE|PLAN_EVIDENCE_BAR_SUPERSEDED/);
    const otherSymbol=evaluatePlanEvidence(plan,{now:NOW,facts:[{symbol:'BTCUSDT',timeframe:'15m',isClosed:true,barCloseTime:NOW-60_000,maxAgeMs:600_000,appliesToSymbol:'BTCUSDT'}],
      resolve:()=>({symbol:'ETHUSDT',timeframe:'15m',closedAt:NOW-60_000,observedAt:NOW-60_000})});
    expect(otherSymbol.unusable[0].reason).toMatch(/PLAN_EVIDENCE_SYMBOL_MISMATCH/);
    const unclosed=evaluatePlanEvidence(plan,{now:NOW,facts:[{symbol:'BTCUSDT',timeframe:'15m',isClosed:false,barCloseTime:NOW+60_000,maxAgeMs:600_000,appliesToSymbol:'BTCUSDT'}],
      resolve:()=>({symbol:'BTCUSDT',timeframe:'15m',closedAt:NOW+60_000,observedAt:NOW})});
    expect(unclosed.unusable[0].reason).toMatch(/PLAN_EVIDENCE_BAR_NOT_CLOSED|PLAN_EVIDENCE_STALE/);
    const unresolved=evaluatePlanEvidence(plan,{now:NOW,facts:[],resolve:()=>null});
    expect(unresolved.ready).toBe(false);
    expect(unresolved.unusable[0].reason).toBe('PLAN_EVIDENCE_UNRESOLVED');
  });

  it('S06-T09 the same frozen facts re-evaluate to the same plan; a new fact version does not',()=>{
    const set=candidates(),candidate=pickExecutable(set);
    const first=assembleTradePlan(planInput(set,candidate));
    const again=assembleTradePlan(planInput(set,candidate));
    expect(again.plan!.planId).toBe(first.plan!.planId);
    expect(JSON.stringify(again.plan!.economics)).toBe(JSON.stringify(first.plan!.economics));
    const moved=candidates({settings:baseSettings({takeProfit:{...baseSettings().takeProfit,minNetProfitUsd:1.5}})});
    const movedCandidate=pickExecutable(moved);
    const other=assembleTradePlan(planInput(moved,movedCandidate));
    expect(other.plan).toBeTruthy();
    expect(other.plan!.planId).not.toBe(first.plan!.planId);
    expect(planIdOf({scope:'s',cycleId:'c',factVersion:'f1',candidateSetHash:'h',side:'LONG',selectedCandidateId:'x',planVersion:1}))
      .toBe(planIdOf({scope:'s',cycleId:'c',factVersion:'f1',candidateSetHash:'h',side:'LONG',selectedCandidateId:'x',planVersion:1}));
  });

  it('S06-T05 a target beyond what the sample ever moved is not offered, and hardMax is recorded',()=>{
    const set=candidates(),candidate=pickExecutable(set);
    expect(candidate.economics.targetMovePercent).toBeLessThanOrEqual((candidate.economics.historicalHardMaxMovePercent??10)+1e-9);
    expect(candidate.economics.statisticalSource).not.toMatch(/confidence|model/i);
    const shortBound=set.set.bounds.find(row=>row.maxTargetPrice!=null)??set.set.bounds[0];
    const computed=set.compute({quantityUnits:candidate.quantityUnits,targetHorizonMinutes:shortBound.horizonMinutes,targetPrice:(shortBound.maxTargetPrice??0)*1.05});
    expect(shortBound.maxTargetPrice).toBeTruthy();
    expect(computed.candidate).toBeNull();
    expect(computed.refusals.join('|')).toMatch(/CANDIDATE_TARGET_BEYOND_STATISTICAL_BOUND|CANDIDATE_TARGET_BELOW_PROFIT_FLOOR/);
  });
});

describe('S06 plan durability and the executed diff',()=>{
  const freshPlan=()=>{
    const set=candidates(),candidate=set.set.candidates.find(row=>row.executable)??set.set.candidates[0];
    return assembleTradePlan(planInput(set,candidate)).plan as TradePlan;
  };

  it('a stored plan is write-once: the same plan is idempotent, a different one is refused',()=>{
    const state=new RuntimeState(any({portfolio:{maxPositions:3},riskGovernance:{}})) as any;
    const plan=freshPlan();
    expect(state.putTradePlan(plan).written).toBe(true);
    expect(state.putTradePlan({...plan}).written).toBe(false);
    expect(state.putTradePlan({...plan}).identical).toBe(true);
    const rewritten=state.putTradePlan({...plan,planId:`${plan.planId}x`,targetPrice:Number(plan.targetPrice!)*1.5,
      economics:{...plan.economics!,targetConditionalNetProfitUsd:999}});
    expect(rewritten.written).toBe(true);
    const sameVersion=state.putTradePlan({...rewritten.plan,planId:plan.planId});
    expect(sameVersion.written).toBe(false);
    expect(sameVersion.reason).toBe('PLAN_VERSION_NOT_INCREASING');
  });

  it('S06-T07 a fill records the deviation and never touches the original prediction',()=>{
    const plan=freshPlan();
    const before=JSON.stringify(plan);
    const record=executedPlanRecord({plan,intentId:'intent_1',reservationId:'reserve_1',orderId:'entry_1',actualEntryPrice:Number(plan.entryReferencePrice)*1.02,
      executedQuantityUnits:plan.quantityUnits-1,feeActualUsd:.12,source:'PARTIAL_FILL',now:plan.persistedAt+1_000});
    expect(JSON.stringify(plan)).toBe(before);
    expect(record.predictionMutated).toBe(false);
    expect(record.plannedQuantityUnits).toBe(plan.quantityUnits);
    expect(record.quantityDeviationUnits).toBe(-1);
    expect(record.priceDeviationUsd).toBeCloseTo(Number(plan.entryReferencePrice)*.02,6);
    const state=new RuntimeState(any({portfolio:{maxPositions:3},riskGovernance:{}})) as any;
    state.putTradePlan(plan);state.recordPlanExecution(record);
    expect(state.executionsForPlan(plan.planId)).toHaveLength(1);
    state.recordPlanExecution({...record,recordedAt:record.recordedAt});
    expect(state.executionsForPlan(plan.planId)).toHaveLength(1);
    const restored=new RuntimeState(any({portfolio:{maxPositions:3},riskGovernance:{}})) as any;
    restored.serialize();
    const roundTrip=new RuntimeState(any({portfolio:{maxPositions:3},riskGovernance:{}})) as any;
    roundTrip.restore(state.serialize());
    expect(roundTrip.tradePlans.get(plan.planId)?.targetPrice).toBe(plan.targetPrice);
    expect(roundTrip.executionsForPlan(plan.planId)).toHaveLength(1);
  });

  it('a re-plan may tighten the cycle budget but never loosen it',()=>{
    const plan=freshPlan();
    const next={...plan,planId:`${plan.planId}v2`,planVersion:2,maxRealizedLossUsd:20,minNetProfitUsd:.5,persistedAt:plan.persistedAt+1};
    expect(assertPlanSupersede(plan,next)).toEqual(expect.arrayContaining(['LOSS_BUDGET_MUST_NOT_GROW','PROFIT_FLOOR_MUST_NOT_LOOSEN']));
    const sameDirection:any={...next,planId:plan.planId,maxRealizedLossUsd:5,minNetProfitUsd:2,side:'SHORT'};
    expect(assertPlanSupersede(plan,sameDirection)).toContain('PLAN_DIRECTION_REINTERPRETED');
    const legal:any={...next,maxRealizedLossUsd:5,minNetProfitUsd:2};
    expect(assertPlanSupersede(plan,legal)).toEqual([]);
    expect(cycleLossBudget([plan,legal],plan.cycleId).maxRealizedLossUsd).toBe(plan.maxRealizedLossUsd);
  });

  it('the plan is durable before the reservation, and a refused plan leaves nothing executable',async()=>{
    const h=harness() as any,now=Date.now(),snapshot=h.state.snapshots.get(h.packet.symbol)!;
    Object.assign(snapshot.quote,{bid:100,ask:100.01,last:100,mark:100,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,ts:now});
    for(const [tf,period] of [['15m',900_000],['5m',300_000],['1m',60_000]] as const){
      Object.assign(snapshot.technical[tf],{trend:'UP',ema8:100,ema21:99,ema55:98,emaSlope21:1,atr14:2,atrPercent:2,recentSwingHigh:110,recentSwingLow:95,
        isClosed:true,asOf:now-1_000,barCloseTime:now-1_000,receivedAt:now,lastClosedBar:{openTime:now-1_000-period+1,closeTime:now-1_000,open:99.5,high:101,low:99,close:100.5,volume:100}});
    }
    h.ai.decide.mockImplementation(async()=>({runId:'j3-run',decision:{...h.supplied,decision:'PLACE_LONG',tradeSide:'LONG',direction:'LONG',quantityUnits:1_000,
      opportunityType:'TREND_RESUMPTION',timingEvent:null,idealPrice:100,acceptablePriceRange:{min:99.99,max:100.01},horizonMinutes:1}}));
    const plansAtSubmit:number[]=[];
    h.exchange.placeEntry=vi.fn(async(order:any)=>{plansAtSubmit.push(h.state.tradePlans?.size??0);return{...order,status:'NEW',exchangeOrderId:'ex_1',filledQuantity:0,updatedAt:Date.now()};});
    await h.run();
    const blocked=h.events.filter((e:any)=>/TRADE_PLAN|ENTRY_DECISION_BLOCKED|ENTRY_ANALYSIS_FAILED/.test(e.type)).map((e:any)=>({type:e.type,...(e.payload??{})}));
    expect(h.state.tradePlans.size,JSON.stringify(blocked).slice(0,900)).toBeGreaterThan(0);
    expect(plansAtSubmit).toHaveLength(1);
    expect(plansAtSubmit[0]).toBeGreaterThan(0);
    const plan=[...h.state.tradePlans.values()][0];
    expect(plan.side).toBeTruthy();
    expect(typeof plan.provenance.candidateSetHash).toBe('string');
    expect(plan.persistedAt).toBeLessThanOrEqual(Date.now());
    // the plan is what the reservation was made against, not a later reconstruction
    expect(plan.quantityUnits).toBeGreaterThan(0);
    expect(plan.selectedCandidateId).toBeTruthy();
  },20_000);
});

describe('S06 plan is the only source of AI exit authority',()=>{
  const planOf=(over:Record<string,any>={})=>{
    const set=candidates(),candidate=set.set.candidates.find(row=>row.executable)??set.set.candidates[0];
    return assembleTradePlan(planInput(set,candidate,over)).plan as TradePlan;
  };
  const scope=JSON.stringify(['TESTNET','binance-primary','BTCUSDT','LONG']);

  it('an AI exit reads its plan facts from the durable plan, and from no position label',()=>{
    const plan=planOf();
    const facts=aiExitPlanFactsOf([plan],{scope,cycleId:plan.cycleId,now:NOW+60_000,markPrice:Number(plan.targetPrice)+1,
      latestClosedBar:{timeframe:'15m',closeTime:NOW+30_000,close:120},firstFillAt:NOW-60_000});
    expect(facts).toMatchObject({planRef:plan.planId,planVersion:plan.planVersion,minNetProfitUsd:plan.minNetProfitUsd,exitConditionMet:true});
    expect(facts!.invalidationEvidenceRefs.length).toBeGreaterThan(0);
    // A closed bar below the plan level is what makes the thesis invalid - not a falling PnL.
    expect(aiExitPlanFactsOf([plan],{scope,cycleId:plan.cycleId,now:NOW+60_000,markPrice:90,
      latestClosedBar:{timeframe:'15m',closeTime:NOW+30_000,close:Number(plan.predicateLevel)-1},firstFillAt:NOW-60_000})!.thesisInvalid).toBe(true);
    // Another scope or cycle identity is not this plan's business, and a WAIT plan authorises nothing.
    expect(aiExitPlanFactsOf([plan],{scope:JSON.stringify(['TESTNET','binance-other','BTCUSDT','LONG']),cycleId:plan.cycleId,now:NOW+60_000,markPrice:120,
      latestClosedBar:{timeframe:'15m',closeTime:NOW+30_000,close:120},firstFillAt:NOW-60_000})).toBeNull();
    expect(aiExitPlanFactsOf([{...plan,side:'WAIT',quantityUnits:0,notionalUsd:0,marginUsd:0} as TradePlan],{scope,cycleId:plan.cycleId,now:NOW+60_000,markPrice:120,
      latestClosedBar:null,firstFillAt:NOW-60_000})).toBeNull();
    expect(aiExitPlanFactsOf([],{scope,cycleId:plan.cycleId,now:NOW,markPrice:120,latestClosedBar:null,firstFillAt:NOW-60_000})).toBeNull();
  });

  it('the horizon predicate elapses against the first fill, never against a re-plan',()=>{
    const plan=planOf();
    const longHorizon:TradePlan={...plan,targetHorizonMinutes:5,predicateLevel:null,invalidationPredicate:'PLAN_HORIZON_ELAPSED',predicateEvidenceRefs:[]} as TradePlan;
    expect(aiExitPlanFactsOf([longHorizon],{scope,cycleId:plan.cycleId,now:plan.persistedAt+600_000,markPrice:101,
      latestClosedBar:null,firstFillAt:plan.persistedAt})!.thesisInvalid).toBe(true);
    expect(aiExitPlanFactsOf([longHorizon],{scope,cycleId:plan.cycleId,now:plan.persistedAt+60_000,markPrice:101,
      latestClosedBar:null,firstFillAt:plan.persistedAt})!.thesisInvalid).toBe(false);
  });
});
