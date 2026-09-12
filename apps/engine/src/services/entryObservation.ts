export const decisionKinds=['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE','RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_TECHNICAL_BLOCK','AI_PROTOCOL_FAILURE'] as const;
const known=(x:any)=>x!==null&&x!==undefined&&String(x)!=='';
const time=(x:any)=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const directional=(decision:unknown)=>['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE'].includes(String(decision??''));
/** One read-only classification and identity join, also used by offline audits. */
export function entryObservation(input:{runs:any[];intents:any[];orders:any[];fills:any[];runtime?:any}){
 const runs=[...new Map(input.runs.filter(r=>r.role==='PRIMARY_BRAIN').map(r=>[r.id,r])).values()];
 const counts=Object.fromEntries(decisionKinds.map(k=>[k,0])) as Record<typeof decisionKinds[number],number>;let running=0;
 for(const r of runs){if(r.status==='RUNNING'){running++;continue;}const d=String(r.decision??'');const category=d==='DATA_ERROR'||/MARKET_DATA_STALE|EIP_EVIDENCE|TECHNICAL_.*(?:INVALID|STALE)/.test(String(r.error??''))?'DATA_TECHNICAL_BLOCK':decisionKinds.includes(d as any)?d:'AI_PROTOCOL_FAILURE';counts[category as typeof decisionKinds[number]]++;}
 const chains=runs.map(r=>{
   const intents=input.intents.filter(i=>i.brainRunId===r.id&&i.symbol===r.symbol),i=intents.length===1?intents[0]:null;
   const os=i?input.orders.filter(o=>o.intentId===i.id&&o.symbol===r.symbol):[];
   const orderFills=(o:any)=>{if(!known(o.exchangeOrderId)||!known(r.symbol))return[];const matched=input.fills.filter(f=>f.symbol===r.symbol&&known(f.tradeId)&&known(f.orderId)&&String(f.orderId)===String(o.exchangeOrderId));return [...new Map(matched.map(f=>[String(f.tradeId),f])).values()].sort((a,b)=>Number(a.executionTime)-Number(b.executionTime));};
   const fs=[...new Map(os.flatMap(orderFills).map(f=>[String(f.symbol)+':'+String(f.tradeId),f])).values()],q=fs.reduce((n,f)=>n+Number(f.qty??0),0);
   const times=fs.map(f=>f.executionTime).filter(time);
   const completion=os.map(o=>{let qty=0;for(const f of orderFills(o)){qty+=Number(f.qty??0);if(qty+1e-10>=Number(o.quantity)&&Number(o.quantity)>0)return time(f.executionTime)?f.executionTime:null;}return null;});
   let normalized:any=null;try{normalized=JSON.parse(r.normalizedPreview??'null');}catch{}
   const semanticSide=i?.side??(directional(r.decision)?r.direction:null)??'UNKNOWN';
   return{runId:r.id,symbol:r.symbol,decision:r.decision??'UNKNOWN',decisionAt:r.completedAt??r.startedAt??null,intentId:i?.id??null,intentAt:i?.createdAt??null,orderIds:os.map(o=>o.id),orderStatuses:os.map(o=>o.status),submitAt:os.some(o=>o.exchangeOrderId)?Math.min(...os.filter(o=>o.exchangeOrderId).map(o=>o.createdAt)):null,clientOrderIds:os.map(o=>o.clientOrderId).filter(known),exchangeOrderIds:[...new Set(os.map(o=>o.exchangeOrderId).filter(known))],fillIds:fs.map(f=>f.fillId??String(f.symbol)+':'+String(f.tradeId)),firstFillAt:times.length===fs.length&&times.length?Math.min(...times):null,completeFillAt:completion.length&&completion.every(time)?Math.max(...completion as number[]):null,side:semanticSide,opportunityType:normalized?.opportunityType??r.opportunityType??'UNKNOWN',idealPrice:i?.idealPrice??'UNKNOWN',authorizedRange:i?.acceptablePriceRange??'UNKNOWN',makerPrice:os[0]?.price??'UNKNOWN',fillVwap:q>0&&fs.every(f=>Number(f.price)>0)?fs.reduce((n,f)=>n+Number(f.qty)*Number(f.price),0)/q:'UNKNOWN',fee:fs.length&&fs.every(f=>typeof f.commissionUsd==='number'&&Number.isFinite(f.commissionUsd))?fs.reduce((n,f)=>n+f.commissionUsd,0):'UNKNOWN',marketAtFill:'UNKNOWN',futureEvaluationFacts:'UNKNOWN',exitAt:'UNKNOWN',linkStatus:!i?'UNKNOWN':fs.some(f=>f.attributionStatus!=='SYSTEM_ATTRIBUTED')?'EXTERNAL':os.length?'LINKED':'INTENT_ONLY'};
 });
 return{schemaVersion:'V3.9.2-ENTRY-OBS-3',counts,completed:Object.values(counts).reduce((a,b)=>a+b,0),running,chains,identity:input.runtime??'UNKNOWN'};
}
