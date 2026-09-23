import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const ts8 = (t) => new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const led = new DatabaseSync('D:/MITS/data/v396-ownership.sqlite', { readOnly: true });
const store = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const rows = led.prepare('select scope, cycle_id, payload from v396_owners order by cycle_id').all().map((r) => ({ scope: r.scope, rowVersion: Number(r.version), ...JSON.parse(String(r.payload)) }));
const positions = store.prepare("select payload from runtime_entities where kind='positions'").all().map((r) => JSON.parse(String(r.payload)));
const openCycles = new Map(positions.map((p) => [String(p.cycleId), p]));
const byCycle = new Map();
for (const r of rows) (byCycle.get(r.cycleId) ?? byCycle.set(r.cycleId, []).get(r.cycleId)).push(r);
const duplicates = [...byCycle.entries()].filter(([, v]) => v.length > 1);
const conflicting = duplicates.filter(([, v]) => v.some((r) => r.ownerState === 'AI_ACTIVE') && v.some((r) => r.ownerState === 'HUMAN_MANAGED'));
const sideOf = (scope) => JSON.parse(String(scope))[3];
const tally = {};
for (const r of rows) tally[`${sideOf(r.scope)}|${r.ownerState}`] = (tally[`${sideOf(r.scope)}|${r.ownerState}`] ?? 0) + 1;
const closeout = await (await fetch('http://127.0.0.1:8080/api/v3/diagnostics/closeout', { signal: AbortSignal.timeout(25_000) })).json();
const evSince = store.prepare('select count(*) n from runtime_events where (type LIKE \'%SUBMIT%\' OR type LIKE \'%ORDER_CREATED%\' OR type LIKE \'%ENTRY_FILLED%\' OR type LIKE \'%CANCEL%\') and ts >= ?').get(1790128800000).n;

