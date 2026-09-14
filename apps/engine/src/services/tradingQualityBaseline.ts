import type { PathWindow } from './tradingEpisodeEvidence.js';

type EpisodeLike={economicCompleteness:string;linkStatus:string;path:PathWindow[];repriceCount?:number|null;fillToIdealBps?:number|null;firstFillAt?:number|null;completeFillAt?:number|null;timeToPositive?:{priceMs:number|null;netMs:number|null;netStatus:string};tradeSource?:string|null};
type FunnelInput={candidates?:number|null;primaryRuns?:number|null;place?:number|null;wait?:number|null;reselect?:number|null;intents?:number|null;orders?:number|null;fills?:number|null;uniqueOpportunities?:number|null;uniqueSymbols?:number|null};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const percentile=(values:number[],p:number)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),index=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));return sorted[index]!;};
const stats=(values:number[])=>({count:values.length,median:percentile(values,.5),p75:percentile(values,.75),p90:percentile(values,.9),p95:percentile(values,.95)});

export function summarizeEntryQuality(episodes:EpisodeLike[]){
  const horizons=[30_000,60_000,180_000,300_000,900_000],filled=episodes.filter(ep=>finite(ep.firstFillAt));
  const byHorizon=Object.fromEntries(horizons.map(horizon=>{const rows=filled.map(ep=>ep.path.find(row=>row.horizonMs===horizon)).filter((row):row is PathWindow=>Boolean(row));return[String(horizon),{coverage:{eligibleEpisodes:filled.length,withWindow:rows.length,withPath:rows.filter(row=>row.sampleCount>0).length},maeBps:stats(rows.map(row=>row.maeBps).filter(finite)),mfeBps:stats(rows.map(row=>row.mfeBps).filter(finite))}];}));
  const fillToIdeal=episodes.map(ep=>ep.fillToIdealBps).filter(finite),reprices=episodes.map(ep=>ep.repriceCount).filter(finite),pricePositive=episodes.map(ep=>ep.timeToPositive?.priceMs).filter(finite),netPositive=episodes.map(ep=>ep.timeToPositive?.netMs).filter(finite),completeness=episodes.reduce<Record<string,number>>((acc,ep)=>(acc[ep.economicCompleteness]=(acc[ep.economicCompleteness]??0)+1,acc),{}),links=episodes.reduce<Record<string,number>>((acc,ep)=>(acc[ep.linkStatus]=(acc[ep.linkStatus]??0)+1,acc),{}),sources=episodes.reduce<Record<string,number>>((acc,ep)=>(acc[ep.tradeSource??'NONE']=(acc[ep.tradeSource??'NONE']??0)+1,acc),{});
  return{episodeCount:episodes.length,filledEpisodeCount:filled.length,completeness,links,sources,byHorizon,fillToIdealBps:stats(fillToIdeal),repriceCount:stats(reprices),timeToPositivePriceMs:stats(pricePositive),timeToPositiveNetMs:stats(netPositive),costIncompleteCount:episodes.filter(ep=>ep.timeToPositive?.netStatus==='COST_INCOMPLETE').length};
}

export function candidateFunnel(input:FunnelInput){
  const value=(v:unknown)=>finite(v)?v:null,row={candidates:value(input.candidates),primaryRuns:value(input.primaryRuns),place:value(input.place),wait:value(input.wait),reselect:value(input.reselect),intents:value(input.intents),orders:value(input.orders),fills:value(input.fills),uniqueOpportunities:value(input.uniqueOpportunities),uniqueSymbols:value(input.uniqueSymbols)},ratio=(a:number|null,b:number|null)=>a!==null&&b!==null&&b>0?a/b:null;
  return{...row,candidateToPrimary:ratio(row.primaryRuns,row.candidates),placeToIntent:ratio(row.intents,row.place),intentToOrder:ratio(row.orders,row.intents),orderToFill:ratio(row.fills,row.orders)};
}

export function stage1BaselineGate(input:{episodeCount:number;hasShortPathMarks:boolean;candidateSupplyAvailable:boolean}){
  const blockers:string[]=[];if(input.episodeCount<=0)blockers.push('NO_EXACT_EPISODES');if(!input.hasShortPathMarks)blockers.push('SHORT_PATH_MARKS_UNAVAILABLE');if(!input.candidateSupplyAvailable)blockers.push('ALL_CANDIDATE_SUPPLY_UNAVAILABLE');
  return{status:blockers.length?'INCONCLUSIVE' as const:'BASELINE_READY' as const,blockers};
}
