import type { DirectionReference, EntryProfile, SelectionMode, SystemSettings } from '@zdj/contracts';

export interface ProfileParameters {
  poolTargetOverride?: number;
  scoreFloorPercentile: number;
  evidenceFloor: number;
  rejectCooldownSeconds: number;
  secondBrainBias: number;
}
export function entryProfileParameters(profile:EntryProfile):ProfileParameters {
  if(profile==='HIGH_FREQUENCY') return {scoreFloorPercentile:45,evidenceFloor:0.75,rejectCooldownSeconds:20,secondBrainBias:0.15};
  if(profile==='FREQUENCY_FIRST') return {scoreFloorPercentile:45,evidenceFloor:0.75,rejectCooldownSeconds:20,secondBrainBias:0.15};
  if(profile==='QUALITY_FIRST') return {scoreFloorPercentile:72,evidenceFloor:0.93,rejectCooldownSeconds:75,secondBrainBias:0.65};
  if(profile==='CUSTOM') return {scoreFloorPercentile:50,evidenceFloor:0.86,rejectCooldownSeconds:30,secondBrainBias:0.35};
  return {scoreFloorPercentile:55,evidenceFloor:0.86,rejectCooldownSeconds:40,secondBrainBias:0.35};
}

export type ComponentWeights = {liquidity:number;tradingActivity:number;capitalActivity:number;technicalOpportunity:number;executionReachability:number;dataQuality:number};
export function selectionWeights(mode:SelectionMode):ComponentWeights {
  switch(mode){
    case 'EXCHANGE_RANK': return {liquidity:0.62,tradingActivity:0.13,capitalActivity:0.05,technicalOpportunity:0.05,executionReachability:0.10,dataQuality:0.05};
    case 'TRADING_ACTIVITY': return {liquidity:0.20,tradingActivity:0.40,capitalActivity:0.15,technicalOpportunity:0.10,executionReachability:0.10,dataQuality:0.05};
    case 'CAPITAL_ACTIVITY': return {liquidity:0.20,tradingActivity:0.12,capitalActivity:0.40,technicalOpportunity:0.13,executionReachability:0.10,dataQuality:0.05};
    case 'CUSTOM_SYMBOLS':
    case 'COMPREHENSIVE_MAINSTREAM':
    default: return {liquidity:0.35,tradingActivity:0.18,capitalActivity:0.12,technicalOpportunity:0.18,executionReachability:0.12,dataQuality:0.05};
  }
}

export function directionWeights(reference:DirectionReference):Record<string,number> {
  const base={ '1m':0.10,'5m':0.20,'15m':1.00,'4h':0.35,'1d':0.20,'1w':0.10 };
  if(reference==='TREND_15M') return {...base,'15m':1.35};
  if(reference==='TREND_4H') return {...base,'4h':0.75};
  if(reference==='TREND_1D') return {...base,'1d':0.60};
  if(reference==='TREND_1W') return {...base,'1w':0.45};
  return base;
}

export function resolveLeverage(settings: SystemSettings): number {
  const { mode, defaultValue, customValue } = settings.leverage;
  if (mode === '10X') return 10;
  if (mode === '20X') return 20;
  return mode === 'CUSTOM' ? customValue : defaultValue;
}
