import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../events/eventBus.js';
import { observedOutcome, terminalDecision } from './decisionEpisodeFacts.js';
import { ShadowRunner } from './shadowRunner.js';
import { harness } from './tradingQualityTestHarness.js';

describe('decision-outcome mark collection', () => {
  it('records a mark for a pending Primary episode without requiring a position', async () => {
    const h = harness();
    const symbol = h.packet.symbol;
    h.state.positions.clear();
    h.state.eips.clear();
    h.state.shadowRunner.status = 'RUNNING';
    const recordShadowMark = vi.fn();
    const store = {
      listOutcomeTrackingSymbols: vi.fn(() => [symbol]),
      recordShadowMark,
      upsertDecisionSnapshot: vi.fn(),
    };
    const market = { snapshot: (candidate: string) => h.state.snapshots.get(candidate) };
    const runner = new ShadowRunner(h.state, market as never, store as never, new EventBus());

    await runner.sample();

    expect(store.listOutcomeTrackingSymbols).toHaveBeenCalledOnce();
    expect(recordShadowMark).toHaveBeenCalledOnce();
    expect(recordShadowMark.mock.calls[0]![0]).toMatchObject({ symbol });
    expect(Number(recordShadowMark.mock.calls[0]![0].mark)).toBeGreaterThan(0);
  });

  it('materializes target hit and censor facts from a contiguous mark path', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE shadow_mark_series(symbol TEXT,ts INTEGER,mark REAL)');
      const insert = db.prepare('INSERT INTO shadow_mark_series VALUES(?,?,?)');
      for (let minute = 0; minute <= 15; minute++)
        insert.run('X', 1_000 + minute * 60_000, 100 + minute / 10);
      const outcome = observedOutcome(db, 'X', 1_000, 100, 'LONG', 901_000, 101);
      expect(outcome.horizons.m15).toMatchObject({
        targetPrice: 101,
        targetHit: true,
        targetHitAt: 601_000,
        censorReason: 'TARGET_HIT',
        coverage: 'SAMPLED_CONTIGUOUS',
      });
      expect(outcome.horizons.h1).toBeNull();
    } finally {
      db.close();
    }
  });

  it('persists the selected candidate and authorized target in terminal facts', () => {
    const decision = terminalDecision({
      id: 'run-1',
      status: 'COMPLETED',
      decision: 'PLACE_LONG',
      direction: 'LONG',
      startedAt: 1,
      completedAt: 2,
      normalizedPreview: JSON.stringify({
        selectedCandidateId: 'candidate-1',
        profitTakePlan: { targetPrice: 123, targetHorizonMinutes: 60 },
      }),
    });
    expect(decision).toMatchObject({
      selectedCandidateId: 'candidate-1',
      targetPrice: 123,
      targetHorizonMinutes: 60,
    });
  });
});
