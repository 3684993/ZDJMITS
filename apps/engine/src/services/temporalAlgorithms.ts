import { createHash } from 'node:crypto';

export type RegimeState='EARLY_UPTREND'|'MATURE_UPTREND'|'EARLY_DOWNTREND'|'MATURE_DOWNTREND'|'RANGE'|'TRANSITION'|'INSUFFICIENT_DATA';
export type CompactFeature={
  trend15m:string|null;trend4h:string|null;trend1d:string|null;emaDistanceAtr:number|null;
  atrPercent:number|null;bbPercentile:number|null;macdAcceleration:number|null;locationScore:number|null;
  spreadBps:number|null;volume24h:number|null;riskTier:string;liquidityClass:string;btcEthAlignment:string;
  multiTfConflict:number|null;mark:number|null;bar15m:number|null;evidenceCompleteness:number|null;
};

const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
export function underlyingOf(symbol:string){return symbol.replace(/(USDT|USDC|BUSD|FDUSD)$/,'')||symbol;}
export function quoteOf(symbol:string){return symbol.match(/(USDT|USDC|BUSD|FDUSD)$/)?.[1]??'UNKNOWN';}
export function liquidityClass(volume:number|null){if(volume===null)return'UNKNOWN';if(volume>=1_000_000_000)return'MEGA';if(volume>=100_000_000)return'HIGH';if(volume>=20_000_000)return'MEDIUM';return'LOW';}
export function extractEvidence(inputPreview:unknown):any|null{
  if(typeof inputPreview!=='string')return null;
  try{
    const outer=JSON.parse(inputPreview),prompt=String(outer?.prompt??'');
    if(outer?.packet&&typeof outer.packet==='object')return outer.packet;
    for(const marker of ['EVIDENCE:\n','EIP:\n']){const at=prompt.lastIndexOf(marker);if(at>=0){const raw=prompt.slice(at+marker.length).trim().replace(/\n(?:Return|OUTPUT)[\s\S]*$/,'');try{return JSON.parse(raw);}catch{}}}
  }catch{}
  return null;
}
export function compactFeature(e:any):CompactFeature{
  const technical=e?.market?.technical??e?.technical??{},t15=technical?.['15m']??{},t4=technical?.['4h']??{},t1=technical?.['1d']??{},mark=finite(e?.market?.quote?.mark??e?.quote?.mark??t15?.lastPrice),atr=finite(t15?.atr14),ema21=finite(t15?.ema21),upper=finite(t15?.bbUpper),lower=finite(t15?.bbLower);
  const trends=[t15?.trend,t4?.trend,t1?.trend].filter(Boolean),majority=trends.filter((x:string)=>x==='UP').length>=2?'UP':trends.filter((x:string)=>x==='DOWN').length>=2?'DOWN':'MIXED';
  const conflict=trends.length?trends.filter((x:string)=>x!==trends[0]).length/trends.length:null,volume=finite(e?.market?.quote?.quoteVolumeUsd24h??e?.quote?.quoteVolumeUsd24h),selection=e?.selection??{};
  return{trend15m:t15?.trend??null,trend4h:t4?.trend??null,trend1d:t1?.trend??null,emaDistanceAtr:mark!==null&&ema21!==null&&atr?((mark-ema21)/atr):null,atrPercent:finite(t15?.atrPercent),bbPercentile:mark!==null&&upper!==null&&lower!==null&&upper>lower?clamp((mark-lower)/(upper-lower)):null,macdAcceleration:finite(t15?.macdHistogram),locationScore:finite(e?.portfolioIntelligence?.locationScore??selection?.components?.technicalOpportunity??selection?.score),spreadBps:finite(e?.microstructure?.spreadBps),volume24h:volume,riskTier:String(e?.portfolioIntelligence?.riskTier??selection?.riskTier??e?.riskTier??'UNKNOWN'),liquidityClass:liquidityClass(volume),btcEthAlignment:String(e?.globalRegime?.regime??majority),multiTfConflict:conflict,mark,bar15m:mark===null?null:Math.floor(Number(e?.createdAt??Date.now())/900_000),evidenceCompleteness:finite(e?.evidenceCompleteness)};
}
export function breadth(features:CompactFeature[]){const valid=features.filter(x=>['UP','DOWN','RANGE','UNCERTAIN'].includes(String(x.trend15m)));const n=valid.length,up=valid.filter(x=>x.trend15m==='UP').length,down=valid.filter(x=>x.trend15m==='DOWN').length;return{eligibleCount:n,bullish:n?up/n:null,bearish:n?down/n:null,neutral:n?(n-up-down)/n:null};}
export function classifyRegime(input:{bullish:number|null;bearish:number|null;slope:number;ageBars:number;transition:number}):RegimeState{
  if(input.bullish===null||input.bearish===null)return'INSUFFICIENT_DATA';
  if(input.transition>=65)return'TRANSITION';
  if(input.bullish>=.58)return input.ageBars>=4?'MATURE_UPTREND':'EARLY_UPTREND';
  if(input.bearish>=.58)return input.ageBars>=4?'MATURE_DOWNTREND':'EARLY_DOWNTREND';
  return'RANGE';
}
export function transitionCandidates(x:{dominant:number;slope:number;acceleration:number;ageBars:number;alignmentConflict:number;extension:number;outcomeDecay:number;multiTfConflict:number}){
  const decay=clamp((-Math.sign(x.dominant-.5)*x.slope)*6),accel=clamp(Math.abs(Math.min(0,x.acceleration))*8),age=clamp(x.ageBars/24),extension=clamp(Math.abs(x.extension)/4),outcome=clamp(x.outcomeDecay),conflict=clamp(x.multiTfConflict),alignment=clamp(x.alignmentConflict);
  return{
    v1:100*clamp(.55*decay+.25*accel+.20*alignment),
    v2:100*clamp(.35*decay+.15*accel+.15*alignment+.15*age+.20*extension),
    v3:100*clamp(.25*decay+.10*accel+.15*alignment+.10*age+.15*extension+.15*outcome+.10*conflict),
  };
}
export function stateFingerprint(symbol:string,feature:CompactFeature,regime:RegimeState,transitionScore:number,portfolioState='FROZEN'){
  const material={symbol,bar15m:feature.bar15m,regime,transitionBucket:Math.floor(transitionScore/20),locationBucket:feature.locationScore===null?'UNKNOWN':Math.floor(feature.locationScore/10),atrMoveBucket:feature.emaDistanceAtr===null?'UNKNOWN':Math.round(feature.emaDistanceAtr*2)/2,btcEth:feature.btcEthAlignment,liquidity:feature.liquidityClass,evidence:feature.evidenceCompleteness===null?'UNKNOWN':Math.floor(feature.evidenceCompleteness*10),portfolioState};
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0,24);
}
export function analogDistance(a:CompactFeature,b:CompactFeature){
  if(a.riskTier!=='UNKNOWN'&&b.riskTier!=='UNKNOWN'&&a.riskTier!==b.riskTier)return Infinity;
  if(a.liquidityClass!=='UNKNOWN'&&b.liquidityClass!=='UNKNOWN'&&a.liquidityClass!==b.liquidityClass)return Infinity;
  const parts:Array<[number|null,number|null,number]>= [[a.emaDistanceAtr,b.emaDistanceAtr,.25],[a.atrPercent,b.atrPercent,.2],[a.bbPercentile,b.bbPercentile,.15],[a.locationScore===null?null:a.locationScore/100,b.locationScore===null?null:b.locationScore/100,.15],[a.multiTfConflict,b.multiTfConflict,.15],[a.spreadBps===null?null:a.spreadBps/20,b.spreadBps===null?null:b.spreadBps/20,.1]];
  let weighted=0,total=0;for(const[x,y,w]of parts)if(x!==null&&y!==null){weighted+=Math.min(4,Math.abs(x-y))*w;total+=w;}if(!total)return Infinity;
  if(a.trend15m!==b.trend15m)weighted+=.25;
  return weighted/total;
}
export function similarityDistribution(distances:number[]){
  const similarities=distances.filter(Number.isFinite).map(distance=>1/(1+distance)).sort((a,b)=>a-b);
  if(!similarities.length)return{min:null,median:null,max:null};
  return{min:similarities[0],median:similarities[Math.floor(similarities.length/2)],max:similarities.at(-1)!};
}
export function validateCutoff(queryAt:number,analogAt:number,outcomeAt:number|null){return analogAt<queryAt&&(outcomeAt===null||outcomeAt<=queryAt);}
