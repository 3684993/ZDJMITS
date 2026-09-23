import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../events/eventBus.js';
import { OwnershipJournal } from './ownershipJournal.js';
import { OwnershipMigration } from './ownershipMigration.js';
import { OwnershipRuntime, type OwnershipSubject } from './ownershipRuntime.js';
import { executionScope } from './executionLifecycle.js';

/**
 * A migrated cycle and a runtime-written cycle must be the same row. Ownership scope is derived by
 * `OwnershipRuntime.identity()` from the position side, while an entry intent claims under the
 * persisted 'ENTRY' vocabulary: a migration keyed with 'ENTRY' writes a ledger the Engine cannot
 * see, the Engine then re-initialises authority from the first fill, and one human-held cycle ends
 * up claimed twice. These tests pin the shared derivation rather than one caller's reading of it.
 */
const IDENTITY = { environment: 'TESTNET', account: 'binance-primary' };
const POSITION = {
  id: 'exchange_AVAXUSDT_SHORT',
  symbol: 'AVAXUSDT',
  side: 'SHORT' as const,
  cycleId: 'cycle_entry_intent_human_short',
  managementStatus: 'HUMAN_MANAGED' as const,
  openedAt: 1_700_000_000_000,
};

/**
 * Windows can keep a just-created SQLite file briefly locked while it is scanned, so unlink may
 * fail with EBUSY after every handle is closed. The scratch directory belongs to the OS temp area,
 * therefore a residual lock must not decide whether the invariant held.
 */
function removeScratch(dir: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== 'EBUSY' && code !== 'EPERM') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

class FixedRuntime extends OwnershipRuntime {
  override subject(_positionId: string): OwnershipSubject | null {
    return { symbol: POSITION.symbol, positionSide: POSITION.side, cycleId: POSITION.cycleId };
  }
  override exchangeIdentity() {
    return { ...IDENTITY };
  }
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'zdj-ownership-scope-'));
  return { dir, file: join(dir, 'v396-ownership.sqlite') };
}

const rowsOf = (journal: OwnershipJournal) =>
  journal
    .query<{ scope: string; payload: string }>('SELECT scope, payload FROM v396_owners')
    .map((row) => ({ scope: String(row.scope), ...JSON.parse(String(row.payload)) }));

describe('ownership scope identity agreement', () => {
  it('derives migration subjects with the scope the Engine uses, so a migrated cycle stays one row', () => {
    const { dir, file } = scratch();
    try {
      const subjects = OwnershipMigration.subjectsForPositions([POSITION], IDENTITY);
      expect(subjects).toHaveLength(1);
      const expected = executionScope(IDENTITY.environment, IDENTITY.account, POSITION.symbol, POSITION.side);
      expect(subjects[0].scope).toBe(expected);
      expect(subjects[0].cycleId).toBe(POSITION.cycleId);
      expect(subjects[0].managementStatus).toBe('HUMAN_MANAGED');

      const journal = new OwnershipJournal(file);
      new OwnershipMigration(journal).apply(subjects, POSITION.openedAt + 1);
      const migrated = journal.get(expected, POSITION.cycleId);
      // A human-held cycle is recorded and then taken over, so it legitimately starts above version 1.
      expect(migrated?.ownerState).toBe('HUMAN_MANAGED');
      const versionAfterMigration = migrated?.ownerVersion ?? 0;
      expect(rowsOf(journal)).toHaveLength(1);
      journal.close();

      const runtime = new FixedRuntime(new EventBus(), file);
      expect(runtime.recordHumanTakeover(POSITION.id, 'MANUAL_SUBMISSION')).toBe(true);
      runtime.close();

      const verify = new OwnershipJournal(file);
      const after = verify.get(expected, POSITION.cycleId);
      expect(after?.ownerState).toBe('HUMAN_MANAGED');
      expect(after?.ownerVersion).toBeGreaterThanOrEqual(versionAfterMigration);
      // The decisive fact: the Engine advanced the migrated row instead of creating its own.
      expect(rowsOf(verify)).toHaveLength(1);
      verify.close();
    } finally {
      removeScratch(dir);
    }
  });

  it('shows that an entry-side scope leaves a parallel row the Engine cannot see', () => {
    const { dir, file } = scratch();
    try {
      const entryScoped = executionScope(IDENTITY.environment, IDENTITY.account, POSITION.symbol, 'ENTRY');
      const journal = new OwnershipJournal(file);
      new OwnershipMigration(journal).apply(
        [{ scope: entryScoped, cycleId: POSITION.cycleId, planRef: null, firstFillAt: POSITION.openedAt, deadline: null, managementStatus: 'HUMAN_MANAGED', legacy: true }],
        POSITION.openedAt + 1,
      );
      const migrated = journal.get(entryScoped, POSITION.cycleId);
      expect(migrated?.ownerState).toBe('HUMAN_MANAGED');
      journal.close();

      const runtime = new FixedRuntime(new EventBus(), file);
      expect(runtime.recordHumanTakeover(POSITION.id, 'MANUAL_SUBMISSION')).toBe(true);
      runtime.close();

      const check = new OwnershipJournal(file);
      const all = rowsOf(check);
      expect(all).toHaveLength(2);
      expect(all.filter((row) => row.cycleId === POSITION.cycleId)).toHaveLength(2);
      expect([...new Set(all.map((row) => row.scope))]).toHaveLength(2);
      // The migrated row is inert: the Engine never reads or advances it.
      expect(check.get(entryScoped, POSITION.cycleId)?.ownerVersion).toBe(migrated?.ownerVersion);
      check.close();
    } finally {
      removeScratch(dir);
    }
  });

  it('refuses subjects built from an incomplete identity, a missing cycle or an unknown mandate', () => {
    const { dir, file } = scratch();
    try {
      expect(() => OwnershipMigration.subjectsForPositions([POSITION], { environment: '', account: 'binance-primary' })).toThrow('MIGRATION_IDENTITY_REQUIRED');
      expect(() => OwnershipMigration.subjectsForPositions([{ ...POSITION, cycleId: '' }], IDENTITY)).toThrow('MIGRATION_SUBJECT_INCOMPLETE');
      expect(() => OwnershipMigration.subjectsForPositions([{ ...POSITION, side: 'SIDEWAYS' }], IDENTITY)).toThrow('MIGRATION_SUBJECT_INCOMPLETE');
      expect(() => OwnershipMigration.subjectsForPositions([{ ...POSITION, managementStatus: 'AI_ACTIVE' }], IDENTITY)).toThrow('MIGRATION_SUBJECT_MANAGEMENT_UNKNOWN');
      // A journal opened for an empty ledger must stay empty: no subject derivation writes.
      const journal = new OwnershipJournal(file);
      expect(rowsOf(journal)).toHaveLength(0);
      journal.close();
    } finally {
      removeScratch(dir);
    }
  });
});
