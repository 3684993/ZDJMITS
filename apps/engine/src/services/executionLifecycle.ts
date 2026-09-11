import type { ManualIntent, ManualOrder, EntryIntent, EntryOrder } from '@zdj/contracts';

/** Shared facts: UNKNOWN is occupied; an unfilled order is never a position reduction. */
export const activeOrderStatus = (status: string) =>
  ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(status);
export const terminalOrderStatus = (status: string) =>
  ['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(status);
export const exitAction = (action: string) => ['REDUCE', 'EMERGENCY_CLOSE'].includes(action);
export function executionScope(environment: string, account: string, symbol: string, side: string) {
  return JSON.stringify([environment, account, symbol.toUpperCase(), side]);
}
export function manualOrderFor(intent: ManualIntent, orders: Iterable<ManualOrder>) {
  return [...orders].find(order => order.symbol === intent.symbol &&
    (order.intentId === intent.id || Boolean(intent.clientOrderId && order.clientOrderId === intent.clientOrderId)));
}
export function manualIntentFromOrder(intent: ManualIntent, order: ManualOrder, positionOpen: boolean): ManualIntent {
  let status: ManualIntent['status'] = intent.status;
  if (order.status === 'UNKNOWN' || order.status === 'NEW') status = 'UNKNOWN';
  else if (['WORKING', 'PARTIALLY_FILLED'].includes(order.status)) status = 'SUBMITTED';
  else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(order.status)) status = order.status as ManualIntent['status'];
  else if (order.status === 'FILLED') status = exitAction(intent.action) && intent.action === 'EMERGENCY_CLOSE' && positionOpen ? 'SUBMITTED' : 'COMPLETED';
  return { ...intent, status, exchangeOrderId: order.exchangeOrderId,
    reason: terminalOrderStatus(order.status) && order.status !== 'FILLED' ? `EXCHANGE_ORDER_${order.status}` : intent.reason,
    updatedAt: Date.now() };
}
export type ManualExecutionRecord = { intent: ManualIntent; order: ManualOrder };
export interface ManualExecutionJournal {
  claim(scope: string, value: ManualExecutionRecord): ManualExecutionRecord;
  save(value: ManualExecutionRecord): void;
}
export type EntryExecutionRecord={intent:EntryIntent;order:EntryOrder;reservation?:unknown};
export interface EntryExecutionJournal {
  claim(scope:string,value:EntryExecutionRecord,retryRejected:boolean):{acquired:boolean;record:EntryExecutionRecord};
  save(value:EntryExecutionRecord):void;
}
