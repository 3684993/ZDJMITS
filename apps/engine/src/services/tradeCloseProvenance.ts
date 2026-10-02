import type {RuntimeState} from '../state/runtimeState.js';
import {exchangeOrderIdentityMatch} from './currentOpenOrders.js';

export type CloseProvenance='OPEN'|'TP'|'SYSTEM_EXIT'|'SYSTEM_MANUAL'|'EXCHANGE_CLOSE'|'MIXED'|'CONFLICT'|'UNKNOWN';
/** Execution style (maker/taker), a client-id prefix, or a legacy closeReason is not an owner proof. */
export function exitFillProvenance(fills:any[],state:RuntimeState,cycleId?:string|null):CloseProvenance {
  if(!fills.length)return'UNKNOWN';
  const sources=new Set<CloseProvenance>();
  for(const fill of fills){
    const proof=state.orderProvenance?.resolve?.({symbol:fill.symbol,clientOrderId:fill.clientOrderId,exchangeOrderId:fill.orderId});
    if(proof?.proof?.some((item:string)=>item.startsWith('PROVENANCE_ROLE_CONFLICT')))return'CONFLICT';
    const rows=(proof?.status==='SYSTEM_PROVEN'?proof.rows:[]).filter((row:any)=>!cycleId||!row.cycleId||row.cycleId===cycleId);
    const roles=new Set<string>(rows.map((row:any)=>String(row.role)));
    const identity={symbol:fill.symbol,clientOrderId:fill.clientOrderId,exchangeOrderId:fill.orderId};
    if(!roles.size){
      const sameCycle=(order:any)=>(!cycleId||order.cycleId===cycleId)&&exchangeOrderIdentityMatch(order,identity);
      if([...state.tpOrders.values()].some(sameCycle))roles.add('TP');
      if([...state.manualOrders.values()].some(order=>sameCycle(order)&&order.reduceOnly===true))roles.add('MANUAL');
    }
    if(roles.size>1)return'CONFLICT';
    const role=[...roles][0];
    if(role==='TP')sources.add('TP');
    else if(role==='EXIT')sources.add('SYSTEM_EXIT');
    else if(role==='MANUAL')sources.add('SYSTEM_MANUAL');
    else if(fill.attributionStatus==='EXTERNAL_OR_UNLINKED'&&['EXCHANGE_AUDIT','USER_DATA_WS'].includes(String(fill.source)))sources.add('EXCHANGE_CLOSE');
    else sources.add('UNKNOWN');
  }
  if(sources.has('UNKNOWN'))return'UNKNOWN';
  return sources.size===1?[...sources][0]:'MIXED';
}

export function tradeCloseProvenance(record:any,state:RuntimeState):CloseProvenance {
  if(record.closedAt==null&&!record.observedClosedAt)return'OPEN';
  const orderIds=new Set<string>((record.exitOrderIds??[]).filter((id:any)=>typeof id==='string'&&id.length>0));
  const linked=new Set<string>(record.linkedFillIds??[]),entrySide=record.direction==='LONG'?'BUY':'SELL';
  const fills=state.executionFills.filter((fill:any)=>fill.symbol===record.symbol&&fill.direction===record.direction&&fill.side!==entrySide&&
    (!record.cycleId||!fill.cycleId||record.cycleId===fill.cycleId)&&
    (orderIds.has(String(fill.orderId??''))||orderIds.has(String(fill.clientOrderId??''))||linked.has(fill.fillId)));
  // A subset of exit fills cannot prove the owner of the whole close.
  if([...orderIds].some(id=>!fills.some(fill=>fill.orderId===id||fill.clientOrderId===id)))return'UNKNOWN';
  const quantity=fills.reduce((sum,fill)=>sum+Number(fill.qty??0),0),expected=Number(record.exitQty??record.entryQty??0);
  if(expected>0&&Math.abs(expected-quantity)>Math.max(1e-10,expected*1e-8))return'UNKNOWN';
  return exitFillProvenance(fills,state,record.cycleId);
}
