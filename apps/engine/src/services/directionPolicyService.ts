import { directionPermissions, directionPreference, preferencePolicy, riskTier } from '@zdj/core';
import type { BrainDecision, MarketSymbolSnapshot } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';

export interface DirectionPolicyResult {
  tier:string; preference:string; allowedDirections:Array<'LONG'|'SHORT'>; preferredDirection:'LONG'|'SHORT'|null;
  longExceptionRequired:boolean; altLongQuality:number; evidenceRefs:string[]; contradictions:string[];
  marginFactor:number; leverageCap:number; reasonCodes:string[]; policyVersion:'V3.8.0';
}

/** The service is advisory until EntryCoordinator validates its result.  Keeping it
 * side-effect free makes policy auditable and prevents it from becoming an order path. */
export class DirectionPolicyService {
  constructor(private readonly state:RuntimeState) {}
  evaluate(symbol:string,snapshot:MarketSymbolSnapshot):DirectionPolicyResult {
    const p=this.state.settings.portfolioIntelligence,tier=riskTier(snapshot,p),preference=directionPreference(symbol,tier,p);
    const t15=snapshot.technical['15m'],t4h=snapshot.technical['4h'];
    if(!t15||!t4h||!snapshot.quote)throw new Error('DATA_ERROR: missing contracted 15m/4h/quote');
    const up=[t15,t4h].filter(x=>x.trend==='UP'||x.emaSlope21>0).length,down=[t15,t4h].filter(x=>x.trend==='DOWN'||x.emaSlope21<0).length;
    const regime=this.state.eips.get(symbol)?.globalRegime?.regime??'MIXED',bearish=regime==='RISK_OFF'||regime==='HIGH_VOLATILITY';
    const quality=Math.max(0,Math.min(100,35+up*18-down*12+(bearish?-16:0)-(t15.atrPercent>5?10:0)));
    const shortOnly=preference==='SHORT_ONLY',strict=preference==='STRICT_SHORT_BIAS',intelligent=preference==='INTELLIGENT_SHORT_BIAS';
    return {tier,preference,allowedDirections:directionPermissions(symbol,tier,p).allowedDirections,preferredDirection:shortOnly||strict||intelligent?'SHORT':null,longExceptionRequired:strict,altLongQuality:quality,evidenceRefs:[`TF_15M_${t15.trend}`,`TF_4H_${t4h.trend}`,`REGIME_${regime}`],contradictions:up&&down?['MULTI_TIMEFRAME_DIRECTION_CONFLICT']:[],marginFactor:tier==='CORE'?1:(p.altLongMarginFactors[tier]??1),leverageCap:tier==='CORE'?p.globalMaxLeverage:(p.altLongLeverageCaps[tier]??p.globalMaxLeverage),reasonCodes:[`TIER_${tier}`,`PREFERENCE_${preference}`,bearish?'BEARISH_BREADTH_OR_REGIME':'REGIME_NOT_BEARISH'],policyVersion:'V3.8.0'};
  }
  allows(policy:DirectionPolicyResult,decision:BrainDecision){
    const side=decision.decision==='PLACE_LONG'?'LONG':decision.decision==='PLACE_SHORT'?'SHORT':decision.direction;
    if(!policy.allowedDirections.includes(side)) return {ok:false,reason:'DIRECTION_NOT_ALLOWED'};
    if(side==='LONG'&&policy.longExceptionRequired){
      const adequate=decision.longException===true&&Boolean(decision.longExceptionReason)&&Number(decision.altLongQuality??0)>=70&&decision.supportingEvidenceRefs.length>0;
      if(!adequate)return{ok:false,reason:'SPECULATIVE_LONG_EXCEPTION_EVIDENCE_REQUIRED'};
    }
    return {ok:true,reason:null};
  }
  compatibility(symbol:string,snapshot:MarketSymbolSnapshot){const policy=this.evaluate(symbol,snapshot);return {...policy,legacyPolicy:preferencePolicy(policy.preference as any)};}
}
