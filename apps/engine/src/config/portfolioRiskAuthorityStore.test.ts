import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SettingsStore } from './settingsStore.js';
import { applyGovernancePatch } from './governanceSettingsMatrix.js';
import { portfolioRiskAuthorityCompile, portfolioRiskAuthorityVerifyRows } from '../services/portfolioRiskAuthority.js';
import { portfolioRiskProfileBlockers, portfolioRiskProfileStatus } from '../services/portfolioRiskLedger.js';

/**
 * A PortfolioRisk authority is only worth having if the Settings row that names it and the rows that
 * hold it can never disagree. These tests break the commit at every step and read the database back,
 * because "we wrapped it in a transaction" is a claim, not a proof.
 */

const directories: string[] = [];
afterAll(async () => {
  for (const dir of directories) await rm(dir, {recursive: true, force: true, maxRetries: 5}).catch(() => {});
});

const SCENARIOS = [
  {id: 'DOWN_10_LIQUIDITY', priceShockPct: -0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: -0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5},
  {id: 'UP_10_LIQUIDITY', priceShockPct: 0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: 0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5},
  {id: 'EXCHANGE_GAP_15', priceShockPct: -0.15, spreadWidenPct: 0.02, fundingShockPct: 0.005, markBasisShockPct: -0.02, depthPenaltyPct: 0.03, exchangeUnavailable: true, unavailablePenaltyPct: 0.03, clusterConvergencePct: 0.75},
];
const LIMITS = {configured: true, maxCapitalAtRiskUsd: 600, maxStressLossUsd: 300, maxGrossNotionalUsd: 6000, maxDirectionNotionalUsd: 4000, maxClusterNotionalUsd: 6000,
  maxHumanNotionalUsd: 6000, maxDrawdownPct: 1, minMarginBufferPct: 0, minLiquidationBufferPct: 0, maxHumanPositions: 8, maxPendingHandoffs: 8, maxAckAgeMs: 86_400_000,
  snapshotTtlMs: 20_000, cashFlowWindowMs: 86_400_000, cashFlowMaxAgeMs: 900_000};

const bracketRead = (ratio = 0.005) => ({environment: 'TESTNET', credentialRef: 'binance-primary', observedAt: 1_700_000_000_000, failures: [],
  symbols: [{symbol: 'BTCUSDT', brackets: [{bracket: 0, notionalFloor: 0, notionalCap: 50_000, maintMarginRatio: 0.004, initialLeverage: 20, cum: 0},
    {bracket: 1, notionalFloor: 50_000, notionalCap: null, maintMarginRatio: ratio, initialLeverage: 10, cum: 0}]},
    {symbol: 'ETHUSDT', brackets: [{bracket: 0, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.005, initialLeverage: 20, cum: 0}]}]});

function compiled(over: Record<string, unknown> = {}) {
  const built = portfolioRiskAuthorityCompile({environment: 'TESTNET', accountScope: 'binance-primary', bracketRead: bracketRead(),
    requiredSymbols: ['BTCUSDT', 'ETHUSDT'], clusters: {}, scenarios: SCENARIOS, committedAt: 1_700_000_000_000, ...over});
  if (!built.ok) throw new Error(`fixture must compile: ${built.blockers.join(',')}`);
  return built;
}
async function open() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zdj-authority-'));
  directories.push(dir);
  const store = new SettingsStore(path.resolve(process.cwd(), '../../config'), dir);
  const settings = await store.load();
  return {store, settings};
}
/** The same composition the dedicated commit channel performs, minus the network collection. */
function settingsWithAuthority(settings: Record<string, unknown>, facts: Record<string, unknown>) {
  return {...structuredClone(settings), riskGovernance: {...(settings.riskGovernance as object), portfolioRisk: {...LIMITS, ...facts}}};
}
const rowsOf = (store: SettingsStore) => (store as unknown as {db: {prepare: (sql: string) => {all: () => unknown[]}}})
  .db.prepare('SELECT kind,content_hash,version,settings_version FROM portfolio_risk_authority ORDER BY kind').all();

