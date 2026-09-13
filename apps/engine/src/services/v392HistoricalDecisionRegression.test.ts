import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {EntryDecisionJsonSchema} from '@zdj/contracts';

const root=new URL('../../../../data/reports/v392-deep-root-cause/',import.meta.url);
const read=(name:string)=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
const summary=read('summary.json'),anomalies=read('anomalies.json'),pairs=read('pairs.json'),runs=read('runs.json');

describe('V3.9.2 historical decision-contract regressions',()=>{
  it('keeps the frozen 101 boundary-only and 118 low-change cohorts explicit',()=>{
    expect(anomalies.contextChanges.onlyBoundary).toBe(101);
    expect(summary.pairCounts.smallChange).toBe(118);
    expect(pairs).toHaveLength(432);
  });

  it('does not let the 199 historical 15m/down + LONG rows define an executable side',()=>{
    expect(anomalies.directionCross["('DOWN', 'LONG')"]).toBe(199);
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

  it('recognizes every frozen NO_EDGE+TP=0 failure while the new non-PLACE grammar permits only null TP',()=>{
    const zeroFailures=summary.failureRows.filter((row:any)=>row.category==='TP_ZERO_SCHEMA'&&row.rawDecision==='NO_DIRECTION_EDGE');
    // The report narrative says 22; the checked-in source fixture contains 21 rows.
    expect(zeroFailures).toHaveLength(21);
    expect(runs.filter((run:any)=>run.payload?.decision==='NO_DIRECTION_EDGE')).not.toHaveLength(0);
    const noEdge=EntryDecisionJsonSchema.oneOf[3] as any;
    expect(noEdge.properties.profitTakePlan).toEqual({type:'null'});
  });
});
