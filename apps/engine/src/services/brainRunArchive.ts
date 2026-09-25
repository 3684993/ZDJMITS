import type { RunExecutionOutcome } from './runExecutionOutcome.js';

export function archivedPacket(inputPreview:unknown){
  try{
    const value=typeof inputPreview==='string'?JSON.parse(inputPreview):inputPreview;
    return value&&typeof value==='object'&&(value as any).packet?(value as any).packet:null;
  }catch{return null;}
}

const activeOrderStatuses=new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const reasonEventTypes=new Set([
  'AI_RUN_FAILED','AI_FAILED_NO_INTENT','PRIMARY_NO_ENTRY','CANDIDATE_REJECTED','ENTRY_DECISION_BLOCKED',
  'ENTRY_ORDER_BLOCKED','ENTRY_EXECUTION_WAIT_TERMINATED','ENTRY_ORDER_EXPIRED','ENTRY_RANGE_INVALIDATED',
  'ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','ENTRY_ORDER_TERMINAL_RECONCILED',
]);
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null;
const eventIntentId=(event:any)=>text(event?.payload?.intentId)??text(event?.payload?.intent?.id);
const eventOrderId=(event:any)=>text(event?.payload?.orderId)??text(event?.payload?.order?.id);
const semanticDirection=(decision:unknown,direction:unknown)=>['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE'].includes(String(decision??''))?direction??null:null;

export function projectBrainRun(run:any,chain:any,entryOrders:any[]=[],fills:any[]=[],now=Date.now(),execution:RunExecutionOutcome|null=null){
  const events=[...(chain?.events??[])].sort((a:any,b:any)=>Number(a.ts??0)-Number(b.ts??0));
  const intentIds=new Set(events.map(eventIntentId).filter(Boolean));
  const orderIds=new Set(events.map(eventOrderId).filter(Boolean));
  const orders=entryOrders.filter((order:any)=>order.decisionChainId===run.id||intentIds.has(order.intentId)||orderIds.has(order.id));
  const order=orders.sort((a:any,b:any)=>Number(b.verifiedAt??b.updatedAt??0)-Number(a.verifiedAt??a.updatedAt??0))[0]??null;
  const linkedFills=fills.filter((fill:any)=>fill.decisionChainId===run.id||(order&&fill.symbol===order.symbol&&[order.id,order.clientOrderId,order.exchangeOrderId].filter(Boolean).includes(fill.orderId)));
  const timeline=events.map((event:any)=>({type:event.type,ts:event.ts,intentId:eventIntentId(event),orderId:eventOrderId(event),clientOrderId:text(event.payload?.clientOrderId)??text(event.payload?.order?.clientOrderId),exchangeOrderId:text(event.payload?.exchangeOrderId)??text(event.payload?.order?.exchangeOrderId),fillQuantity:event.payload?.order?.filledQuantity??event.payload?.filledQuantity??null,status:event.payload?.order?.status??event.payload?.status??null,reason:event.payload?.reason??null}));
  for(const fill of linkedFills)timeline.push({type:'EXECUTION_FILL',ts:fill.executionTime,intentId:null,orderId:fill.orderId,clientOrderId:fill.clientOrderId,exchangeOrderId:fill.orderId,fillQuantity:fill.qty,status:'FILLED',reason:null});
  timeline.sort((a:any,b:any)=>Number(a.ts)-Number(b.ts));
  const active=order&&activeOrderStatuses.has(order.status),partial=order&&Number(order.filledQuantity??0)>0&&Number(order.filledQuantity)<Number(order.quantity);
  const terminalStage=order?(active?(order.status==='UNKNOWN'?'ORDER_SUBMISSION_UNKNOWN':order.status==='NEW'?'ORDER_PREPARED':order.status==='SUBMITTING'?'ORDER_SUBMITTING':'ORDER_WORKING'):order.status==='FILLED'?'ORDER_FILLED':partial?`ORDER_${order.status}_PARTIAL`:`ORDER_${order.status}`):(chain?.status&&chain.status!=='PRIMARY_RUNNING'&&chain.status!=='PRIMARY_QUEUED'?chain.status:run.terminalStage??run.status);
  const reasonEvent=[...events].reverse().find((event:any)=>reasonEventTypes.has(event.type)&&(text(event.payload?.reason)||text(event.payload?.error)||text(event.payload?.message)));
  const submitted=Boolean(order&&order.status!=='NEW')||events.some((event:any)=>['ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED','ENTRY_SUBMIT_RESPONSE_RECOVERED'].includes(event.type));
  const reason=active?null:text(reasonEvent?.payload?.reason)??text(reasonEvent?.payload?.error)??text(reasonEvent?.payload?.message)??text(execution?.blockReasons?.[0])??(!submitted?'UNKNOWN':null);
  const remaining=order?Math.max(0,Number(order.quantity)-Number(order.filledQuantity??0)):null;
  const orderFact=order?{status:order.status,internalOrderId:order.id,clientOrderId:order.clientOrderId??null,exchangeOrderId:order.exchangeOrderId??null,symbol:order.symbol,side:order.side,quantity:order.quantity,limitPrice:order.price,filledQuantity:order.filledQuantity,remainingQuantity:remaining,ageMs:Math.max(0,now-Number(order.createdAt)),absoluteExpiresAt:order.absoluteExpiresAt??null,ttlRemainingMs:order.absoluteExpiresAt?Math.max(0,order.absoluteExpiresAt-now):null,repriceCount:order.repriceCount??0,executionState:order.status==='UNKNOWN'?'WAITING_EXACT_EXCHANGE_RESULT':active?'WAITING_LIMIT_MATCH':'TERMINAL',orderType:order.orderType??'LIMIT',timeInForce:order.timeInForce??'UNKNOWN',maker:order.maker??order.timeInForce==='GTX',factSource:order.factSource??'LOCAL_STATE',verifiedAt:order.verifiedAt??order.updatedAt??null}:null;
  return{timeline,orderFact,execution,summary:{direction:semanticDirection(run.decision,run.direction),decision:run.decision,status:run.status,error:run.failure?.errorMessage??run.error,finalStage:terminalStage,reason,actual:reasonEvent?.payload?.actual??null,limit:reasonEvent?.payload?.limit??reasonEvent?.payload?.acceptablePriceRange??null,submitted,orderStatus:order?.status??null,
    // The run-level answer comes from the durable fold, never from a second reading of these events:
    // `orderFact.executionState` describes the order object, this describes the whole chain.
    executionState:execution?.executionState??null,executionLabel:execution?.executionLabel??null,blockStage:execution?.blockStage??null}};
}
