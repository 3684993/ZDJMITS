import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {RuntimeState} from '../state/runtimeState.js';
import {SystemSettingsSchema,type MarketSymbolSnapshot} from '@zdj/contracts';
import {candidateAnalysisEligibility,evaluateEntryExecutionPermit,portfolioRiskObservation} from './entryPermissionModel.js';
import {buildPreAiExecutionEnvelope,entryCandidateMarginBudgetUsd} from './preAiExecutionEnvelope.js';
import {acquireExecutionLease,activeExecutionLeaseMargin} from './executionLease.js';
import {bookAdmissionSummary} from './admissionCapacityReader.js';
import {projectHumanManaged} from './humanManagedProjection.js';

/**
 * P4 acceptance: three facts that used to be argued about with one word.
 *
 * The audit (R8/R9) found the cockpit reading a `NOT_APPLICABLE` risk ceiling as a real "$0
 * capacity", an analysis lease holding the entire quote balance, and a funnel that displayed
 * "risk admission passed = 0" as a mandatory step on runs that then submitted successfully.
 */

const settings=SystemSettingsSchema.parse(JSON.parse(readFileSync(new URL('../../../../config/settings.default.json',import.meta.url),'utf8')));
const any=(value:unknown)=>value as any;
const fundsOnly={...settings,connections:{...settings.connections,exchange:{...settings.connections.exchange,environment:'TESTNET'},executionMode:'TESTNET_ENABLED'}} as any;
const production={...settings,connections:{...settings.connections,exchange:{...settings.connections.exchange,environment:'PRODUCTION'},executionMode:'ENABLED'}} as any;

function stateWith(over:Record<string,unknown>={},settingsUsed=fundsOnly){
  const state=new RuntimeState(settingsUsed);
  Object.assign(state,over);
  return state;
}

