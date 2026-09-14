import {describe,expect,it} from 'vitest';
import {evaluateV393ReleaseGate} from './tradingQualityReleaseGate.js';
const base=()=>({safety:{identityConflictCount:0,duplicateSubmitCount:0,quantityFailureCount:0,getWriteCount:0,unknownRiskReleasedCount:0,cycleResurrectionCount:0,tpCoverageRegressionCount:0},measurement:{manifestFrozen:true,exactEntryEpisodes:10,maturePathEpisodes:10,candidateObservationCoverage:1,collectorDegraded:false,requiredDimensionsMissing:[] as string[]},economic:{prospectiveCycleCount:10,canonicalEligibleCount:5,primaryMetricReady:true,nonInferiorityReady:true,outOfSampleReady:true}});
describe('V3.9.3 release gate',()=>{
  it('fails known safety defects instead of PASS_WITH_GAPS',()=>{const x=base();x.safety.quantityFailureCount=1;const r=evaluateV393ReleaseGate(x);expect(r.safetyIntegrity).toBe('FAIL');expect(r.releaseEligible).toBe(false);expect(r.entryEnforceAuthorized).toBe(false);});
  it('keeps missing natural samples inconclusive',()=>{const x=base();x.economic.prospectiveCycleCount=0;x.economic.canonicalEligibleCount=0;const r=evaluateV393ReleaseGate(x);expect(r.safetyIntegrity).toBe('PASS');expect(r.economicAcceptance).toBe('INCONCLUSIVE');expect(r.releaseEligible).toBe(false);});
  it('does not let a 24h duration automatically authorize behavior',()=>{const r=evaluateV393ReleaseGate(base());expect(r.releaseEligible).toBe(true);expect(r.entryEnforceAuthorized).toBe(false);expect(r.profitRealizationAuthorized).toBe(false);});
});
