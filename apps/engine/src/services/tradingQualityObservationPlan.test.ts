import {describe,expect,it} from 'vitest';
import {evidenceEnvelope,observationAdmission,observationRetentionCutoff,V393_DEFAULT_OBSERVATION_BUDGET} from './tradingQualityObservationPlan.js';

describe('V3.9.3 bounded observation contract',()=>{
  it('carries provenance and version without becoming source truth',()=>{const e=evidenceEnvelope({lifecycle:'ENTRY',subjectId:'ep1',sourceIds:['fill2','fill1','fill1'],sourceRevisions:{fill1:1,fill2:2},metricVersion:'m1',computedAt:200,asOf:190,maturity:'MATURE',payload:{mae:3}});expect(e.sourceIds).toEqual(['fill1','fill2']);expect(e.sourceRevisionHash).toMatch(/^[a-f0-9]{64}$/);expect(e.payload).toEqual({mae:3});});
  it('degrades evidence instead of gaining trade, TP, or reconciliation authority',()=>{const result=observationAdmission({candidateSets:99,candidatesPerSet:99,activeEntries:999,activePositions:999,recentExits:999,writesLastMinute:99999,queuedWrites:99999});expect(result.admitted).toBe(false);expect(result.degradation).toBe('EVIDENCE_DEGRADED');expect(result.tradeAuthorizationImpact).toBe('NONE');expect(result.tpImpact).toBe('NONE');expect(result.reconciliationImpact).toBe('NONE');expect(result.reasons.length).toBeGreaterThan(1);});
  it('uses explicit bounded retention',()=>expect(observationRetentionCutoff(10_000,{...V393_DEFAULT_OBSERVATION_BUDGET,retentionMs:1_000})).toBe(9_000));
});
