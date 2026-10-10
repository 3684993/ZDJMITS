import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requiredNetProfit } from '@zdj/core';
import { OwnershipJournal, OWNERSHIP_SCHEMA_VERSION } from './ownershipJournal.js';
import { OwnershipMigration, type MigrationSubject } from './ownershipMigration.js';
import { V396ExitRuntime } from './v396ExitRuntime.js';
import { ONE_WAY_CAPABILITIES } from './v396ExitTestHarness.js';
import { applyGovernancePatch, changedGovernancePaths, governanceFieldOf, governanceReadback, V396_GOVERNANCE_FIELDS } from '../config/governanceSettingsMatrix.js';
import { createRuntimeSettingsResourcesRouter } from '../api/runtimeSettingsResources.js';

/**
 * J5 / S08 acceptance: the settings surface has to mean what it says, and the durable ledger has to
 * survive a backup, a restore and a newer writer.
 *
 * Two failure modes are tested over and over here. A field that is editable but read by nothing, and
 * a copy of the truth that silently becomes two truths (a settings value that disagrees with the unit
 * the code applies, or a database an older build would half-upgrade).
 */

const dirs: string[] = [];
const servers: any[] = [];
afterEach(async () => {
  while (dirs.length) { const dir = dirs.pop()!; try { rmSync(dir, { recursive: true, force: true }); } catch { /* busy handle */ } }
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
});
const tempDir = (prefix = 'zdj-v396-j5-') => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir; };
const any = (value: unknown) => value as any;
const repoRoot = join(process.cwd(), '..', '..');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
});

describe('S08 field matrix: an editable setting must name the code that reads it', () => {
  it('every row carries a unit, a meaning, an effective moment, and a consumer if it is editable', () => {
    for (const field of V396_GOVERNANCE_FIELDS) {
      expect(field.unit, field.path).toBeTruthy();
      expect(field.meaning.length, field.meaning).toBeGreaterThan(4);
      expect(field.effectiveAt, field.path).toBeTruthy();
      if (field.editable) expect(field.consumers.length, `${field.path} is editable but read by nothing`).toBeGreaterThan(0);
      // A field nobody reads must be declared so in the matrix rather than offered as a knob.
      if (!field.consumers.length) { expect(field.editable, field.path).toBe(false); expect(field.readOnlyReason?.length ?? 0, field.path).toBeGreaterThan(8); }
      if (field.kind === 'enum' && field.enum) expect(field.enum.length, field.path).toBeGreaterThan(0);
      if (field.kind === 'number' || field.kind === 'integer') expect(field.min, field.path).toBeTypeOf('number');
    }
  });

  it('names consumers that actually exist in the source, so the matrix cannot rot into a wish list', () => {
    const missing: string[] = [];
    for (const field of V396_GOVERNANCE_FIELDS) for (const consumer of field.consumers) {
      const [file, symbol] = consumer.split('#');
      const absolute = join(repoRoot, file.startsWith('packages/') ? file : join('apps', 'engine', 'src', file));
      let source = '';
      try { source = readFileSync(absolute, 'utf8'); } catch { missing.push(`${field.path} -> ${consumer} (file)`); continue; }
      if (!source.includes(symbol)) missing.push(`${field.path} -> ${consumer} (symbol)`);
    }
    expect(missing).toEqual([]);
  });

  it('lists every governance leaf of the exit-coordination block, so no new knob hides off-matrix', () => {
    const schema = readFileSync(join(repoRoot, 'packages/contracts/src/riskGovernance.ts'), 'utf8');
    const declared = [...schema.matchAll(/export const ExitCoordinationSettingsSchema[\s\S]*?\n\}\)\.default\(\{\}\);/g)]
      .flatMap(block => [...block[0].matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)]).map(match => match[1]);
    expect(declared.length).toBeGreaterThanOrEqual(14);
    for (const key of declared) expect(governanceFieldOf(`riskGovernance.exitCoordination.${key}`), key).toBeTruthy();
  });

  it('detects exactly the governance leaves a whole-settings PUT changed', () => {
    const before = any({ settingsVersion: 1, riskGovernance: { exitCoordination: { aiExitAuthority: 'OFF', normalReviewsPerPlan: 2 } },
      positionManagement: { humanHandoffAfterMinutes: 1440 }, takeProfit: { minNetProfitRoiPct: 0.15 }, tradeEconomics: { admissionMode: 'SHADOW' } });
    const after = any(structuredClone(before));
    after.riskGovernance.exitCoordination.normalReviewsPerPlan = 4;
    after.settingsVersion = 2;
    expect(changedGovernancePaths(before, after)).toEqual(['riskGovernance.exitCoordination.normalReviewsPerPlan']);
    after.positionManagement.humanHandoffAfterMinutes = 60;
    expect(changedGovernancePaths(before, after)).toEqual(['positionManagement.humanHandoffAfterMinutes', 'riskGovernance.exitCoordination.normalReviewsPerPlan']);
  });
});

