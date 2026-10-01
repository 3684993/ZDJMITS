import { ExecutionFillSchema, ExperienceSampleSchema, TradeRecordSchema, type EntryOrder, type ExecutionFill, type Position, type TakeProfitOrder } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import { PositionLifecycleTracker } from './positionLifecycleTracker.js';
import { accountCycle, cycleFills, exactCycleRecord } from './cycleAccounting.js';
import type { TradeAuditSnapshot } from '../types.js';
import type { TradeRecord } from '@zdj/contracts';

type CloseReason='TP'|'MANUAL'|'RECONCILIATION'|'UNKNOWN';
const expectedEntrySide=(direction:'LONG'|'SHORT')=>direction==='LONG'?'BUY':'SELL';
const stable=(asset:string)=>['USDT','USDC','BUSD'].includes(asset.toUpperCase());
const present=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

/**
 * P7: the position row carries the facts the hold-duration readback needs, taken from the physical
 * cycle rather than recomputed in the browser. `openedAt` never moves on an add-on or a partial
 * close, `lastAddAt`/`addCount` describe the add-ons, and `physicalCycleKey` makes the identity
 * account+environment+symbol+side+cycle instead of the symbol alone.
 */
export function applyCycleFacts(position:Position,lifecycle:any,transition:string|null){
  position.physicalCycleKey=lifecycle?.key??`${position.symbol}:${position.side}`;
  if(Number.isFinite(lifecycle?.openedAt))position.openedAt=Math.trunc(Number(lifecycle.openedAt));
  if(Number.isFinite(lifecycle?.firstObservedAt)&&!Number.isFinite(Number(position.firstObservedAt)))position.firstObservedAt=Math.trunc(Number(lifecycle.firstObservedAt));
  position.lastAddAt=lifecycle?.lastAddAt??position.lastAddAt??position.openedAt??null;
  position.addCount=Math.max(0,Number(lifecycle?.addCount??position.addCount??0));
  if(transition==='INCREASE')position.entryTimeSource=position.entryTimeSource??'SYSTEM_FILL';
  return position;
}

