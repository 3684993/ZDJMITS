import type { ExecutionFill, TradeRecord } from '@zdj/contracts';

export type PathMark={ts:number;mark:number;bid?:number|null;ask?:number|null};
export type EpisodeCompleteness='COMPLETE_WITH_FUNDING'|'COMPLETE_EX_FUNDING'|'PARTIAL'|'OPEN'|'UNKNOWN_ATTRIBUTION';
export type AdverseFirst='ADVERSE_FIRST'|'FAVORABLE_FIRST'|'NEITHER'|'AMBIGUOUS'|'DATA_UNAVAILABLE';
export type PathWindow={horizonMs:number;sampleCount:number;maeBps:number|null;mfeBps:number|null;lastSignedBps:number|null};
type EpisodeOrder={id:string;intentId:string;symbol:string;exchangeOrderId?:string|null;repriceCount?:number;quantity?:number;filledQuantity?:number;status?:string};

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const sideSign=(side:'LONG'|'SHORT')=>side==='LONG'?1:-1;
const bps=(from:number,to:number,side:'LONG'|'SHORT')=>sideSign(side)*(to/from-1)*10_000;

export function dedupeExecutionFills(fills:ExecutionFill[]):ExecutionFill[]{
  const seen=new Set<string>();
  return [...fills].filter(fill=>{const key=`${fill.symbol}|${fill.orderId}|${fill.tradeId}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.executionTime-b.executionTime||a.tradeId.localeCompare(b.tradeId));
}

export function fillVwap(fills:ExecutionFill[]):number|null{
  const rows=dedupeExecutionFills(fills),qty=rows.reduce((n,row)=>n+row.qty,0);
  return qty>0?rows.reduce((n,row)=>n+row.qty*row.price,0)/qty:null;
}

export function firstFillVwap(fills:ExecutionFill[]):number|null{
  const rows=dedupeExecutionFills(fills);if(!rows.length)return null;const firstAt=rows[0]!.executionTime,firstRows=rows.filter(row=>row.executionTime===firstAt),qty=firstRows.reduce((n,row)=>n+row.qty,0);
  return qty>0?firstRows.reduce((n,row)=>n+row.qty*row.price,0)/qty:null;
}

export function fillAnchoredPath(input:{side:'LONG'|'SHORT';fillPrice:number;fillAt:number;marks:PathMark[];horizonsMs?:number[]}):PathWindow[]{
  const horizons=input.horizonsMs??[30_000,60_000,180_000,300_000,900_000];
  const marks=input.marks.filter(row=>finite(row.ts)&&finite(row.mark)&&row.mark>0&&row.ts>=input.fillAt).sort((a,b)=>a.ts-b.ts);
  return horizons.map(horizonMs=>{const rows=marks.filter(row=>row.ts<=input.fillAt+horizonMs),signed=rows.map(row=>bps(input.fillPrice,row.mark,input.side));return{horizonMs,sampleCount:rows.length,maeBps:signed.length?Math.max(0,-Math.min(...signed)):null,mfeBps:signed.length?Math.max(0,Math.max(...signed)):null,lastSignedBps:signed.length?signed[signed.length-1]!:null};});
}

export function timeToPositive(input:{side:'LONG'|'SHORT';fillPrice:number;fillAt:number;marks:PathMark[];costBps?:number|null}){
  const rows=input.marks.filter(row=>row.ts>=input.fillAt&&finite(row.mark)&&row.mark>0).sort((a,b)=>a.ts-b.ts),price=rows.find(row=>bps(input.fillPrice,row.mark,input.side)>0),cost=finite(input.costBps)?Math.max(0,input.costBps):null,net=cost===null?null:rows.find(row=>bps(input.fillPrice,row.mark,input.side)>cost);
  return{priceMs:price?price.ts-input.fillAt:null,netMs:net?net.ts-input.fillAt:null,netStatus:cost===null?'COST_INCOMPLETE':net?'OBSERVED':'NOT_OBSERVED'};
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

export function economicCompleteness(record:TradeRecord|undefined):EpisodeCompleteness{
  if(!record)return'UNKNOWN_ATTRIBUTION';if(record.status==='OPEN'||record.status==='IMPORTED_OPEN_POSITION')return'OPEN';if(record.status!=='CLOSED'||record.recordCompleteness!=='COMPLETE'||record.classification!=='COMPLETE'||record.feeCompleteness!=='COMPLETE')return'PARTIAL';return record.funding===null?'COMPLETE_EX_FUNDING':'COMPLETE_WITH_FUNDING';
}

export function buildEpisodeEvidence(input:{run:{id:string;symbol:string;decision?:string|null};intent?:{id:string;brainRunId:string;symbol:string;idealPrice?:number|null};orders:EpisodeOrder[];fills:ExecutionFill[];tradeRecords:TradeRecord[];marks?:PathMark[];costBps?:number|null}){
  const intent=input.intent&&input.intent.brainRunId===input.run.id&&input.intent.symbol===input.run.symbol?input.intent:undefined,orders=intent?input.orders.filter(row=>row.intentId===intent.id&&row.symbol===input.run.symbol):[],exchangeIds=new Set(orders.map(row=>row.exchangeOrderId).filter((v):v is string=>Boolean(v))),fills=dedupeExecutionFills(input.fills.filter(row=>row.symbol===input.run.symbol&&exchangeIds.has(row.orderId)&&row.attributionStatus==='SYSTEM_ATTRIBUTED'));
  const first=fills[0],last=fills[fills.length-1],vwap=fillVwap(fills),firstVwap=firstFillVwap(fills),record=intent?input.tradeRecords.find(row=>row.entryRunId===input.run.id&&row.entryIntentId===intent.id&&row.symbol===input.run.symbol&&row.canonical!==false):undefined,filledExchangeIds=new Set(orders.filter(row=>row.status==='FILLED').map(row=>row.exchangeOrderId).filter((v):v is string=>Boolean(v))),completeFills=fills.filter(row=>filledExchangeIds.has(row.orderId)),completeFillAt=completeFills.length?Math.max(...completeFills.map(row=>row.executionTime)):null,path=first&&firstVwap!==null?fillAnchoredPath({side:first.direction,fillPrice:firstVwap,fillAt:first.executionTime,marks:input.marks??[]}):[],positive=first&&firstVwap!==null?timeToPositive({side:first.direction,fillPrice:firstVwap,fillAt:first.executionTime,marks:input.marks??[],costBps:input.costBps??null}):{priceMs:null,netMs:null,netStatus:'COST_INCOMPLETE' as const},fillToIdealBps=first&&vwap!==null&&finite(intent?.idealPrice)&&intent.idealPrice>0?sideSign(first.direction)*(vwap/intent.idealPrice-1)*10_000:null;
  return{runId:input.run.id,symbol:input.run.symbol,intentId:intent?.id??null,orderIds:orders.map(row=>row.id),fillIds:fills.map(row=>row.fillId),firstFillAt:first?.executionTime??null,completeFillAt,firstFillVwap:firstVwap,fillVwap:vwap,fillToIdealBps,repriceCount:orders.reduce((n,row)=>n+(finite(row.repriceCount)?row.repriceCount:0),0),tradeId:record?.tradeId??null,cycleId:record?.cycleId??null,tradeSource:record?.source??null,tradeStatus:record?.status??null,economicCompleteness:economicCompleteness(record),timeToPositive:positive,path,linkStatus:!intent?'INTENT_UNKNOWN':!orders.length?'ORDER_UNKNOWN':!fills.length?'NO_FILL':record?'LINKED':'TRADE_RECORD_UNKNOWN'};
}
