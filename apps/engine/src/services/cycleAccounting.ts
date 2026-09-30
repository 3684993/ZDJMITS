import { TradeRecordSchema, type EntryLot, type ExecutionFill, type TradeRecord } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';

export const quantityTolerance = (qty:number) => Math.max(1e-10, Math.abs(qty)*1e-8);
const present = (s:unknown):s is string => typeof s==='string' && s.length>0;
type IdentityFill = Pick<ExecutionFill,'symbol'|'orderId'|'clientOrderId'|'tradeId'> & {cycleId?:string|null;fillId?:string};

/**
 * P2: deterministic FIFO attribution of exits onto the Entry lots of one physical cycle.
 *
 * The engine only ever stores one real exchange fill. This function decides which lot each exit
 * unit is *accounted* against, so a cycle built from several add-ons can report per-lot results
 * without inventing fills. Quantity, notional, exit fee and realised PnL are apportioned together
 * and the apportionment is total-preserving: whatever the last lot cannot absorb from a partial
 * unit is handed to it as a remainder, so the lots always sum back to the cycle totals.
 */
type LotShare={quantity:number;notional:number;fee:number|null;pnl:number|null};
const emptyShare=():LotShare=>({quantity:0,notional:0,fee:null,pnl:null});

function addShare(target:LotShare,part:LotShare){
  target.quantity+=part.quantity;target.notional+=part.notional;
  if(part.fee!=null)target.fee=(target.fee??0)+part.fee;
  if(part.pnl!=null)target.pnl=(target.pnl??0)+part.pnl;
}

export function allocateExitLotsFifo(lots:EntryLot[],exits:ExecutionFill[]):{lots:EntryLot[];method:'FIFO'|'EXPLICIT'|'UNKNOWN'}{
  const ordered=[...lots].sort((a,b)=>(a.filledAt??0)-(b.filledAt??0)||(a.lotId<b.lotId?-1:1));
  if(!ordered.length)return{lots,method:'UNKNOWN'};
  const remaining=ordered.map(lot=>({lot,left:Math.max(0,Number(lot.quantity))}));
  const shares=new Map<string,LotShare>(ordered.map(lot=>[lot.lotId,emptyShare()]));
  const sortedExits=[...exits].sort((a,b)=>a.executionTime-b.executionTime||a.fillId.localeCompare(b.fillId));
  let index=0;
  for(const exit of sortedExits){
    const exitFee=exit.commissionUsd!=null?Number(exit.commissionUsd):null;
    const exitPnl=Number.isFinite(exit.realizedPnl)?Number(exit.realizedPnl):null;
    let toPlace=Math.max(0,Number(exit.qty));
    while(toPlace>quantityTolerance(toPlace)){
      const slot=remaining[index];
      if(!slot){
        // More exit quantity than any lot can account for is the audited R4 symptom. It stays on the
        // first lot so the difference is visible in the conservation check instead of vanishing.
        const fallback=shares.get(ordered[0].lotId)!;
        addShare(fallback,{quantity:toPlace,notional:toPlace*exit.price,fee:exitFee==null?null:exitFee*toPlace/exit.qty,pnl:exitPnl==null?null:exitPnl*toPlace/exit.qty});
        break;
      }
      const take=Math.min(slot.left,toPlace);
      // The exit fill is one exchange fact: its fee and realised PnL are split by the share of *that
      // fill* each lot receives, so the parts always re-sum to the whole.
      const shareRatio=Math.max(0,Math.min(1,take/Math.max(Number(exit.qty),Number.EPSILON)));
      const share:LotShare={quantity:take,notional:take*exit.price,
        fee:exitFee!=null?exitFee*shareRatio:null,
        pnl:exitPnl!=null?exitPnl*shareRatio:null};
      addShare(shares.get(slot.lot.lotId)!,share);
      slot.left-=take;toPlace-=take;
      if(slot.left<=quantityTolerance(slot.left))index++;
    }
  }
  return{lots:ordered.map(lot=>{
    const share=shares.get(lot.lotId)??emptyShare();
    return{...lot,
      exitAllocatedQuantity:round(share.quantity),
      exitAllocatedNotional:round(share.notional),
      allocatedExitFee:share.fee!=null?round(share.fee):null,
      allocatedGrossRealizedPnl:share.pnl!=null?roundTo(share.pnl,9):null,
      allocationSource:lot.allocationSource==='EXPLICIT'?'EXPLICIT' as const:'FIFO' as const,
    };
  }),method:'FIFO'};
}

