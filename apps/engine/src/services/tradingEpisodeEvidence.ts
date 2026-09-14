import type { ExecutionFill, TradeRecord, TradingQualityFundingEvidence } from '@zdj/contracts';
import { canonicalPnlEligible, ledgerClosedComplete } from './tradingQualityEligibility.js';

export type PathMark={ts:number;mark:number;bid?:number|null;ask?:number|null};
export type EpisodeCompleteness='COMPLETE_WITH_FUNDING'|'COMPLETE_EX_FUNDING'|'PARTIAL'|'OPEN'|'UNKNOWN_ATTRIBUTION';
export type AdverseFirst='ADVERSE_FIRST'|'FAVORABLE_FIRST'|'NEITHER'|'AMBIGUOUS'|'DATA_UNAVAILABLE';
export type PathWindow={horizonMs:number;sampleCount:number;maeBps:number|null;mfeBps:number|null;lastSignedBps:number|null;coverage?:'COMPLETE'|'SPARSE'|'IMMATURE';maxGapMs?:number;observedThrough?:number|null};
type EpisodeOrder={id:string;intentId:string;symbol:string;exchangeOrderId?:string|null;repriceCount?:number;quantity?:number;filledQuantity?:number;status?:string};

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const sideSign=(side:'LONG'|'SHORT')=>side==='LONG'?1:-1;
const bps=(from:number,to:number,side:'LONG'|'SHORT')=>sideSign(side)*(to/from-1)*10_000;

export function dedupeExecutionFills(fills:ExecutionFill[]):ExecutionFill[]{
  const seen=new Map<string,ExecutionFill>(),conflicts=new Set<string>();
  for(const fill of fills){
    if(!fill.symbol||!fill.orderId||!fill.tradeId||!finite(fill.executionTime)||!finite(fill.qty)||fill.qty<=0||!finite(fill.price)||fill.price<=0)continue;
    const key=`${fill.symbol}|${fill.tradeId}`,prior=seen.get(key);
    if(prior&&(['orderId','executionTime','qty','price','direction','side'] as const).some(k=>prior[k]!==fill[k]))conflicts.add(key);
    if(!prior||prior.commissionUsd===null&&fill.commissionUsd!==null)seen.set(key,fill);
  }
  return [...seen].filter(([key])=>!conflicts.has(key)).map(([,f])=>f).sort((a,b)=>a.executionTime-b.executionTime||a.tradeId.localeCompare(b.tradeId));
}

export function fillVwap(fills:ExecutionFill[]):number|null{
  const rows=dedupeExecutionFills(fills),qty=rows.reduce((n,row)=>n+row.qty,0);
  return qty>0?rows.reduce((n,row)=>n+row.qty*row.price,0)/qty:null;
}
export function firstFillVwap(fills:ExecutionFill[]):number|null{
  const rows=dedupeExecutionFills(fills);if(!rows.length)return null;const firstAt=rows[0]!.executionTime,firstRows=rows.filter(row=>row.executionTime===firstAt),qty=firstRows.reduce((n,row)=>n+row.qty,0);
  return qty>0?firstRows.reduce((n,row)=>n+row.qty*row.price,0)/qty:null;
}

export function fillAnchoredPath(input:{side:'LONG'|'SHORT';fillPrice:number;fillAt:number;marks:PathMark[];horizonsMs?:number[];now?:number;maxGapMs?:number}):PathWindow[]{
  const horizons=input.horizonsMs??[30_000,60_000,180_000,300_000,900_000];
  const marks=input.marks.filter(row=>finite(row.ts)&&finite(row.mark)&&row.mark>0&&row.ts>=input.fillAt).sort((a,b)=>a.ts-b.ts);
  const now=input.now??Date.now(),allowedGap=input.maxGapMs??5000;
  return horizons.map(horizonMs=>{
    const end=input.fillAt+horizonMs,rows=marks.filter(row=>row.ts<=Math.min(end,now)),signed=rows.map(row=>bps(input.fillPrice,row.mark,input.side));
    let maxGapMs=rows.length?Math.max(rows[0]!.ts-input.fillAt,end-rows.at(-1)!.ts):horizonMs;
    for(let i=1;i<rows.length;i++)maxGapMs=Math.max(maxGapMs,rows[i]!.ts-rows[i-1]!.ts);
    const coverage=now<end?'IMMATURE':rows.length&&maxGapMs<=allowedGap?'COMPLETE':'SPARSE';
    return{horizonMs,sampleCount:rows.length,coverage,maxGapMs,observedThrough:rows.at(-1)?.ts??null,
      maeBps:coverage==='COMPLETE'?Math.max(0,-Math.min(...signed)):null,mfeBps:coverage==='COMPLETE'?Math.max(0,...signed):null,
      lastSignedBps:coverage==='COMPLETE'?signed.at(-1)!:null};
  });
}

