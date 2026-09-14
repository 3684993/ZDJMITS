import { Router } from 'express';
import type { EngineRuntime } from '../runtime/appRuntime.js';
import { createApiRouter as createLegacyApiRouter } from './routerLegacy.js';
import { TradeRecordIntegrityService } from '../services/tradeRecordIntegrityService.js';
import { filterFormalOutcome, projectTradeRecordRow, projectTradeRecordSummary } from '../services/tradeRecordReadModel.js';

const closedAt=(row:any)=>Number.isFinite(row.closedAt)?Number(row.closedAt):Number.isFinite(row.observedClosedAt)?Number(row.observedClosedAt):-Infinity;

/**
 * V3.9.3 read-semantics wrapper. It deliberately intercepts only read endpoints.
 * All write routes remain owned by the audited V3.9.2 router.
 */
export function createApiRouter(runtime:EngineRuntime){
  const r=Router();
  r.get('/trade-records',(req,res)=>{
    const q=req.query as Record<string,string|undefined>,page=Math.max(1,Number(q.page??1)),limit=Math.min(100,Math.max(1,Number(q.limit??20)));
    const records=[...runtime.state.tradeRecords.values()],summary=projectTradeRecordSummary({records}),integrity=new TradeRecordIntegrityService(runtime.state).summary();
    let rows=records.map(record=>projectTradeRecordRow(record)).sort((a,b)=>closedAt(b)-closedAt(a)||a.tradeId.localeCompare(b.tradeId));
    const category=q.category??'COMPLETE';
    rows=category==='ISSUES'?rows.filter(row=>['DUPLICATE','CONFLICT','INVALID'].includes(row.classification)):rows.filter(row=>row.classification===category);
    if(q.symbol)rows=rows.filter(row=>row.symbol.toUpperCase().includes(q.symbol!.toUpperCase()));
    if(q.direction)rows=rows.filter(row=>row.direction===q.direction);
    if(q.status)rows=rows.filter(row=>row.status===q.status);
    if(q.closeReason)rows=rows.filter(row=>row.closeReason===q.closeReason);
    rows=filterFormalOutcome(rows,q.outcome);
    if(q.search)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(q.search!.toLowerCase()));
    const total=rows.length;
    res.json({page,limit,total,items:rows.slice((page-1)*limit,page*limit),autoSync:runtime.tradeRecordAutoSyncStatus(),summary:{...summary,
      partiallyClosed:records.filter(row=>row.status==='PARTIALLY_CLOSED').length,
      unknownCount:records.filter(row=>row.classification!=='COMPLETE'||row.fundingAttributionStatus!=='EXACT').length,
      grossIncome:null,lossExpense:null,totalFees:null,floatingPnl:runtime.state.account.unrealizedPnlUsd??0,
      counts:{total:integrity.total,complete:integrity.complete,partial:integrity.partial,imported:integrity.imported,external:integrity.external,duplicate:integrity.duplicate,conflict:integrity.conflict,invalid:integrity.invalid,invalidClosed:integrity.invalidClosed,missingExit:integrity.missingExit,missingFee:integrity.missingFee,missingMargin:integrity.missingMargin},
    }});
  });
  r.get('/trade-records/:id',(req,res)=>{
    const raw=runtime.state.tradeRecords.get(req.params.id);if(!raw)return res.status(404).json({error:{message:'trade record not found'}});
    const record=projectTradeRecordRow(raw),entryRuns=raw.entryRunId?runtime.state.aiRuns.filter(run=>run.id===raw.entryRunId):[];
    res.json({record,rawRecord:raw,experience:[...runtime.state.experienceSamples.values()].find(sample=>sample.tradeId===raw.tradeId)??null,
      linkedFills:runtime.state.executionFills.filter(fill=>raw.linkedFillIds.includes(fill.fillId)||raw.entryOrderIds.includes(fill.orderId)||raw.exitOrderIds.includes(fill.orderId)),entryRuns,
      entryOrders:raw.entryOrderIds.map(id=>runtime.state.entryOrders.get(id)).filter(Boolean),exitOrders:raw.exitOrderIds.map(id=>runtime.state.tpOrders.get(id)).filter(Boolean),
      rawAudit:runtime.settingsStore.runtimeEvents(raw.createdAt,['TRADE_RECORD_OPENED','TRADE_RECORD_CLOSED','TRADE_RECORD_REPAIRED','EXPERIENCE_SAMPLE_CREATED'],500)});
  });
  r.get('/experience',(_req,res)=>{
    const projected=[...runtime.state.tradeRecords.values()].map(record=>projectTradeRecordRow(record)).filter(row=>row.economicEligibility.canonicalPnlEligible),ids=new Set(projected.map(row=>row.tradeId));
    const samples=[...runtime.state.experienceSamples.values()].filter(sample=>ids.has(sample.tradeId)).sort((a,b)=>b.createdAt-a.createdAt),wins=samples.filter(x=>x.winLoss==='WIN').length,losses=samples.filter(x=>x.winLoss==='LOSS').length;
    res.json({samples,records:projected,summary:{completed:samples.length,wins,losses,winRate:samples.length?wins/samples.length:null,avgNetPnl:projected.length?projected.reduce((n,row)=>n+(row.formalNetPnl??0),0)/projected.length:null,avgHoldingDurationMs:projected.length?projected.reduce((n,row)=>n+(row.durationMs??0),0)/projected.length:null,avgFillDelayMs:samples.length?samples.reduce((n,row)=>n+(row.fillDelayMs??0),0)/samples.length:null,status:projected.length?'ELIGIBLE':'NO_ELIGIBLE_SAMPLES'}});
  });
  r.use(createLegacyApiRouter(runtime));
  return r;
}
