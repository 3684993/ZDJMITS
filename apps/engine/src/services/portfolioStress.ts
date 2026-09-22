import type {PortfolioRiskExposure,PortfolioRiskSnapshot} from './portfolioRiskSnapshot.js';

export interface PortfolioRiskProfile{
  maxCapitalAtRiskUsd:number;
  maxDrawdownPct:number;
  maxStressLossUsd:number;
  maxGrossNotionalUsd:number;
  maxDirectionNotionalUsd:number;
  maxClusterNotionalUsd:number;
  minMarginBufferPct:number;
  minLiquidationBufferPct:number;
}

export interface CorrelationMap{
  version:string;
  clusters:Record<string,string>;
}

export interface StressScenario{
  id:string;
  priceShockPct:number;
  spreadWidenPct:number;
  fundingShockPct:number;
  markBasisShockPct:number;
  depthPenaltyPct:number;
  exchangeUnavailable:boolean;
  unavailablePenaltyPct:number;
  clusterConvergencePct:number;
}

export interface PortfolioStressResult{
  profileValid:boolean;
  scenarioSetValid:boolean;
  admissionAllowed:boolean;
  blockers:string[];
  limitingConstraints:string[];
  maxStressLossUsd:number;
  worstScenarioId:string|null;
  clusterVersion:string|null;
  clusterNotional:Record<string,number>;
  marginBuffers:Record<string,number|null>;
  minObservedLiquidationBufferPct:number|null;
  scenarios:Array<{id:string;stressLossUsd:number;correlationPenaltyUsd:number}>;
}

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
const nonNegative=(value:unknown)=>finite(value)&&Number(value)>=0;
const fraction=(value:unknown)=>nonNegative(value)&&Number(value)<=1;

function validateProfile(profile:PortfolioRiskProfile){
  return nonNegative(profile.maxCapitalAtRiskUsd)&&fraction(profile.maxDrawdownPct)&&nonNegative(profile.maxStressLossUsd)&&nonNegative(profile.maxGrossNotionalUsd)&&nonNegative(profile.maxDirectionNotionalUsd)&&nonNegative(profile.maxClusterNotionalUsd)&&fraction(profile.minMarginBufferPct)&&fraction(profile.minLiquidationBufferPct);
}

function validateScenario(row:StressScenario){
  return Boolean(String(row.id??'').trim())&&fraction(Math.abs(row.priceShockPct))&&fraction(row.spreadWidenPct)&&fraction(row.fundingShockPct)&&fraction(Math.abs(row.markBasisShockPct))&&fraction(row.depthPenaltyPct)&&fraction(row.unavailablePenaltyPct)&&fraction(row.clusterConvergencePct);
}

function clusterKey(exposure:PortfolioRiskExposure,map:CorrelationMap){
  const assigned=String(map.clusters[exposure.underlying]??'').trim();
  return assigned||'UNMAPPED_CORRELATED';
}