export function timeToPositive(input:{side:'LONG'|'SHORT';fillPrice:number;fillAt:number;marks:PathMark[];costBps?:number|null;windowEndAt?:number|null;dataInterrupted?:boolean}){
  const rows=input.marks.filter(row=>row.ts>=input.fillAt&&finite(row.mark)&&row.mark>0).sort((a,b)=>a.ts-b.ts),price=rows.find(row=>bps(input.fillPrice,row.mark,input.side)>0),cost=finite(input.costBps)?Math.max(0,input.costBps):null,net=cost===null?null:rows.find(row=>bps(input.fillPrice,row.mark,input.side)>cost);
  const observedThrough=rows.at(-1)?.ts??null,windowMature=input.windowEndAt!=null&&observedThrough!=null&&observedThrough>=input.windowEndAt;
  return{priceMs:price?price.ts-input.fillAt:null,netMs:net?net.ts-input.fillAt:null,netStatus:cost===null?'COST_INCOMPLETE':net?'OBSERVED':input.dataInterrupted?'DATA_INTERRUPTED':windowMature?'RIGHT_CENSORED':'NOT_OBSERVED',observedThrough};
}

export function adverseFirst(input:{side:'LONG'|'SHORT';fillPrice:number;fillAt:number;marks:PathMark[];adverseBoundaryBps:number;favorableBoundaryBps:number}):AdverseFirst{
  const rows=input.marks.filter(row=>row.ts>=input.fillAt&&finite(row.mark)&&row.mark>0).sort((a,b)=>a.ts-b.ts);if(!rows.length)return'DATA_UNAVAILABLE';let adverseAt:number|null=null,favorableAt:number|null=null;
  for(const row of rows){const move=bps(input.fillPrice,row.mark,input.side);if(adverseAt===null&&move<=-Math.abs(input.adverseBoundaryBps))adverseAt=row.ts;if(favorableAt===null&&move>=Math.abs(input.favorableBoundaryBps))favorableAt=row.ts;}
  if(adverseAt===null&&favorableAt===null)return'NEITHER';if(adverseAt!==null&&favorableAt!==null&&adverseAt===favorableAt)return'AMBIGUOUS';if(adverseAt!==null&&(favorableAt===null||adverseAt<favorableAt))return'ADVERSE_FIRST';return'FAVORABLE_FIRST';
}

export function immediateNegativeAttribution(input:{side:'LONG'|'SHORT';fillPrice:number;quantity:number;mark:number|null;bid:number|null;ask:number|null;entryFeeUsd:number|null}){
  const notional=input.fillPrice*input.quantity,exitSide=input.side==='LONG'?input.bid:input.ask,fillToMarkBps=finite(input.mark)&&input.mark>0?bps(input.fillPrice,input.mark,input.side):null,markToExecutableBps=finite(input.mark)&&input.mark>0&&finite(exitSide)&&exitSide>0?sideSign(input.side)*(exitSide/input.mark-1)*10_000:null,entryFeeBps=finite(input.entryFeeUsd)&&notional>0?input.entryFeeUsd/notional*10_000:null,immediateExecutableBps=finite(exitSide)&&exitSide>0?bps(input.fillPrice,exitSide,input.side):null;
  return{fillToMarkBps,markToExecutableBps,entryFeeBps,immediateExecutableBps,attributionComplete:fillToMarkBps!==null&&markToExecutableBps!==null&&entryFeeBps!==null};
}