const round=(value:number)=>Math.round(value*1e12)/1e12;
const roundTo=(value:number,digits:number)=>Number(value.toFixed(digits));

/** Builds the lot ledger for one physical cycle from its own entry fills. One row per Entry lot. */
export function entryLotsFromFills(record:TradeRecord,entries:ExecutionFill[]):EntryLot[]{
  const existing=new Map((record.entryLots??[]).map(lot=>[lot.lotId,lot]));
  const byLot=new Map<string,{fills:ExecutionFill[]}>();
  for(const fill of entries){
    // A fallback WS lot and a later explicit Entry lot can name the same exchange order. Their
    // aliases are not additional quantity. Prefer the explicit identity before grouping partials.
    const aliases=[...existing.values()].filter(lot=>present(fill.orderId)&&(lot.exchangeOrderId===fill.orderId||lot.orderId===fill.orderId));
    const preferred=aliases.find(lot=>lot.allocationSource==='EXPLICIT')??aliases[0];
    const lotId=preferred?.lotId??fill.entryLotId??`lot_${fill.orderId}`;
    const bucket=byLot.get(lotId)??{fills:[]};bucket.fills.push(fill);byLot.set(lotId,bucket);
  }
  const built:[string,EntryLot][]=[];
  for(const [lotId,bucket] of byLot){
    const quantity=bucket.fills.reduce((sum,fill)=>sum+fill.qty,0);
    const notional=bucket.fills.reduce((sum,fill)=>sum+fill.qty*fill.price,0);
    const entryFee=bucket.fills.every(fill=>fill.commissionUsd!=null)?bucket.fills.reduce((sum,fill)=>sum+Number(fill.commissionUsd),0):null;
    const prior=existing.get(lotId);
    built.push([lotId,{
      lotId,
      intentId:prior?.intentId??null,
      orderId:prior?.orderId??bucket.fills[0]?.orderId??null,
      exchangeOrderId:prior?.exchangeOrderId??bucket.fills.find(fill=>present(fill.orderId))?.orderId??null,
      quantity:round(quantity),
      averagePrice:quantity>0?notional/quantity:null,
      filledAt:Math.min(...bucket.fills.map(fill=>fill.executionTime)),
      exitAllocatedQuantity:prior?.exitAllocatedQuantity??0,
      exitAllocatedNotional:prior?.exitAllocatedNotional??0,
      allocatedEntryFee:entryFee!=null?round(entryFee):(prior?.allocatedEntryFee??null),
      allocatedExitFee:prior?.allocatedExitFee??null,
      allocatedGrossRealizedPnl:prior?.allocatedGrossRealizedPnl??null,
      allocationSource:prior?.allocationSource??'UNALLOCATED',
    }]);
  }
  // A lot that existed before but has no fill any more keeps its identity: dropping it would rewrite
  // history rather than account for it.
  for(const [lotId,lot] of existing)if(!byLot.has(lotId)&&!built.some(([,value])=>present(lot.exchangeOrderId)&&value.exchangeOrderId===lot.exchangeOrderId))built.push([lotId,lot]);
  return built.sort((a,b)=>(a[1].filledAt??0)-(b[1].filledAt??0)).map(([,lot])=>lot);
}