describe('P4 portfolio risk is an observation, not a permission',()=>{
  it('funds-only marks the observation unenforced and reports no ceiling as absent, not zero',()=>{
    const state=stateWith({positions:new Map(),account:{status:'READY',equityUsd:10_000,assets:[{asset:'USDT',availableBalance:5_000,asOf:Date.now()}],asOf:Date.now()},riskAdmission:null});
    const observation=portfolioRiskObservation(state,Date.now());
    expect(observation.enforced).toBe(false);
    expect(observation.basis).toBe('TESTNET_FUNDS_ONLY_OBSERVATION');
    expect(observation.positionCount.enforced).toBe(false);
    // Slot overrun is stated, and it is not a veto.
    const crowded=portfolioRiskObservation(stateWith({positions:new Map(Array.from({length:80},(_,index)=>[`p${index}`,{symbol:`SYM${index}USDT`,side:'LONG',quantity:1,entryPrice:10,markPrice:10,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:1,notionalUsd:10} as any])),account:{status:'READY',equityUsd:10_000,assets:[],asOf:Date.now()}}),Date.now());
    expect(crowded.positionCount.used).toBe(80);
    expect(crowded.positionCount.max).toBe(settings.portfolio.maxPositions);
    expect(crowded.enforced).toBe(false);
  });

  it('NOT_APPLICABLE and UNAVAILABLE ceilings are null while ZERO stays a real zero',()=>{
    const none=bookAdmissionSummary(stateWith({account:{status:'READY',assets:[],asOf:Date.now()},riskAdmission:null}),Date.now());
    expect(none.status).toBe('NOT_APPLICABLE');
    expect(none.ceilingUsdBySide).toBeNull();
    expect(none.enforced).toBe(false);
    const unavailable=bookAdmissionSummary(stateWith({account:{status:'READY',assets:[],asOf:Date.now()},riskAdmission:{capacityFacts:()=>null}},production),Date.now());
    expect(unavailable.status).toBe('UNAVAILABLE');
    expect(unavailable.ceilingUsdBySide).toBeNull();
    const zero=bookAdmissionSummary(stateWith({account:{status:'READY',assets:[],asOf:Date.now()},riskAdmission:{capacityFacts:()=>({evaluatedAt:Date.now(),maxNewRiskNotionalUsdBySide:{LONG:0,SHORT:0},evidenceBlockers:[],sizeIndependentRefusals:[],admitsAnyPositiveNotional:false,complete:true,firstBinding:null,overdueHandoffs:0,oldestOverdueHours:null})}},production),Date.now());
    expect(zero.status).toBe('ZERO');
    expect(zero.ceilingUsdBySide).toEqual({LONG:0,SHORT:0});
    expect(zero.hasVerdict).toBe(true);
  });

  it('a risk ceiling of zero cannot deny an entry permit that the money facts support',()=>{
    const now=Date.now();
    const state=stateWith({account:{status:'READY',equityUsd:10_000,assets:[{asset:'USDT',availableBalance:1_000,asOf:now}],asOf:now},
      entryReservations:new Map(),lifecycles:new Map(),positions:new Map(),
      riskAdmission:{capacityFacts:()=>({evaluatedAt:now,maxNewRiskNotionalUsdBySide:{LONG:0,SHORT:0},evidenceBlockers:[],sizeIndependentRefusals:['RISK_CEILING_ZERO'],admitsAnyPositiveNotional:false,complete:true})}});
    const permit=evaluateEntryExecutionPermit({state,symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',requiredMarginUsd:20,
      authorization:{valid:true,expiresAt:now+60_000,identity:'intent_p4'},filtersComplete:true,durableStorageReady:true,now});
    expect(permit.permitted).toBe(true);
    expect(permit.firstCause).toBeNull();
    // The zero ceiling is still visible - as an observation with the mode that made it non-binding.
    expect(permit.observation.enforced).toBe(false);
    expect(permit.facts.executableForNewReservationUsd).toBe(1_000);
  });

  it('insufficient margin, stale private facts and missing filters still refuse',()=>{
    const now=Date.now();
    const base={account:{status:'READY',equityUsd:10_000,assets:[{asset:'USDT',availableBalance:10,asOf:now}],asOf:now},entryReservations:new Map(),lifecycles:new Map(),positions:new Map(),riskAdmission:null};
    expect(evaluateEntryExecutionPermit({state:stateWith(base),symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',requiredMarginUsd:20,
      authorization:{valid:true,expiresAt:now+60_000,identity:'i'},filtersComplete:true,durableStorageReady:true,now}).firstCause).toBe('INSUFFICIENT_AVAILABLE_MARGIN');
    expect(evaluateEntryExecutionPermit({state:stateWith({...base,account:{...base.account,status:'STALE'}}),symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',requiredMarginUsd:5,
      authorization:{valid:true,expiresAt:now+60_000,identity:'i'},filtersComplete:true,durableStorageReady:true,now}).firstCause).toBe('PRIVATE_ACCOUNT_NOT_FRESH');
    expect(evaluateEntryExecutionPermit({state:stateWith(base),symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',requiredMarginUsd:5,
      authorization:{valid:true,expiresAt:now+60_000,identity:'i'},filtersComplete:false,durableStorageReady:true,now}).firstCause).toBe('EXCHANGE_FILTERS_UNPROVEN');
    expect(evaluateEntryExecutionPermit({state:stateWith(base),symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',requiredMarginUsd:5,
      authorization:{valid:true,expiresAt:now-1,identity:'i'},filtersComplete:true,durableStorageReady:true,now}).firstCause).toBe('AI_AUTHORIZATION_EXPIRED');
    expect(evaluateEntryExecutionPermit({state:stateWith(base),symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',requiredMarginUsd:5,
      authorization:{valid:true,expiresAt:now+60_000,identity:null},filtersComplete:true,durableStorageReady:true,now}).firstCause).toBe('SUBMISSION_IDENTITY_MISSING');
  });

  it('Production keeps the risk observation enforced',()=>{
    const state=stateWith({account:{status:'READY',equityUsd:10_000,assets:[],asOf:Date.now()}},production);
    expect(portfolioRiskObservation(state,Date.now()).enforced).toBe(true);
    expect(portfolioRiskObservation(state,Date.now()).basis).toBe('PORTFOLIO_RISK_ENFORCED');
  });
});

