import {describe, expect, it} from 'vitest';
import {authoritativePipelineVerdict} from './pipelineVerdict.js';

/**
 * G4: one authoritative blocker per pipeline cycle, one next action that matches it, and everything else
 * demoted to diagnostics. These cases pin the boundary the cockpit was previously deciding for itself.
 */
const base = {now: 1, noEntryReason: null as string | null};

describe('the authoritative pipeline verdict', () => {
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
});