describe('S08 units: 0.15 is 0.15%, and the handoff minutes reach a real deadline', () => {
  it('applies the take-profit ROI floor as a percentage of margin, not as a fraction', () => {
    const input = { minNetProfitUsd: 1, minNetProfitRoiPct: 0.15, entryPrice: 100, qty: 10, leverage: 10 };
    // margin = 100*10/10 = 100 USDT, so 0.15% of margin is 0.15 USDT and the absolute floor wins.
    expect(requiredNetProfit(input as never)).toBe(1);
    expect(requiredNetProfit({ ...input, minNetProfitUsd: 0.01 } as never)).toBeCloseTo(0.15, 10);
    // The mistake this guards against: reading 0.15 as 15% would demand 15 USDT on the same margin.
    expect(requiredNetProfit({ ...input, minNetProfitRoiPct: 15 } as never)).toBe(15);
    const field = governanceFieldOf('takeProfit.minNetProfitRoiPct');
    expect(field).toMatchObject({ unit: 'PERCENT_OF_MARGIN', defaultValue: 0.15 });
    expect(readFileSync(join(repoRoot, 'packages/core/src/tradingCost.ts'), 'utf8')).toMatch(/minNetProfitRoiPct\s*\/\s*100/);
  });

  it('refuses a 0.15 to 15 edit until the operator confirms the unit', () => {
    const settings = any({ takeProfit: { minNetProfitRoiPct: 0.15 } });
    const unconfirmed = applyGovernancePatch(settings, { 'takeProfit.minNetProfitRoiPct': 15 });
    expect(unconfirmed.applied).toEqual([]);
    expect(unconfirmed.refusals[0]).toMatchObject({ code: 'GOVERNANCE_UNIT_REQUIRES_CONFIRMATION', path: 'takeProfit.minNetProfitRoiPct' });
    // The same value at a different magnitude is an ordinary edit, not a unit trap.
    expect(applyGovernancePatch(settings, { 'takeProfit.minNetProfitRoiPct': 0.3 }).applied).toEqual(['takeProfit.minNetProfitRoiPct']);
    const confirmed = applyGovernancePatch(settings, { 'takeProfit.minNetProfitRoiPct': 15 }, { acks: ['PERCENT_UNIT_INTENDED'] });
    expect(confirmed.applied).toEqual(['takeProfit.minNetProfitRoiPct']);
    expect(confirmed.settings.takeProfit.minNetProfitRoiPct).toBe(15);
  });

  it('writes the handoff minutes into the durable management deadline', () => {
    const identity = { environment: 'TESTNET', account: 'binance-primary' };
    const exitRuntime = new V396ExitRuntime(':memory:', () => identity, async () => ONE_WAY_CAPABILITIES, () => ({ aiExitAuthority: 'OFF' as const }));
    const subject = { symbol: 'BTCUSDT', side: 'LONG' as const, cycleId: 'cycle_j5', openedAt: 1_000 };
    const minutes = Number(governanceFieldOf('positionManagement.humanHandoffAfterMinutes')!.defaultValue);
    const firstFillAt = 1_800_000_000_000;
    const owner = exitRuntime.fixManagementDeadline(subject, minutes * 60_000, firstFillAt, 'plan_j5');
    expect(owner.deadline).toBe(firstFillAt + minutes * 60_000);
    expect(owner.ownerState).toBe('AI_ACTIVE');
    // A later caller can never lengthen the deadline it was opened with.
    expect(exitRuntime.fixManagementDeadline(subject, 10 * 60_000, firstFillAt, 'plan_j5').deadline).toBe(owner.deadline);
  });
});

