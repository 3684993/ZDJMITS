import {EXCHANGE_OPEN_ORDER_STATUSES,ORDER_TERMINAL_STATUSES,exchangeOrderIdentityMatch,type OpenOrderReadback} from '../services/currentOpenOrders.js';

export function entryCancelEligibility(order:any,current:OpenOrderReadback<any>|null|undefined,now=Date.now()) {
  const deny=(status:number,code:string,message:string)=>({allowed:false,status,code,message});
  if(!order)return deny(404,'ENTRY_ORDER_NOT_FOUND','本机没有对应建仓订单身份；未发送取消请求。');
  if(ORDER_TERMINAL_STATUSES.has(String(order.status)))return deny(409,'ENTRY_ORDER_ALREADY_TERMINAL',`订单已处于终态 ${order.status}，无需重复取消。`);
  if(!['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(String(order.status)))return deny(409,'ENTRY_ORDER_NOT_ACTIVE','订单状态不支持取消。');
  if(!current||current.status!=='READY'||!Number.isFinite(current.verifiedAt)||!Number.isFinite(current.validUntil)||
    now<Number(current.verifiedAt)||now>Number(current.validUntil))return deny(503,'EXCHANGE_OPEN_ORDERS_READBACK_UNAVAILABLE','没有新鲜的完整交易所活动订单快照；等待对账完成后重试。');
  const matches=current.items.filter(row=>EXCHANGE_OPEN_ORDER_STATUSES.has(String(row.status))&&exchangeOrderIdentityMatch(order,row));
  if(matches.length!==1)return deny(409,'ENTRY_NOT_CONFIRMED_OPEN_ON_EXCHANGE','最近完整快照没有唯一确认此活动订单；历史/未确认记录不可直接取消。');
  return{allowed:true,status:200,code:'ENTRY_CONFIRMED_OPEN',message:'交易所完整快照已确认该订单活动。'};
}
