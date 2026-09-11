import type { EntryOrder } from '@zdj/contracts';

/** Positive pre-submit rejection evidence, plus absence of a durable/wire attempt. */
export function recoverUnsubmittedEntry(order:EntryOrder, durableIntentIds:Set<string>, events:Array<{type:string;payload:any}>) {
  if(order.status!=='UNKNOWN'||order.exchangeOrderId||order.filledQuantity>0||durableIntentIds.has(order.intentId))return null;
  const chain=events.filter(e=>e.payload?.intentId===order.intentId);
  if(chain.some(e=>e.type==='ENTRY_SUBMIT_ATTEMPTED'))return null;
  if(!chain.some(e=>e.type==='ENTRY_ORDER_BLOCKED'&&e.payload?.stage==='BINANCE_SUBMIT'&&['RISK_MAX_POSITIONS','AI_AUTHORIZATION_EXPIRED','EXECUTION_PERMISSION_CHANGED'].includes(e.payload?.reason)))return null;
  return {...order,status:'REJECTED' as const,factSource:'LOCAL_NOT_SUBMITTED',updatedAt:Date.now()};
}