describe('S08 governance patch: refusals are the product, not an error path', () => {
  const base = () => any({ settingsVersion: 3, riskGovernance: { exitCoordination: { aiExitAuthority: 'OFF', aiExitLossLimitUsd: 10, aiExitMinNetProfitUsd: 0.2,
    positionReviewEnabled: false, normalReviewsPerPlan: 2, reviewFailureBudget: 2, reviewMinIntervalMs: 300_000, reviewAuthorityTtlMs: 20_000,
    convergenceIntervalMs: 120_000, convergenceBatchLimit: 8, continuousConvergenceEnabled: true }, portfolioRisk: { configured: false, maxCapitalAtRiskUsd: 0 } },
  positionManagement: { humanHandoffAfterMinutes: 1440 }, takeProfit: { minNetProfitRoiPct: 0.15 } });

  it('refuses a path the matrix does not list', () => {
    const result = applyGovernancePatch(base(), { 'riskGovernance.exitCoordination.someFutureKnob': 1 });
    expect(result.refusals[0].code).toBe('GOVERNANCE_FIELD_UNSUPPORTED');
    expect(result.settings).toBe(result.settings);
    expect(applyGovernancePatch(base(), { 'connections.executionMode': 'TESTNET_ENABLED' }).refusals[0].code).toBe('GOVERNANCE_FIELD_UNSUPPORTED');
  });

  it('refuses a read-only field and says why', () => {
    const result = applyGovernancePatch(base(), { 'riskGovernance.portfolioRisk.marginTierVersion': 'TIER-7' });
    expect(result.refusals[0].code).toBe('GOVERNANCE_FIELD_READ_ONLY');
    expect(result.refusals[0].detail.length).toBeGreaterThan(8);
  });

  it('refuses out-of-range, non-integer and unknown enum values', () => {
    const settings = base();
    expect(applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.aiExitLossLimitUsd': 11 }).refusals[0].code).toBe('GOVERNANCE_ABOVE_MAXIMUM');
    expect(applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.normalReviewsPerPlan': 1.5 }).refusals[0].code).toBe('GOVERNANCE_INTEGER_REQUIRED');
    expect(applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.positionReviewEnabled': 'yes' }).refusals[0].code).toBe('GOVERNANCE_TYPE_BOOLEAN_REQUIRED');
    expect(applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.aiExitAuthority': 'ENFORCE_SOFTLY' }).refusals[0].code).toBe('GOVERNANCE_ENUM_UNSUPPORTED');
  });

  it('refuses to grant the AI close authority without an explicit acknowledgement', () => {
    const settings = base();
    const refused = applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.aiExitAuthority': 'ENFORCE' });
    expect(refused.refusals[0]).toMatchObject({ code: 'GOVERNANCE_ACK_REQUIRED' });
    expect(refused.settings.riskGovernance.exitCoordination.aiExitAuthority).toBe('OFF');
    expect(settings.riskGovernance.exitCoordination.aiExitAuthority).toBe('OFF');
    const acknowledged = applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.aiExitAuthority': 'ENFORCE' }, { acks: ['AI_EXIT_ENFORCE_AUTHORITY'] });
    expect(acknowledged.applied).toEqual(['riskGovernance.exitCoordination.aiExitAuthority']);
    // SHADOW stays an ordinary edit: it decides nothing and submits nothing.
    expect(applyGovernancePatch(settings, { 'riskGovernance.exitCoordination.aiExitAuthority': 'SHADOW' }).applied.length).toBe(1);
  });

  it('applies all of a patch or none of it', () => {
    const settings = base();
    const mixed = applyGovernancePatch(settings, { 'positionManagement.humanHandoffAfterMinutes': 240, 'riskGovernance.exitCoordination.normalReviewsPerPlan': 99 });
    expect(mixed.applied).toEqual([]);
    expect(mixed.refusals.map(refusal => refusal.path)).toEqual(['riskGovernance.exitCoordination.normalReviewsPerPlan']);
    // The refused settings object is the caller's own, unchanged: a partial write is not offered.
    expect(mixed.settings).toBe(settings);
    expect(settings.positionManagement.humanHandoffAfterMinutes).toBe(1440);
  });

  it('gives the operator a readback that states unit, effect moment and reader', () => {
    const settings = base();
    const rows = governanceReadback(settings as never);
    expect(rows).toHaveLength(V396_GOVERNANCE_FIELDS.length);
    const authority = rows.find(row => row.path === 'riskGovernance.exitCoordination.aiExitAuthority');
    expect(authority).toMatchObject({ value: 'OFF', unit: 'ENUM', effectiveAt: 'NEXT_EXIT_ATTEMPT', editable: true, ack: 'AI_EXIT_ENFORCE_AUTHORITY', atDefault: true });
    expect(authority!.consumers.length).toBeGreaterThan(0);
    const moved = governanceReadback({ ...settings, riskGovernance: { ...settings.riskGovernance, exitCoordination: { ...settings.riskGovernance.exitCoordination, normalReviewsPerPlan: 5 } } } as never);
    expect(moved.find(row => row.path === 'riskGovernance.exitCoordination.normalReviewsPerPlan')).toMatchObject({ value: 5, atDefault: false });
  });
});

describe('S08 settings API: the matrix is enforced at the boundary', () => {
  function settings() {
    return any({ settingsVersion: 1, connections: { proxy: { enabled: true, protocol: 'SOCKS5H', url: 'socks5h://127.0.0.1:20081', forceBinanceRest: true, forceBinanceWs: true, proxyDns: true, binanceRestRoute: 'CONFIGURED', bypassLocalhost: true, failClosed: true },
      exchange: { provider: 'BINANCE_USDM', environment: 'TESTNET', productionBaseUrl: 'https://fapi.binance.com', testnetBaseUrl: 'https://demo-fapi.binance.com', testnetRestBaseUrl: 'https://demo-fapi.binance.com', testnetWsBaseUrl: 'wss://demo-fstream.binance.com/ws', productionRestBaseUrl: 'https://fapi.binance.com', productionWsBaseUrl: 'wss://fstream.binance.com/ws', credentialRef: 'binance-primary', recvWindowMs: 5000, autoTimeSync: true },
      marketDataMode: 'BINANCE', executionMode: 'READ_ONLY', aiMode: 'OPENAI_COMPATIBLE' },
    aiResources: [{ id: 'primary', role: 'PRIMARY_BRAIN', enabled: true, baseUrl: 'http://127.0.0.1:8084/v1', model: 'qwen', maxConcurrency: 1, gpu: 'gpu' }],
    riskGovernance: { exitCoordination: { aiExitAuthority: 'OFF', normalReviewsPerPlan: 2, reviewMinIntervalMs: 300_000, reviewAuthorityTtlMs: 20_000 }, portfolioRisk: { configured: false } },
    positionManagement: { humanHandoffAfterMinutes: 1440 }, takeProfit: { minNetProfitRoiPct: 0.15 } });
  }
  async function fixture() {
    const state = any({ settings: settings() });
    const runtime = any({ state, market: { retentionSymbols: vi.fn(() => new Set(['BTCUSDT'])), stop: vi.fn(), setRetentionSymbols: vi.fn() },
      ai: { load: new Map(), probeResources: vi.fn().mockResolvedValue(undefined) }, events: { publish: vi.fn() },
      exitRuntime: { schemaInfo: () => ({ schemaVersion: OWNERSHIP_SCHEMA_VERSION, runtimeSchemaVersion: OWNERSHIP_SCHEMA_VERSION, minSupported: 1, tables: ['v396_owners'] }) },
      updateSettingsIfVersion: vi.fn(async (input: any, expected: number) => {
        if (state.settings.settingsVersion !== expected) throw new Error('SETTINGS_VERSION_CONFLICT');
        state.settings = { ...input, settingsVersion: expected + 1 }; return state.settings;
      }) });
    const app = express(); app.use(express.json()); app.use(createRuntimeSettingsResourcesRouter(runtime));
    const server = app.listen(0); servers.push(server);
    await new Promise(resolve => server.once('listening', resolve));
    return { runtime, state, url: `http://127.0.0.1:${(server.address() as any).port}` };
  }

  it('serves the readback with the durable schema identity beside it', async () => {
    const { url } = await fixture();
    const response = await fetch(`${url}/settings/governance`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settingsVersion).toBe(1);
    expect(body.fields.length).toBe(V396_GOVERNANCE_FIELDS.length);
    expect(body.ownershipSchema).toMatchObject({ schemaVersion: OWNERSHIP_SCHEMA_VERSION, minSupported: 1 });
  });

  it('writes an allowed field and reads back what the server actually stored', async () => {
    const { url, state } = await fixture();
    const response = await fetch(`${url}/settings/governance`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedSettingsVersion: 1, fields: { 'riskGovernance.exitCoordination.normalReviewsPerPlan': 3 } }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ settingsVersion: 2, applied: ['riskGovernance.exitCoordination.normalReviewsPerPlan'] });
    expect(body.readback[0]).toMatchObject({ value: 3, unit: 'COUNT', effectiveAt: 'NEXT_TICK' });
    expect(state.settings.riskGovernance.exitCoordination.normalReviewsPerPlan).toBe(3);
  });

  it('refuses a patch it cannot honour and does not burn a settings version', async () => {
    const { url, state, runtime } = await fixture();
    const response = await fetch(`${url}/settings/governance`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedSettingsVersion: 1, fields: { 'riskGovernance.exitCoordination.aiExitAuthority': 'ENFORCE' } }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'GOVERNANCE_PATCH_REFUSED' }, currentSettingsVersion: 1 });
    expect(state.settings.settingsVersion).toBe(1);
    expect(runtime.updateSettingsIfVersion).not.toHaveBeenCalled();
  });

  it('keeps optimistic concurrency on the governance channel', async () => {
    const { url, state } = await fixture();
    const stale = await fetch(`${url}/settings/governance`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedSettingsVersion: 7, fields: { 'positionManagement.humanHandoffAfterMinutes': 60 } }) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { message: 'SETTINGS_VERSION_CONFLICT' }, currentSettingsVersion: 1 });
    expect(state.settings.positionManagement.humanHandoffAfterMinutes).toBe(1440);
  });

  it('refuses an authority change smuggled through the whole-settings PUT', async () => {
    const { url, state, runtime } = await fixture();
    const requested = structuredClone(state.settings);
    requested.riskGovernance.exitCoordination.aiExitAuthority = 'ENFORCE';
    const response = await fetch(`${url}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requested) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'SETTINGS_GOVERNANCE_PATH_REQUIRES_PATCH',
      blockedPaths: ['riskGovernance.exitCoordination.aiExitAuthority'] } });
    expect(runtime.updateSettingsIfVersion).not.toHaveBeenCalled();
    expect(state.settings.riskGovernance.exitCoordination.aiExitAuthority).toBe('OFF');
    // An ordinary, already-consumed setting still travels the existing PUT path unchanged.
    const ordinary = structuredClone(state.settings); ordinary.riskGovernance.exitCoordination.normalReviewsPerPlan = 5;
    expect((await fetch(`${url}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ordinary) })).status).toBe(200);
    expect(state.settings.riskGovernance.exitCoordination.normalReviewsPerPlan).toBe(5);
    // A non-governance edit is untouched by the guard.
    const benign = structuredClone(state.settings); benign.portfolio = { maxPositions: 7 };
    expect((await fetch(`${url}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(benign) })).status).toBe(200);
  });

  it('blocks an unlisted governance leaf too, not only a known one', async () => {
    const { url, state } = await fixture();
    const requested = structuredClone(state.settings);
    requested.riskGovernance.exitCoordination.somedayKnob = true;
    const response = await fetch(`${url}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requested) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.blockedPaths).toContain('riskGovernance.exitCoordination.somedayKnob');
  });
});

