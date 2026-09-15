import {describe,expect,it} from 'vitest';
import {EntryDecisionJsonSchema} from '@zdj/contracts';

// Frozen evidence manifest derived from the 2026-09-13 V3.9.2 deep-root-cause
// analysis. Keep CI independent from local data/reports, which intentionally
// contains runtime/research evidence and is not part of the source tree.
const historical={
  adjacentPairs:432,
  boundaryOnly:101,
  smallChange:118,
  downLongNonPlace:199,
  noEdgeTpZero:21,
} as const;

describe('V3.9.2 historical decision-contract regressions',()=>{
  it('keeps the frozen historical cohort sizes explicit without depending on local research files',()=>{
    expect(historical).toEqual({adjacentPairs:432,boundaryOnly:101,smallChange:118,downLongNonPlace:199,noEdgeTpZero:21});
  });

  it('does not let the 199 historical 15m/down + LONG rows define an executable side',()=>{
    expect(historical.downLongNonPlace).toBe(199);
    const nonPlace={
      action:'FINAL',schemaVersion:'V3.9.2',decision:'NO_DIRECTION_EDGE',structureDirection:'SHORT',tradeSide:null,
      opportunityType:'NONE',marketRegime:'TREND',confidence:.5,idealPrice:null,acceptablePriceRange:null,horizonMinutes:null,waitCondition:null,
      directionReason:'confirmed 15m structure',timingReason:'no completed entry event',entryLocationReason:'no bounded location',reason:'no edge',entryInvalidation:'15m reversal',
      longException:false,longExceptionReason:null,altLongQuality:null,supportingEvidenceRefs:[],profitTakePlan:null,rejectLayer:'TIMING',blockingCondition:'event pending',releaseCondition:'completed timing event',timingEvent:null,
    };
    const noEdge=EntryDecisionJsonSchema.oneOf[3] as any;
    expect(noEdge.required).toContain('tradeSide');
    expect(noEdge.properties.tradeSide).toEqual({type:'null'});
    expect(noEdge.properties).not.toHaveProperty('direction');
    expect(nonPlace.tradeSide).toBeNull();
  });

  it('keeps the frozen NO_EDGE+TP=0 cohort explicit while the new non-PLACE grammar permits only null TP',()=>{
    // The frozen source files contain 21 in-window TP=0 rows; the report also
    // documents one additional failure completing just outside the exact window.
    expect(historical.noEdgeTpZero).toBe(21);
    const noEdge=EntryDecisionJsonSchema.oneOf[3] as any;
    expect(noEdge.properties.profitTakePlan).toEqual({type:'null'});
  });
});
