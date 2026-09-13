import type { EntryOrder, Side } from '@zdj/contracts';

export type PendingEntryRiskExposure={id:string;symbol:string;side:Side|'BOTH';notionalUsd:number;reservationId:string|null;orderId:string|null;source:'ORDER'|'RESERVATION'};
export type PendingEntryRiskExposureList=PendingEntryRiskExposure[]&{strictPlannedNotional?:boolean};

const ACTIVE_ORDER=new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const ACTIVE_RESERVATION=new Set(['RESERVED','WORKING']);

export function hasVerifiedNoActiveRisk(order:EntryOrder,now=Date.now()){
  const evidence=(order as any).activeRiskEvidence;
  return order.status==='UNKNOWN'&&(order as any).activeRiskExposure===false&&evidence?.status==='VERIFIED_NO_ACTIVE_RISK'&&Number(evidence.validUntil)>now&&typeof evidence.identityTombstone==='string'&&evidence.identityTombstone.length>0;
}

export function entryOrderOccupiesRisk(order:EntryOrder,now=Date.now()){
  return ACTIVE_ORDER.has(order.status)&&!hasVerifiedNoActiveRisk(order,now);
}

export function entryIdentityTombstone(order:EntryOrder){
  return `ENTRY:${String(order.symbol).toUpperCase()}:${String(order.clientOrderId??order.exchangeOrderId??order.id)}`;
}

/**
 * Converts active reservations / in-flight entry orders into one deduplicated
 * risk exposure per reservation. Orders win over their reservation so a
 * partial fill only reserves the remaining order quantity. Unreserved active
 * orders are still counted fail-closed.
 *
 * Supplying priorityReservationId means the snapshot is for the final JIT
 * validation of that reservation. In that mode the exact planned/actual
 * notional must fit the remaining headroom; routing/preflight snapshots remain
 * capacity-only and may safely clamp recommendations down to finalNotional.
 */
export function collectPendingEntryRiskExposures(state:any,options:{now?:number;excludeReservationId?:string|null;excludeOrderId?:string|null;priorityReservationId?:string|null}={}):PendingEntryRiskExposureList{
  const now=options.now??Date.now(),out:PendingEntryRiskExposure[]=[] ,seenReservations=new Set<string>(),seenOrders=new Set<string>();
  const reservations=[...state.entryReservations.values()].filter((row:any)=>ACTIVE_RESERVATION.has(String(row.status))&&Number(row.expiresAt)>now);
  const current=options.priorityReservationId?state.entryReservations.get(options.priorityReservationId):null;
  const beforeCurrent=(row:any)=>!current||Number(row.createdAt??0)<Number(current.createdAt??0)||(Number(row.createdAt??0)===Number(current.createdAt??0)&&String(row.id)<String(current.id));
  const orders=[...state.entryOrders.values()].filter((row:EntryOrder)=>row.id!==options.excludeOrderId&&entryOrderOccupiesRisk(row,now));
  for(const reservation of reservations){
    if(reservation.id===options.excludeReservationId)continue;
    const order=orders.find((row:EntryOrder)=>row.reservationId===reservation.id);
    const alreadySubmitted=Boolean(order&&['SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(order.status));
    if(current&&!beforeCurrent(reservation)&&!alreadySubmitted)continue;
    if(order){
      const remainingQty=Math.max(0,Number(order.quantity)-Number(order.filledQuantity??0)),notionalUsd=remainingQty*Number(order.price);
      if(Number.isFinite(notionalUsd)&&notionalUsd>0)out.push({id:`order:${order.id}`,symbol:order.symbol,side:order.side,notionalUsd,reservationId:reservation.id,orderId:order.id,source:'ORDER'});
      seenReservations.add(reservation.id);seenOrders.add(order.id);continue;
    }
    const intent=[...state.entryIntents.values()].find((row:any)=>row.reservationId===reservation.id),plan=intent?.allocationPlan??state.allocationPlans.get(reservation.planId),symbol=String(intent?.symbol??plan?.symbol??`${reservation.underlying}${reservation.quoteAsset==='USDC'?'USDC':'USDT'}`),side=(intent?.side??plan?.direction??'BOTH') as Side|'BOTH',notionalUsd=Math.max(0,Number(reservation.notionalUsd??plan?.notionalUsd??0));
    if(Number.isFinite(notionalUsd)&&notionalUsd>0)out.push({id:`reservation:${reservation.id}`,symbol,side,notionalUsd,reservationId:reservation.id,orderId:null,source:'RESERVATION'});
    seenReservations.add(reservation.id);
  }
  for(const order of orders){
    if(seenOrders.has(order.id)||order.reservationId&&seenReservations.has(order.reservationId))continue;
    const remainingQty=Math.max(0,Number(order.quantity)-Number(order.filledQuantity??0)),notionalUsd=remainingQty*Number(order.price);
    if(Number.isFinite(notionalUsd)&&notionalUsd>0)out.push({id:`order:${order.id}`,symbol:order.symbol,side:order.side,notionalUsd,reservationId:order.reservationId??null,orderId:order.id,source:'ORDER'});
  }
  const result=out.sort((a,b)=>a.id.localeCompare(b.id)) as PendingEntryRiskExposureList;
  if(options.priorityReservationId)Object.defineProperty(result,'strictPlannedNotional',{value:true,enumerable:false});
  return result;
}