/** Only durable identifiers are evidence. Conflicting exact evidence fails closed. */
export function exactCycleRecord(state:RuntimeState, fill:IdentityFill):TradeRecord|undefined {
  const records=[...state.tradeRecords.values()].filter(r=>r.symbol===fill.symbol&&!r.duplicateOf);
  const identical=state.executionFills.filter(f=>f.symbol===fill.symbol&&present(fill.tradeId)&&f.tradeId===fill.tradeId);
  const exactCycles=new Set(identical.map(f=>f.cycleId).filter(present));
  if(exactCycles.size===1){const owned=records.filter(r=>exactCycles.has(r.cycleId??''));if(owned.length===1)return owned[0];}
  const known=state.executionFills.filter(f=>f.symbol===fill.symbol&&(f.tradeId===fill.tradeId||(present(fill.orderId)&&f.orderId===fill.orderId)||(present(fill.clientOrderId)&&f.clientOrderId===fill.clientOrderId)));
  const orders=[...state.entryOrders.values(),...state.tpOrders.values(),...state.manualOrders.values()].filter(o=>o.symbol===fill.symbol&&(
    present(fill.orderId)&&(o.exchangeOrderId===fill.orderId||o.id===fill.orderId)||present(fill.clientOrderId)&&(o.clientOrderId===fill.clientOrderId||o.id===fill.clientOrderId)));
  const cycles=new Set([fill.cycleId,...known.map(f=>f.cycleId),...orders.map(o=>o.cycleId)].filter(present));
  const ids=new Set([fill.orderId,fill.clientOrderId,...orders.flatMap(o=>[o.id,o.exchangeOrderId,o.clientOrderId])].filter(present));
  const positionIds=new Set(orders.flatMap(o=>'positionId' in o?[o.positionId]:[]));
  const matches=records.filter(r=>cycles.has(r.cycleId??'')||r.linkedFillIds.some(id=>id===fill.fillId||known.some(f=>f.fillId===id))||[...r.entryOrderIds,...r.exitOrderIds].some(id=>ids.has(id))||(
    !cycles.size&&r.positionId!=null&&positionIds.has(r.positionId)));
  return matches.length===1?matches[0]:undefined;
}

export function cycleFills(state:RuntimeState, record:TradeRecord):ExecutionFill[] {
  return [...new Map(state.executionFills.filter(f=>f.symbol===record.symbol&&(
    f.cycleId?f.cycleId===record.cycleId:record.linkedFillIds.includes(f.fillId)||[...record.entryOrderIds,...record.exitOrderIds].includes(f.orderId)
  )).map(f=>[`${f.symbol}:${f.tradeId}`,f])).values()];
}

/**
 * The conservation judgement on its own, so a durable row can be re-labelled by the same arithmetic
 * the accounting path uses - and so an old row written under a wrong rule is correctable without
 * rewriting any money field.
 *
 * Conservation is an agreement test, not a "must be flat" test. An OPEN cycle legitimately still
 * holds quantity, and labelling every open record UNCONSERVED would bury a genuinely broken ledger in
 * healthy rows. UNCONSERVED is reserved for a trade that says it is closed while its fills never
 * reached zero; a negative remainder is the stronger LEDGER_INCONSISTENT anomaly.
 */
export function conservationOf(record:Pick<TradeRecord,'direction'|'status'|'observedClosedAt'>,fills:ExecutionFill[]):NonNullable<TradeRecord['ledgerConservation']>{
  const entries=fills.filter(f=>f.side===(record.direction==='LONG'?'BUY':'SELL'));
  const remaining=entries.reduce((n,f)=>n+Number(f.qty),0)-fills.filter(f=>!entries.includes(f)).reduce((n,f)=>n+Number(f.qty),0);
  const eps=quantityTolerance(entries.reduce((n,f)=>n+Number(f.qty),0));
  if(!entries.length)return 'UNKNOWN';
  if(remaining<-eps)return 'LEDGER_INCONSISTENT';
  const expectsFlat=record.status==='CLOSED'||Boolean(record.observedClosedAt);
  return expectsFlat&&Math.abs(remaining)>eps?'UNCONSERVED':'CONSERVED';
}

/**
 * Pure accounting projection; callers explicitly persist on command/event paths.
 *
 * P2: the unit of accounting is the physical cycle, and every Entry execution inside it is a lot.
 * A negative remaining quantity is not a partial close - it is a broken ledger, and it is labelled
 * as one instead of being hidden behind a normal-looking status.
 */
