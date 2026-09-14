import { TradeRecordSchema, type ExecutionFill, type TradeRecord } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';

export const quantityTolerance = (qty:number) => Math.max(1e-10, Math.abs(qty)*1e-8);
const present = (s:unknown):s is string => typeof s==='string' && s.length>0;
type IdentityFill = Pick<ExecutionFill,'symbol'|'orderId'|'clientOrderId'|'tradeId'> & {cycleId?:string|null;fillId?:string};

/** Only durable identifiers are evidence. Conflicting exact evidence fails closed. */
export function exactCycleRecord(state:RuntimeState, fill:IdentityFill):TradeRecord|undefined {
  const records=[...state.tradeRecords.values()].filter(r=>r.symbol===fill.symbol&&!r.duplicateOf);
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

/** Pure accounting projection; callers explicitly persist on command/event paths. */
export function accountCycle(record:TradeRecord, fills:ExecutionFill[]):TradeRecord {
  const entries=fills.filter(f=>f.side===(record.direction==='LONG'?'BUY':'SELL')),exits=fills.filter(f=>!entries.includes(f));
  const sum=(rows:ExecutionFill[],fn:(f:ExecutionFill)=>number)=>rows.reduce((n,f)=>n+fn(f),0);
  const entryQty=sum(entries,f=>f.qty),exitQty=sum(exits,f=>f.qty),remaining=entryQty-exitQty,eps=quantityTolerance(entryQty);
  const conserved=entries.length>0&&exits.length>0&&Math.abs(remaining)<=eps;
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
  return TradeRecordSchema.parse({...record,entryQty:entries.length?entryQty:record.entryQty,exitQty,remainingQty:entries.length?(Math.abs(remaining)<=eps?0:remaining):null,
    entryAveragePrice:entryQty?entryNotional/entryQty:record.entryAveragePrice,exitAveragePrice:exitQty?exitNotional/exitQty:null,
    entryGrossNotional:entryNotional,exitGrossNotional:exitNotional,entryFee,exitFee,totalFee:fees?entryFee!+exitFee!:null,
    entryFillCount:entries.length,exitFillCount:exits.length,grossRealizedPnl:gross,tradingNetPnlExFunding:trading,
    funding:fundingKnown?record.funding:null,fundingAttributionStatus:fundingKnown?'EXACT':'UNKNOWN',netPnl:net,
    pnlBasis:fundingKnown?'CANONICAL_NET_WITH_FUNDING':'CANONICAL_NET_WITH_FUNDING_UNKNOWN',
    netRoiOnMargin:net!=null&&record.marginUsed?net/record.marginUsed*100:null,netReturnOnNotional:net!=null&&entryNotional?net/entryNotional*100:null,
    status:closed?'CLOSED':exits.length?'PARTIALLY_CLOSED':record.observedClosedAt?'INCOMPLETE':'OPEN',closedAt,
    durationMs:closedAt!=null&&record.openedAt!=null?Math.max(0,closedAt-record.openedAt):null,
    feeCompleteness:fees?'COMPLETE':'PARTIAL',recordCompleteness:conserved&&fees?'COMPLETE':'PARTIAL',classification:conserved&&fees?'COMPLETE':'PARTIAL',
    missingFacts:missing,integrityFlags:record.integrityFlags.filter(f=>!['FILL_CONSERVATION_FAILED','CLOSED_NO_EXIT_FACT'].includes(f)),
    entryOrderIds:[...new Set([...record.entryOrderIds,...entries.map(f=>f.orderId)])],exitOrderIds:[...new Set([...record.exitOrderIds,...exits.map(f=>f.orderId)])],
    linkedFillIds:fills.map(f=>f.fillId),feeBreakdown:fills.map(f=>({stage:entries.includes(f)?'ENTRY':'EXIT',asset:f.commissionAsset,amount:f.commission,usd:f.commissionUsd,conversionSource:f.commissionUsd==null?null:'EXCHANGE_COMMISSION'}))});
}
