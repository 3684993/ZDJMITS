import {describe,expect,it,vi} from 'vitest';
import type { EntryOrder } from '@zdj/contracts';
import {
  REMOTE_FACT_AUDIT_LADDERS_MS,
  advanceRemoteFactAudit,
  jitteredNextAuditAt,
  remoteFactAuditClass,
  remoteFactAuditDeferred,
  remoteFactAuditEligible,
} from './entryRiskOccupancy.js';
import { primaryBrainHealth } from './aiResourceHealth.js';

const ladder = REMOTE_FACT_AUDIT_LADDERS_MS;
const row = (over: Partial<EntryOrder> = {}) => ({
  id: 'entry_1', symbol: 'BTCUSDT', side: 'LONG', quantity: 2, price: 100, filledQuantity: 0,
  status: 'CANCELED', exchangeTerminalStatus: 'CANCELED', exchangeOrderId: null, clientOrderId: 'ml_1',
  createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 86_400_000, factSource: 'LOCAL_NOT_SUBMITTED', ...over,
} as EntryOrder);
const audit = (over: Record<string, unknown> = {}) => ({ tier: 2, consecutive: 9, nextAuditAt: Date.now() + 3_600_000, factHash: 'h', verifiedCount: 9, lastAuditAt: Date.now() - 3_600_000, lastEventAt: 0, lastEmittedReason: null, ...over });

describe('shared remote fact audit policy', () => {
  it('classifies rows by what can still change about them', () => {
    expect(remoteFactAuditClass(row({ status: 'UNKNOWN', exchangeTerminalStatus: 'UNKNOWN', factSource: null } as never))).toBe('unknown');
    expect(remoteFactAuditClass(row())).toBe('neverSubmitted');
    expect(remoteFactAuditClass(row({ factSource: null } as never))).toBe('terminal');
    expect(remoteFactAuditClass(row({ filledQuantity: 2 }))).toBe(null);
    expect(remoteFactAuditClass(row({ exchangeOrderId: '999', factSource: 'BINANCE_EXACT_ORDER' } as never))).toBe(null);
    expect(remoteFactAuditClass(row({ status: 'WORKING', exchangeTerminalStatus: null } as never))).toBe(null);
  });

  it('keeps a recent terminal row at the fresh cadence and only escalates on identical proofs', () => {
    const now = Date.now(), fresh = row({ remoteAudit: audit({ tier: 0, nextAuditAt: now }) });
    expect(remoteFactAuditDeferred(fresh, now)).toBe(false);
    let previous = null as ReturnType<typeof advanceRemoteFactAudit> | null;
    for (let pass = 0; pass < 4; pass++) previous = advanceRemoteFactAudit(previous, { sources: ['REMOTE_EXACT_ORDER_ABSENT'], reason: 'EXACT_ORDER_NOT_FOUND' }, now, 'neverSubmitted', 'ENTRY:BTCUSDT:ml_1');
    expect(previous!.tier).toBe(1);
    expect(previous!.nextAuditAt).toBeGreaterThan(now);
    expect(previous!.nextAuditAt).toBeLessThanOrEqual(now + ladder.neverSubmitted[1]);
    const escalated = row({ remoteAudit: previous as never });
    expect(remoteFactAuditDeferred(escalated, now + 60_000)).toBe(true);
  });

  it('never slows a row that still occupies risk, holds a fill, or has an unresolved terminal outcome', () => {
    const now = Date.now();
    expect(remoteFactAuditEligible(row({ filledQuantity: 1, remoteAudit: audit() } as never), now)).toBe(false);
    expect(remoteFactAuditEligible(row({ exchangeTerminalStatus: 'UNKNOWN', remoteAudit: audit() } as never), now)).toBe(false);
    expect(remoteFactAuditEligible(row({ status: 'UNKNOWN', exchangeTerminalStatus: 'UNKNOWN', remoteAudit: audit() } as never), now)).toBe(false);
    expect(remoteFactAuditEligible(row({ remoteAudit: audit() }), now)).toBe(true);
  });

  it('treats a persisted audit window that already elapsed as due, never as deferred', () => {
    const now = Date.now();
    expect(remoteFactAuditDeferred(row({ remoteAudit: audit({ nextAuditAt: now - 1 }) } as never), now)).toBe(false);
    expect(remoteFactAuditDeferred(row({ remoteAudit: audit({ nextAuditAt: now + 60_000 }) } as never), now)).toBe(true);
  });

  it('spreads audit deadlines deterministically without exceeding the tier interval', () => {
    const now = Date.now(), interval = ladder.neverSubmitted[2], deadlines = new Set<number>();
    for (let index = 0; index < 100; index++) {
      const at = jitteredNextAuditAt(now, interval, `ENTRY:SYM${index}:ml_${index}`);
      deadlines.add(Math.floor((at - now) / 1000));
      expect(at).toBeGreaterThan(now - 1);
      expect(at).toBeLessThanOrEqual(now + interval);
    }
    expect(deadlines.size).toBeGreaterThan(50);
    expect(jitteredNextAuditAt(now, interval, 'ENTRY:BTCUSDT:ml_1')).toBe(jitteredNextAuditAt(now, interval, 'ENTRY:BTCUSDT:ml_1'));
  });
});

describe('primary brain health semantics', () => {
  const base = { paused: false, ready: true, eligible: 3, executableCandidates: 2, poolResidents: 12, pendingEntries: 0, maxPendingEntries: 6, modelOnline: true, lastRunAgeMs: 46 * 60_000 };
  it('does not report a fault for a healthy model that had nothing dispatchable', () => {
    const idle = primaryBrainHealth({ ...base, idleReason: 'WAITING_CANDIDATE' });
    expect(idle).toMatchObject({ status: 'READY', unexplainedIdle: false });
    expect(idle.reason).toBe('IDLE_WAITING_CANDIDATE');
    expect(primaryBrainHealth({ ...base, eligible: 0, executableCandidates: 0, idleReason: null }).reason).toBe('IDLE_NO_DISPATCHABLE_CANDIDATE');
    expect(primaryBrainHealth({ ...base, pendingEntries: 6, idleReason: null }).reason).toBe('IDLE_NO_DISPATCHABLE_CANDIDATE');
  });

  it('still reports a real model outage and a genuine unexplained idle', () => {
    expect(primaryBrainHealth({ ...base, modelOnline: false, idleReason: null })).toMatchObject({ status: 'UNAVAILABLE', reason: 'PRIMARY_MODEL_OFFLINE' });
    expect(primaryBrainHealth({ ...base, idleReason: null })).toMatchObject({ status: 'DEGRADED', reason: 'DEGRADED_UNEXPLAINED_IDLE', unexplainedIdle: true });
    expect(primaryBrainHealth({ ...base, lastRunAgeMs: 60_000, idleReason: null })).toMatchObject({ status: 'READY', reason: 'READY' });
    expect(primaryBrainHealth({ ...base, paused: true, idleReason: null })).toMatchObject({ status: 'PAUSED', reason: 'RUNTIME_PAUSED' });
  });
});