export function accountCycle(record:TradeRecord, fills:ExecutionFill[]):TradeRecord {
  const entries=fills.filter(f=>f.side===(record.direction==='LONG'?'BUY':'SELL')),exits=fills.filter(f=>!entries.includes(f));
  const sum=(rows:ExecutionFill[],fn:(f:ExecutionFill)=>number)=>rows.reduce((n,f)=>n+fn(f),0);
  const entryQty=sum(entries,f=>f.qty),exitQty=sum(exits,f=>f.qty),remaining=entryQty-exitQty,eps=quantityTolerance(entryQty);
  const conserved=entries.length>0&&exits.length>0&&Math.abs(remaining)<=eps;
  const ledgerInconsistent=entries.length>0&&remaining<-eps;
  // One rule for the label, shared with the durable re-label path.
  const conservation:NonNullable<TradeRecord['ledgerConservation']>=conservationOf(record,fills);
  const entryFee=entries.length&&entries.every(f=>f.commissionUsd!=null)?sum(entries,f=>f.commissionUsd!):null;
  const exitFee=exits.length&&exits.every(f=>f.commissionUsd!=null)?sum(exits,f=>f.commissionUsd!):null;
  const fees=entryFee!=null&&exitFee!=null,gross=exits.length?sum(exits,f=>f.realizedPnl):null;
  const trading=fees&&gross!=null?gross-entryFee!-exitFee!:null;
  const fundingKnown=record.fundingAttributionStatus==='EXACT'&&record.funding!=null;
  const net=conserved&&trading!=null&&fundingKnown?trading+record.funding!:null;
  const closed=record.status==='CLOSED'||conserved;
  const closedAt=closed?(record.closedAt??Math.max(...exits.map(f=>f.executionTime))):null;
  const missing=[...(!entries.length?['ENTRY_FACT']:[]),...(!exits.length?['EXIT_FACT']:[]),...(!fees?['FEE_FACT']:[]),...(!conserved?['EXCHANGE_FILL_CONSERVATION']:[])];
  const entryNotional=sum(entries,f=>f.qty*f.price),exitNotional=sum(exits,f=>f.qty*f.price);
  const lots=allocateExitLotsFifo(entryLotsFromFills(record,entries),exits);
  return TradeRecordSchema.parse({...record,positionCycleId:record.positionCycleId??record.cycleId,entryLots:lots.lots,lotAllocationMethod:lots.method,ledgerConservation:conservation,
    entryQty:entries.length?entryQty:record.entryQty,exitQty,remainingQty:entries.length?(Math.abs(remaining)<=eps?0:remaining):null,
    entryAveragePrice:entryQty?entryNotional/entryQty:record.entryAveragePrice,exitAveragePrice:exitQty?exitNotional/exitQty:null,
    entryGrossNotional:entryNotional,exitGrossNotional:exitNotional,entryFee,exitFee,totalFee:fees?entryFee!+exitFee!:null,
    entryFillCount:entries.length,exitFillCount:exits.length,grossRealizedPnl:gross,tradingNetPnlExFunding:trading,
    funding:fundingKnown?record.funding:null,fundingAttributionStatus:fundingKnown?'EXACT':'UNKNOWN',netPnl:net,
    pnlBasis:fundingKnown?'CANONICAL_NET_WITH_FUNDING':'CANONICAL_NET_WITH_FUNDING_UNKNOWN',
    netRoiOnMargin:net!=null&&record.marginUsed?net/record.marginUsed*100:null,netReturnOnNotional:net!=null&&entryNotional?net/entryNotional*100:null,
    // A quantity-negative cycle is an explicit anomaly, never a normal "still partially open" row.
    status:closed?'CLOSED':ledgerInconsistent?'INCOMPLETE':exits.length?'PARTIALLY_CLOSED':record.observedClosedAt?'INCOMPLETE':'OPEN',closedAt,
    durationMs:closedAt!=null&&record.openedAt!=null?Math.max(0,closedAt-record.openedAt):null,
    feeCompleteness:fees?'COMPLETE':'PARTIAL',recordCompleteness:conserved&&fees?'COMPLETE':'PARTIAL',classification:conserved&&fees?'COMPLETE':'PARTIAL',
    missingFacts:missing,integrityFlags:[...new Set([...record.integrityFlags.filter(f=>!['FILL_CONSERVATION_FAILED','CLOSED_NO_EXIT_FACT','LEDGER_INCONSISTENT'].includes(f)),...(ledgerInconsistent?['LEDGER_INCONSISTENT']:[]),...(conservation==='UNCONSERVED'?['FILL_CONSERVATION_FAILED']:[])])],
    entryOrderIds:[...new Set([...record.entryOrderIds,...entries.map(f=>f.orderId)])],exitOrderIds:[...new Set([...record.exitOrderIds,...exits.map(f=>f.orderId)])],
    linkedFillIds:fills.map(f=>f.fillId),feeBreakdown:fills.map(f=>({stage:entries.includes(f)?'ENTRY':'EXIT',asset:f.commissionAsset,amount:f.commission,usd:f.commissionUsd,conversionSource:f.commissionUsd==null?null:'EXCHANGE_COMMISSION'}))});
}