describe('P4 analysis eligibility is not an order permission',()=>{
  it('a missing market waits, it is not refused',()=>{
    const eligibility=candidateAnalysisEligibility(stateWith({snapshots:new Map(),positions:new Map()}),'BTCUSDT',Date.now());
    expect(eligibility.disposition).toBe('WAIT');
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.length).toBeGreaterThan(0);
    expect(eligibility.facts.marketFresh).toBe(false);
  });

  it('an existing holding is skipped, not blocked, and money never enters this layer',()=>{
    const state=stateWith({snapshots:new Map([['BTCUSDT',{symbol:'BTCUSDT',quote:{tickSize:.1,stepSize:.001,minQty:.001,minNotional:5,last:100,bid:99.9,ask:100.1,mark:100,ts:Date.now()}} as any]]),
      positions:new Map([['p',{symbol:'BTCUSDT',side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:1} as any]]),account:{status:'READY',equityUsd:0,assets:[],asOf:Date.now()}});
    const eligibility=candidateAnalysisEligibility(state,'BTCUSDT',Date.now());
    expect(eligibility.disposition).toBe('SKIP');
    expect(Object.keys(eligibility.facts)).toEqual(['marketFresh','modelAvailable','alreadyHeld','dataError']);
  });

  it('an unavailable model waits without touching capital',()=>{
    const state=stateWith({snapshots:new Map([['BTCUSDT',{symbol:'BTCUSDT',quote:{tickSize:.1,stepSize:.001,minQty:.001,minNotional:5,last:100,bid:99.9,ask:100.1,mark:100,ts:Date.now()}} as any]]),positions:new Map(),account:{status:'READY',equityUsd:0,assets:[],asOf:Date.now()}});
    expect(candidateAnalysisEligibility(state,'BTCUSDT',Date.now(),{modelAvailable:false}).disposition).toBe('WAIT');
  });
});

describe('P4 analysis lease is an earmark, not the whole balance',()=>{
  it('the lease is capped by the candidate budget and leaves room for another route',()=>{
    const now=Date.now();
    const state=new RuntimeState(fundsOnly);
    state.account={status:'READY',equityUsd:20_000,assets:[{asset:'USDT',availableBalance:4_000,asOf:now}],asOf:now} as any;
    state.snapshots.set('BTCUSDT',any(snapshotOf('BTCUSDT')));
    state.universe.push(any({symbol:'BTCUSDT',eligible:true,rank:1,recommendedLeverage:10}));
    const envelope=buildPreAiExecutionEnvelope(state,'BTCUSDT',now);
    expect(envelope.leaseBudget?.cappedBy).toBe('CONFIGURED_PER_POSITION_MARGIN');
    expect(envelope.leaseRequiredMarginUsd).toBeLessThanOrEqual(envelope.leaseBudget!.budgetUsd);
    expect(envelope.leaseRequiredMarginUsd).toBeLessThan(4_000);
    const lease=acquireExecutionLease(state,{symbol:'BTCUSDT',quoteAsset:'USDT',reservedMarginUsd:envelope.leaseRequiredMarginUsd,ttlMs:135_000},now);
    expect(lease.ok).toBe(true);
    // A second candidate on the same quote still has money available: the earmark no longer
    // converts the whole balance into zero capacity for everybody else.
    const remaining=4_000-activeExecutionLeaseMargin(state,'USDT',now);
    expect(remaining).toBeGreaterThanOrEqual(4_000-envelope.leaseRequiredMarginUsd);
    expect(remaining).toBeGreaterThan(3_000);
  });

  it('a routed plan margin wins over the generic per-position cap',()=>{
    const state=new RuntimeState(fundsOnly);
    state.runtimeControl.capital.routedCandidates=[any({symbol:'ETHUSDT',longPlanFacts:{marginUsd:42.5},shortPlanFacts:{marginUsd:42.5}})];
    const budget=entryCandidateMarginBudgetUsd(state,'ETHUSDT',{leverage:10,minimumLegalNotionalUsd:5});
    expect(budget.source).toBe('ROUTED_PLAN_MARGIN');
    expect(budget.budgetUsd).toBeGreaterThanOrEqual(42.5);
  });

  it('the floor is the exchange minimum, so a tiny budget never earmarks zero',()=>{
    const state=new RuntimeState({...fundsOnly,portfolioIntelligence:{...fundsOnly.portfolioIntelligence,maxMarginPerPositionUsd:0},portfolio:{...fundsOnly.portfolio,entryMarginUsd:0}});
    const budget=entryCandidateMarginBudgetUsd(state,'XUSDT',{leverage:10,minimumLegalNotionalUsd:50});
    expect(budget.source).toBe('EXCHANGE_MINIMUM_MARGIN');
    expect(budget.budgetUsd).toBeCloseTo(5,10);
  });

  it('one owner, one debit: the same intent cannot lease twice against itself',()=>{
    const now=Date.now(),state=new RuntimeState(fundsOnly);
    state.account={status:'READY',equityUsd:20_000,assets:[{asset:'USDT',availableBalance:100,asOf:now}],asOf:now} as any;
    const first=acquireExecutionLease(state,{symbol:'BTCUSDT',quoteAsset:'USDT',reservedMarginUsd:60,ttlMs:60_000},now);
    expect(first.ok).toBe(true);
    const second=acquireExecutionLease(state,{symbol:'ETHUSDT',quoteAsset:'USDT',reservedMarginUsd:60,ttlMs:60_000},now);
    expect(second).toMatchObject({ok:false,reason:'EXECUTION_LEASE_MARGIN_CHANGED'});
  });
});