describe('one commit, or nothing', () => {
  it('writes the three dataset rows and the settings row together, bumping the version exactly once', async () => {
    const {store, settings} = await open();
    const built = compiled();
    const before = Number((settings as {settingsVersion: number}).settingsVersion);
    const {settings: saved} = await store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(settings as never, built.profileFacts as never), expectedSettingsVersion: before});
    expect(saved.settingsVersion).toBe(before + 1);
    expect(rowsOf(store)).toHaveLength(3);
    expect(await store.load()).toMatchObject({settingsVersion: before + 1,
      riskGovernance: {portfolioRisk: {configured: true, marginTierVersion: built.facts.margin.version, maintenanceMarginRatePct: built.facts.margin.maintenanceMarginRatePct,
        correlationVersion: built.facts.correlation.version, scenarioVersion: built.facts.scenarios.version}}});
    const audit = (store as unknown as {db: {prepare: (sql: string) => {all: () => Array<{source: string;summary: string}>}}})
      .db.prepare("SELECT source,summary FROM settings_audit WHERE source='portfolio-risk-authority'").all();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].summary)).toMatchObject({marginTierVersion: built.facts.margin.version, coverageSymbols: 2, derivedMaintenanceMarginRatePct: 0.005});
    store.close();
  });

  it('reads the durable authority back and refuses a hand-edited row instead of trusting its hash', async () => {
    const {store, settings} = await open();
    const built = compiled();
    await store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(settings as never, built.profileFacts as never),
      expectedSettingsVersion: Number((settings as {settingsVersion: number}).settingsVersion)});
    const read = await store.readPortfolioRiskAuthority();
    expect(read.facts).toMatchObject({environment: 'TESTNET', accountScope: 'binance-primary',
      margin: {version: built.facts.margin.version, coverageSymbols: ['BTCUSDT', 'ETHUSDT'], maintenanceMarginRatePct: 0.005, derivation: 'ALL_COVERED_TIERS'}});
    // The runtime's own readiness predicate now runs on facts it re-read, not on the settings string.
    const profile = (saved => saved.riskGovernance.portfolioRisk as Record<string, unknown>)(await store.load());
    expect(portfolioRiskProfileStatus(profile, {facts: read.facts, environment: 'TESTNET', accountScope: 'binance-primary', requiredSymbols: ['BTCUSDT']})).toBe('READY');
    expect(portfolioRiskProfileBlockers(profile, {facts: read.facts, environment: 'TESTNET', accountScope: 'binance-primary', requiredSymbols: ['DOGEUSDT']}))
      .toContain('MARGIN_TIER_SYMBOL_UNPROVEN:DOGEUSDT');
    // Same content, one tampered maintenance ratio: the stored identity no longer follows from the payload.
    (store as unknown as {db: {prepare: (sql: string) => {run: (...args: unknown[]) => unknown}}}).db
      .prepare("UPDATE portfolio_risk_authority SET canonical_payload=REPLACE(canonical_payload,'\"maintenanceMarginRatio\":0.005','\"maintenanceMarginRatio\":0.0005') WHERE kind='margin'").run();
    const tampered = await store.readPortfolioRiskAuthority();
    expect(tampered.facts).toBeNull();
    expect(tampered.reasons.join(',')).toMatch(/AUTHORITY_CONTENT_HASH_MISMATCH:margin/);
    expect(portfolioRiskProfileBlockers(profile, {facts: tampered.facts, environment: 'TESTNET', accountScope: 'binance-primary'})).toEqual(['MARGIN_AUTHORITY_MISSING']);
    store.close();
  });

  it('H11 rolls every byte back when a dataset row write fails mid-transaction', async () => {
    const {store, settings} = await open();
    const built = compiled();
    const expected = Number((settings as {settingsVersion: number}).settingsVersion);
    await store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(settings as never, built.profileFacts as never), expectedSettingsVersion: expected});
    const versionAfterFirst = Number((await store.load()).settingsVersion);
    const rowsAfterFirst = JSON.stringify(rowsOf(store));
    const drifted = compiled({bracketRead: bracketRead(0.02)});
    // Fail on the third row only: margin and correlation have already been rewritten by now, so a
    // commit that is not atomic would leave the account naming a half-replaced authority.
    (store as unknown as {db: {exec: (sql: string) => unknown}}).db
      .exec("CREATE TRIGGER fail_authority_rows BEFORE UPDATE ON portfolio_risk_authority WHEN new.kind='scenarios' BEGIN SELECT RAISE(ABORT,'TEST_AUTHORITY_COMMIT_FAILURE'); END;");
    await expect(store.commitPortfolioRiskAuthority({facts: drifted.facts, settings: settingsWithAuthority(await store.load() as never, drifted.profileFacts as never),
      expectedSettingsVersion: versionAfterFirst})).rejects.toThrow(/TEST_AUTHORITY_COMMIT_FAILURE/);
    expect(Number((await store.load()).settingsVersion)).toBe(versionAfterFirst);
    expect(JSON.stringify(rowsOf(store))).toBe(rowsAfterFirst);
    const read = await store.readPortfolioRiskAuthority();
    expect(read.facts?.margin.contentHash).toBe(built.facts.margin.contentHash);
    (store as unknown as {db: {exec: (sql: string) => unknown}}).db.exec('DROP TRIGGER fail_authority_rows');
    store.close();
  });

  it('refuses a CAS conflict, a forged row set and a production context without touching anything', async () => {
    const {store, settings} = await open();
    const built = compiled();
    const expected = Number((settings as {settingsVersion: number}).settingsVersion);
    const before = JSON.stringify(await store.load());
    await expect(store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(settings as never, built.profileFacts as never),
      expectedSettingsVersion: expected + 7})).rejects.toThrow('SETTINGS_VERSION_CONFLICT');
    expect(JSON.stringify(await store.load())).toBe(before);
    expect(rowsOf(store)).toEqual([]);
    // A caller that hand-builds facts whose payload does not reproduce their hash is not committing.
    const forged = structuredClone(built.facts) as unknown as {margin: {contentHash: string}};
    forged.margin.contentHash = '0'.repeat(64);
    await expect(store.commitPortfolioRiskAuthority({facts: forged as never, settings: settingsWithAuthority(settings as never, built.profileFacts as never),
      expectedSettingsVersion: expected})).rejects.toThrow(/AUTHORITY_COMMIT_UNVERIFIED:AUTHORITY_CONTENT_HASH_MISMATCH:margin/);
    expect(rowsOf(store)).toEqual([]);
    // H18: an authority collected in a production context can never be committed as Testnet authority.
    const production = portfolioRiskAuthorityCompile({environment: 'PRODUCTION', accountScope: 'binance-primary', bracketRead: {...bracketRead(), environment: 'PRODUCTION'},
      requiredSymbols: ['BTCUSDT', 'ETHUSDT'], clusters: {}, scenarios: SCENARIOS, committedAt: 1});
    expect(production.ok).toBe(false);
    expect((production as {blockers: string[]}).blockers.join(',')).toMatch(/MARGIN_AUTHORITY_ENVIRONMENT_REQUIRED_TESTNET/);
    // A set of rows that does not belong together is not an authority, however each row looks fine.
    const db = (store as unknown as {db: {prepare: (sql: string) => {run: (...args: unknown[]) => unknown}}}).db;
    let version = Number((await store.load()).settingsVersion);
    await store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(await store.load() as never, built.profileFacts as never), expectedSettingsVersion: version});
    db.prepare("DELETE FROM portfolio_risk_authority WHERE kind='scenarios'").run();
    expect((await store.readPortfolioRiskAuthority()).reasons.join(',')).toMatch(/AUTHORITY_ROWS_INCOMPLETE:scenarios/);
    expect(portfolioRiskAuthorityVerifyRows([]).reasons.join(',')).toMatch(/AUTHORITY_ROWS_INCOMPLETE/);
    version = Number((await store.load()).settingsVersion);
    await store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(await store.load() as never, built.profileFacts as never), expectedSettingsVersion: version});
    db.prepare("UPDATE portfolio_risk_authority SET committed_at=committed_at+1 WHERE kind='scenarios'").run();
    expect((await store.readPortfolioRiskAuthority()).reasons.join(',')).toMatch(/AUTHORITY_COMMIT_SPLIT/);
    store.close();
  });
});

