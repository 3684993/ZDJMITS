export type GateState='PASS'|'FAIL'|'INCONCLUSIVE';
export type V393ReleaseGateInput={
  safety:{identityConflictCount:number;duplicateSubmitCount:number;quantityFailureCount:number;getWriteCount:number;unknownRiskReleasedCount:number;cycleResurrectionCount:number;tpCoverageRegressionCount:number};
  measurement:{manifestFrozen:boolean;exactEntryEpisodes:number;maturePathEpisodes:number;candidateObservationCoverage:number|null;collectorDegraded:boolean;requiredDimensionsMissing:string[]};
  economic:{prospectiveCycleCount:number;canonicalEligibleCount:number;primaryMetricReady:boolean;nonInferiorityReady:boolean;outOfSampleReady:boolean};
};
export function evaluateV393ReleaseGate(input:V393ReleaseGateInput){
  const safetyReasons:string[]=[];for(const [key,value] of Object.entries(input.safety))if(value>0)safetyReasons.push(`${key}:${value}`);
  const safetyIntegrity:GateState=safetyReasons.length?'FAIL':'PASS';
  const measurementReasons=[...input.measurement.requiredDimensionsMissing];if(!input.measurement.manifestFrozen)measurementReasons.push('EXPERIMENT_MANIFEST_NOT_FROZEN');if(input.measurement.exactEntryEpisodes<=0)measurementReasons.push('NO_EXACT_ENTRY_EPISODES');if(input.measurement.maturePathEpisodes<=0)measurementReasons.push('NO_MATURE_PATH_EPISODES');if(input.measurement.candidateObservationCoverage==null)measurementReasons.push('CANDIDATE_COVERAGE_UNKNOWN');if(input.measurement.collectorDegraded)measurementReasons.push('COLLECTOR_DEGRADED');
  const measurementReadiness:GateState=measurementReasons.length?'INCONCLUSIVE':'PASS';
  const economicReasons:string[]=[];if(input.economic.prospectiveCycleCount<=0)economicReasons.push('NO_PROSPECTIVE_CYCLES');if(input.economic.canonicalEligibleCount<=0)economicReasons.push('NO_CANONICAL_ECONOMIC_SAMPLES');if(!input.economic.primaryMetricReady)economicReasons.push('PRIMARY_METRIC_NOT_READY');if(!input.economic.nonInferiorityReady)economicReasons.push('NON_INFERIORITY_NOT_READY');if(!input.economic.outOfSampleReady)economicReasons.push('OUT_OF_SAMPLE_NOT_READY');
  const economicAcceptance:GateState=economicReasons.length?'INCONCLUSIVE':'PASS';
  return{safetyIntegrity,measurementReadiness,economicAcceptance,reasons:{safety:safetyReasons,measurement:measurementReasons,economic:economicReasons},entryEnforceAuthorized:false,profitRealizationAuthorized:false,releaseEligible:safetyIntegrity==='PASS'&&measurementReadiness==='PASS'&&economicAcceptance==='PASS'};
}