describe('P4 human caps keep their counts but lose their authority',()=>{
  const positions=(count:number)=>new Map(Array.from({length:count},(_,index)=>[`p${index}`,any({id:`p${index}`,symbol:`SYM${index}USDT`,side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:1,humanManagedAt:1,managementStatus:'HUMAN_MANAGED',tpStatus:'PROTECTED',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'SYSTEM_CREATED',lossHandoff:{cycleId:'x',lastClosedBarAt:null,consecutiveLossBars:0,status:'ACTIVE'}})]));
  it('over-cap human exposure is an observation under funds-only',()=>{
    const state=stateWith({positions:positions(9),account:{status:'READY',equityUsd:10_000,assets:[],asOf:Date.now()},tpOrders:new Map(),tradeRecords:new Map(),lifecycles:new Map()});
    const projection=projectHumanManaged(state);
    expect(projection.summary.count).toBe(9);
    expect(projection.summary.newEntryBlockedByCaps).toBe(false);
    expect(projection.summary.humanCapsDisposition).toBe('OBSERVE_OVER_CAPS');
    expect(projection.summary.humanCapsEnforced).toBe(false);
  });
  it('the same exposure still blocks outside funds-only',()=>{
    const state=stateWith({positions:positions(9),account:{status:'READY',equityUsd:10_000,assets:[],asOf:Date.now()},tpOrders:new Map(),tradeRecords:new Map(),lifecycles:new Map()},production);
    const projection=projectHumanManaged(state);
    expect(projection.summary.newEntryBlockedByCaps).toBe(true);
    expect(projection.summary.humanCapsDisposition).toBe('BLOCKING');
  });
});

function snapshotOf(symbol:string):MarketSymbolSnapshot{
  return {symbol,packet:{symbol},quote:{symbol,tickSize:.1,stepSize:.001,minQty:.001,minNotional:5,last:100,bid:99.9,ask:100.1,mark:100,ts:Date.now(),trades:[],depthNotionalUsd:0},
    technical:{'1m':{atr14:.2},'5m':{atr14:.5},'15m':{atrPercent:1.2,closed:true}},recentTradedPrices:[{price:100,lastSeenAt:Date.now()}],dataCompleteness:1} as any;
}
