import type { SystemSettings } from '@zdj/contracts';

export type TradingParameterProfile='CONSERVATIVE'|'DEFAULT'|'AGGRESSIVE'|'CUSTOM';

export const tradingParameterProfiles={
  CONSERVATIVE:{label:'保守',minNetProfitUsd:1,baseMarginUsd:100,maxMarginPerPositionUsd:200,perTradeRiskPctEquity:.0025,globalMaxLeverage:8,maxPositions:10,minHistoricalReachProbability:.60,maxHumanManagedPositions:2,maxHumanManagedNotionalPctEquity:.10},
  DEFAULT:{label:'默认',minNetProfitUsd:2,baseMarginUsd:150,maxMarginPerPositionUsd:300,perTradeRiskPctEquity:.005,globalMaxLeverage:10,maxPositions:20,minHistoricalReachProbability:.50,maxHumanManagedPositions:4,maxHumanManagedNotionalPctEquity:.20},
  AGGRESSIVE:{label:'激进',minNetProfitUsd:3,baseMarginUsd:200,maxMarginPerPositionUsd:500,perTradeRiskPctEquity:.0075,globalMaxLeverage:15,maxPositions:30,minHistoricalReachProbability:.40,maxHumanManagedPositions:6,maxHumanManagedNotionalPctEquity:.30},
} as const;

export function applyTradingParameterProfile(settings:SystemSettings,profile:TradingParameterProfile){
  settings.tradeEconomics.parameterProfile=profile;
  if(profile==='CUSTOM')return settings;
  const p=tradingParameterProfiles[profile];
  settings.takeProfit.minNetProfitUsd=p.minNetProfitUsd;
  settings.portfolioIntelligence.baseMarginUsd=p.baseMarginUsd;
  settings.portfolio.entryMarginUsd=p.baseMarginUsd;
  settings.portfolioIntelligence.maxMarginPerPositionUsd=p.maxMarginPerPositionUsd;
  settings.riskGovernance.perTradeRiskPctEquity=p.perTradeRiskPctEquity;
  settings.portfolioIntelligence.globalMaxLeverage=p.globalMaxLeverage;
  settings.leverage.mode='CUSTOM';
  settings.leverage.customValue=p.globalMaxLeverage;
  settings.portfolio.maxPositions=p.maxPositions;
  settings.tradeEconomics.minHistoricalReachProbability=p.minHistoricalReachProbability;
  settings.positionManagement.maxHumanManagedPositions=p.maxHumanManagedPositions;
  settings.positionManagement.maxHumanManagedNotionalPctEquity=p.maxHumanManagedNotionalPctEquity;
  return settings;
}
