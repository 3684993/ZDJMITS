import {testnetFundsOnlyEntry} from '@zdj/core';
/** The exchange availableBalance already incorporates its accepted orders/positions.
 * Only live, unsubmitted local spending promises need an additional deduction. UNKNOWN and
 * historic claims stay in the risk journal; they are not a second debit of exchange funds.
 */
export function reservationDebitsAvailableFunds(state:any,row:any,now=Date.now()):boolean {
  if(!['RESERVED','WORKING'].includes(String(row.status))||!(Number(row.expiresAt)>now))return false;
  if(!testnetFundsOnlyEntry(state.settings))return true;
  const orders=[...(state.entryOrders?.values()??[])].filter((order:any)=>order.reservationId===row.id||Boolean(row.intentId)&&order.intentId===row.intentId);
  return orders.length===0 ? row.status==='RESERVED' : orders.every((order:any)=>order.status==='NEW'&&!order.exchangeOrderId);
}
