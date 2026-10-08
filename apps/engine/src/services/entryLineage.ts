import {EntryLotDecisionLineageSchema} from '@zdj/contracts';
import type {TradeRecord,ExecutionFill} from '@zdj/contracts';
export type EntryLineageContext={entryIntents:Map<string,any>;entryOrders:Map<string,any>;tradePlans:Map<string,any>;aiRuns:any[];executionFills?:ExecutionFill[]};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Every add lot follows its own authorization; cycle VWAP and cycle entryRunId are not fallback evidence. */
export function projectEntryLineage(record:TradeRecord, context:EntryLineageContext) {
  const lots=(record.entryLots??[]).map(lot=>{
    const saved=lot.decisionLineage;
    if(saved?.status==='EXACT'&&saved.lotId===lot.lotId&&saved.intentId===lot.intentId&&saved.orderId===lot.orderId&&saved.exchangeOrderId===lot.exchangeOrderId&&saved.firstFillAt===lot.filledAt&&saved.runCompletedAt!=null&&saved.firstFillAt!=null&&saved.runCompletedAt<=saved.firstFillAt&&saved.contextTimestamp!=null&&saved.modelIdentity&&saved.quantity===lot.quantity&&saved.entryPrice===lot.averagePrice&&saved.allocatedEntryFee===lot.allocatedEntryFee&&EntryLotDecisionLineageSchema.safeParse(saved).success)return saved;
    const reasons:string[]=[];
    const exactOrders=[...context.entryOrders.values()].filter(o=>o.symbol===record.symbol&&o.exchangeOrderId===lot.exchangeOrderId&&(o.id===lot.orderId||lot.orderId===lot.exchangeOrderId));
    const order=exactOrders.length===1?exactOrders[0]:undefined;
    const intent=(lot.intentId??order?.intentId)?context.entryIntents.get(lot.intentId??order.intentId):undefined;
    const linked=new Set(record.linkedFillIds),lotFills=(context.executionFills??[]).filter(f=>linked.has(f.fillId)&&f.symbol===record.symbol&&f.orderId===lot.exchangeOrderId&&f.side===(record.direction==='LONG'?'BUY':'SELL'));
    const qty=lotFills.reduce((n,f)=>n+f.qty,0),cost=lotFills.reduce((n,f)=>n+f.qty*f.price,0);
    if(!lotFills.length||Math.min(...lotFills.map(f=>f.executionTime))!==lot.filledAt||Math.abs(qty-lot.quantity)>Math.max(1e-8,lot.quantity*1e-8)||lot.averagePrice==null||Math.abs(cost/qty-lot.averagePrice)>Math.max(1e-8,lot.averagePrice*1e-8))reasons.push('LOT_FILL_CHAIN_UNPROVEN');
    const plan=intent?.planId?context.tradePlans.get(intent.planId):undefined;
    const run=context.aiRuns.find(r=>r.id===intent?.brainRunId);
    if(!order||!intent||order.intentId!==intent.id||order.symbol!==record.symbol||intent.symbol!==record.symbol||order.exchangeOrderId!==lot.exchangeOrderId)reasons.push('LOT_ORDER_INTENT_CHAIN_UNPROVEN');
    if(!plan||plan.provenance?.modelRunId!==intent?.brainRunId||plan.symbol!==record.symbol||plan.planVersion!==intent?.planVersion||plan.cycleId!==(intent?.planCycleId??record.cycleId))reasons.push('LOT_PLAN_CHAIN_UNPROVEN');
    if(!run||run.role!=='PRIMARY_BRAIN'||run.status!=='COMPLETED'||run.symbol!==record.symbol||run.requestSource!=='ENTRY')reasons.push('ORIGIN_PRIMARY_RUN_UNPROVEN');
    if(!finite(run?.startedAt)||!finite(run?.completedAt)||!finite(lot.filledAt))reasons.push('ORIGIN_TIMESTAMPS_MISSING');
    else if(run.completedAt>lot.filledAt||run.startedAt>run.completedAt||finite(intent?.createdAt)&&intent.createdAt<run.completedAt)reasons.push('ORIGIN_RUN_AFTER_FILL_OR_INTENT');
    let contextTimestamp:number|null=run?.packetId===intent?.packetId&&finite(run?.contextCreatedAt)?run.contextCreatedAt:null;
    if(contextTimestamp===null&&typeof run?.inputPreview==='string'&&run.inputPreview.length<=262144){try{const packet=JSON.parse(run.inputPreview).packet;if(packet?.packetId===intent?.packetId&&finite(packet.createdAt))contextTimestamp=packet.createdAt;}catch{/* incomplete archive remains unknown */}}
    if(contextTimestamp===null||finite(run?.startedAt)&&contextTimestamp>run.startedAt)reasons.push('ENTRY_CONTEXT_UNPROVEN');
    if(!run?.model||!run?.resourceId||!run?.modelIdentity)reasons.push('MODEL_RESOURCE_IDENTITY_UNPROVEN');
    if(!finite(intent?.createdAt))reasons.push('INTENT_TIMESTAMP_MISSING');
    if(!finite(plan?.planVersion)||!finite(plan?.targetPrice)||plan.targetPrice<=0)reasons.push('LOT_TP_VERSION_UNPROVEN');
    if(!finite(lot.allocatedEntryFee))reasons.push('LOT_ENTRY_FEE_UNPROVEN');
    if(!finite(lot.averagePrice)||!finite(lot.quantity)||lot.quantity<=0)reasons.push('LOT_COST_UNPROVEN');
    const binding={lotId:lot.lotId,intentId:intent?.id??lot.intentId,orderId:order?.id??lot.orderId,exchangeOrderId:lot.exchangeOrderId,
      quantity:lot.quantity,entryPrice:lot.averagePrice,entryCost:lot.averagePrice==null?null:lot.quantity*lot.averagePrice,
      fillStages:lotFills.slice().sort((a,b)=>a.executionTime-b.executionTime||a.fillId.localeCompare(b.fillId)).map(f=>({fillId:f.fillId,quantity:f.qty,entryCost:f.qty*f.price,executionTime:f.executionTime,feeAsset:f.commissionAsset,feeAmount:f.commission})),
      allocatedEntryFee:lot.allocatedEntryFee,planId:plan?.planId??null,planCycleId:plan?.cycleId??null,positionCycleId:record.cycleId??null,tpVersion:plan?.planVersion??null,tpTarget:plan?.targetPrice??null,
      runId:intent?.brainRunId??null,model:run?.model??null,resourceId:run?.resourceId??null,modelIdentity:run?.modelIdentity??null,
      contextTimestamp,runStartedAt:run?.startedAt??null,runCompletedAt:run?.completedAt??null,firstFillAt:lot.filledAt,
      status:reasons.length?'UNCERTAIN' as const:'EXACT' as const,reasons};
    return binding;
  });
  const runIds=lots.filter(l=>l.status==='EXACT').map(l=>l.runId);
  const duplicateRunForIndependentLots=new Set(runIds).size!==runIds.length;
  const lotQuantityConserved=Math.abs(lots.reduce((n,l)=>n+l.quantity,0)-record.entryQty)<=Math.max(1e-8,record.entryQty*1e-8);
  const complete=lotQuantityConserved&&lots.length>0&&lots.every(l=>l.status==='EXACT')&&!duplicateRunForIndependentLots;
  return {complete,lots,originRunId:complete?lots.slice().sort((a,b)=>(a.firstFillAt??0)-(b.firstFillAt??0))[0]!.runId:null,
    reasons:[...new Set([...(!lots.length?['ENTRY_LOTS_MISSING']:[]),...(!lotQuantityConserved?['ENTRY_LOT_QUANTITY_NOT_CONSERVED']:[]),...lots.flatMap(l=>l.reasons),...(duplicateRunForIndependentLots?['ADD_LOT_REUSES_ORIGIN_RUN']:[])])]};
}
