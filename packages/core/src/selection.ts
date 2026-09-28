import { testnetFundsOnlyEntry } from './entryResourcePolicy.js';
import type { MarketSymbolSnapshot, OpportunityComponents, SystemSettings, UniverseCandidate } from '@zdj/contracts';
import { percentileRank, clamp, safeDiv } from './math.js';
import { selectionWeights } from './profiles.js';
import { assessMarketQuality } from './marketQuality.js';

export interface SelectionContext {
  snapshots: MarketSymbolSnapshot[];
  positions: Set<string>;
  pendingEntries: Set<string>;
  settings: SystemSettings;
  generation: number;
  now?: number;
  makerFillQuality?: Record<string,number|undefined>;
}

function spreadBps(s:MarketSymbolSnapshot){ return safeDiv(s.quote.ask-s.quote.bid,(s.quote.ask+s.quote.bid)/2,0)*10000; }
function activityRaw(s:MarketSymbolSnapshot){ const t=s.technical['15m']; return Math.log10(1+s.quote.tradeCount24h) + Math.max(0,t.volumeZScore)*0.9 + t.atrPercent*4; }
/** Derivatives are contextual ranking evidence. Stale/missing derivatives degrade to neutral instead of being treated as current facts. */
function capitalRaw(s:MarketSymbolSnapshot,now:number){ const d=s.derivatives;if(!Number.isFinite(d.ts)||now-d.ts>305_000)return 0; return Math.abs(d.openInterestChange15m??0)*220 + Math.abs((d.takerBuySellRatio5m??1)-1)*50 + Math.abs(d.fundingRate??0)*12000; }
function technicalRaw(s:MarketSymbolSnapshot){ const t=s.technical['15m']; const structure=(t.higherHighs+t.higherLows+t.lowerHighs+t.lowerLows); return t.trendStrength*50 + Math.abs(t.macdHistogramSlope)*safeDiv(100,t.lastPrice,0) + Math.abs(t.bbPosition-0.5)*20 + Math.min(15,structure); }
function reachabilityRaw(s:MarketSymbolSnapshot){ const sp=spreadBps(s); const t1=s.technical['1m']; const t5=s.technical['5m']; return clamp(100 - sp*2.2 + Math.min(25,t1.atrPercent*60+t5.atrPercent*25),0,100); }
function freshnessReasons(s:MarketSymbolSnapshot,now:number){const reasons:string[]=[];if(now-s.quote.ts>15_000)reasons.push('QUOTE_STALE');if(now-s.orderBook.ts>15_000)reasons.push('ORDER_BOOK_STALE');if(now-s.technical['1m'].asOf>125_000)reasons.push('TECHNICAL_1m_STALE');if(now-s.technical['5m'].asOf>605_000)reasons.push('TECHNICAL_5m_STALE');if(now-s.technical['15m'].asOf>1_805_000)reasons.push('TECHNICAL_15m_STALE');return reasons;}

export function selectUniverse(ctx:SelectionContext):UniverseCandidate[] {
  const now=ctx.now??Date.now(); const mode=ctx.settings.selection.mode; const allowed = new Set(ctx.settings.selection.customSymbols.map(x=>x.toUpperCase())); const excluded=new Set(ctx.settings.selection.excludeSymbols.map(x=>x.toUpperCase()));
  const quality=assessMarketQuality(ctx.snapshots,ctx.settings,ctx.makerFillQuality);
  const rows=ctx.snapshots.map(s=>({s, spread:spreadBps(s), liquidityRaw:Math.log10(1+s.quote.quoteVolumeUsd24h), activityRaw:activityRaw(s), capitalRaw:capitalRaw(s,now), technicalRaw:technicalRaw(s), reachRaw:reachabilityRaw(s)}));
  const liq=rows.map(x=>x.liquidityRaw), act=rows.map(x=>x.activityRaw), cap=rows.map(x=>x.capitalRaw), tech=rows.map(x=>x.technicalRaw), reach=rows.map(x=>x.reachRaw), data=rows.map(x=>x.s.dataCompleteness);
  const weights=selectionWeights(mode);
  const candidates: UniverseCandidate[]=rows.map(row=>{
    const s=row.s, reasons:string[]=[]; const sym=s.symbol.toUpperCase();
    const marketQuality=quality.get(sym)!;
    if(!testnetFundsOnlyEntry(ctx.settings)&&ctx.positions.has(sym)) reasons.push('ACTIVE_POSITION');
    if(!testnetFundsOnlyEntry(ctx.settings)&&ctx.pendingEntries.has(sym)) reasons.push('ACTIVE_ENTRY_ORDER');
    if(excluded.has(sym)) reasons.push('USER_EXCLUDED');
    if(mode==='CUSTOM_SYMBOLS'&&!allowed.has(sym)) reasons.push('NOT_IN_CUSTOM_SYMBOLS');
    if(s.quote.quoteVolumeUsd24h<ctx.settings.selection.minQuoteVolumeUsd24h) reasons.push('LOW_24H_QUOTE_VOLUME');
    if(row.spread>ctx.settings.selection.maxSpreadBps) reasons.push('SPREAD_TOO_WIDE');
    if(!marketQuality.admitted) reasons.push(`MARKET_QUALITY_${marketQuality.grade}`,...marketQuality.reasons);
    // Decimal completeness is assembled from several source signals; tolerate IEEE-754
    // representation error only, never a meaningful shortfall from the configured gate.
    if(s.dataCompleteness+1e-9<ctx.settings.selection.minDataCompleteness) reasons.push('DATA_INCOMPLETE');
    reasons.push(...freshnessReasons(s,now));
    const c:OpportunityComponents={
      liquidity:percentileRank(row.liquidityRaw,liq), tradingActivity:percentileRank(row.activityRaw,act), capitalActivity:percentileRank(row.capitalRaw,cap), technicalOpportunity:percentileRank(row.technicalRaw,tech), executionReachability:percentileRank(row.reachRaw,reach), dataQuality:percentileRank(s.dataCompleteness,data),
    };
    const score=c.liquidity*weights.liquidity+c.tradingActivity*weights.tradingActivity+c.capitalActivity*weights.capitalActivity+c.technicalOpportunity*weights.technicalOpportunity+c.executionReachability*weights.executionReachability+c.dataQuality*weights.dataQuality;
    return {symbol:s.symbol, rank:0, score:clamp(score,0,100), lifecycle:reasons.length?'DATA_BLOCKED':'AVAILABLE', eligible:reasons.length===0, exclusionReasons:reasons, components:c, quoteVolumeUsd24h:s.quote.quoteVolumeUsd24h, spreadBps:row.spread,lastPrice:s.quote.last,change24hPercent:s.quote.priceChangePercent24h,dataCompleteness:s.dataCompleteness,selectionGeneration:ctx.generation,updatedAt:now,marketQuality} satisfies UniverseCandidate;
  });
  const eligible=candidates.filter(x=>x.eligible).sort((a,b)=>b.score-a.score).slice(0,ctx.settings.selection.universeTopN);
  eligible.forEach((x,i)=>{x.rank=i+1; x.lifecycle='SHORTLIST';});
  const inTop=new Set(eligible.map(x=>x.symbol));
  const blocked=candidates.filter(x=>!inTop.has(x.symbol)); blocked.sort((a,b)=>b.score-a.score);
  return [...eligible,...blocked];
}
