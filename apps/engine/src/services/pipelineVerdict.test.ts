import {describe, expect, it} from 'vitest';
import {authoritativePipelineVerdict} from './pipelineVerdict.js';

/**
 * G4: one authoritative blocker per pipeline cycle, one next action that matches it, and everything else
 * demoted to diagnostics. These cases pin the boundary the cockpit was previously deciding for itself.
 */
const base = {now: 1, noEntryReason: null as string | null};

describe('the authoritative pipeline verdict', () => {
  it('carries the book gate arithmetic and versioned readback as the same first-cause evidence',()=>{
    const verdict=authoritativePipelineVerdict({...base,capacityVisibility:{admission:{status:'AVAILABLE',exhausted:true,hasVerdict:true,code:'GROSS',gate:'MAX_GROSS_NOTIONAL',
      evaluatedAt:7,scope:'BOOK',snapshotHash:'snapshot-1',profileVersion:'profile-2',settingsVersion:'settings-3',riskGeneration:4,
      firstBinding:{kind:'NOTIONAL',code:'GROSS',gate:'MAX_GROSS_NOTIONAL',limitUsd:100,usedUsd:100,headroomUsd:0,shortfallUsd:25,detail:'full'},
      gates:[{name:'MAX_GROSS_NOTIONAL',reason:'GROSS',unit:'NOTIONAL_USD',limitUsd:100,usedUsd:100,maxAdditionalUsd:0,candidateImpactUsd:25,candidateShortfallUsd:25}],
      pendingLineage:[{id:'reservation-1',symbol:'BTCUSDT',side:'LONG',notionalUsd:5,quoteAsset:'USDT',ownerState:'AI_ACTIVE',factStatus:'VERIFIED'}]}}});
    expect(verdict.evidence).toMatchObject({riskAdmissionReadback:{scope:'BOOK',evaluatedAt:7,snapshotHash:'snapshot-1',riskGeneration:4,profileVersion:'profile-2'},
      riskAdmissionGates:[{candidateImpactUsd:25,candidateShortfallUsd:25}]});
  });
  it('PV-01 says nothing is blocking when the Engine chain is empty, without inventing a cause', () => {
    const verdict = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING'});
    expect(verdict).toMatchObject({code: 'NONE', stage: 'NONE', secondary: []});
    expect(verdict.nextAction).toContain('无需处理');
  });

  it('PV-02 keeps one code when in-flight backpressure and a market diagnostic coexist', () => {
    const verdict = authoritativePipelineVerdict({...base, noEntryReason: 'ENTRY_BACKPRESSURE', pipelineState: 'RUNNING',
      marketDataReason: null, marketIsolation: {candidateCount: 4, isolatedCount: 2, healthyCandidates: 2, isolated: [{symbol: 'XUSDT', reasons: ['TECHNICAL_15m_SEQUENCE_INVALID']}]},
      pendingEntries: 3, maxPendingEntries: 3, idleReason: 'WAITING_EXECUTION_RANGE', analysisReason: 'AI_RESOURCE_BUSY'});
    expect(verdict.code).toBe('ENTRY_BACKPRESSURE');
    expect(verdict.stage).toBe('IN_FLIGHT');
    expect(verdict.nextAction).toContain('在途建仓 3/3');
    // The isolated symbol stays a fact about itself, never a second first cause.
    expect(verdict.secondary.every((row) => row.code.includes('DIAGNOSTIC'))).toBe(true);
    expect(verdict.secondary.map((row) => row.code)).toContain('MODEL_DIAGNOSTIC:ANALYSIS_REASON');
    expect(verdict.secondary.map((row) => row.code)).not.toContain('ENTRY_BACKPRESSURE');
  });

  it('PV-03 a systemic market pause names the source action and keeps isolation counts as evidence', () => {
    const verdict = authoritativePipelineVerdict({...base, noEntryReason: 'PAUSED_MARKET_DATA_UNAVAILABLE', pipelineState: 'PAUSED_MARKET_DATA_UNAVAILABLE',
      marketDataReason: 'MARKET_QUOTES_STALE', marketIsolation: {candidateCount: 3, isolatedCount: 3, healthyCandidates: 0, isolated: [{symbol: 'AUSDT', reasons: ['QUOTE_STALE']}]} as any,
      freshMarkets: {status: 'DEGRADED', stale: ['AUSDT'], sequenceInvalid: 0}});
    expect(verdict.stage).toBe('MARKET_DATA');
    expect(verdict.nextAction).toContain('MARKET_QUOTES_STALE');
    // The count is derived from the listed symbols, so a diagnostic can never overstate the quarantine.
    expect(verdict.evidence).toMatchObject({healthyCandidates: 0, isolatedCount: 1, isolatedSymbols: ['AUSDT:QUOTE_STALE']});
  });

  it('PV-04 missing execution facts names the blocker the model would have wasted a run on', () => {
    const verdict = authoritativePipelineVerdict({...base, noEntryReason: 'EXECUTION_BLOCKED', pipelineState: 'RUNNING',
      executionReadiness: {mode: 'EXECUTION_BLOCKED', ready: false, firstBlocker: 'RISK_PROFILE_UNCONFIGURED', blockers: ['RISK_PROFILE_UNCONFIGURED', 'PRIVATE_DATA_UNAVAILABLE']}});
    expect(verdict.stage).toBe('EXECUTION_FACTS');
    expect(verdict.nextAction).toContain('RISK_PROFILE_UNCONFIGURED');
    expect(verdict.secondary).toContainEqual({code: 'EXECUTION_FACTS_DIAGNOSTIC:RISK_PROFILE_UNCONFIGURED', detail: 'RISK_PROFILE_UNCONFIGURED · PRIVATE_DATA_UNAVAILABLE'});
  });

  it('PV-05 exhausted new risk is answered with the human action, never an automatic relief', () => {
    const verdict = authoritativePipelineVerdict({...base, noEntryReason: 'WAITING_EXECUTION_CAPACITY', pipelineState: 'RUNNING',
      capacityVisibility: {firstBlocker: 'GROSS', exhaustedForNewRisk: true, exhaustedReason: 'GROSS', sideStatus: {code: 'NO_EXECUTABLE_SIDE', text: '两侧都无可执行容量：见各侧逐候选首因'}},
      slots: {used: 24, max: 50}, executableCandidateCount: 0});
    expect(verdict.stage).toBe('CAPACITY');
    expect(verdict.nextAction).toContain('GROSS');
    expect(verdict.nextAction).toContain('人工减仓');
    expect(verdict.evidence).toMatchObject({exhaustedForNewRisk: true, executableCandidateCount: 0, slotsUsed: 24});
    expect(verdict.secondary.map((row) => row.code)).toContain('CAPACITY_DIAGNOSTIC:NO_EXECUTABLE_SIDE');
  });

  it('PV-06 an unmapped pool code still resolves to the supply stage and never to a model fault', () => {
    const verdict = authoritativePipelineVerdict({...base, noEntryReason: 'POOL_EMPTY_ALL_COOLDOWN', poolStatus: 'POOL_EMPTY_ALL_COOLDOWN'});
    expect(verdict.stage).toBe('SUPPLY');
    expect(verdict.nextAction).toContain('POOL_EMPTY_ALL_COOLDOWN');
    expect(verdict.evidence).toMatchObject({poolStatus: 'POOL_EMPTY_ALL_COOLDOWN'});
  });

  it('PV-07 a single blocked symbol cannot produce a pipeline-level code at all', () => {
    // Healthy candidates exist, so the Engine reports no market pause: isolation is a diagnostic line.
    const verdict = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING', marketDataReason: null,
      marketIsolation: {candidateCount: 2, isolatedCount: 1, healthyCandidates: 1, isolated: [{symbol: 'BADUSDT', reasons: ['TECHNICAL_5m_SEQUENCE_INVALID']}]} as any,
      freshMarkets: {status: 'RECOVERING', stale: ['BADUSDT'], sequenceInvalid: 1}, eligibility: {status: 'READY', count: 1}, executableCandidateCount: 1});
    expect(verdict.code).toBe('NONE');
    expect(verdict.stage).toBe('NONE');
    expect(verdict.evidence).toMatchObject({isolatedCount: 1, healthyCandidates: 1, isolatedSymbols: ['BADUSDT:TECHNICAL_5m_SEQUENCE_INVALID']});
    expect(verdict.secondary.map((row) => row.code)).toContain('MARKET_DIAGNOSTIC:STALE_SYMBOLS');
  });

  const refusal = {at: 1, symbol: 'TAOUSDT', stage: 'PORTFOLIO_RISK_ADMISSION', code: 'HUMAN_ACK_OVERDUE',
    reasons: ['HUMAN_ACK_OVERDUE', 'HUMAN_POTENTIAL_NOTIONAL_LIMIT', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL'],
    limits: ['MAX_GROSS_NOTIONAL'], ageMs: 42_000};

  it('PV-08 a healthy pipeline whose newest cycle was refused by risk admission is not reported as NONE', () => {
    const verdict = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING', noEntryReason: null,
      capacityVisibility: {exhaustedForNewRisk: false, sideStatus: {code: 'BOTH_SIDES_EXECUTABLE', text: 'LONG 与 SHORT 均可新增'}},
      eligibility: {status: 'READY', count: 2}, executableCandidateCount: 2, riskAdmission: refusal});
    expect(verdict.code).toBe('HUMAN_ACK_OVERDUE');
    expect(verdict.stage).toBe('RISK_ADMISSION');
    expect(verdict.nextAction).toContain('TAOUSDT');
    expect(verdict.nextAction).toContain('HUMAN_POTENTIAL_NOTIONAL_LIMIT');
    expect(verdict.nextAction).toContain('人工减少已有敞口');
    expect(verdict.evidence).toMatchObject({riskAdmissionStage: 'PORTFOLIO_RISK_ADMISSION', riskAdmissionSymbol: 'TAOUSDT',
      riskAdmissionLimits: ['MAX_GROSS_NOTIONAL'], riskAdmissionAgeMs: 42_000, exhaustedForNewRisk: false});
  });

  it('PV-09 a pipeline-level blocker still outranks the refusal of an older cycle', () => {
    const verdict = authoritativePipelineVerdict({...base, noEntryReason: 'ENTRY_BACKPRESSURE', pipelineState: 'RUNNING',
      pendingEntries: 6, maxPendingEntries: 6, riskAdmission: refusal});
    expect(verdict.code).toBe('ENTRY_BACKPRESSURE');
    expect(verdict.stage).toBe('IN_FLIGHT');
    expect(verdict.nextAction).toContain('在途建仓 6/6');
    expect(verdict.evidence.riskAdmissionSymbol).toBeNull();
  });

  it('PV-10 the risk-admission stage disappears by itself once the newest cycle passes admission', () => {
    const cleared = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING', riskAdmission: null,
      capacityVisibility: {sideStatus: {code: 'BOTH_SIDES_EXECUTABLE', text: 'LONG 与 SHORT 均可新增'}}});
    expect(cleared).toMatchObject({code: 'NONE', stage: 'NONE'});
    // The refusal is named once as the primary and never re-listed as a competing primary.
    const withRefusal = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING', riskAdmission: refusal,
      capacityVisibility: {sideStatus: {code: 'BOTH_SIDES_EXECUTABLE', text: 'LONG 与 SHORT 均可新增'}}, eligibility: {status: 'READY', count: 1}});
    const primaries = [withRefusal.code, ...withRefusal.secondary.filter((row) => !row.code.includes('DIAGNOSTIC')).map((row) => row.code)];
    expect(primaries).toEqual([withRefusal.code]);
  });

  it('PV-11 a book-level denial is the first cause even when no cycle ever reached admit', () => {
    const verdict = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING',
      capacityVisibility: {sideStatus: {code: 'RISK_ADMISSION_EXHAUSTED', text: '确定性风险门拒绝任何新增名义：见首因的每道门数值'},
        exhaustedForNewRisk: true, exhaustedReason: 'RISK_ADMISSION',
        admission: {exhausted: true, hasVerdict: true, code: 'HUMAN_ACK_OVERDUE', gate: null, evaluatedAt: base.now - 1_200,
          detail: 'HUMAN_ACK_OVERDUE：22 行人工交接未确认，超过上限 24 小时，最旧 175.2 小时 —— 任意名义均拒，只能由人工确认',
          ceilingUsdBySide: {LONG: 0, SHORT: 0}}}});
    // Answering NONE here would be the same lie in a new place: nothing was blocked upstream, so nothing ran.
    expect(verdict.code).toBe('HUMAN_ACK_OVERDUE');
    expect(verdict.stage).toBe('RISK_ADMISSION');
    expect(verdict.nextAction).toContain('22 行人工交接未确认');
    expect(verdict.nextAction).toContain('可新增 0.00 USD');
    expect(verdict.evidence).toMatchObject({riskAdmissionStage: 'PORTFOLIO_RISK_ADMISSION', riskAdmissionAgeMs: 1_200, riskAdmissionExhausted: true});
  });

  it('PV-12 the synthesized denial expires the moment the gate reports room again', () => {
    const open = authoritativePipelineVerdict({...base, pipelineState: 'RUNNING',
      capacityVisibility: {sideStatus: {code: 'BOTH_SIDES_EXECUTABLE', text: 'LONG 与 SHORT 均可新增'},
        admission: {exhausted: false, hasVerdict: true, code: null, gate: null, evaluatedAt: base.now, detail: null, ceilingUsdBySide: {LONG: 5_012.31, SHORT: 1_173.27}}}});
    expect(open).toMatchObject({code: 'NONE', stage: 'NONE'});
    expect(open.evidence.riskAdmissionExhausted).toBe(false);
  });
});

