/**
 * A stand-in for the J2 portfolio admission, for tests that are not testing admission itself.
 *
 * `RuntimeState.reserveEntry` refuses to create a durable reservation without a risk binding, and
 * `EntryCoordinator` refuses to reach that call without an admission object that issued the ticket.
 * Both are deliberately un-bypassable in production, so any fixture that walks the normal entry path
 * has to say what is standing in. This is that statement: a fixed binding, no evaluation, and no
 * claim to be the real snapshot - the real behaviour is covered by j2PortfolioAdmissionHostile.
 */

export const DETERMINISTIC_RISK_GENERATION = 1;
export const DETERMINISTIC_SNAPSHOT_HASH = `v396r${'d'.repeat(64)}`;

export function deterministicAdmission(now = Date.now()) {
  const binding = () => ({
    riskGeneration: DETERMINISTIC_RISK_GENERATION, snapshotHash: DETERMINISTIC_SNAPSHOT_HASH,
    evaluatedAt: now - 1, expiresAt: now + 300_000, profileVersion: 'v396-fixture-profile',
    factCoverage: { assets: 'VERIFIED', marginTier: 'VERIFIED', cashFlow: 'VERIFIED', ownership: 'VERIFIED', account: 'VERIFIED' },
    limitingConstraints: [] as string[], scenarioSet: [] as string[],
  });
  const ticket = () => ({
    riskGeneration: DETERMINISTIC_RISK_GENERATION, snapshotHash: DETERMINISTIC_SNAPSHOT_HASH, profileVersion: 'v396-fixture-profile',
    evaluatedAt: now - 1, expiresAt: now + 300_000, candidateKey: 'fixture', coverage: binding().factCoverage, limits: [], reasons: [],
  });
  return {
    gate: () => ({ allowed: true, reason: 'PORTFOLIO_ADMISSION_AUTHORISED', binding: binding() }),
    admit: () => ({
      allowed: true, reason: 'PORTFOLIO_ADMISSION_AUTHORISED', reasons: [], limits: [], ticket: ticket(),
      snapshot: { grossNotionalUsd: 0, capitalAtRiskUsd: 0, drawdownPct: 0, blockers: [], complete: true },
      stress: { blockers: [], limitingConstraints: [], scenarios: [] }, capacity: { blockers: [], executable: true },
    }),
    refresh: () => null, serialize: () => ({}), restore: () => null, state: () => ({}), snapshot: () => null, denies: () => null,
  };
}

/** Installs the stand-in on a state object the same way appRuntime installs the real one. */
export function installDeterministicAdmission(state: any, now = Date.now()) {
  const admission = deterministicAdmission(now);
  state.riskAdmission = admission;
  state.entryRiskGate = admission.gate;
  return admission;
}
