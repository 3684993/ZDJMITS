import {describe,expect,it} from 'vitest';
import {buildEip,tradingCostSnapshot} from '@zdj/core';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {harness} from './tradingQualityTestHarness.js';
import {buildQuantityHorizonCandidates} from './quantityHorizonCandidates.js';
import {summarizeReachability} from './historicalTpReachability.js';

const NOW=2_000_000_000_000;
const candles=(ordinaryHigh:number,outlierHigh?:number)=>Array.from({length:240},(_,i)=>{
  const openTime=NOW-(240-i)*300_000;
  return{openTime,closeTime:openTime+299_999,open:100,high:i===180&&(outlierHigh??0)>ordinaryHigh?outlierHigh!:ordinaryHigh,
    low:99.7,close:100,volume:1,isClosed:true};
});

function candidateSet(rows:any[]){
  return buildQuantityHorizonCandidates({symbol:'TESTUSDT',side:'LONG',now:NOW,
    quote:{bid:99.99,ask:100,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5},leverage:10,
    envelope:{executable:true,maxQuantityUnits:30_000,maxNotionalUsd:3_000,maxMarginUsd:300,minQuantityUnits:1,riskHeadroom:{blockers:[]}},
    envelopeExpiresAt:NOW+120_000,factVersion:'v397-economic-test',risk:null,
    settings:{takeProfit:defaults.takeProfit,tradeEconomics:{...defaults.tradeEconomics,admissionMode:'SHADOW',reachabilityLookbackBars:180,reachabilityMinSamples:30},
      portfolioIntelligence:{businessMinInitialMarginUsd:100,preferredInitialMarginUsd:200}},
    candles:()=>rows,targetHorizons:[60],managementDurationMs:90*60_000} as never);
}

describe('V3.9.7 canonical cost and robust TP authority',()=>{
  it('uses one cost snapshot in EIP and does not add target ambition to break-even edge',()=>{
    const h=harness(),snapshot=h.state.snapshots.get(h.packet.symbol)!,candidate=h.state.universe[0]!;
    (snapshot.technical as any)['1h']??=structuredClone(snapshot.technical['15m']);
    const packet=buildEip({candidate,snapshot,btc:snapshot,eth:snapshot,positions:[],pendingEntries:[],
      experience:{sampleSize:0,sameSymbolWinRate:null,sameRegimeWinRate:null,averageFillMinutes:null,recentLessons:[]},settings:h.state.settings,now:NOW});
    const cost=tradingCostSnapshot(h.state.settings.takeProfit as any);
    expect(packet.economic).toMatchObject({costVersion:cost.costVersion,entryFeeBps:cost.entryFeeBps,expectedExitFeeBps:cost.expectedExitFeeBps,
      allInCostBps:cost.allInCostBps,minimumEconomicEdgeBps:cost.allInCostBps,minimumEconomicEdgeDefinition:'ALL_IN_BREAK_EVEN_COST_ONLY'});
    expect(packet.economic.minimumEconomicEdgeBps).toBeLessThan(packet.economic.configuredTargetMoveBps);
  });

  it('offers 60m p50/p75 targets and never turns a hard-max outlier into a normal candidate',()=>{
    const rows=candles(100.3,105),summary=summarizeReachability({rows:rows as never,horizonMinutes:60,lookbackBars:180,minSamples:30,now:NOW});
    expect(summary.LONG.hardMaxMovePercent).toBeGreaterThan(summary.LONG.p75*5);
    const set=candidateSet(rows);
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(new Set(set.candidates.map(row=>row.economics.targetBasis))).toEqual(new Set(['P50','P75']));
    for(const candidate of set.candidates){
      expect(candidate.targetHorizonMinutes).toBe(60);
      expect(candidate.economics.targetMovePercent).toBeLessThanOrEqual(summary.LONG.p75+1e-8);
      expect(candidate.economics.targetConditionalNetProfitUsd).toBeGreaterThanOrEqual(defaults.takeProfit.minNetProfitUsd);
      expect(candidate.costs.costVersion).toBe(tradingCostSnapshot(defaults.takeProfit as any).costVersion);
    }
  });

  it('does not escape to hard-max when the minimum-net floor lies beyond the p75 band',()=>{
    const set=candidateSet(candles(100.1));
    expect(set.candidates).toEqual([]);
    expect(set.noTradeReasons).toContain('TARGET_BEYOND_P75_REACHABILITY_BAND');
  });
});
