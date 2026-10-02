import { directionPermissions, directionPreference, preferencePolicy, riskTier } from '@zdj/core';
import type { BrainDecision, MarketSymbolSnapshot } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';
import { directionFacts } from './entryDirectionContract.js';

export interface DirectionPolicyResult {
  tier:string; preference:string; allowedDirections:Array<'LONG'|'SHORT'>; preferredDirection:'LONG'|'SHORT'|null;
  longExceptionRequired:boolean; altLongQuality:number; evidenceRefs:string[]; contradictions:string[];
  marginFactor:number; leverageCap:number; reasonCodes:string[]; policyVersion:'V3.9.7';
}

/** The service is advisory until EntryCoordinator validates its result.  Keeping it
 * side-effect free makes policy auditable and prevents it from becoming an order path. */
export class DirectionPolicyService {
  constructor(private readonly state:RuntimeState) {}
  evaluate(symbol:string,snapshot:MarketSymbolSnapshot):DirectionPolicyResult {
    const p=this.state.settings.portfolioIntelligence,tier=riskTier(snapshot,p),preference=directionPreference(symbol,tier,p);
    const t15=snapshot.technical['15m'],t4h=snapshot.technical['4h'],t1d=snapshot.technical['1d'];
    if(!t15||!t4h||!t1d||!snapshot.quote)throw new Error('DATA_ERROR: missing contracted 1d/4h/15m/quote');
    const alignment=directionFacts(snapshot),roles=[alignment.trend1dRole,alignment.trend4hRole,alignment.trend15mRole],up=roles.filter(x=>x==='SUPPORTS_LONG').length,down=roles.filter(x=>x==='SUPPORTS_SHORT').length;
    const regime=this.state.eips.get(symbol)?.globalRegime?.regime??'MIXED',bearish=regime==='RISK_OFF'||regime==='HIGH_VOLATILITY';
    const quality=Math.max(0,Math.min(100,40+Math.max(up,down)*15-Math.min(up,down)*15+(bearish?-5:0)-(t15.atrPercent>5?10:0)));
    const legacy=directionPermissions(symbol,tier,p).allowedDirections,biasTieBreaker=alignment.baseAlignmentClass==='MIXED'&&preference!=='BALANCED'?'SHORT':null;
    const preferredDirection=alignment.baseAlignmentClass==='ALIGNED_LONG'?'LONG':alignment.baseAlignmentClass==='ALIGNED_SHORT'?'SHORT':biasTieBreaker;
    return {tier,preference,allowedDirections:['LONG','SHORT'],preferredDirection,longExceptionRequired:false,altLongQuality:quality,evidenceRefs:[`TF_1D_${t1d.trend}`,`TF_4H_${t4h.trend}`,`TF_15M_${t15.trend}`,`REGIME_${regime}`],contradictions:alignment.baseAlignmentClass==='MIXED'?['MULTI_TIMEFRAME_DIRECTION_CONFLICT']:[],marginFactor:tier==='CORE'?1:(p.altLongMarginFactors[tier]??1),leverageCap:tier==='CORE'?p.globalMaxLeverage:(p.altLongLeverageCaps[tier]??p.globalMaxLeverage),reasonCodes:[`TIER_${tier}`,`ALIGNMENT_${alignment.baseAlignmentClass}`,`LEGACY_PREFERENCE_OBSERVATION_${preference}`,`LEGACY_ALLOWED_OBSERVATION_${legacy.join('_')}`,biasTieBreaker?'SHORT_BIAS_TIE_BREAKER_ONLY':'NO_BIAS_TIE_BREAK',bearish?'BEARISH_BREADTH_OR_REGIME':'REGIME_NOT_BEARISH'],policyVersion:'V3.9.7'};
  }
  allows(policy:DirectionPolicyResult,decision:BrainDecision){
    const side=decision.decision==='PLACE_LONG'?'LONG':decision.decision==='PLACE_SHORT'?'SHORT':decision.direction;
    if(!policy.allowedDirections.includes(side)) return {ok:false,reason:'DIRECTION_NOT_ALLOWED'};
    return {ok:true,reason:null};
  }
  compatibility(symbol:string,snapshot:MarketSymbolSnapshot){const policy=this.evaluate(symbol,snapshot);return {...policy,legacyPolicy:preferencePolicy(policy.preference as any)};}
}