/** S05-B/C: deterministic stress and budget evaluation over one authoritative snapshot. */
export function evaluatePortfolioStress(input:{snapshot:PortfolioRiskSnapshot;profile:PortfolioRiskProfile;correlation:CorrelationMap;scenarios:StressScenario[]}):PortfolioStressResult{
  const {snapshot,profile,correlation}=input,blockers:string[]=[],limits:string[]=[];
  const profileValid=validateProfile(profile);
  const scenarioSetValid=input.scenarios.length>0&&input.scenarios.every(validateScenario)&&new Set(input.scenarios.map(row=>row.id)).size===input.scenarios.length;
  if(!profileValid)blockers.push('RISK_PROFILE_INCOMPLETE_OR_INVALID');
  if(!scenarioSetValid)blockers.push('STRESS_SCENARIOS_INVALID');
  if(!snapshot.complete)blockers.push('PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE');
  if(!String(correlation.version??'').trim())blockers.push('CORRELATION_VERSION_MISSING');

  const positions=snapshot.exposures.filter(row=>row.kind==='POSITION'&&row.notionalUsd>0);
  for(const row of positions){
    if(row.maintenanceMarginUsd==null||!nonNegative(row.maintenanceMarginUsd))blockers.push(`MAINTENANCE_MARGIN_UNPROVEN:${row.id}`);
    if(row.liquidationBufferPct==null||!nonNegative(row.liquidationBufferPct))blockers.push(`LIQUIDATION_BUFFER_UNPROVEN:${row.id}`);
  }

  const clusterNotional:Record<string,number>={};
  for(const row of snapshot.exposures){const key=clusterKey(row,correlation);clusterNotional[key]=(clusterNotional[key]??0)+row.notionalUsd;}
  const marginBuffers:Record<string,number|null>={};
  for(const row of snapshot.quoteAssets){
    if(row.availableMarginUsd==null||!nonNegative(row.availableMarginUsd)){marginBuffers[row.asset]=null;blockers.push(`MARGIN_ASSET_UNVERIFIED:${row.asset}`);continue;}
    marginBuffers[row.asset]=row.availableMarginUsd>0?(row.availableMarginUsd-row.marginUsedUsd)/row.availableMarginUsd:(row.marginUsedUsd>0?-1:1);
  }
  const observedLiquidation=positions.map(row=>row.liquidationBufferPct).filter(nonNegative) as number[];
  const minObservedLiquidationBufferPct=observedLiquidation.length?Math.min(...observedLiquidation):null;

  if(profileValid){
    if(snapshot.capitalAtRiskUsd>profile.maxCapitalAtRiskUsd)limits.push('MAX_CAPITAL_AT_RISK');
    if(snapshot.drawdownPct>profile.maxDrawdownPct)limits.push('MAX_DRAWDOWN');
    if(snapshot.grossNotionalUsd>profile.maxGrossNotionalUsd)limits.push('MAX_GROSS_NOTIONAL');
    if(Math.max(snapshot.longNotionalUsd,snapshot.shortNotionalUsd)>profile.maxDirectionNotionalUsd)limits.push('MAX_DIRECTION_NOTIONAL');
    if(Math.max(0,...Object.values(clusterNotional))>profile.maxClusterNotionalUsd)limits.push('MAX_CLUSTER_NOTIONAL');
    if(Object.values(marginBuffers).some(value=>value==null||value<profile.minMarginBufferPct))limits.push('MIN_MARGIN_BUFFER');
    if(minObservedLiquidationBufferPct==null||minObservedLiquidationBufferPct<profile.minLiquidationBufferPct)limits.push('MIN_LIQUIDATION_BUFFER');
  }

  const scenarios:Array<{id:string;stressLossUsd:number;correlationPenaltyUsd:number}>=[];
  if(scenarioSetValid){
    for(const scenario of input.scenarios){
      const basePct=Math.abs(scenario.priceShockPct)+scenario.spreadWidenPct+scenario.fundingShockPct+Math.abs(scenario.markBasisShockPct)+scenario.depthPenaltyPct+(scenario.exchangeUnavailable?scenario.unavailablePenaltyPct:0);
      const baseLoss=snapshot.exposures.reduce((sum,row)=>sum+row.notionalUsd*basePct,0);
      let correlationPenaltyUsd=0;
      for(const [key,notional] of Object.entries(clusterNotional)){
        const members=snapshot.exposures.filter(row=>clusterKey(row,correlation)===key).length;
        if(members>1)correlationPenaltyUsd+=notional*Math.abs(scenario.priceShockPct)*scenario.clusterConvergencePct;
      }
      scenarios.push({id:scenario.id,stressLossUsd:baseLoss+correlationPenaltyUsd,correlationPenaltyUsd});
    }
  }
  scenarios.sort((a,b)=>a.id.localeCompare(b.id));
  const worst=scenarios.reduce<typeof scenarios[number]|null>((current,row)=>!current||row.stressLossUsd>current.stressLossUsd?row:current,null);
  if(profileValid&&worst&&worst.stressLossUsd>profile.maxStressLossUsd)limits.push('MAX_STRESS_LOSS');
  const uniqueBlockers=[...new Set(blockers)].sort(),uniqueLimits=[...new Set(limits)].sort();
  return {profileValid,scenarioSetValid,admissionAllowed:uniqueBlockers.length===0&&uniqueLimits.length===0,blockers:uniqueBlockers,limitingConstraints:uniqueLimits,maxStressLossUsd:worst?.stressLossUsd??0,worstScenarioId:worst?.id??null,clusterVersion:String(correlation.version??'').trim()||null,clusterNotional:Object.fromEntries(Object.entries(clusterNotional).sort(([a],[b])=>a.localeCompare(b))),marginBuffers:Object.fromEntries(Object.entries(marginBuffers).sort(([a],[b])=>a.localeCompare(b))),minObservedLiquidationBufferPct,scenarios};
}
