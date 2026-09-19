import type { EntryOrder, Side } from '@zdj/contracts';

export type PendingEntryRiskExposure={id:string;symbol:string;side:Side|'BOTH';notionalUsd:number;reservationId:string|null;orderId:string|null;source:'ORDER'|'RESERVATION'};
export type PendingEntryRiskExposureList=PendingEntryRiskExposure[]&{strictPlannedNotional?:boolean};

const ACTIVE_ORDER=new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const TERMINAL_ORDER=new Set(['FILLED','CANCELED','EXPIRED','REJECTED']);
const ACTIVE_RESERVATION=new Set(['RESERVED','WORKING']);

export function hasVerifiedNoActiveRisk(order:EntryOrder,now=Date.now()){
  const evidence=(order as any).activeRiskEvidence;
  return (order as any).activeRiskExposure===false&&evidence?.status==='VERIFIED_NO_ACTIVE_RISK'&&Number.isFinite(Number(evidence.checkedAt))&&Number(evidence.validUntil)>now&&evidence.identityTombstone===entryIdentityTombstone(order);
}

export function entryHasUnresolvedExchangeTerminalRisk(order:EntryOrder,now=Date.now()){
  return TERMINAL_ORDER.has(order.status)&&(order as any).exchangeTerminalStatus==='UNKNOWN'&&!hasVerifiedNoActiveRisk(order,now);
}

export function isHistoricalUnknownEntryOrder(order:EntryOrder){
  return order.status==='UNKNOWN'||(TERMINAL_ORDER.has(order.status)&&(order as any).exchangeTerminalStatus==='UNKNOWN');
}

export function entryOrderOccupiesRisk(order:EntryOrder,now=Date.now()){
  if(ACTIVE_ORDER.has(order.status))return order.status==='UNKNOWN'?!hasVerifiedNoActiveRisk(order,now):true;
  return entryHasUnresolvedExchangeTerminalRisk(order,now);
}

/** True when a submitted-but-unverified entry has been positively proven to hold no exchange order,
 *  no fill and no position. The UNKNOWN row itself is never rewritten. */
export function entryClaimReleasedByExchangeFacts(order:EntryOrder,now=Date.now()){
  return order.status==='UNKNOWN'&&!order.exchangeOrderId&&Number(order.filledQuantity??0)===0&&hasVerifiedNoActiveRisk(order,now);
}

/** Durable entry scope is owned only while the submission can still become real risk. */
export function durableEntryClaimActive(order:EntryOrder,now=Date.now()){
  return ACTIVE_ORDER.has(order.status)&&!entryClaimReleasedByExchangeFacts(order,now);
}

/**
 * Tier 0 deliberately equals the historical 5-minute evidence TTL, so a fresh or merely
 * once-proven UNKNOWN keeps exactly the cadence it had before tiering existed. Only an order
 * that has been re-proven identical several times in a row may wait longer, and any new
 * exchange fact resets it immediately.
 */
export const UNKNOWN_RISK_EVIDENCE_TIER_MS=[5*60_000,15*60_000,30*60_000] as const;
export const UNKNOWN_RISK_AUDIT_PROMOTE_AFTER=3;
export const UNKNOWN_RISK_AUDIT_SUMMARY_INTERVAL_MS=60*60_000;

export type RemoteRiskAudit={tier:number;consecutive:number;nextAuditAt:number;factHash:string|null;verifiedCount:number;lastAuditAt:number;lastEventAt:number;lastEmittedReason:string|null};

export function remoteRiskAudit(order:EntryOrder):RemoteRiskAudit|null{
  const row=(order as any).remoteAudit;
  if(!row||typeof row!=='object')return null;
  const tier=Math.max(0,Math.min(UNKNOWN_RISK_EVIDENCE_TIER_MS.length-1,Number(row.tier)||0));
  return{tier,consecutive:Number(row.consecutive)||0,nextAuditAt:Number(row.nextAuditAt)||0,factHash:typeof row.factHash==='string'?row.factHash:null,
    verifiedCount:Number(row.verifiedCount)||0,lastAuditAt:Number(row.lastAuditAt)||0,lastEventAt:Number(row.lastEventAt)||0,
    lastEmittedReason:typeof row.lastEmittedReason==='string'?row.lastEmittedReason:null};
}

const NO_RISK_ABSENCE_SOURCES=['BINANCE_EXACT_ORDER_NOT_FOUND','BINANCE_OPEN_ORDERS_IDENTITY_ABSENT','BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT'];

/** Category B: a historical UNKNOWN whose absence of risk has been proven by every remote source. */
export function historicalNoRiskEligible(order:EntryOrder,now=Date.now()){
  if(order.status!=='UNKNOWN'||!entryClaimReleasedByExchangeFacts(order,now))return false;
  const evidence=(order as any).activeRiskEvidence;
  if(!NO_RISK_ABSENCE_SOURCES.every(source=>(evidence?.sources??[]).includes(source)))return false;
  return (evidence?.sources??[]).includes('BINANCE_LONG_SHORT_POSITION_ZERO')||(evidence?.sources??[]).includes('POSITION_PRESENT_PROVEN_OTHER_CYCLE');
}

/** True when the next active remote audit of a promoted historical UNKNOWN is not yet due. */
export function remoteRiskAuditDeferred(order:EntryOrder,now=Date.now()){
  const audit=remoteRiskAudit(order);
  if(!audit||audit.tier<=0)return false;
  return historicalNoRiskEligible(order,now)&&Number(audit.nextAuditAt)>now;
}

export function riskFactHash(evidence:{sources?:string[];reason?:string|null}){
  return `${[...(evidence?.sources??[])].sort().join(',')}|${evidence?.reason??''}`;
}

export function advanceRemoteRiskAudit(previous:RemoteRiskAudit|null,evidence:{sources?:string[];reason?:string|null},now=Date.now()):RemoteRiskAudit{
  const factHash=riskFactHash(evidence);
  const identical=Boolean(previous&&previous.factHash===factHash);
  const consecutive=identical?Math.max(1,previous!.consecutive)+1:1;
  const tier=Math.max(0,Math.min(UNKNOWN_RISK_EVIDENCE_TIER_MS.length-1,consecutive-UNKNOWN_RISK_AUDIT_PROMOTE_AFTER));
  return{tier,consecutive,nextAuditAt:now+UNKNOWN_RISK_EVIDENCE_TIER_MS[tier],factHash,
    verifiedCount:(previous?.verifiedCount??0)+1,lastAuditAt:now,lastEventAt:previous?.lastEventAt??0,lastEmittedReason:previous?.lastEmittedReason??null};
}

/** Any conflicting or incomplete fact returns the order to the fresh, high-frequency tier. */
export function resetRemoteRiskAudit(now=Date.now()):RemoteRiskAudit{
  return{tier:0,consecutive:0,nextAuditAt:now,factHash:null,verifiedCount:0,lastAuditAt:now,lastEventAt:0,lastEmittedReason:null};
}

/** Emit only when something is actually new; identical proofs become a summary instead of spam. */
export function shouldEmitNoRiskEvent(order:EntryOrder,audit:RemoteRiskAudit,reason:string,now=Date.now()){
  const previous=remoteRiskAudit(order);
  if(!previous||!previous.lastEventAt)return true;
  return previous.lastEmittedReason!==reason||(previous.factHash&&audit.factHash!==previous.factHash)||audit.tier!==previous.tier||now-audit.lastEventAt>=UNKNOWN_RISK_AUDIT_SUMMARY_INTERVAL_MS;
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
