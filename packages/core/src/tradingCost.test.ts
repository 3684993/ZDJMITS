import { describe,expect,it } from 'vitest';
import { estimateTradingCost } from './tradingCost.js';

const base={entryPrice:100,qty:1,direction:'LONG' as const,leverage:10,entryFeeRate:.004,expectedExitFeeRate:.004,expectedSlippagePct:0,feeSafetyBufferPct:0,minNetProfitUsd:5,minNetProfitRoiPct:0};
describe('TradingCostModel',()=>{
  it('calculates maker/maker cost floor and net profit',()=>{const x=estimateTradingCost(base,110);expect(x.estimatedEntryFee).toBeCloseTo(.4);expect(x.estimatedExitFee).toBeCloseTo(.44);expect(x.expectedNetProfit).toBeCloseTo(9.16);expect(x.minProfitableExitPrice).toBeGreaterThan(105);});
  it('supports short maker/taker worst-case',()=>{const x=estimateTradingCost({...base,direction:'SHORT',expectedExitFeeRate:.008},90);expect(x.expectedGrossProfit).toBe(10);expect(x.expectedNetProfit).toBeCloseTo(8.88);expect(x.minProfitableExitPrice).toBeLessThan(95);});
  it('uses the larger of USD and margin ROI floors',()=>{const x=estimateTradingCost({...base,minNetProfitUsd:1,minNetProfitRoiPct:20},110);expect(x.requiredNetProfit).toBe(2);expect(x.minProfitableExitPrice).toBeGreaterThan(102);});
  it('detects gross positive but net negative',()=>{const x=estimateTradingCost({...base,entryFeeRate:.02,expectedExitFeeRate:.02},101);expect(x.expectedGrossProfit).toBe(1);expect(x.expectedNetProfit).toBeLessThan(0);});
});
