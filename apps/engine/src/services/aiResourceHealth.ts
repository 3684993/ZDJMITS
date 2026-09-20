/**
 * Primary/Scout health semantics. A gap between runs is only a fault when the engine actually had
 * something to dispatch; supply-side idleness must not be reported as a degraded model.
 */
export type PrimaryIdleInput = {
  paused: boolean;
  ready: boolean;
  eligible: number;
  executableCandidates: number;
  poolResidents: number;
  pendingEntries: number;
  maxPendingEntries: number;
  modelOnline: boolean;
  lastRunAgeMs: number | null;
  idleReason: string | null;
};

export const SUPPLY_EXPLAINED_PRIMARY_IDLE = new Set([
  'WAITING_CANDIDATE',
  'WAITING_EXECUTION_CAPACITY',
  'AI_RESOURCE_BUSY',
  'AI_PRIMARY_CIRCUIT_OPEN',
]);

export function primaryBrainHealth(input: PrimaryIdleInput): { status: 'PAUSED' | 'DEGRADED' | 'READY' | 'UNAVAILABLE'; reason: string; unexplainedIdle: boolean } {
  if (input.paused) return { status: 'PAUSED', reason: 'RUNTIME_PAUSED', unexplainedIdle: false };
  if (!input.modelOnline) return { status: 'UNAVAILABLE', reason: 'PRIMARY_MODEL_OFFLINE', unexplainedIdle: false };
  const idleBeyondThreshold = input.lastRunAgeMs !== null && input.lastRunAgeMs > 10 * 60_000;
  const dispatchable = input.ready && input.eligible > 0 && input.executableCandidates > 0 && input.poolResidents > 0 && input.pendingEntries < input.maxPendingEntries;
  const unexplainedIdle = idleBeyondThreshold && dispatchable && !SUPPLY_EXPLAINED_PRIMARY_IDLE.has(input.idleReason ?? '');
  if (unexplainedIdle) return { status: 'DEGRADED', reason: 'DEGRADED_UNEXPLAINED_IDLE', unexplainedIdle: true };
  if (idleBeyondThreshold && !dispatchable) return { status: 'READY', reason: 'IDLE_NO_DISPATCHABLE_CANDIDATE', unexplainedIdle: false };
  if (idleBeyondThreshold && SUPPLY_EXPLAINED_PRIMARY_IDLE.has(input.idleReason ?? '')) return { status: 'READY', reason: `IDLE_${input.idleReason}`, unexplainedIdle: false };
  return { status: 'READY', reason: 'READY', unexplainedIdle: false };
}
