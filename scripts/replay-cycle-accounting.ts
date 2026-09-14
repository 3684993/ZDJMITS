import {readFileSync,writeFileSync} from 'node:fs';
import {RuntimeState} from '../apps/engine/src/state/runtimeState.js';
import {accountCycle,exactCycleRecord} from '../apps/engine/src/services/cycleAccounting.js';

// Offline only: a deliberately bounded JSON extraction from a copied database.
// No engine construction, credentials, exchange API, or SQLite writer exists here.
const input=JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const state=new RuntimeState({portfolio:{},takeProfit:{}} as any);
for(const row of input.records)state.tradeRecords.set(row.tradeId,row);
state.executionFills=input.fills;
for(const kind of ['entryOrders','tpOrders','manualOrders'] as const)for(const row of input.orders[kind])state[kind].set(row.id,row);
const allocations=input.exitfills.map((fill:any)=>{
 const old=input.records.filter((r:any)=>r.linkedFillIds.includes(fill.fillId)||r.exitOrderIds.includes(fill.orderId));
 const exact=exactCycleRecord(state,fill);
 const tp=input.orders.tpOrders.filter((o:any)=>o.symbol===fill.symbol&&(o.exchangeOrderId===fill.orderId||o.clientOrderId===fill.clientOrderId||o.id===fill.clientOrderId));
 const sameOrder=state.executionFills.filter(f=>f.symbol===fill.symbol&&f.orderId===fill.orderId);
 const owners=input.records.filter((r:any)=>r.symbol===fill.symbol&&sameOrder.some(f=>r.linkedFillIds.includes(f.fillId)));
 return{symbol:fill.symbol,tradeId:fill.tradeId,orderId:fill.orderId,clientOrderId:fill.clientOrderId,qty:fill.qty,orphan:old.length===0,originalRecords:old.map((r:any)=>r.tradeId),exactRecord:exact?.tradeId??null,tpOrders:tp.map((o:any)=>o.id),positionIds:tp.map((o:any)=>o.positionId),reason:exact?'EXACT_ORDER_FILL_ANCHOR':owners.length>1?'ORDER_SHARED_BY_MULTIPLE_RECORDS':tp.length?'TP_POSITION_ID_HAS_NO_DURABLE_CYCLE':'TP_ORDER_IDENTITY_NOT_RETAINED'};
});
const plans=input.closed.map((id:string)=>{
 const raw=state.tradeRecords.get(id)!;
 const fills=state.executionFills.filter(f=>exactCycleRecord(state,f)?.tradeId===id);
 const projected=accountCycle(raw,fills);
 // Legacy null/reused cycle identity cannot be certified from order membership alone.
 const identityKnown=raw.cycleId!=null&&raw.positionId!=null;
 return{tradeId:id,cycleId:raw.cycleId,originalStatus:raw.status,originalEntryQty:raw.entryQty,entryQty:projected.entryQty,exitQty:projected.exitQty,remainingQty:projected.remainingQty,entryFillCount:projected.entryFillCount,exitFillCount:projected.exitFillCount,identityKnown,action:identityKnown&&projected.classification==='COMPLETE'?'PREVIEW_REPAIR_COMPLETE':'RETAIN_PARTIAL_UNKNOWN',missingFacts:[...projected.missingFacts,...(!identityKnown?['LEGACY_CYCLE_IDENTITY_UNPROVEN']:[])],fundingStatus:'UNKNOWN',canonicalNetPnl:null};
});
const output={window:{start:input.start,end:input.end},closedCycles:plans.length,exitFillCount:allocations.length,orphanCount:allocations.filter((x:any)=>x.orphan).length,exactAttributed:allocations.filter((x:any)=>x.exactRecord).length,unresolved:allocations.filter((x:any)=>!x.exactRecord).length,completeRecoverable:plans.filter((x:any)=>x.action==='PREVIEW_REPAIR_COMPLETE').length,canonicalComplete:0,plans,allocations};
writeFileSync(process.argv[3]!,JSON.stringify(output,null,2));
console.log(JSON.stringify({...output,plans:undefined,allocations:undefined}));