export function economicCompleteness(record:TradeRecord|undefined,fundingEvidence?:TradingQualityFundingEvidence|null):EpisodeCompleteness{
  if(!record)return'UNKNOWN_ATTRIBUTION';
  if(record.status==='OPEN'||record.status==='IMPORTED_OPEN_POSITION')return'OPEN';
  if(!ledgerClosedComplete(record).eligible)return'PARTIAL';
  return canonicalPnlEligible(record,{fundingEvidence}).eligible?'COMPLETE_WITH_FUNDING':'COMPLETE_EX_FUNDING';
}

export function buildEpisodeEvidence(input:{run:{id:string;symbol:string;decision?:string|null};intent?:{id:string;brainRunId:string;symbol:string;side?:string;idealPrice?:number|null;opportunityEvidence?:any};orders:EpisodeOrder[];fills:ExecutionFill[];tradeRecords:TradeRecord[];marks?:PathMark[];costBps?:number|null;now?:number;adverseBoundaryBps?:number;favorableBoundaryBps?:number;fundingEvidenceByCycle?:Record<string,TradingQualityFundingEvidence|undefined>}){
  const now=input.now??Date.now(),intent=input.intent?.brainRunId===input.run.id&&input.intent.symbol===input.run.symbol?input.intent:undefined;
  const orders=intent?input.orders.filter(o=>o.intentId===intent.id&&o.symbol===input.run.symbol):[];
  const exchangeIds=new Set(orders.map(o=>o.exchangeOrderId).filter(Boolean));
  const matched=input.fills.filter(f=>f.symbol===input.run.symbol&&exchangeIds.has(f.orderId));
  const fills=dedupeExecutionFills(matched.filter(f=>f.attributionStatus==='SYSTEM_ATTRIBUTED'&&(!intent?.side||f.direction===intent.side)&&f.side===(f.direction==='LONG'?'BUY':'SELL')));
  const first=fills[0],vwap=fillVwap(fills),firstVwap=firstFillVwap(fills);
  const records=intent?input.tradeRecords.filter(r=>r.symbol===input.run.symbol&&r.canonical!==false&&!r.duplicateOf&&r.source!=='EXTERNAL'&&((r.entryRunId===input.run.id&&r.entryIntentId===intent.id)||fills.some(f=>r.linkedFillIds.includes(f.fillId)||r.entryOrderIds.includes(f.orderId)))):[];
  const record=records.length===1?records[0]:undefined;
  const fundingEvidence=record?.cycleId?input.fundingEvidenceByCycle?.[record.cycleId]:undefined;
  const canonicalEligibility=record?canonicalPnlEligible(record,{fundingEvidence}):{eligible:false,reasons:['TRADE_RECORD_UNKNOWN']};
  const ledgerEligibility=record?ledgerClosedComplete(record):{eligible:false,reasons:['TRADE_RECORD_UNKNOWN']};
  const completion=orders.map(o=>{let qty=0;const rows=fills.filter(f=>f.orderId===o.exchangeOrderId);for(const f of rows){qty+=f.qty;if(o.status==='FILLED'&&finite(o.quantity)&&qty+1e-10>=o.quantity)return f.executionTime;}return null;});
  const completeFillAt=completion.length&&completion.every(finite)?Math.max(...completion as number[]):null;
  const marks=(input.marks??[]).filter(m=>m.ts<=now&&(first?m.ts<=first.executionTime+900000:true));
  const path=first&&firstVwap!==null?fillAnchoredPath({side:first.direction,fillPrice:firstVwap,fillAt:first.executionTime,marks,now}):[];
  const positive=first&&firstVwap!==null?timeToPositive({side:first.direction,fillPrice:firstVwap,fillAt:first.executionTime,marks,costBps:input.costBps??null,windowEndAt:first.executionTime+900_000}):{priceMs:null,netMs:null,netStatus:'COST_INCOMPLETE',observedThrough:null};
  const feesKnown=fills.length>0&&fills.every(f=>finite(f.commissionUsd)),entryFee=feesKnown?fills.reduce((s,f)=>s+f.commissionUsd!,0):null;
  const gross=record?.grossRealizedPnl??null,totalFee=record?.totalFee??null,funding=record?.funding??null;
  const derivedNetPnlDiagnostic=finite(gross)&&finite(totalFee)&&finite(funding)?gross-totalFee+funding:null;
  const authoritativeNetPnl=canonicalEligibility.eligible?record!.netPnl:null;
  const exitFills=record?dedupeExecutionFills(input.fills.filter(f=>f.symbol===record.symbol&&f.direction===record.direction&&record.exitOrderIds.includes(f.orderId)&&f.side===(record.direction==='LONG'?'SELL':'BUY'))):[];
  const windowComplete=path.find(p=>p.horizonMs===900000)?.coverage==='COMPLETE';
  const firstQuote=first?marks.find(m=>m.ts>=first.executionTime&&m.ts-first.executionTime<=5000):null,firstLots=first?fills.filter(f=>f.executionTime===first.executionTime):[],firstQty=firstLots.reduce((n,f)=>n+f.qty,0),firstFee=firstLots.length&&firstLots.every(f=>finite(f.commissionUsd))?firstLots.reduce((n,f)=>n+f.commissionUsd!,0):null;
  const immediate=first&&firstVwap!==null&&firstQuote?{...immediateNegativeAttribution({side:first.direction,fillPrice:firstVwap,quantity:firstQty,mark:firstQuote.mark,bid:firstQuote.bid??null,ask:firstQuote.ask??null,entryFeeUsd:firstFee}),observedAt:firstQuote.ts,samplingDelayMs:firstQuote.ts-first.executionTime}:null;
  return {schemaVersion:'TQ-EPISODE-3',runId:input.run.id,symbol:input.run.symbol,intentId:intent?.id??null,
    opportunityId:intent?.opportunityEvidence?.opportunityId??null,opportunityVersion:intent?.opportunityEvidence?.version??null,
    orderIds:orders.map(o=>o.id),exchangeOrderIds:[...exchangeIds],fillIds:fills.map(f=>f.fillId),unattributedFillCount:matched.length-fills.length,
    firstFillAt:first?.executionTime??null,completeFillAt,firstFillVwap:firstVwap,fillVwap:vwap,
    fillToIdealBps:first&&vwap!==null&&finite(intent?.idealPrice)&&intent.idealPrice>0?bps(intent.idealPrice,vwap,first.direction):null,
    repriceCount:orders.reduce((n,o)=>n+(o.repriceCount??0),0),tradeId:record?.tradeId??null,cycleId:record?.cycleId??null,
    tradeSource:record?.source??null,tradeStatus:record?.status??null,economicCompleteness:economicCompleteness(record,fundingEvidence),
    economicEligibility:{ledger:ledgerEligibility,canonical:canonicalEligibility},fees:{entry:entryFee,total:totalFee},funding,grossPnl:gross,
    netPnl:authoritativeNetPnl,derivedNetPnlDiagnostic,exitReason:record?.closeReason??null,
    exitExecutionAt:exitFills.length?Math.max(...exitFills.map(f=>f.executionTime)):null,reconciliationConfirmedAt:record?.closedAt??null,
    immediateNegativeAttribution:immediate,makerFillCount:fills.filter(f=>f.maker===true).length,
    timeToPositive:{...positive,coverage:windowComplete?'COMPLETE':'INCOMPLETE',observedThrough:marks.at(-1)?.ts??null},path,
    adverseFirst:windowComplete&&first&&firstVwap!==null?adverseFirst({side:first.direction,fillPrice:firstVwap,fillAt:first.executionTime,marks,adverseBoundaryBps:input.adverseBoundaryBps??10,favorableBoundaryBps:input.favorableBoundaryBps??10}):'DATA_UNAVAILABLE',
    eventAgeAtFill:first&&intent?.opportunityEvidence?.timingEvent?.time!=null?first.executionTime-intent.opportunityEvidence.timingEvent.time:null,
    observedThrough:marks.at(-1)?.ts??null,computedAt:now,
    linkStatus:!intent?'INTENT_UNKNOWN':!orders.length?'ORDER_UNKNOWN':!fills.length?'NO_FILL':records.length>1?'TRADE_RECORD_CONFLICT':record?'LINKED':'TRADE_RECORD_UNKNOWN'};
}
