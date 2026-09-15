import type {MarketSymbolSnapshot,SystemSettings} from '@zdj/contracts';
import {createHash} from 'node:crypto';

const bucket=(value:number|undefined,width:number)=>Math.floor(Number(value??0)/width);

/** Only facts that can change a Primary decision belong in this key. */
export function decisionContextKey(input:{market:MarketSymbolSnapshot;settingsContext:string;longExecutable?:boolean;shortExecutable?:boolean;confirmation?:unknown;}){
  const {market}=input;
  return JSON.stringify({
    bar15:bucket(market.technical['15m'].asOf,15*60_000),bar5:bucket(market.technical['5m'].asOf,5*60_000),
    trend15:market.technical['15m'].trend,trend5:market.technical['5m'].trend,
    priceAtrBucket:Math.round((market.quote.last-market.technical['15m'].ema21)/Math.max(market.technical['15m'].atr14,Number.EPSILON)*4),
    settingsContext:input.settingsContext,longExecutable:Boolean(input.longExecutable),shortExecutable:Boolean(input.shortExecutable),confirmation:input.confirmation??null,
  });
}

export function decisionSettingsContext(settings:SystemSettings){
  const relevant={selection:{minQuoteVolumeUsd24h:settings.selection.minQuoteVolumeUsd24h,maxSpreadBps:settings.selection.maxSpreadBps,minDataCompleteness:settings.selection.minDataCompleteness,assetDirectory:{version:settings.selection.assetDirectory.version,evidenceHash:settings.selection.assetDirectory.evidenceHash},marketQuality:settings.selection.marketQuality},entryProfile:settings.entryProfile,directionReference:settings.directionReference,leverage:settings.leverage,portfolio:settings.portfolio,portfolioIntelligence:settings.portfolioIntelligence,riskGovernance:settings.riskGovernance,entry:settings.entry,takeProfit:settings.takeProfit,ai:settings.ai,executionMode:settings.connections.executionMode};
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

export function nextClosedFiveMinute(now=Date.now()){return(Math.floor(now/(5*60_000))+1)*(5*60_000)+1;}
export function decisionContextPermissions(key:string|undefined){try{const parsed=JSON.parse(key??'{}');return{longExecutable:Boolean(parsed.longExecutable),shortExecutable:Boolean(parsed.shortExecutable)};}catch{return{longExecutable:false,shortExecutable:false};}}

/** Stable NO_EDGE review facts. Bar timestamps are intentionally excluded. */
export function noEdgeReviewFacts(input:{market:MarketSymbolSnapshot;longExecutable:boolean;shortExecutable:boolean}){
  const m=input.market,t15=m.technical['15m'],t5=m.technical['5m'],t1=m.technical['1m'],atr=Math.max(t15.atr14,Number.EPSILON),px=m.quote.last;
  return {structureDirection:t15.trend==='UP'?'LONG':t15.trend==='DOWN'?'SHORT':null,trend15:t15.trend,trend5:t5.trend,trend1:t1.trend,
    priceAtrBucket:Math.round((px-t15.ema21)/atr*4),longSpaceBps:t15.recentSwingHigh>px?Math.round((t15.recentSwingHigh/px-1)*10_000):0,shortSpaceBps:t15.recentSwingLow>0&&t15.recentSwingLow<px?Math.round((1-t15.recentSwingLow/px)*10_000):0,
    longExecutable:input.longExecutable,shortExecutable:input.shortExecutable,completedEvent:{bar1:t1.lastClosedBar?.closeTime??null,bar5:t5.lastClosedBar?.closeTime??null}};
}
export function noEdgeReleaseReason(previous:any,next:any,now=Date.now()){
  if(!previous)return 'FIRST_REVIEW'; if(previous.expiresAt&&now>=previous.expiresAt)return 'NO_EDGE_TTL_EXPIRED';
  const a=previous.facts??previous,b=next;
  if(a.longExecutable!==b.longExecutable||a.shortExecutable!==b.shortExecutable)return 'PERMISSION_CHANGED';
  if(a.structureDirection!==b.structureDirection||a.trend15!==b.trend15)return 'STRUCTURE_15M_CHANGED';
  if(a.longSpaceBps!==b.longSpaceBps||a.shortSpaceBps!==b.shortSpaceBps||a.priceAtrBucket!==b.priceAtrBucket)return 'PRICE_OR_SPACE_THRESHOLD_CHANGED';
  if(a.completedEvent?.bar1!==b.completedEvent?.bar1&&previous.releaseCondition?.includes('EVENT'))return 'TIMING_EVENT_COMPLETED';
  return null;
}
