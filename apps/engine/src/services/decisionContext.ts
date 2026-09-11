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
