import { describe, expect, it } from 'vitest';
import { evaluateEconomicEntryFeasibility } from './economicEntryFeasibility.js';

const now=1_800_000;
const rows=Array.from({length:90},(_,i)=>({openTime:now-90*60_000+i*60_000,closeTime:now-90*60_000+(i+1)*60_000-1,receivedAt:now-90*60_000+(i+1)*60_000,isClosed:true,source:'MOCK',open:100,high:102,low:98,close:100,volume:1,quoteVolume:100,trades:1}));
function state(){
  return {
    settings:{
      tradeEconomics:{admissionMode:'ENFORCE',historicalTpReachabilityEnabled:true,minHistoricalReachProbability:.5,reachabilityLookbackBars:60,reachabilityMinSamples:30},
      takeProfit:{exitFeeAssumption:'TAKER',makerFeeRate:.0002,takerFeeRate:.0004,entryFeeRate:.0002,slippageBufferPct:0,feeSafetyBufferPct:10,minNetProfitUsd:2,minNetProfitRoiPct:0},
      positionManagement:{humanManagedAdmissionCapsEnabled:true,maxHumanManagedPositions:4,maxHumanManagedNotionalPctEquity:.2},
    },
    snapshots:new Map([['BTCUSDT',{quote:{stepSize:.1}}]]),
    positions:new Map(),
    account:{equityUsd:10_000},
  } as any;
}
const market={cachedCandles:()=>rows} as any;
const envelope={leverage:10,LONG:{executable:true,maxQuantityUnits:200,maxNotionalUsd:2_000},SHORT:{executable:true,maxQuantityUnits:200,maxNotionalUsd:2_000}};
const plan={targetPrice:101,acceptableTargetRange:{min:100.8,max:101.2},targetHorizonMinutes:5,targetReason:'test',evidenceRefs:['technical.15m.confirmed']};
describe('economic entry feasibility',()=>{
  it('passes a reachable profitable AI quantity without resizing it',()=>{
    const result=evaluateEconomicEntryFeasibility({state:state(),market,symbol:'BTCUSDT',side:'LONG',quantityUnits:100,acceptablePriceRange:{min:99.9,max:100},profitTakePlan:plan,envelope,now});
    expect(result.passed).toBe(true);
    expect(result.notionalUsd).toBeCloseTo(1000,8);
    expect(result.expectedNetProfit).toBeGreaterThanOrEqual(2);
    expect(result.reachProbability).toBe(1);
  });
  it('rejects insufficient net profit instead of enlarging quantity',()=>{
    const result=evaluateEconomicEntryFeasibility({state:state(),market,symbol:'BTCUSDT',side:'LONG',quantityUnits:1,acceptablePriceRange:{min:99.9,max:100},profitTakePlan:plan,envelope,now});
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('ECONOMIC_MIN_NET_PROFIT_UNMET');
    expect(result.notionalUsd).toBeCloseTo(10,8);
  });
  it('rejects a final price move that takes notional below the configured business floor',()=>{
    const e={...envelope,LONG:{...envelope.LONG,minimumInitialMarginQuote:1,minimumOrderNotionalQuote:200}};
    const result=evaluateEconomicEntryFeasibility({state:state(),market,symbol:'BTCUSDT',side:'LONG',quantityUnits:19,acceptablePriceRange:{min:99.9,max:100},profitTakePlan:plan,envelope:e,actualEntryPrice:100,now});
    expect(result.notionalUsd).toBeCloseTo(190,8);
    expect(result.blockers).toContain('BUSINESS_MIN_ORDER_NOTIONAL_UNMET');
  });
  it('rejects a final margin below the configured initial-margin floor',()=>{
    const e={...envelope,LONG:{...envelope.LONG,minimumInitialMarginQuote:21,minimumOrderNotionalQuote:200}};
    const result=evaluateEconomicEntryFeasibility({state:state(),market,symbol:'BTCUSDT',side:'LONG',quantityUnits:20,acceptablePriceRange:{min:99.9,max:100},profitTakePlan:plan,envelope:e,actualEntryPrice:100,now});
    expect(result.notionalUsd).toBeCloseTo(200,8);
    expect(result.blockers).toContain('BUSINESS_MIN_INITIAL_MARGIN_UNMET');
  });
  it('rejects a target outside observed historical reachability',()=>{
    const far={...plan,targetPrice:105,acceptableTargetRange:{min:104.9,max:105.1}};
    const result=evaluateEconomicEntryFeasibility({state:state(),market,symbol:'BTCUSDT',side:'LONG',quantityUnits:100,acceptablePriceRange:{min:99.9,max:100},profitTakePlan:far,envelope,now});
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('TP_HISTORICAL_REACHABILITY_UNMET');
  });
  it('blocks new risk when HUMAN_MANAGED portfolio caps are full',()=>{
    const s=state();s.positions.set('p1',{managementStatus:'HUMAN_MANAGED',quantity:30,markPrice:100,entryPrice:100});
    const result=evaluateEconomicEntryFeasibility({state:s,market,symbol:'BTCUSDT',side:'LONG',quantityUnits:100,acceptablePriceRange:{min:99.9,max:100},profitTakePlan:plan,envelope,now});
    expect(result.blockers).toContain('HUMAN_MANAGED_EXPOSURE_LIMIT');
  });
});
