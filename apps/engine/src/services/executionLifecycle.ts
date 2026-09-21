import type { ManualIntent, ManualOrder, EntryIntent, EntryOrder } from '@zdj/contracts';

/** Shared facts: UNKNOWN is occupied; an unfilled order is never a position reduction. */
export const activeOrderStatus = (status: string) =>
  ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(status);
export const terminalOrderStatus = (status: string) =>
  ['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(status);
export const exitAction = (action: string) => ['REDUCE', 'EMERGENCY_CLOSE'].includes(action);
/**
 * Journal and claim identity. The fourth element stays the persisted vocabulary ('ENTRY' for
 * an entry intent, LONG/SHORT for a manual exit) until an explicit, reversible migration
 * exists, because a changed key silently orphans every already-occupied claim. A value
 * outside that vocabulary is a programming error, not a new bucket: it throws instead of
 * minting a fresh identity that no recovery path would ever find.
 */
const PERSISTED_SCOPE_SIDES = new Set(['ENTRY', 'LONG', 'SHORT', 'BOTH']);
export function executionScope(environment: string, account: string, symbol: string, side: string) {
  if (!PERSISTED_SCOPE_SIDES.has(side)) throw new Error(`EXECUTION_SCOPE_SIDE_UNSUPPORTED: ${String(side)}`);
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
