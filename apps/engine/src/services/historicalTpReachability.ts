import type { Candle } from '@zdj/contracts';

export type ReachabilityTimeframe='1m'|'5m'|'15m';
export type ReachabilityStatus='READY'|'INSUFFICIENT_DATA'|'STALE';
export type ReachabilitySide='LONG'|'SHORT';

export interface ReachabilitySideSummary {
  hardMaxMovePercent:number;
  p50:number;
  p75:number;
  p90:number;
}
export interface ReachabilityHorizonSummary {
  horizonMinutes:number;
  timeframe:ReachabilityTimeframe;
  sampleCount:number;
  status:ReachabilityStatus;
  LONG:ReachabilitySideSummary;
  SHORT:ReachabilitySideSummary;
}
export interface HistoricalTpReachabilityEnvelope {
  version:'V3.9.5';
  source:'CLOSED_CANDLE_CACHE';
  generatedAt:number;
  horizons:ReachabilityHorizonSummary[];
}
export interface TargetReachability {
  horizonMinutes:number;
  timeframe:ReachabilityTimeframe;
  sampleCount:number;
  status:ReachabilityStatus;
  hardMaxMovePercent:number|null;
  reachProbability:number|null;
  targetMovePercent:number;
}

const timeframeMinutes:Record<ReachabilityTimeframe,number>={'1m':1,'5m':5,'15m':15};
const maxAgeMs:Record<ReachabilityTimeframe,number>={'1m':125_000,'5m':605_000,'15m':1_805_000};
export const STANDARD_TP_HORIZONS=[5,15,30,60,120,240,480,720,1440] as const;

export function reachabilityTimeframe(horizonMinutes:number):ReachabilityTimeframe{
  if(horizonMinutes<=15)return'1m';
  if(horizonMinutes<=120)return'5m';
  return'15m';
}
const zero=():ReachabilitySideSummary=>({hardMaxMovePercent:0,p50:0,p75:0,p90:0});
const percentile=(sorted:number[],p:number)=>{
  if(!sorted.length)return 0;
  const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);
  if(lo===hi)return sorted[lo]!;
  return sorted[lo]!+(sorted[hi]!-sorted[lo]!)*(index-lo);
};
const sideSummary=(values:number[]):ReachabilitySideSummary=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return{hardMaxMovePercent:sorted.at(-1)??0,p50:percentile(sorted,.5),p75:percentile(sorted,.75),p90:percentile(sorted,.9)};
};
const closedRows=(rows:Candle[],now:number)=>rows.filter(row=>row.isClosed!==false&&row.closeTime<=now&&Number.isFinite(row.close)&&row.close>0).sort((a,b)=>a.openTime-b.openTime);

export function summarizeReachability(input:{
  rows:Candle[];
  horizonMinutes:number;
  lookbackBars:number;
  minSamples:number;
  now?:number;
}):ReachabilityHorizonSummary{
  const now=input.now??Date.now(),timeframe=reachabilityTimeframe(input.horizonMinutes),minutes=timeframeMinutes[timeframe],
    steps=Math.max(1,Math.ceil(input.horizonMinutes/minutes)),rows=closedRows(input.rows,now),last=rows.at(-1);
  if(!last||now-last.closeTime>maxAgeMs[timeframe]){
    return{horizonMinutes:input.horizonMinutes,timeframe,sampleCount:0,status:'STALE',LONG:zero(),SHORT:zero()};
  }
  const eligible=Math.max(0,rows.length-steps),first=Math.max(0,eligible-Math.max(1,input.lookbackBars)),long:number[]=[],short:number[]=[];
  for(let i=first;i<eligible;i++){
    const anchor=rows[i]!.close;
    let high=anchor,low=anchor;
    for(let j=i+1;j<=i+steps&&j<rows.length;j++){high=Math.max(high,rows[j]!.high);low=Math.min(low,rows[j]!.low);}
    long.push(Math.max(0,(high/anchor-1)*100));
    short.push(Math.max(0,(1-low/anchor)*100));
  }
  const sampleCount=long.length,status:ReachabilityStatus=sampleCount>=input.minSamples?'READY':'INSUFFICIENT_DATA';
  return{horizonMinutes:input.horizonMinutes,timeframe,sampleCount,status,LONG:sideSummary(long),SHORT:sideSummary(short)};
}

export function buildHistoricalTpReachability(input:{
  candles:(timeframe:ReachabilityTimeframe,limit:number)=>Candle[];
  lookbackBars:number;
  minSamples:number;
  horizons?:readonly number[];
  now?:number;
}):HistoricalTpReachabilityEnvelope{
  const now=input.now??Date.now(),horizons=input.horizons??STANDARD_TP_HORIZONS;
  return{version:'V3.9.5',source:'CLOSED_CANDLE_CACHE',generatedAt:now,horizons:horizons.map(h=>{
    const tf=reachabilityTimeframe(h);
    return summarizeReachability({rows:input.candles(tf,300),horizonMinutes:h,lookbackBars:input.lookbackBars,minSamples:input.minSamples,now});
  })};
}

export function evaluateTargetReachability(input:{
  rows:Candle[];
  side:ReachabilitySide;
  horizonMinutes:number;
  targetMovePercent:number;
  lookbackBars:number;
  minSamples:number;
  now?:number;
}):TargetReachability{
  const summary=summarizeReachability({rows:input.rows,horizonMinutes:input.horizonMinutes,lookbackBars:input.lookbackBars,minSamples:input.minSamples,now:input.now});
  if(summary.status!=='READY')return{horizonMinutes:input.horizonMinutes,timeframe:summary.timeframe,sampleCount:summary.sampleCount,status:summary.status,hardMaxMovePercent:null,reachProbability:null,targetMovePercent:input.targetMovePercent};
  const now=input.now??Date.now(),minutes=timeframeMinutes[summary.timeframe],steps=Math.max(1,Math.ceil(input.horizonMinutes/minutes)),rows=closedRows(input.rows,now),
    eligible=Math.max(0,rows.length-steps),first=Math.max(0,eligible-Math.max(1,input.lookbackBars)),values:number[]=[];
  for(let i=first;i<eligible;i++){
    const anchor=rows[i]!.close;let extreme=anchor;
    for(let j=i+1;j<=i+steps&&j<rows.length;j++)extreme=input.side==='LONG'?Math.max(extreme,rows[j]!.high):Math.min(extreme,rows[j]!.low);
    values.push(input.side==='LONG'?Math.max(0,(extreme/anchor-1)*100):Math.max(0,(1-extreme/anchor)*100));
  }
  const hard=summary[input.side].hardMaxMovePercent,probability=values.length?values.filter(v=>v+1e-12>=input.targetMovePercent).length/values.length:null;
  return{horizonMinutes:input.horizonMinutes,timeframe:summary.timeframe,sampleCount:summary.sampleCount,status:summary.status,hardMaxMovePercent:hard,reachProbability:probability,targetMovePercent:input.targetMovePercent};
}
