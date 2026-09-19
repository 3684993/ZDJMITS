import { describe, expect, it } from 'vitest';
import { applyTradingParameterProfile } from './tradingParameterProfiles';

function settings(){
  return {tradeEconomics:{parameterProfile:'CUSTOM',minHistoricalReachProbability:.1},takeProfit:{minNetProfitUsd:1},portfolioIntelligence:{baseMarginUsd:1,maxMarginPerPositionUsd:1,globalMaxLeverage:1},riskGovernance:{perTradeRiskPctEquity:.01},leverage:{mode:'DEFAULT',defaultValue:20,customValue:20},portfolio:{maxPositions:50},positionManagement:{maxHumanManagedPositions:9,maxHumanManagedNotionalPctEquity:.9}} as any;
}
describe('trading parameter profiles',()=>{
  it('applies conservative/default/aggressive as real settings values',()=>{
    const d=settings();applyTradingParameterProfile(d,'DEFAULT');
    expect(d.takeProfit.minNetProfitUsd).toBe(2);
    expect(d.portfolioIntelligence.baseMarginUsd).toBe(150);
    expect(d.portfolio.entryMarginUsd).toBe(150);
    expect(d.portfolioIntelligence.maxMarginPerPositionUsd).toBe(300);
    expect(d.riskGovernance.perTradeRiskPctEquity).toBe(.005);
    expect(d.portfolioIntelligence.globalMaxLeverage).toBe(10);
    expect(d.portfolio.maxPositions).toBe(20);
    expect(d.tradeEconomics.minHistoricalReachProbability).toBe(.5);
    expect(d.positionManagement.maxHumanManagedPositions).toBe(4);
    expect(d.positionManagement.maxHumanManagedNotionalPctEquity).toBe(.2);
  });
  it('CUSTOM does not overwrite individual parameters',()=>{
    const s=settings();const before=s.takeProfit.minNetProfitUsd;applyTradingParameterProfile(s,'CUSTOM');expect(s.takeProfit.minNetProfitUsd).toBe(before);
  });
});
