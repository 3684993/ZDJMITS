const ACTIVE=new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const TERMINAL=new Set(['FILLED','CANCELED','EXPIRED','REJECTED']);

export function entryCancelEligibility(order:any,current:{status:string;items:any[]}|null){
  if(!order)return{allowed:false,status:404,code:'ENTRY_ORDER_NOT_FOUND',message:'建仓订单身份不存在。'};
  if(TERMINAL.has(String(order.status)))return{allowed:false,status:409,code:'ENTRY_ORDER_ALREADY_TERMINAL',message:`订单已处于终态 ${order.status}，无需重复取消。`};
  if(!ACTIVE.has(String(order.status)))return{allowed:false,status:409,code:'ENTRY_ORDER_NOT_ACTIVE',message:`订单状态 ${String(order.status)} 不支持取消。`};
  if(!current||current.status!=='READY')return{allowed:false,status:503,code:'EXCHANGE_OPEN_ORDERS_READBACK_UNAVAILABLE',message:'当前没有新鲜的交易所活动订单快照；等待对账完成后重试。'};
  const present=current.items.some(row=>row.id===order.id||row.clientOrderId===order.clientOrderId||Boolean(row.exchangeOrderId&&row.exchangeOrderId===order.exchangeOrderId));
  if(!present)return{allowed:false,status:409,code:'ENTRY_NOT_CONFIRMED_OPEN_ON_EXCHANGE',message:'最近一次交易所活动订单快照未包含此身份；它是历史/未确认记录，未发送取消请求。'};
  return{allowed:true,status:200,code:'ENTRY_CONFIRMED_OPEN',message:'交易所最近一次完整快照确认订单活动。'};
}
