import type {EntryIntent} from '@zdj/contracts';

/** Inference time is separate from the lifetime of an accepted PLACE authorization. */
export const ENTRY_DECISION_EXECUTION_WINDOW_MS = 60_000;
type DecisionClock = Pick<EntryIntent,'decisionCompletedAt'|'decisionExecutionExpiresAt'>;

export function entryDecisionClockBlock(clock:DecisionClock,now=Date.now()):string|null {
  const {decisionCompletedAt:start,decisionExecutionExpiresAt:end}=clock;
  // Historical journal entries retain their original authorization/TTL; recovery never re-arms them.
  if(start===undefined&&end===undefined)return null;
  if(typeof start!=='number'||typeof end!=='number'||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||start>now||end!==start+ENTRY_DECISION_EXECUTION_WINDOW_MS)
    return 'ENTRY_DECISION_CLOCK_INVALID';
  return now>=end?'ENTRY_DECISION_EXECUTION_EXPIRED':null;
}
