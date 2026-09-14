export type GateState='PASS'|'FAIL'|'INCONCLUSIVE';
export type V393ReleaseGateInput={
  safety:{identityConflictCount:number;duplicateSubmitCount:number;quantityFailureCount:number;getWriteCount:number;unknownRiskReleasedCount:number;cycleResurrectionCount:number;tpCoverageRegressionCount:number};
  measurement:{manifestFrozen:boolean;exactEntryEpisodes:number;maturePathEpisodes:number;candidateObservationCoverage:number|null;collectorDegraded:boolean;requiredDimensionsMissing:string[];failedChecks?:string[]};
  economic:{prospectiveCycleCount:number;canonicalEligibleCount:number;primaryMetricReady:boolean;nonInferiorityReady:boolean;outOfSampleReady:boolean;failedChecks?:string[]};
};
export function evaluateV393ReleaseGate(input:V393ReleaseGateInput){
  const safetyReasons:string[]=[];for(const [key,value] of Object.entries(input.safety))if(value>0)safetyReasons.push(`${key}:${value}`);
  const safetyIntegrity:GateState=safetyReasons.length?'FAIL':'PASS';
  const measurementFailed=[...(input.measurement.failedChecks??[])];
  const measurementMissing=[...input.measurement.requiredDimensionsMissing];if(!input.measurement.manifestFrozen)measurementMissing.push('EXPERIMENT_MANIFEST_NOT_FROZEN');if(input.measurement.exactEntryEpisodes<=0)measurementMissing.push('NO_EXACT_ENTRY_EPISODES');if(input.measurement.maturePathEpisodes<=0)measurementMissing.push('NO_MATURE_PATH_EPISODES');if(input.measurement.candidateObservationCoverage==null)measurementMissing.push('CANDIDATE_COVERAGE_UNKNOWN');if(input.measurement.collectorDegraded)measurementMissing.push('COLLECTOR_DEGRADED');
  const measurementReadiness:GateState=measurementFailed.length?'FAIL':measurementMissing.length?'INCONCLUSIVE':'PASS';
  const economicFailed=[...(input.economic.failedChecks??[])],economicMissing:string[]=[];if(input.economic.prospectiveCycleCount<=0)economicMissing.push('NO_PROSPECTIVE_CYCLES');if(input.economic.canonicalEligibleCount<=0)economicMissing.push('NO_CANONICAL_ECONOMIC_SAMPLES');if(!input.economic.primaryMetricReady)economicMissing.push('PRIMARY_METRIC_NOT_READY');if(!input.economic.nonInferiorityReady)economicMissing.push('NON_INFERIORITY_NOT_READY');if(!input.economic.outOfSampleReady)economicMissing.push('OUT_OF_SAMPLE_NOT_READY');
  const economicAcceptance:GateState=economicFailed.length?'FAIL':economicMissing.length?'INCONCLUSIVE':'PASS';
  const releaseEligible=safetyIntegrity==='PASS'&&measurementReadiness==='PASS'&&economicAcceptance==='PASS';
  return{safetyIntegrity,measurementReadiness,economicAcceptance,reasons:{safety:safetyReasons,measurement:[...measurementFailed,...measurementMissing],economic:[...economicFailed,...economicMissing]},entryEnforceAuthorized:false,profitRealizationAuthorized:false,releaseEligible,
    releaseDecision:releaseEligible?'REVIEW_REQUIRED' as const:'BLOCKED' as const};
}
