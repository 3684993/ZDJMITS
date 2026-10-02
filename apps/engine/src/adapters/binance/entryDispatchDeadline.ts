/** Positive evidence that an Entry POST/PUT was refused before any HTTP request was created. */
export class EntryExecutionExpiredBeforeDispatchError extends Error {
  readonly code = 'ENTRY_DECISION_EXECUTION_EXPIRED';
  readonly wireAttempted = false;
  constructor() {
    super('ENTRY_DECISION_EXECUTION_EXPIRED');
    this.name = 'EntryExecutionExpiredBeforeDispatchError';
  }
}

/** Synchronous, no-I/O authorization check. Throw to refuse a not-yet-dispatched Entry write. */
export type EntryDispatchGuard = () => void;

/** Positive evidence that the guard rejected this POST/PUT before creating its HTTP request. */
export class EntryDispatchGuardRejectedError extends Error {
  readonly code = 'ENTRY_DISPATCH_GUARD_REJECTED';
  readonly wireAttempted = false;
  constructor(readonly reason:string) {
    super(`ENTRY_DISPATCH_GUARD_REJECTED:${reason}`);
    this.name = 'EntryDispatchGuardRejectedError';
  }
}

export function isEntryOrderWrite(method:string,purpose:string|undefined):boolean {
  return (purpose==='NEW_ENTRY'||purpose==='ENTRY_REPRICE')&&(method==='POST'||method==='PUT');
}

/** Only call before request creation; never relabel an in-flight write or its ACK as unsent. */
export function assertEntryDispatchGuard(guard:EntryDispatchGuard|undefined):void {
  if(!guard)return;
  try{
    const result:unknown=guard();
    // TypeScript permits async functions where () => void is expected. Fail closed rather than
    // silently dispatching before such a check settles, and handle its eventual rejection.
    if(result&&typeof (result as {then?:unknown}).then==='function'){
      void Promise.resolve(result).catch(()=>{});
      throw new Error('ASYNC_ENTRY_DISPATCH_GUARD_UNSUPPORTED');
    }
  }catch(error){
    if(error instanceof EntryDispatchGuardRejectedError||error instanceof EntryExecutionExpiredBeforeDispatchError)throw error;
    throw new EntryDispatchGuardRejectedError(error instanceof Error?error.message:String(error));
  }
}

/** Old orders keep their existing policy; never manufacture a new clock during recovery. */
export function entryDispatchDeadline(order: { decisionExecutionExpiresAt?: number; absoluteExpiresAt?: number }): number | undefined {
  if (order.decisionExecutionExpiresAt === undefined) return undefined;
  if (typeof order.decisionExecutionExpiresAt !== 'number' || !Number.isFinite(order.decisionExecutionExpiresAt)
    || typeof order.absoluteExpiresAt !== 'number' || !Number.isFinite(order.absoluteExpiresAt)) {
    throw new EntryExecutionExpiredBeforeDispatchError();
  }
  return Math.min(order.decisionExecutionExpiresAt, order.absoluteExpiresAt);
}

export function assertEntryDispatchDeadline(expiresAt: number | undefined, now = Date.now()): void {
  if (expiresAt === undefined) return;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || now >= expiresAt) {
    throw new EntryExecutionExpiredBeforeDispatchError();
  }
}