describe('the dataset fields stay locked on the generic channels', () => {
  it('H7/H25 refuses a PATCH that only wants to lower the derived maintenance rate', async () => {
    const {store, settings} = await open();
    const built = compiled();
    const patch = Object.fromEntries(Object.entries(LIMITS).map(([key, value]) => [`riskGovernance.portfolioRisk.${key}`, value]));
    const staged = applyGovernancePatch(settings as never, {...patch, 'riskGovernance.portfolioRisk.maintenanceMarginRatePct': 0.0001}, {acks: ['PORTFOLIO_RISK_PROFILE_ENABLED']});
    expect(staged.applied).toEqual([]);
    expect(staged.refusals).toEqual([expect.objectContaining({path: 'riskGovernance.portfolioRisk.maintenanceMarginRatePct', code: 'GOVERNANCE_FIELD_READ_ONLY'})]);
    // The same commit with only the limits is accepted, and the rate is still whatever the data says.
    const limitsOnly = applyGovernancePatch(settings as never, patch, {acks: ['PORTFOLIO_RISK_PROFILE_ENABLED']});
    expect(limitsOnly.refusals).toEqual([]);
    expect(limitsOnly.settings.riskGovernance.portfolioRisk.maintenanceMarginRatePct).toBeNull();
    const committed = await store.commitPortfolioRiskAuthority({facts: built.facts, settings: settingsWithAuthority(limitsOnly.settings as never, built.profileFacts as never),
      expectedSettingsVersion: Number((settings as {settingsVersion: number}).settingsVersion)});
    expect(committed.settings.riskGovernance.portfolioRisk.maintenanceMarginRatePct).toBe(built.facts.margin.maintenanceMarginRatePct);
    store.close();
  });

  it('H9 refuses to write a dataset version through the patch channel at all', async () => {
    const {store, settings} = await open();
    const staged = applyGovernancePatch(settings as never, {'riskGovernance.portfolioRisk.marginTierVersion': 'TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_' + '0'.repeat(64)}, {});
    expect(staged.applied).toEqual([]);
    expect(staged.refusals[0]).toMatchObject({code: 'GOVERNANCE_FIELD_READ_ONLY'});
    expect(Number((await store.load()).settingsVersion)).toBe(Number((settings as {settingsVersion: number}).settingsVersion));
    store.close();
  });
});