export class PositionService {
  private readonly lifecycle:PositionLifecycleTracker;
  constructor(private state:RuntimeState,private events:EventBus){this.lifecycle=new PositionLifecycleTracker(state);}
  private record(fill:ExecutionFill,stage:'ENTRY'|'EXIT'){const owner=exactCycleRecord(this.state,fill);const parsed=ExecutionFillSchema.parse({...fill,cycleId:fill.cycleId??owner?.cycleId});this.state.recordExecutionFill(parsed);this.lifecycle.attachFill(parsed,stage);}
  private currentRecord(pos:Position){
    const cycleId=pos.cycleId??this.state.lifecycles.get(this.lifecycle.key(pos.symbol,pos.side))?.cycleId;
    return [...this.state.tradeRecords.values()].find(r=>r.symbol===pos.symbol&&r.direction===pos.side&&r.cycleId===cycleId);
  }
  private ensureOpenRecord(pos:Position,source:'SYSTEM'|'IMPORTED_AT_STARTUP'|'RECONCILIATION'='SYSTEM'){
    const cycle=this.state.lifecycles.get(this.lifecycle.key(pos.symbol,pos.side)),existing=this.currentRecord(pos);if(existing){if(!existing.positionId){const linked={...existing,positionId:pos.id};this.state.tradeRecords.set(linked.tradeId,linked);return linked;}return existing;}const now=Date.now(),physicalCycle=pos.cycleId??cycle?.cycleId??null,tradeId=`trade_${physicalCycle??pos.id}`;
    const record=TradeRecordSchema.parse({tradeId,positionId:pos.id,symbol:pos.symbol,direction:pos.side,openedAt:pos.openedAt,closedAt:null,durationMs:null,entryQty:pos.quantity,entryAveragePrice:pos.entryPrice,exitAveragePrice:null,entryFee:null,exitFee:null,totalFee:null,funding:null,entryGrossNotional:pos.quantity*pos.entryPrice,exitGrossNotional:0,marginUsed:null,netRoiOnMargin:null,netReturnOnNotional:null,entryFillCount:0,exitFillCount:0,feeBreakdown:[],grossRealizedPnl:null,netPnl:null,closeReason:null,status:source==='SYSTEM'?'OPEN':'IMPORTED_OPEN_POSITION',entryRunId:null,entryIntentId:null,entryOrderIds:[],exitOrderIds:[],source,regime:this.state.eips.get(pos.symbol)?.globalRegime.regime??null,feeCompleteness:'UNKNOWN',recordCompleteness:'PARTIAL',classification:source==='IMPORTED_AT_STARTUP'?'IMPORTED':'PARTIAL',canonical:true,duplicateOf:null,cycleId:physicalCycle,positionCycleId:physicalCycle,entryLots:[],lotAllocationMethod:'UNKNOWN',repairSource:null,linkedFillIds:[],missingFacts:['EXIT_FACT','FEE_FACT'],integrityFlags:[],createdAt:pos.firstObservedAt??now,updatedAt:now,firstObservedAt:pos.firstObservedAt??pos.openedAt});
    this.state.tradeRecords.set(tradeId,record);this.events.publish('TRADE_RECORD_OPENED',record,pos.symbol);return record;
  }
  onEntryFilled(order:EntryOrder):Position{
    this.state.entryOrders.set(order.id,order);const filledQuantity=order.filledQuantity>0?order.filledQuantity:order.quantity,now=Date.now();
    const existing=[...this.state.positions.values()].find(pos=>pos.symbol===order.symbol&&pos.side===order.side);
    const intent=this.state.entryIntents.get(order.intentId),plan=intent?.profitTakePlan??null,mandate=intent?.economicMandate??null;
    const pos:Position=existing?{...existing,quantity:existing.quantity+filledQuantity,entryPrice:(existing.entryPrice*existing.quantity+order.price*filledQuantity)/(existing.quantity+filledQuantity),profitTakePlan:existing.profitTakePlan??plan,economicAdmission:existing.economicAdmission??intent?.economicAdmission??null,economicMandate:existing.economicMandate??mandate}:{id:`pos_${order.id}`,symbol:order.symbol,side:order.side,quantity:filledQuantity,entryPrice:order.price,markPrice:order.price,leverage:order.leverage,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:now,firstObservedAt:now,entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PENDING',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE',tpEconomics:null,profitTakePlan:plan,profitTakePlanSource:null,economicAdmission:intent?.economicAdmission??null,economicMandate:mandate,lossHandoff:{cycleId:`pos_${order.id}`,lastClosedBarAt:null,consecutiveLossBars:0,status:'ACTIVE'}};
    const transition=this.lifecycle.observe({symbol:pos.symbol,side:pos.side,quantity:pos.quantity,cycleId:order.cycleId,openedAt:pos.openedAt,firstObservedAt:pos.firstObservedAt??pos.openedAt,source:'SYSTEM',lotId:order.id,at:now});let record=this.ensureOpenRecord(pos,'SYSTEM');pos.cycleId=transition.lifecycle.cycleId;applyCycleFacts(pos,transition.lifecycle,transition.transition);this.state.entryOrders.set(order.id,{...order,cycleId:pos.cycleId});
    if(record.entryIntentId!==order.intentId||!record.entryOrderIds.includes(order.id)){const lotId=order.id;if(!record.entryLots?.some(lot=>lot.lotId===lotId))record={...record,positionCycleId:pos.cycleId,entryLots:[...(record.entryLots??[]),{lotId,intentId:order.intentId,orderId:order.id,exchangeOrderId:order.exchangeOrderId??null,quantity:filledQuantity,averagePrice:order.price,filledAt:now,exitAllocatedQuantity:0,exitAllocatedNotional:0,allocationSource:'EXPLICIT'}]};record={...record,entryRunId:intent?.brainRunId??record.entryRunId,entryIntentId:order.intentId,entryOrderIds:[...new Set([...record.entryOrderIds,order.id,...(order.exchangeOrderId?[order.exchangeOrderId]:[])])],entryQty:pos.quantity,entryAveragePrice:pos.entryPrice,entryGrossNotional:pos.quantity*pos.entryPrice,updatedAt:now};this.state.tradeRecords.set(record.tradeId,TradeRecordSchema.parse(record));}
    this.record({cycleId:record.cycleId,fillId:`simulation-entry-${order.id}-${now}`,symbol:order.symbol,direction:order.side,side:order.side==='LONG'?'BUY':'SELL',positionSide:order.side,orderId:order.exchangeOrderId??order.id,clientOrderId:order.id,tradeId:`sim_${order.id}`,executionTime:now,qty:filledQuantity,price:order.price,realizedPnl:0,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:true,source:'SIMULATION'},'ENTRY');
    this.state.positions.set(pos.id,pos);this.state.account.availableUsd=Math.max(0,(this.state.account.availableUsd??0)-(filledQuantity*order.price/order.leverage));this.events.publish('POSITION_LIFECYCLE_TRANSITION',{positionId:pos.id,transition:transition.transition,quantity:pos.quantity},pos.symbol);this.events.publish('TRADE_RECORD_OPENED',this.state.tradeRecords.get(record.tradeId),order.symbol);this.events.publish('POSITION_OPENED',pos,order.symbol);return pos;
  }
  updateMarks(){for(const [id,p] of this.state.positions){const q=this.state.snapshots.get(p.symbol)?.quote;if(!q)continue;const move=p.side==='LONG'?q.mark-p.entryPrice:p.entryPrice-q.mark,pnl=move*p.quantity;this.state.positions.set(id,{...p,markPrice:q.mark,unrealizedPnl:pnl,unrealizedPnlPercent:(move/p.entryPrice)*p.leverage*100});}}
  observeRemotePosition(remote:Position,source:'RECONCILIATION'|'IMPORTED_AT_STARTUP'='RECONCILIATION',entryOrder?:EntryOrder){
    if(entryOrder){const owner=exactCycleRecord(this.state,{symbol:entryOrder.symbol,orderId:entryOrder.exchangeOrderId??entryOrder.id,clientOrderId:entryOrder.clientOrderId??'',tradeId:''});if(owner&&(owner.status==='CLOSED'||owner.observedClosedAt))entryOrder=undefined;}
    const transition=this.lifecycle.observe({symbol:remote.symbol,side:remote.side,quantity:remote.quantity,cycleId:remote.cycleId??entryOrder?.cycleId,openedAt:remote.openedAt,firstObservedAt:remote.firstObservedAt??remote.openedAt,source,lotId:entryOrder?.id??null});remote.cycleId=transition.lifecycle.cycleId;const record=this.ensureOpenRecord(remote,source==='RECONCILIATION'?'RECONCILIATION':'IMPORTED_AT_STARTUP');
    remote.cycleId=transition.lifecycle.cycleId;applyCycleFacts(remote,transition.lifecycle,transition.transition);this.state.positions.set(remote.id,remote);
    if(entryOrder){entryOrder={...entryOrder,cycleId:transition.lifecycle.cycleId};this.state.entryOrders.set(entryOrder.id,entryOrder);
      // A startup/reconciliation observation of an Entry order this engine owns is also lot evidence:
      // the position book may be the first place a lot becomes visible after a restart.
      if(!record.entryLots?.some(lot=>lot.lotId===entryOrder!.id)&&record.status!=='CLOSED'&&!record.observedClosedAt){
        const linked=TradeRecordSchema.parse({...record,positionCycleId:transition.lifecycle.cycleId,entryLots:[...(record.entryLots??[]),{lotId:entryOrder.id,intentId:entryOrder.intentId,orderId:entryOrder.id,exchangeOrderId:entryOrder.exchangeOrderId??null,quantity:entryOrder.filledQuantity||entryOrder.quantity,averagePrice:entryOrder.price,filledAt:entryOrder.updatedAt??null,exitAllocatedQuantity:0,exitAllocatedNotional:0,allocationSource:'EXPLICIT'}],updatedAt:Date.now()});
        this.state.tradeRecords.set(linked.tradeId,linked);
      }}
    const intent=entryOrder?this.state.entryIntents.get(entryOrder.intentId):undefined;
    if(entryOrder&&record.status!=='CLOSED'&&!record.observedClosedAt){const linked=TradeRecordSchema.parse({...this.state.tradeRecords.get(record.tradeId)??record,status:'OPEN',source:'SYSTEM',classification:'PARTIAL',entryIntentId:entryOrder.intentId,entryRunId:intent?.brainRunId??record.entryRunId,cycleId:transition.lifecycle.cycleId,entryOrderIds:[...new Set([...record.entryOrderIds,entryOrder.id,...(entryOrder.exchangeOrderId&&this.state.executionFills.some(f=>f.symbol===remote.symbol&&f.orderId===entryOrder.exchangeOrderId)?[entryOrder.exchangeOrderId]:[])])],linkedFillIds:[...new Set([...record.linkedFillIds,...this.state.executionFills.filter(f=>f.symbol===remote.symbol&&f.direction===remote.side&&f.orderId===entryOrder.exchangeOrderId).map(f=>f.fillId)])],entryQty:record.entryQty,entryAveragePrice:record.entryAveragePrice,entryGrossNotional:record.entryGrossNotional,updatedAt:Date.now()});this.state.tradeRecords.set(linked.tradeId,linked);}
    if(transition.transition==='REDUCE'&&record.status!=='CLOSED'){const current=this.state.tradeRecords.get(record.tradeId)??record,next=TradeRecordSchema.parse({...current,status:'PARTIALLY_CLOSED',closedAt:null,updatedAt:Date.now()});this.state.tradeRecords.set(next.tradeId,next);}
    this.events.publish('POSITION_LIFECYCLE_TRANSITION',{positionId:remote.id,transition:transition.transition,previousQty:transition.lifecycle.previousQty,currentQty:remote.quantity},remote.symbol);return transition;
  }
  /**
   * P2: which physical cycle a fill belongs to.
   *
   * Order of evidence, most specific first: the durable record that already owns this exact fill
   * identity, then the live non-zero cycle, then a new cycle seeded from the position or the first
   * Entry order. An add-on has no record of its own, so it joins the live cycle instead of opening a
   * second one - which is what made an aggregated take-profit overshoot its own Entry quantity (R4).
   */
  private cycleForFill(owner:TradeRecord|undefined,symbol:string,side:'LONG'|'SHORT',stage:'ENTRY'|'EXIT',position:Position|undefined,seedCycleId:string|null,quantity:number,at:number,lotId:string|null):{cycleId:string|null;openedAt:number;firstObservedAt:number}{
    const ownerCycle=owner?.cycleId??owner?.positionCycleId;
    // A replay of the same exchange fill must resolve to the cycle it was first booked against and
    // must not disturb the lifecycle: re-observing a closed cycle is how a duplicate report used to
    // silently open a second one.
    if(present(ownerCycle))return{cycleId:String(ownerCycle),openedAt:position?.openedAt??at,firstObservedAt:position?.firstObservedAt??position?.openedAt??at};
    if(stage==='EXIT'&&present(seedCycleId))return{cycleId:seedCycleId,openedAt:at,firstObservedAt:at};
    const live=this.state.lifecycles.get(this.lifecycle.key(symbol,side));
    // ACCOUNT_UPDATE zero may precede its TRADE update. An exit never starts a new holding.
    // Only an execution inside the known physical interval may join it without order identity.
    if(stage==='EXIT'){
      const inside=live&&at>=live.openedAt&&(live.status!=='CLOSED'||at<=Number(live.closedAt??0));
      return{cycleId:inside?live.cycleId:null,openedAt:inside?live.openedAt:at,firstObservedAt:inside?live.firstObservedAt:at};
    }
    if(live&&live.status!=='CLOSED'){
      const observed=this.lifecycle.observe({symbol,side,quantity:Math.max(quantity,Number(live.currentQty)||quantity),cycleId:live.cycleId,openedAt:position?.openedAt??live.openedAt,firstObservedAt:position?.firstObservedAt??live.firstObservedAt,source:position?'RECONCILIATION':'SYSTEM',lotId,at}).lifecycle;
      return{cycleId:observed.cycleId,openedAt:observed.openedAt,firstObservedAt:observed.firstObservedAt};
    }
    const created=this.lifecycle.observe({symbol,side,quantity,cycleId:position?.cycleId??seedCycleId??null,openedAt:position?.openedAt??at,firstObservedAt:position?.firstObservedAt??position?.openedAt??at,source:'SYSTEM',lotId,at}).lifecycle;
    return{cycleId:created.cycleId,openedAt:created.openedAt,firstObservedAt:created.firstObservedAt};
  }
  recordExchangeFill(input:Omit<ExecutionFill,'direction'|'commissionUsd'|'source'> & {direction?:'LONG'|'SHORT';commissionUsd?:number|null;source?:'USER_DATA_WS'|'EXCHANGE_AUDIT'} & {entryLotId?:string|null}){
    let owner=exactCycleRecord(this.state,input);
    const localOrder=this.findDurableOrder(input);
    const manualEntry=localOrder?.kind==='MANUAL'&&localOrder.row.reduceOnly===false;
    const durableDirection=localOrder?.kind==='ENTRY'?localOrder.row.side:localOrder?(manualEntry?(input.side==='BUY'?'LONG':'SHORT'):(input.side==='SELL'?'LONG':'SHORT')):undefined;
    const direction=owner?.direction??durableDirection??input.direction??(input.positionSide==='LONG'?'LONG':input.positionSide==='SHORT'?'SHORT':(/^(tp_|manual_|ma_|mr_|mc_|ec[0-9]*_)/i.test(input.clientOrderId)?(input.side==='SELL'?'LONG':'SHORT'):(input.side==='BUY'?'LONG':'SHORT')));
    const localIntent=localOrder?.kind==='ENTRY'?this.state.entryIntents.get(localOrder.row.intentId):undefined;
    // P2/R5: system origin is proved from the durable order tables and the order registry, never from
    // the shape of a client id. A `v396x...` id that no durable record owns stays UNPROVEN, and an
    // exit fill this engine did place is no longer mislabelled EXTERNAL_OR_UNLINKED.
    const registry=this.state.orderProvenance?.resolve?.({symbol:input.symbol,clientOrderId:present(input.clientOrderId)?input.clientOrderId:null,exchangeOrderId:present(input.orderId)?input.orderId:null});
    const registryCycles=[...new Set((registry?.rows??[]).filter((row:any)=>['TP','EXIT','MANUAL_EXIT'].includes(row.role)).map((row:any)=>row.cycleId).filter(present))] as string[];
    const registeredExitCycle=registry?.status==='SYSTEM_PROVEN'&&registryCycles.length===1?registryCycles[0]:null;
    if(registeredExitCycle)owner=[...this.state.tradeRecords.values()].find(row=>row.symbol===input.symbol&&row.cycleId===registeredExitCycle&&!row.duplicateOf);
    const provenanceSource=registry?.status==='SYSTEM_PROVEN'?'ORDER_REGISTRY':localOrder?'DURABLE_ORDER_TABLE':(/^(entry_|ml_|tp_|manual_|ma_|mr_|mc_|ec[0-9]*_)/i.test(input.clientOrderId)?'LEGACY_PREFIX':'UNPROVEN');
    const systemProven=provenanceSource==='ORDER_REGISTRY'||provenanceSource==='DURABLE_ORDER_TABLE';
    const entrySide=expectedEntrySide(direction);
    const stage=(localOrder?.kind==='TP'||(localOrder?.kind==='MANUAL'&&!manualEntry)||input.side!==entrySide)?'EXIT':'ENTRY';
    const pos=[...this.state.positions.values()].find(row=>row.symbol===input.symbol&&row.side===direction);
    const lotId=stage==='ENTRY'?(input.entryLotId??localOrder?.row.id??`lot_${input.orderId||input.tradeId}`):null;
    const cycle=this.cycleForFill(owner,input.symbol,direction,stage,pos,registeredExitCycle??localOrder?.row.cycleId??null,stage==='ENTRY'?Math.max(pos?.quantity??0,input.qty):Math.max(0,(pos?.quantity??input.qty)-input.qty),input.executionTime,lotId);
    const cycleId=cycle.cycleId as string;
    const entryLotId=lotId;
    if(stage==='ENTRY'&&localOrder){
      // Add-ons keep one physical cycle while each Entry order keeps its own lot identity, so the
      // order row is re-pointed at the cycle and the lot is recorded on that cycle's TradeRecord.
      if(localOrder.row.cycleId!==cycleId){if(localOrder.kind==='ENTRY')this.state.entryOrders.set(localOrder.row.id,{...localOrder.row,cycleId} as EntryOrder);else if(localOrder.kind==='MANUAL')this.state.manualOrders.set(localOrder.row.id,{...localOrder.row,cycleId} as any);}
      const record=this.ensureOpenRecord({...pos,symbol:input.symbol,side:direction,cycleId,quantity:input.qty,entryPrice:input.price,openedAt:cycle.openedAt,firstObservedAt:cycle.firstObservedAt,id:pos?.id??`pos_${input.symbol}_${direction}`} as Position,'SYSTEM');
      const lotId=String(entryLotId);
      if(!record.entryLots?.some(lot=>lot.lotId===lotId)){
        const linked=TradeRecordSchema.parse({...record,positionCycleId:cycleId,entryLots:[...(record.entryLots??[]),{lotId,intentId:localIntent?.id??localOrder.row.intentId??null,orderId:localOrder.row.id,exchangeOrderId:localOrder.row.exchangeOrderId??input.orderId??null,quantity:input.qty,averagePrice:input.price,filledAt:input.executionTime,exitAllocatedQuantity:0,exitAllocatedNotional:0,allocationSource:'EXPLICIT'}],entryOrderIds:[...new Set([...record.entryOrderIds,localOrder.row.id,...(input.orderId?[input.orderId]:[])])],updatedAt:Date.now()});
        this.state.tradeRecords.set(linked.tradeId,linked);
      }
    }
    const fill=ExecutionFillSchema.parse({...input,cycleId,positionCycleId:cycleId,entryLotId,fillRole:stage,
      direction:owner?.direction??direction,commissionUsd:input.commissionUsd!==undefined?input.commissionUsd:(stable(input.commissionAsset)?input.commission:null),source:input.source??'USER_DATA_WS',
      attributionStatus:systemProven?'SYSTEM_ATTRIBUTED':'EXTERNAL_OR_UNLINKED',provenanceSource,
      decisionChainId:localOrder?.decisionChainId??localIntent?.decisionChainId??localIntent?.brainRunId??null,
      allocationPlanId:(localIntent?.allocationPlan as any)?.planId??null});this.record(fill,stage);
    if(localOrder?.kind==='ENTRY'){const order=localOrder.row;const fills=[...(order.fills??[]).filter(row=>row.tradeId!==fill.tradeId),{tradeId:fill.tradeId,qty:fill.qty,price:fill.price,commission:fill.commissionUsd,commissionAsset:fill.commissionAsset,executedAt:fill.executionTime}],filledQuantity=Math.max(order.filledQuantity,fills.reduce((n,row)=>n+row.qty,0)),avg=fills.reduce((n,row)=>n+row.price*row.qty,0)/Math.max(fills.reduce((n,row)=>n+row.qty,0),Number.EPSILON),status=filledQuantity>=order.quantity-1e-10?'FILLED':order.status==='CANCELED'?'CANCELED':'PARTIALLY_FILLED',decisionChainId=fill.decisionChainId??localIntent?.brainRunId??null;this.state.entryOrders.set(order.id,{...order,cycleId:fill.cycleId,filledQuantity,status,fillState:filledQuantity>=order.quantity-1e-10?'COMPLETE':'PARTIAL',fills,price:avg||order.price,updatedAt:Date.now()});this.events.publish('ORDER_FILL_RECONCILED',{decisionChainId,brainRunId:decisionChainId,intentId:order.intentId,orderId:order.id,exchangeOrderId:fill.orderId,clientOrderId:fill.clientOrderId,tradeId:fill.tradeId,filledQuantity,status,fillState:status==='CANCELED'?'PARTIALLY_FILLED_THEN_CANCELED':status},fill.symbol);if(status==='FILLED'&&order.status!=='FILLED')this.events.publish('ENTRY_FILLED',{decisionChainId,brainRunId:decisionChainId,intentId:order.intentId,orderId:order.id,exchangeOrderId:fill.orderId,clientOrderId:fill.clientOrderId,filledQuantity,fillCount:fills.length},fill.symbol);}
    const target=exactCycleRecord(this.state,fill)??this.state.tradeRecords.get(`trade_${cycleId}`);
    if(target){const linked={...target,linkedFillIds:[...new Set([...target.linkedFillIds,fill.fillId])]},next=accountCycle(linked,cycleFills(this.state,linked));this.state.tradeRecords.set(next.tradeId,next);if(next.status==='CLOSED'&&this.state.lifecycles.get(this.lifecycle.key(next.symbol,next.direction))?.cycleId===next.cycleId)this.lifecycle.close(next.symbol,next.direction,'SYSTEM');this.events.publish('TRADE_RECORD_REPAIRED',next,fill.symbol);}
    this.events.publish(systemProven?'EXCHANGE_FILL_ATTRIBUTED':'EXCHANGE_FILL_UNATTRIBUTED',{decisionChainId:fill.decisionChainId??null,brainRunId:fill.decisionChainId??null,fill,stage,provenanceSource,localOrderId:localOrder?.row.id??null},fill.symbol);return{fill,stage};
  }
  /**
   * The durable order identity behind an exchange fill. Entry, take-profit and manual rows are all
   * searched: a system exit order is only ever in the TP or manual table, and looking only at Entry
   * orders is precisely how filled take-profits were labelled external (R5).
   */
  private findDurableOrder(input:{symbol?:string;orderId?:string;clientOrderId?:string;side?:string}){
    const client=present(input.clientOrderId)?String(input.clientOrderId):null,order=present(input.orderId)?String(input.orderId):null;
    if(!present(input.symbol)||(!client&&!order))return null;
    const matches=(row:{symbol?:string;id?:string;exchangeOrderId?:string|null;clientOrderId?:string|null})=>row.symbol===input.symbol&&((client&&row.clientOrderId===client)||(order&&row.exchangeOrderId===order)||(client&&row.id===client)||(order&&row.id===order));
    const entry=[...this.state.entryOrders.values()].find(matches);
    if(entry)return{kind:'ENTRY' as const,row:entry,decisionChainId:entry.decisionChainId};
    const tp=[...this.state.tpOrders.values()].find(matches);
    if(tp)return{kind:'TP' as const,row:tp,decisionChainId:null};
    const manual=[...this.state.manualOrders.values()].find(matches);
    if(manual)return{kind:'MANUAL' as const,row:manual,decisionChainId:null};
    return null;
  }
  /** Rebuild only projections with an exact registered exit identity or duplicate order aliases. */
  rebuildProvenCycleAccounting(){
    const affected=new Set<string>();let rebound=0,rebuilt=0;
    for(const fill of [...this.state.executionFills]){
      const proof=this.state.orderProvenance?.resolve?.({symbol:fill.symbol,clientOrderId:fill.clientOrderId,exchangeOrderId:fill.orderId});
      const cycles=[...new Set((proof?.rows??[]).filter((row:any)=>['TP','EXIT','MANUAL_EXIT'].includes(row.role)).map((row:any)=>row.cycleId).filter(present))] as string[];
      if(proof?.status!=='SYSTEM_PROVEN'||cycles.length!==1||cycles[0]===fill.cycleId)continue;
      if(![...this.state.tradeRecords.values()].some(row=>row.symbol===fill.symbol&&row.cycleId===cycles[0]&&!row.duplicateOf))continue;
      if(fill.cycleId)affected.add(fill.cycleId);affected.add(cycles[0]!);
      this.recordExchangeFill(fill as any);rebound++;
      this.events.publish('FILL_CYCLE_BINDING_RESTORED',{fillId:fill.fillId,tradeId:fill.tradeId,orderId:fill.orderId,fromCycleId:fill.cycleId,toCycleId:cycles[0],proof:proof.proof,exchangeWrites:0},fill.symbol);
    }
    for(const row of [...this.state.tradeRecords.values()]){
      const ids=(row.entryLots??[]).map(lot=>lot.exchangeOrderId).filter(present),aliasDuplicate=new Set(ids).size<ids.length;
      if(!affected.has(row.cycleId??'')&&!aliasDuplicate)continue;
      const fills=cycleFills(this.state,row);if(!fills.length)continue;
      const next=accountCycle(row,fills);this.state.tradeRecords.set(next.tradeId,next);rebuilt++;
      this.events.publish('CYCLE_ACCOUNTING_REBUILT_FROM_EXACT_IDENTITIES',{tradeId:row.tradeId,cycleId:row.cycleId,priorLots:row.entryLots,lots:next.entryLots,ledgerConservation:next.ledgerConservation,exchangeWrites:0},row.symbol);
    }
    return{rebound,rebuilt};
  }
  onReconciledClose(position:Position,reason:CloseReason='RECONCILIATION',source:'RECONCILIATION'|'LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT'='RECONCILIATION'){this.lifecycle.close(position.symbol,position.side,source);this.finalizeSafe(position,reason,source);}
  onTakeProfitFilled(order:TakeProfitOrder){
    const pos=this.state.positions.get(order.positionId);if(!pos)return;const gross=(pos.side==='LONG'?order.price-pos.entryPrice:pos.entryPrice-order.price)*Math.min(pos.quantity,order.quantity),margin=pos.quantity*pos.entryPrice/pos.leverage,now=Date.now();
    this.record({cycleId:order.cycleId??pos.cycleId,fillId:`simulation-exit-${order.id}-${now}`,symbol:pos.symbol,direction:pos.side,side:pos.side==='LONG'?'SELL':'BUY',positionSide:pos.side,orderId:order.exchangeOrderId??order.id,clientOrderId:order.id,tradeId:`sim_${order.id}`,executionTime:now,qty:Math.min(pos.quantity,order.quantity),price:order.price,realizedPnl:gross,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:true,source:'SIMULATION'},'EXIT');
    this.state.account.availableUsd=(this.state.account.availableUsd??0)+margin+gross;this.state.account.realizedPnlUsd24h=(this.state.account.realizedPnlUsd24h??0)+gross;this.state.positions.delete(pos.id);
    if(order.quantity<pos.quantity){const remaining={...pos,quantity:pos.quantity-order.quantity};this.state.positions.set(pos.id,remaining);this.lifecycle.observe({symbol:remaining.symbol,side:remaining.side,quantity:remaining.quantity,openedAt:remaining.openedAt,firstObservedAt:remaining.firstObservedAt??remaining.openedAt,source:'SYSTEM'});this.finalizeSafe({...pos,quantity:order.quantity},'TP','RECONCILIATION');return;}
    this.onReconciledClose(pos,'TP','RECONCILIATION');
  }
  private finalizeSafe(position:Position,reason:CloseReason,source:'RECONCILIATION'|'LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT'='RECONCILIATION'){
    const record=this.currentRecord(position)??this.ensureOpenRecord(position,'RECONCILIATION');
    const linked={...record,observedClosedAt:record.observedClosedAt??Date.now(),closeReason:reason,repairSource:source};
    const next=accountCycle(linked,cycleFills(this.state,linked));
    this.state.tradeRecords.set(next.tradeId,next);
    this.events.publish(next.status==='CLOSED'?'TRADE_RECORD_CLOSED':'TRADE_RECORD_REPAIRED',next,next.symbol);
  }
  repairClosedCyclesFromAudit(_audit:TradeAuditSnapshot){
    throw new Error('EXPLICIT_SYNC_PREVIEW_AND_APPLY_REQUIRED');
  }
}