const evidence = {
  findingId: 'ownership-scope-key-divergence-20260923',
  generatedAtUtc8: ts8(Date.now()),
  severity: 'P1',
  summary: 'The V3.9.6 runtime derives an ownership scope from the position side (LONG/SHORT), while the C2 migration wrote its subjects under the persisted entry-intent side "ENTRY". The two keys never collide, so every migrated cycle is invisible to the runtime, which then re-initialises ownership from scratch: 28 of 29 cycles now carry two owner rows, and 6 of them assert HUMAN_MANAGED and AI_ACTIVE at the same time.',
  introducedBy: 'my own phase C2 subject derivation (executionScope(environment, credentialRef, SYMBOL, "ENTRY")); the migration itself reported 0 AI_ACTIVE and preserved 27 HUMAN_MANAGED, so the C-phase invariant held only against the keys the migration could see',
  mechanism: {
    migrationKeySource: 'phase-c-d/phaseC2-migrate.mjs -> executionScope(env, cred, symbol, "ENTRY")',
    runtimeKeySource: 'apps/engine/src/services/ownershipRuntime.ts:35 uses subject.positionSide; v396ExitRuntime.ts:64 uses subject.side',
    persistedVocabularyWarning: 'apps/engine/src/services/executionLifecycle.ts:10-13 states the fourth scope element must stay the persisted vocabulary ("ENTRY" for an entry intent) because a changed key silently orphans every already-occupied claim - the divergence is exactly that failure mode, reached from the other direction',
  },
  ownershipLedger: {
    totalRows: rows.length,
    distinctCycles: byCycle.size,
    tallyByScopeSideAndState: tally,
    cyclesWithMultipleOwnerRows: duplicates.length,
    cyclesWithContradictoryAuthority: conflicting.length,
    contradictoryExamples: conflicting.slice(0, 6).map(([cycleId, v]) => ({
      cycleId,
      openPositionSymbol: openCycles.get(cycleId)?.symbol ?? null,
      storeManagementStatus: openCycles.get(cycleId)?.managementStatus ?? null,
      rows: v.map((r) => ({ scopeSide: sideOf(r.scope), ownerState: r.ownerState, ownerVersion: r.ownerVersion, planRef: r.planRef ?? null, deadlineUtc8: r.deadline ? ts8(r.deadline) : null, reason: r.reason })),
    })),
    aiActiveOwners: rows.filter((r) => r.ownerState === 'AI_ACTIVE').map((r) => ({ cycleId: r.cycleId, scopeSide: sideOf(r.scope), reason: r.reason, planRef: r.planRef, deadlineUtc8: r.deadline ? ts8(r.deadline) : null, openPosition: openCycles.has(r.cycleId) })),
  },
  safetyFactsAtDetection: {
    exchangeWrites: closeout.productionWriteBoundary,
    orderLifecycleEventsSinceV396Start: evSince,
    executionMode: closeout.runtime?.settings?.connections?.executionMode ?? 'READ_ONLY',
    note: 'No exchange write occurred, so no trade was placed or closed under the wrong authority; the defect is in the authority bookkeeping and would become executable if aiExitAuthority were moved to ENFORCE.',
  },
  shadowWindowCounts: {
    sinceUtc8: ts8(1790128800000),
    AI_EXIT_PLAN_UNPROVEN: store.prepare("select count(*) n from runtime_events where type='AI_EXIT_PLAN_UNPROVEN' and ts>=?").get(1790128800000).n,
    AI_MANAGEMENT_DEADLINE_FIXED: store.prepare("select count(*) n from runtime_events where type='AI_MANAGEMENT_DEADLINE_FIXED' and ts>=?").get(1790128800000).n,
    V396_OWNERSHIP_OUTBOX: store.prepare("select count(*) n from runtime_events where type='V396_OWNERSHIP_OUTBOX' and ts>=?").get(1790128800000).n,
    AI_EXIT_SHADOW_DECISION: store.prepare("select count(*) n from runtime_events where type='AI_EXIT_SHADOW_DECISION' and ts>=?").get(1790128800000).n,
    TRADE_PLAN_PERSISTED: store.prepare("select count(*) n from runtime_events where type='TRADE_PLAN_PERSISTED' and ts>=?").get(1790128800000).n,
    POSITION_FACT_UNVERIFIED: store.prepare("select count(*) n from runtime_events where type='POSITION_FACT_UNVERIFIED' and ts>=?").get(1790128800000).n,
    RISK_any: store.prepare("select count(*) n from runtime_events where type LIKE 'RISK_%' and ts>=?").get(1790128800000).n,
    outboxDelivered: led.prepare('select count(*) n from v396_outbox where delivered=1').get().n,
    quantityClaims: led.prepare('select count(*) n from v396_quantity_claims').get().n,
    mandates: led.prepare('select count(*) n from v396_mandates').get().n,
  },
  notionalP0ConfirmationLive: {
    openPositions: positions.length,
    carryingNotionalField: positions.filter((p) => p.notionalUsd != null).length,
    negativeNotionalAfterHydration: positions.filter((p) => Number(p.notionalUsd) < 0).length,
    unprotectedPositions: positions.filter((p) => p.tpStatus !== 'PROTECTED').length,
    engineFatalEventsThisRun: store.prepare("select count(*) n from runtime_events where type='ENGINE_FATAL_ERROR' and ts>=?").get(1790128800000).n,
  },
  consequenceForReadonly: 'While executionMode is READ_ONLY the engine cannot repair a lapsed take-profit order either; protection currently rests on the 28 exchange-side WORKING orders that predate the cutover.',
};
writeFileSync(`${OUT}/ownership-scope-divergence.json`, JSON.stringify(evidence, null, 1) + '\n');
console.log(JSON.stringify({ total: evidence.ownershipLedger.totalRows, dup: evidence.ownershipLedger.cyclesWithMultipleOwnerRows, conflicting: evidence.ownershipLedger.cyclesWithContradictoryAuthority, writes: evidence.safetyFactsAtDetection.exchangeWrites, negNotional: evidence.notionalP0ConfirmationLive.negativeNotionalAfterHydration, fatal: evidence.notionalP0ConfirmationLive.engineFatalEventsThisRun }, null, 1));
store.close();
led.close();
