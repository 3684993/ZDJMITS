import { buildEip } from '@zdj/core';
import { directionPermissions, directionPolicy, directionPreference, locationScore, resolveQuoteAsset, resolveUnderlying, riskTier } from '@zdj/core';
import type { BrainDecision, EntryIntelligencePacket } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';
import type { ExperienceService } from './experienceService.js';
import type {ExternalIntelligenceService} from './externalIntelligenceService.js';
import { directionFacts } from './entryDirectionContract.js';
import { eipEvidenceError } from './eipDependencies.js';

const DERIVATIVES_MAX_AGE_MS=305_000;

export class EipService {
  constructor(private state:RuntimeState,private experience:ExperienceService,private external?:ExternalIntelligenceService){}
  build(symbol:string,executionEnvelope?:unknown):EntryIntelligencePacket{
    const held=([...this.state.positions.values()] as any[]).some(position=>position.symbol===symbol),candidate=this.state.universe.find(x=>x.symbol===symbol&&(x.eligible||x.residentEligible||held)); const snapshot=this.state.snapshots.get(symbol); const btc=this.state.snapshots.get('BTCUSDT'),eth=this.state.snapshots.get('ETHUSDT');
    if(!candidate||!snapshot||!btc||!eth)throw new Error(`Cannot build EIP for ${symbol}: evidence missing`);
    const routeGeneration=Number(this.state.runtimeControl.capital.generation??candidate.selectionGeneration);if(routeGeneration>0&&candidate.selectionGeneration!==routeGeneration)throw new Error(`MARKET_GENERATION_MISMATCH: candidate=${candidate.selectionGeneration} route=${routeGeneration}`);
    this.assertFresh(snapshot);this.assertFresh(btc,true);this.assertFresh(eth,true);
    const now=Date.now(),derivativesAge=now-Number(snapshot.derivatives?.ts),derivativesStatus=!Number.isFinite(derivativesAge)||derivativesAge>DERIVATIVES_MAX_AGE_MS?'STALE':snapshot.derivatives.openInterest==null?'UNAVAILABLE_BY_EXCHANGE':'PRESENT';
    const eipSnapshot=derivativesStatus==='STALE'?{...snapshot,derivatives:{...snapshot.derivatives,openInterest:null,openInterestChange5m:null,openInterestChange15m:null,fundingRate:null,takerBuySellRatio5m:null,globalLongShortRatio:null,topTraderPositionRatio:null}}:snapshot;
    const provisionalRegime=(btc.technical['15m'].trend==='UP'&&eth.technical['15m'].trend==='UP')?'RISK_ON':(btc.technical['15m'].trend==='DOWN'&&eth.technical['15m'].trend==='DOWN')?'RISK_OFF':'MIXED';
    const packet=buildEip({candidate,snapshot:eipSnapshot,btc,eth,positions:[...this.state.positions.values()],pendingEntries:[...this.state.entryOrders.values()],experience:this.experience.summarize(symbol,provisionalRegime),settings:this.state.settings});
    const tier=(candidate.riskTier as any)??riskTier(eipSnapshot,this.state.settings.portfolioIntelligence),policy=(candidate.directionPolicy as any)??directionPolicy(symbol,tier,this.state.settings.portfolioIntelligence),preference=directionPreference(symbol,tier,this.state.settings.portfolioIntelligence),alignment=directionFacts(eipSnapshot),direction=eipSnapshot.technical['15m'].trend==='DOWN'?'SHORT':'LONG',quoteAsset=candidate.quoteAsset??resolveQuoteAsset(symbol),recommendedMargin=candidate.recommendedMargin??this.state.settings.portfolioIntelligence.baseMarginUsd,recommendedLeverage=candidate.recommendedLeverage??this.state.settings.portfolioIntelligence.globalMaxLeverage,exchangeMinNotional=Math.max(eipSnapshot.quote.minNotional,eipSnapshot.quote.minQty*eipSnapshot.quote.mark),minExecutableMargin=Math.max(this.state.settings.portfolioIntelligence.minMarginUsd,exchangeMinNotional/Math.max(1,recommendedLeverage)*1.1),routed=this.state.runtimeControl.capital.routedCandidates.find((x:any)=>x.symbol===symbol),allowedDirections=directionPermissions(symbol,tier,this.state.settings.portfolioIntelligence).allowedDirections,externalContext=this.external?.context(symbol,packet.createdAt)??[];
    const requiredTimeframes=['1m','5m','15m','1h','4h','1d','1w'],technicalAllTimeframes=requiredTimeframes.every((tf)=>Object.prototype.hasOwnProperty.call(eipSnapshot.technical,tf));
    // portfolioIntelligence/capitalEnvelope remain compatibility/audit surfaces only.
    // buildCompactBrainPrompt deliberately excludes them. Primary sees only MARKET_FACTS + the fresh executionEnvelope.
    const preferredDirection=alignment.baseAlignmentClass==='ALIGNED_LONG'?'LONG':alignment.baseAlignmentClass==='ALIGNED_SHORT'?'SHORT':preference==='BALANCED'?null:'SHORT';
    const enriched:any={...packet,...(executionEnvelope?{executionEnvelope}:{}),...(externalContext.length?{externalContext}:{}),evidenceDomains:{required:{quote:'PRESENT',orderBook:eipSnapshot.orderBook.bids.length&&eipSnapshot.orderBook.asks.length?'PRESENT':'MISSING',technicalSevenTimeframes:technicalAllTimeframes?'PRESENT':'MISSING',btcEthMultiTimeframe:packet.referenceMarkets?'PRESENT':'MISSING',portfolio:'PRESENT'},optional:{derivatives:derivativesStatus,experience:packet.experience.sampleSize?'PRESENT':'NO_SAMPLES',temporalIntelligence:'ADVISORY',externalIntelligence:externalContext.length?'PRESENT':'NOT_IN_PRIMARY'}},capitalEnvelope:{quoteAsset,exchangeMinNotional,minExecutableMargin,riskRecommendedMargin:recommendedMargin,recommendedLeverage,maxExecutableMargin:routed?.marginUsd??0,executable:Boolean(routed),longExecutable:Boolean((routed as any)?.longExecutable),shortExecutable:Boolean((routed as any)?.shortExecutable),longAvailableNotionalUsd:this.state.runtimeControl.capital.directionBudget.longAvailableNotionalUsd,shortAvailableNotionalUsd:this.state.runtimeControl.capital.directionBudget.shortAvailableNotionalUsd,capitalGeneration:this.state.runtimeControl.capital.generation,reasonCodes:routed?[]:['NOT_IN_CURRENT_CAPITAL_ROUTE']},portfolioIntelligence:{underlying:candidate.underlyingAsset??resolveUnderlying(symbol),quoteAsset,riskTier:tier,directionPolicy:policy,directionPreference:preference,allowedDirections:['LONG','SHORT'],preferredDirection,longExceptionRequired:false,altLongQuality:null,marginFactor:this.state.settings.portfolioIntelligence.altLongMarginFactors[tier]??1,leverageCap:this.state.settings.portfolioIntelligence.altLongLeverageCaps[tier]??recommendedLeverage,locationScore:candidate.locationScore??locationScore(eipSnapshot,direction),recommendedMargin,recommendedLeverage,marginMode:this.state.settings.portfolioIntelligence.marginMode,existingUnderlyingExposure:candidate.existingUnderlyingExposure??0,allocationAdmission:'PENDING_PRIMARY',reasons:[`ALIGNMENT_${alignment.baseAlignmentClass}`,`LEGACY_DIRECTION_PREFERENCE_OBSERVATION_${preference}`]}};
    if(derivativesStatus==='STALE')enriched.contradictions=[...new Set([...(enriched.contradictions??[]),'DERIVATIVES_STALE_CONTEXTUAL_ONLY'])];
    this.state.eips.set(symbol,enriched); return enriched;
  }
  private assertFresh(snapshot:import('@zdj/contracts').MarketSymbolSnapshot,regimeOnly=false){const error=eipEvidenceError(snapshot,this.state.settings.selection.minDataCompleteness,regimeOnly);if(error)throw new Error(error);}
  async resolveTools(requests:BrainDecision['evidenceRequests'],symbol:string):Promise<Record<string,unknown>>{
    const packet=this.state.eips.get(symbol)??this.build(symbol); const out:Record<string,unknown>={};
    for(const req of requests.slice(0,this.state.settings.ai.maxEvidenceToolsPerRound)){
      switch(req.tool){
        case 'GET_MULTITIMEFRAME': out[req.tool]=packet.market.technical; break;
        case 'GET_DERIVATIVES': {const age=Date.now()-Number(packet.market.derivatives.ts),stale=!Number.isFinite(age)||age>DERIVATIVES_MAX_AGE_MS;out[req.tool]={status:stale?'STALE':'PRESENT',ageMs:Number.isFinite(age)?age:null,data:packet.market.derivatives};break;}
        case 'GET_ORDERBOOK': out[req.tool]=packet.market.orderBook; break;
        case 'GET_GLOBAL_REGIME': out[req.tool]={referenceMarkets:packet.referenceMarkets,legacyRegime:packet.globalRegime}; break;
        case 'GET_PORTFOLIO_CONTEXT': out[req.tool]=packet.portfolio; break;
        case 'GET_EXPERIENCE': out[req.tool]=packet.experience; break;
        case 'GET_REACHABLE_BAND': out[req.tool]=packet.microstructure; break;
      }
    }
    return out;
  }
}