describe('S08 durable ledger: backup, restore, idempotent migration and a newer writer', () => {
  const subjects = (scope: string, cycleIds: string[]): MigrationSubject[] => cycleIds.map(cycleId => ({
    scope, cycleId, planRef: cycleId === 'cycle-ai' ? 'plan_j5' : null, firstFillAt: 1_000, deadline: Date.now() + 600_000,
    managementStatus: cycleId.endsWith('human') ? 'HUMAN_MANAGED' : 'AUTO_MANAGED', legacy: false }));

  it('stamps a fresh ledger and reopens it without changing the records', () => {
    const file = join(tempDir(), 'ledger.sqlite');
    const journal = new OwnershipJournal(file);
    expect(journal.schemaInfo()).toMatchObject({ schemaVersion: OWNERSHIP_SCHEMA_VERSION, minSupported: 1 });
    const owner = journal.initialize({ scope: 'scope-j5', cycleId: 'cycle-a', planRef: 'plan_j5', firstFillAt: 1_000, durationMs: 600_000, now: 1_000, legacy: false });
    journal.close();
    const reopened = new OwnershipJournal(file);
    try {
      expect(reopened.get('scope-j5', 'cycle-a')).toMatchObject({ ownerVersion: owner.ownerVersion, deadline: owner.deadline });
      expect(reopened.schemaInfo().schemaVersion).toBe(OWNERSHIP_SCHEMA_VERSION);
    } finally { reopened.close(); }
  });

  it('refuses a ledger written by a newer schema before running any DDL of its own', () => {
    const file = join(tempDir(), 'ledger.sqlite');
    new OwnershipJournal(file).close();
    new DatabaseSync(file).exec(`PRAGMA user_version=${OWNERSHIP_SCHEMA_VERSION + 1}`);
    expect(() => new OwnershipJournal(file)).toThrow(/OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME/);
    // The refusal happened without the older writer adding tables the newer schema never approved.
    const tables = new Set(new DatabaseSync(file, { readOnly: true }).prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
    expect([...tables].sort()).toEqual(['v396_claims_history', 'v396_mandates', 'v396_outbox', 'v396_owners', 'v396_quantity_claims']);
  });

  it('refuses a stamped ledger whose tables have gone missing', () => {
    const file = join(tempDir(), 'ledger.sqlite');
    new OwnershipJournal(file).close();
    const handle = new DatabaseSync(file); handle.exec('DROP TABLE v396_mandates'); handle.close();
    expect(() => new OwnershipJournal(file)).toThrow(/OWNERSHIP_SCHEMA_TABLES_MISSING/);
  });

  it('previews, applies, reads back, restores and repeats without inventing authority', async () => {
    const dir = tempDir(), file = join(dir, 'ledger.sqlite'), image = join(dir, 'image.sqlite');
    const journal = new OwnershipJournal(file);
    try {
      const migration = new OwnershipMigration(journal);
      const planned = OwnershipMigration.preview(subjects('scope-j5', ['cycle-ai', 'cycle-legacy', 'cycle-human']), journal, Date.now());
      expect(planned.created.map(row => row.ownerState).sort()).toEqual(['AI_ACTIVE', 'HANDOFF_PENDING', 'HUMAN_MANAGED']);
      expect(planned.wouldMutateExisting).toBe(1);
      // A preview must not have written anything.
      expect(journal.get('scope-j5', 'cycle-ai')).toBeNull();

      const first = migration.apply(subjects('scope-j5', ['cycle-ai', 'cycle-legacy', 'cycle-human']), Date.now());
      expect(first).toMatchObject({ created: 3, preserved: 0 });
      const readback = journal.get('scope-j5', 'cycle-ai');
      expect(readback).toMatchObject({ ownerState: 'AI_ACTIVE', ownerVersion: 1 });
      expect(journal.get('scope-j5', 'cycle-human')).toMatchObject({ ownerState: 'HUMAN_MANAGED' });

      await migration.backup(image);
      const verified = OwnershipMigration.verify(image, ['cycle-ai', 'cycle-legacy', 'cycle-human']);
      // Four outbox rows for three owners: recording a human-held cycle emits its initial row and the
      // takeover transition, and neither is folded away to make a count look tidier.
      expect(verified).toMatchObject({ owners: 3, outbox: 4 });
      expect(verified.missing).toEqual([]);

      const second = migration.apply(subjects('scope-j5', ['cycle-ai', 'cycle-legacy', 'cycle-human']), Date.now());
      expect(second).toMatchObject({ created: 0, preserved: 3 });
      expect(journal.get('scope-j5', 'cycle-ai').ownerVersion).toBe(readback.ownerVersion);
    } finally { journal.close(); }
  });

  it('never lets a migration hand AI authority to a row the human already owns', () => {
    const journal = new OwnershipJournal(join(tempDir(), 'ledger.sqlite'));
    try {
      const migration = new OwnershipMigration(journal);
      const subjectsOf = [{ scope: 'scope-j5', cycleId: 'cycle-human', planRef: 'plan_j5', firstFillAt: 1_000, deadline: Date.now() + 600_000, managementStatus: 'HUMAN_MANAGED', legacy: false }];
      migration.apply(subjectsOf, Date.now());
      expect(journal.get('scope-j5', 'cycle-human').ownerState).toBe('HUMAN_MANAGED');
      const plan = OwnershipMigration.preview(subjectsOf, journal, Date.now());
      expect(plan.preserved).toContain('cycle-human');
      expect(plan.created).toHaveLength(0);
    } finally { journal.close(); }
  });
});