it('prefers complete BOOK evidence over an unversioned pre-model refusal and keeps candidate passes separate',()=>{
  const binding={kind:'MARGIN',code:'MARGIN_LIMIT',gate:'MIN_MARGIN_BUFFER:USDT',unit:'MARGIN_USD',limitUsd:100,usedUsd:90,headroomUsd:10,shortfallUsd:5,detail:'margin'};
  const gates=[{name:'MIN_MARGIN_BUFFER:USDT',reason:'MARGIN_LIMIT',unit:'MARGIN_USD',limitUsd:100,usedUsd:90,maxAdditionalUsd:10,candidateImpactUsd:15,candidateShortfallUsd:5}];
  const capacityVisibility={admission:{status:'ZERO' as const,exhausted:true,code:'BOOK_LIMIT',evaluatedAt:10,scope:'BOOK',snapshotHash:'book',gates,firstBinding:binding}};
  const legacy={at:9,symbol:'BTCUSDT',stage:'PRE_AI',code:'LEGACY',reasons:['LEGACY'],limits:[],ageMs:1};
  expect(authoritativePipelineVerdict({...base,capacityVisibility,riskAdmission:legacy})).toMatchObject({code:'BOOK_LIMIT',evidence:{riskAdmissionReadback:{scope:'BOOK',snapshotHash:'book',gates,firstBinding:binding}}});
  const readback={scope:'CANDIDATE' as const,evaluatedAt:9,snapshotHash:'candidate',riskGeneration:1,profileVersion:'p',settingsVersion:'s',symbol:'BTCUSDT',side:'LONG' as const,quoteAsset:'USDT',leverage:10,leverageFact:'MARKET',candidateNotionalUsd:150,candidateMarginUsd:15,status:'ZERO' as const,pendingLineage:[]};
  const result=authoritativePipelineVerdict({...base,capacityVisibility,riskAdmission:{...legacy,code:'MARGIN_LIMIT',binding,gates,readback}});
  expect(result.evidence).toMatchObject({riskAdmissionReadback:{...readback,gates,firstBinding:binding},riskAdmissionCeilingUsdBySide:null,riskAdmissionExhausted:null,bookAdmission:{snapshotHash:'book'}});
  expect(result.nextAction).toContain('MARGIN_USD');
});
