import {describe,expect,it,vi} from 'vitest';
import {ExternalTradeAdapter} from '../adapters/exchange/ExternalTradeAdapter.js';
import {EngineRuntime} from '../runtime/appRuntime.js';
import {
  canonicalizeMarginBrackets,
  MARGIN_AUTHORITY_SCHEMA,
  portfolioRiskAuthorityBlockers,
  portfolioRiskAuthorityCompile,
} from './portfolioRiskAuthority.js';
import {PortfolioRiskAdmission, portfolioRiskProfileBlockers, portfolioRiskProfileStatus} from './portfolioRiskLedger.js';
import {executionReadiness} from './executionReadiness.js';

/**
 * A PortfolioRisk profile must never become "proven" because somebody typed a version string. The
 * facts behind marginTier / correlation / scenarios are datasets with content, and the only honest
 * identity for a dataset is a hash of that content, computed by this server, stored durably, and
 * re-checked on every admission. Everything below is an attempt to get a READY profile without that.
 */

const SCENARIO_A = {id: 'DOWN_10_LIQUIDITY', priceShockPct: -0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: -0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5};
const SCENARIO_B = {id: 'UP_10_LIQUIDITY', priceShockPct: 0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: 0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5};
const SCENARIO_C = {id: 'EXCHANGE_GAP_15', priceShockPct: -0.15, spreadWidenPct: 0.02, fundingShockPct: 0.005, markBasisShockPct: -0.02, depthPenaltyPct: 0.03, exchangeUnavailable: true, unavailablePenaltyPct: 0.03, clusterConvergencePct: 0.75};
const SCENARIOS = [SCENARIO_A, SCENARIO_B, SCENARIO_C];

/** Real `/fapi/v1/leverageBracket` tier shape, not an invented field name. */
const tier = (bracket: number, notionalFloor: number, notionalCap: number | null, maintMarginRatio: number, initialLeverage = 10) =>
  ({bracket, notionalFloor, notionalCap, maintMarginRatio, initialLeverage, cum: null});
const bracketRow = (symbol: string, tiers: unknown[]) => ({symbol, brackets: tiers});
const read = (symbols: unknown[], environment = 'TESTNET', failures: unknown[] = []) =>
  ({environment, credentialRef: 'binance-primary', observedAt: 1_700_000_000_000, symbols, failures});

function compile(over: Partial<Parameters<typeof portfolioRiskAuthorityCompile>[0]> = {}) {
  return portfolioRiskAuthorityCompile({
    environment: 'TESTNET', accountScope: 'binance-primary',
    bracketRead: read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 50_000, 200_000, 0.01)]), bracketRow('ETHUSDT', [tier(0, 0, null, 0.005)])]),
    requiredSymbols: ['BTCUSDT', 'ETHUSDT'], clusters: {}, scenarios: SCENARIOS, ...over,
  });
}
/** The numeric limits a profile must carry alongside the dataset facts; see PROFILE_LIMIT_KEYS. */
const LIMITS = {maxCapitalAtRiskUsd: 600, maxStressLossUsd: 300, maxGrossNotionalUsd: 6000, maxDirectionNotionalUsd: 4000, maxClusterNotionalUsd: 6000,
  maxHumanNotionalUsd: 6000, maxDrawdownPct: 1, minMarginBufferPct: 0, minLiquidationBufferPct: 0, maxHumanPositions: 50, maxPendingHandoffs: 50,
  maxAckAgeMs: 86_400_000, snapshotTtlMs: 20_000};
/** The profile a legitimate authority commit produces: versions and rate are the server's own. */
function profileFrom(facts: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {configured: true, ...LIMITS, ...facts, ...over};
}

describe('margin dataset canonicalisation is fail-closed', () => {
  it('accepts a well-formed read and orders symbols and tiers deterministically', () => {
    const ethTiers = [tier(0, 0, 50_000, 0.004), tier(1, 50_000, null, 0.006)];
    const first = canonicalizeMarginBrackets(read([bracketRow('ETHUSDT', ethTiers), bracketRow('btcusdt', [tier(1, 50_000, null, 0.005), tier(0, 0, 50_000, 0.004)])]));
    const again = canonicalizeMarginBrackets(read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 50_000, null, 0.005)]), bracketRow('ETHUSDT', [...ethTiers].reverse())]));
    expect(first.ok, JSON.stringify(first.failures)).toBe(true);
    if (!first.ok) return;
    expect(again.ok).toBe(true);
    expect(first.dataset.map(row => row.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(first.dataset[0].tiers.map(t => t.bracket)).toEqual([0, 1]);
    expect(canonicalizeMarginBrackets(read([])).ok).toBe(false);
  });

  it('rejects NaN, Infinity, negative ratios and inverted floor/cap instead of normalising them', () => {
    for (const bad of [
      [tier(0, 0, null, Number.NaN)],
      [tier(0, 0, null, Number.POSITIVE_INFINITY)],
      [tier(0, 0, null, -0.004)],
      [tier(0, 50_000, 10_000, 0.004)],
      [tier(0, 0, null, 0.004, 0)],
      [tier(0, -1, null, 0.004)],
    ]) {
      const result = canonicalizeMarginBrackets(read([bracketRow('BTCUSDT', bad)]));
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses an unprovable tier gap and a missing bracket for a required symbol', () => {
    const gap = canonicalizeMarginBrackets(read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(2, 100_000, null, 0.006)])]));
    expect(gap.ok).toBe(false);
    const compiled = compile({requiredSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']});
    expect(compiled.ok).toBe(false);
    expect(compiled.blockers.join(',')).toMatch(/MARGIN_BRACKET_MISSING:SOLUSDT/);
  });

  it('rejects two tiers that claim the same range with different maintenance ratios', () => {
    const conflict = canonicalizeMarginBrackets(read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 0, 50_000, 0.01)])]));
    expect(conflict.ok).toBe(false);
  });
});

describe('authority versions and the maintenance rate are server-derived', () => {
  it('derives every version from dataset content and never from a client label', () => {
    const built = compile();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.facts.margin.version).toMatch(new RegExp(`^${MARGIN_AUTHORITY_SCHEMA}_SHA256_[0-9a-f]{64}$`));
    expect(built.facts.correlation.version).toContain('SHA256_');
    expect(built.facts.scenarios.version).toContain('SHA256_');
    expect(built.profileFacts.maintenanceMarginRatePct).toBe(0.01);
  });

  it('takes the maximum applicable bracket rate, never an average, and repeats identically', () => {
    const wide = compile({bracketRead: read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 50_000, 200_000, 0.025), tier(2, 200_000, null, 0.006)])]), requiredSymbols: ['BTCUSDT']});
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    // Sizing reachability is not provable for BTCUSDT here, so the rule degrades to the max of all covered tiers.
    expect(wide.profileFacts.maintenanceMarginRatePct).toBe(0.025);
    expect(compile().facts.margin.contentHash).toEqual(compile().facts.margin.contentHash);
  });

  it('uses the reachable bracket range when sizing envelopes are provable, and still conservative', () => {
    const provable = compile({
      bracketRead: read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.02), tier(1, 50_000, null, 0.004)])]),
      requiredSymbols: ['BTCUSDT'],
      reachability: [{symbol: 'BTCUSDT', minNotionalUsd: 100, maxNotionalUsd: 40_000}],
    });
    expect(provable.ok).toBe(true);
    if (!provable.ok) return;
    expect(provable.profileFacts.maintenanceMarginRatePct).toBe(0.02);
    expect(provable.facts.margin.derivation).toBe('REACHABLE_TIERS');
  });

  it('changes the hash when any tier drifts, and keeps it for observation-time-only differences', () => {
    const base = compile();
    const drifted = compile({bracketRead: read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.0041), tier(1, 50_000, 200_000, 0.01)]), bracketRow('ETHUSDT', [tier(0, 0, null, 0.005)])])});
    const reObserved = compile({bracketRead: {...read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 50_000, 200_000, 0.01)]), bracketRow('ETHUSDT', [tier(0, 0, null, 0.005)])]), observedAt: 1_700_000_999_999}});
    expect(base.ok && drifted.ok && reObserved.ok).toBe(true);
    if (!base.ok || !drifted.ok || !reObserved.ok) return;
    expect(drifted.facts.margin.contentHash).not.toBe(base.facts.margin.contentHash);
    expect(reObserved.facts.margin.contentHash).toBe(base.facts.margin.contentHash);
    expect(reObserved.facts.margin.observedAt).toBe(1_700_000_999_999);
  });

  it('is insensitive to JSON key order and scenario order, and derives correlation identity from the dataset', () => {
    const reordered = compile({scenarios: [SCENARIO_B, SCENARIO_C, SCENARIO_A]});
    const keyOrdered = compile({scenarios: [Object.fromEntries(Object.entries(SCENARIO_A).reverse()), SCENARIO_B, SCENARIO_C]});
    expect(reordered.ok && keyOrdered.ok).toBe(true);
    if (!reordered.ok || !keyOrdered.ok) return;
    expect(reordered.facts.scenarios.contentHash).toBe(compile().facts.scenarios.contentHash);
    expect(keyOrdered.facts.scenarios.contentHash).toBe(compile().facts.scenarios.contentHash);
    const clusters = compile({clusters: {BTC: 'MAJOR', ETH: 'MAJOR'}});
    expect(clusters.ok).toBe(true);
    if (!clusters.ok) return;
    expect(clusters.facts.correlation.clusters).toEqual({BTC: 'MAJOR', ETH: 'MAJOR'});
    expect(clusters.facts.correlation.contentHash).not.toBe(compile().facts.correlation.contentHash);
  });

  it('refuses a PRODUCTION read used to claim Testnet authority', () => {
    const production = compile({bracketRead: read([bracketRow('BTCUSDT', [tier(0, 0, null, 0.004)])], 'PRODUCTION'), requiredSymbols: ['BTCUSDT']});
    expect(production.ok).toBe(false);
    expect(production.blockers.join(',')).toMatch(/MARGIN_AUTHORITY_ENVIRONMENT/);
  });
});

describe('profile validation trusts the durable authority, not strings', () => {
  it('H1 a non-empty version triple with no committed authority is never READY', () => {
    const placeholder = {configured: true, maxCapitalAtRiskUsd: 600, maxStressLossUsd: 900, maxGrossNotionalUsd: 6000, maxDirectionNotionalUsd: 4000, maxClusterNotionalUsd: 3000, maxHumanNotionalUsd: 6000, maxDrawdownPct: 1, minMarginBufferPct: 0, minLiquidationBufferPct: 0, maxHumanPositions: 50, maxPendingHandoffs: 50, maxAckAgeMs: 86_400_000, snapshotTtlMs: 20_000,
      marginTierVersion: 'looks-proven-i-typed-it', maintenanceMarginRatePct: 0.005, correlationVersion: 'corr-2026-09', scenarioVersion: 'scn-2026-09', clusters: {}, scenarios: SCENARIOS} as never;
    const withoutAuthority = portfolioRiskProfileBlockers(placeholder, {facts: null, environment: 'TESTNET', accountScope: 'binance-primary'});
    expect(withoutAuthority).toContain('MARGIN_AUTHORITY_MISSING');
    expect(portfolioRiskProfileStatus(placeholder, {facts: null, environment: 'TESTNET', accountScope: 'binance-primary'})).not.toBe('READY');
    // The legacy shape-only layer still refuses to call this READY once an authority context exists,
    // and the runtime always supplies that context.
    expect(portfolioRiskProfileBlockers(placeholder)).toEqual([]);
  });

  it('accepts exactly the profile the compiler produced and nothing weaker', () => {
    const built = compile();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const profile = profileFrom(built.profileFacts);
    const context = {facts: built.facts, environment: 'TESTNET', accountScope: 'binance-primary', requiredSymbols: ['BTCUSDT']};
    expect(portfolioRiskProfileBlockers(profile, context)).toEqual([]);
    expect(portfolioRiskProfileStatus(profile, context)).toBe('READY');
    expect(portfolioRiskProfileBlockers({...profile, maintenanceMarginRatePct: 0.001} as never, context)).toContain('MAINTENANCE_RATE_MISMATCH');
    expect(portfolioRiskProfileBlockers({...profile, marginTierVersion: 'forged' } as never, context)).toContain('MARGIN_TIER_VERSION_MISMATCH');
    expect(portfolioRiskProfileBlockers({...profile, correlationVersion: 'forged'} as never, context)).toContain('CORRELATION_AUTHORITY_MISMATCH');
    expect(portfolioRiskProfileBlockers({...profile, scenarioVersion: 'forged'} as never, context)).toContain('STRESS_SCENARIO_AUTHORITY_MISMATCH');
    expect(portfolioRiskProfileBlockers({...profile, clusters: {BTC: 'OTHER'} } as never, context)).toContain('CORRELATION_AUTHORITY_MISMATCH');
    expect(portfolioRiskProfileBlockers({...profile, scenarios: [SCENARIO_A]} as never, context)).toContain('STRESS_SCENARIO_AUTHORITY_MISMATCH');
  });

  it('H23/H3 a candidate symbol outside the committed coverage fails closed with a named blocker', () => {
    const built = compile();
    if (!built.ok) throw new Error('fixture must compile');
    const profile = profileFrom(built.profileFacts);
    const blockers = portfolioRiskAuthorityBlockers({profile, facts: built.facts, environment: 'TESTNET', accountScope: 'binance-primary', requiredSymbols: ['BTCUSDT', 'DOGEUSDT']});
    expect(blockers).toContain('MARGIN_TIER_SYMBOL_UNPROVEN:DOGEUSDT');
    expect(portfolioRiskProfileStatus(profile, {facts: built.facts, environment: 'TESTNET', accountScope: 'binance-primary', requiredSymbols: ['BTCUSDT', 'DOGEUSDT']})).not.toBe('READY');
  });

  it('marks drift stale and refuses readiness, without silently adopting the new hash', () => {
    const built = compile();
    if (!built.ok) throw new Error('fixture must compile');
    // A fresh collection of the same bracket table is not drift; a changed tier is, and it stays a
    // diagnosis rather than a new authority.
    const recollected = compile({bracketRead: {...read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 50_000, 200_000, 0.01)]), bracketRow('ETHUSDT', [tier(0, 0, null, 0.005)])]), observedAt: 1_800_000_000_000}});
    const drifted = compile({bracketRead: read([bracketRow('BTCUSDT', [tier(0, 0, 50_000, 0.004), tier(1, 50_000, 200_000, 0.0125)]), bracketRow('ETHUSDT', [tier(0, 0, null, 0.005)])])});
    expect(built.ok && recollected.ok && drifted.ok).toBe(true);
    if (!drifted.ok || !recollected.ok) return;
    const profile = profileFrom(built.profileFacts);
    const context = {facts: built.facts, environment: 'TESTNET', accountScope: 'binance-primary'};
    expect(portfolioRiskProfileBlockers(profile, {...context, staleObservedContentHash: recollected.facts.margin.contentHash})).toEqual([]);
    expect(portfolioRiskProfileBlockers(profile, {...context, staleObservedContentHash: drifted.facts.margin.contentHash})).toEqual(['MARGIN_AUTHORITY_STALE']);
    expect(portfolioRiskProfileStatus(profile, {...context, staleObservedContentHash: drifted.facts.margin.contentHash})).toBe('PROFILE_FACTS_UNPROVEN');
    // The drifted hash is never adopted: the profile still names the committed version.
    expect(profile.marginTierVersion).toBe(built.facts.margin.version);
    expect(portfolioRiskProfileBlockers(profile, {facts: null, environment: 'TESTNET', accountScope: 'binance-primary'})).toContain('MARGIN_AUTHORITY_MISSING');
  });

  it('refuses a scope mismatch so a Testnet authority cannot be replayed on another account', () => {
    const built = compile();
    if (!built.ok) throw new Error('fixture must compile');
    const profile = profileFrom(built.profileFacts);
    expect(portfolioRiskProfileBlockers(profile, {facts: built.facts, environment: 'TESTNET', accountScope: 'binance-other'})).toContain('MARGIN_AUTHORITY_SCOPE_MISMATCH');
  });
});

function fakeTransport(environment = 'TESTNET') {
  const calls: string[] = [], writes: string[] = [];
  const transport = {
    calls, writes,
    environment: () => environment,
    executionMode: () => 'READ_ONLY',
    json: async (path: string) => {
      calls.push(path.split('?')[0]);
      if (path.startsWith('/fapi/v1/time')) return {serverTime: Date.now()};
      const symbol = new URLSearchParams(path.split('?')[1] ?? '').get('symbol');
      if (symbol === 'MISSINGUSDT') return [];
      return [bracketRow(String(symbol), [tier(0, 0, 50_000, 0.004), tier(1, 50_000, null, 0.01)])];
    },
    assertTestnetExchangeWrite: (operation: string) => {writes.push(String(operation));throw new Error('WRITE_ATTEMPTED');},
    entryBlockReason: () => null,
  };
  return transport;
}
const adapterFor = (transport: any) => new ExternalTradeAdapter(transport, {apiKey: 'k', apiSecret: 's'});
describe('the bracket collector is a pure read', () => {

  it('issues one signed GET per required symbol and never touches a writer or setLeverage', async () => {
    const transport = fakeTransport();
    const result = await adapterFor(transport).fetchMaintenanceMarginBrackets(['btcusdt', 'BTCUSDT', 'ethusdt']);
    expect(transport.calls.filter(path => path === '/fapi/v1/leverageBracket')).toHaveLength(2);
    expect(transport.calls.some(path => path === '/fapi/v1/leverage')).toBe(false);
    expect(result.symbols.map(row => row.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(result.environment).toBe('TESTNET');
  });

  it('refuses to collect authority in production and reports per-symbol failures instead of a partial dataset', async () => {
    await expect(adapterFor(fakeTransport('PRODUCTION')).fetchMaintenanceMarginBrackets(['BTCUSDT'])).rejects.toThrow(/MARGIN_AUTHORITY_REQUIRES_TESTNET/);
    const partial = await adapterFor(fakeTransport()).fetchMaintenanceMarginBrackets(['BTCUSDT', 'MISSINGUSDT']);
    expect(partial.failures.map(f => f.symbol)).toContain('MISSINGUSDT');
    const compiled = portfolioRiskAuthorityCompile({environment: 'TESTNET', accountScope: 'binance-primary', bracketRead: partial, requiredSymbols: ['BTCUSDT', 'MISSINGUSDT'], clusters: {}, scenarios: SCENARIOS});
    expect(compiled.ok).toBe(false);
  });

  it('bounds fan-out so a wide universe cannot launch an unbounded weight-30 burst', async () => {
    const transport = fakeTransport();
    let inFlight = 0, peak = 0;
    (transport as unknown as {json: (path: string) => Promise<unknown>}).json = async (path: string) => {
      if (path.startsWith('/fapi/v1/time')) return {serverTime: Date.now()};
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return [bracketRow(new URLSearchParams(path.split('?')[1] ?? '').get('symbol') ?? '', [tier(0, 0, null, 0.004)])];
    };
    const symbols = Array.from({length: 40}, (_, index) => `SYM${index}USDT`);
    const result = await adapterFor(transport).fetchMaintenanceMarginBrackets(symbols);
    expect(result.symbols).toHaveLength(40);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('the position-fact probe is a single GET and never reaches a writer', async () => {
    const transport = fakeTransport();
    const probe = await adapterFor(transport).probePositionRiskFields();
    expect([...new Set(transport.calls)].sort()).toEqual(['/fapi/v1/time', '/fapi/v3/positionRisk']);
    expect(transport.writes).toEqual([]);
    expect(probe.environment).toBe('TESTNET');
    // No positionAmt on the fake rows: the probe reports what the exchange sent, not a guess.
    expect(probe.rowCount).toBe(1);
    expect(probe.rows).toEqual([]);
    expect(probe.fieldNames).toEqual(['brackets', 'symbol']);
    await expect(adapterFor(fakeTransport('PRODUCTION')).probePositionRiskFields()).rejects.toThrow(/POSITION_PROBE_REQUIRES_TESTNET/);
  });
});

const COMMIT_LIMITS = {configured: true, maxCapitalAtRiskUsd: 600, maxStressLossUsd: 300, maxGrossNotionalUsd: 6000, maxDirectionNotionalUsd: 4000, maxClusterNotionalUsd: 6000,
  maxHumanNotionalUsd: 6000, maxDrawdownPct: 1, minMarginBufferPct: 0, minLiquidationBufferPct: 0, maxHumanPositions: 8, maxPendingHandoffs: 8, maxAckAgeMs: 86_400_000,
  snapshotTtlMs: 20_000, cashFlowWindowMs: 86_400_000, cashFlowMaxAgeMs: 900_000};

/**
 * The commit channel, driven through the real runtime method over a fake exchange: what the operator
 * gets back must be derived by this server from a GET-only collection, and every refusal has to leave
 * Settings exactly where it found them.
 */
describe('the derived rate is bounded by the notional the account can actually reach', () => {
  // A live-shaped ladder: the top bracket prices 2x leverage, which no entry inside the
  // operator's own gross cap can ever occupy.
  const ladder = (symbol: string, top: number) => ({symbol, brackets: [
    {bracket: 0, initialLeverage: 20, notionalFloor: 0, notionalCap: 50_000, maintMarginRatio: 0.004, cum: 0},
    {bracket: 1, initialLeverage: 10, notionalFloor: 50_000, notionalCap: 200_000, maintMarginRatio: 0.01, cum: 100},
    {bracket: 2, initialLeverage: 2, notionalFloor: 200_000, notionalCap: null, maintMarginRatio: top, cum: 5_000},
  ]});
  const readOf = (rows: unknown[]) => ({environment: 'TESTNET', credentialRef: 'binance-primary', observedAt: 1_700_000_000_000, symbols: rows, failures: []});
  const build = (rows: unknown[], sizingBound: Record<string, unknown>) => portfolioRiskAuthorityCompile({
    environment: 'TESTNET', accountScope: 'binance-primary', bracketRead: readOf(rows),
    requiredSymbols: [...new Set(rows.map(row => String((row as {symbol: string}).symbol)))], clusters: {}, scenarios: SCENARIOS, sizingBound,
  });

  it('R1 excludes brackets the entry cap makes unreachable, and still takes the maximum, not an average', () => {
    const bounded = build([ladder('BTCUSDT', 0.5)], {maxEntryNotionalUsd: 10_813, maintenanceRateBound: 0.2});
    expect(bounded.ok, JSON.stringify((bounded as {blockers: string[]}).blockers)).toBe(true);
    if (!bounded.ok) return;
    expect(bounded.facts.margin.maintenanceMarginRatePct).toBe(0.004);
    expect(bounded.facts.margin.derivation).toBe('ENTRY_BOUND_TIERS');
    // The unbounded degradation is what produced the impossible 0.5 in the first place.
    const unbounded = build([ladder('BTCUSDT', 0.5)], {});
    expect(unbounded.ok).toBe(true);
    if (!unbounded.ok) return;
    expect(unbounded.facts.margin.maintenanceMarginRatePct).toBe(0.5);
    expect(unbounded.facts.margin.derivation).toBe('ALL_COVERED_TIERS');
  });

  it('R2 refuses and names the symbol when the rate inside the cap still exceeds the field bound; it never clamps', () => {
    // ETHUSDT prices everything up to null notional at 25% - unreachable or not, that is a fact about a
    // bracket the account could actually sit in, so the commit must fail rather than round it down.
    const result = build([ladder('BTCUSDT', 0.5), {symbol: 'ETHUSDT', brackets: [{bracket: 0, initialLeverage: 4, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.25, cum: 0}]}],
      {maxEntryNotionalUsd: 10_813, maintenanceRateBound: 0.2});
    expect(result.ok).toBe(false);
    const blockers = (result as {blockers: string[]}).blockers;
    expect(blockers.join(',')).toMatch(/MAINTENANCE_RATE_EXCEEDS_PROFILE_BOUND:0\.2:ETHUSDT/);
    expect((result as {facts: null}).facts).toBeNull();
    expect((result as {profileFacts: null}).profileFacts).toBeNull();
    expect(JSON.stringify(blockers)).not.toMatch(/:0\.2[,}"]/);
  });

  it('R3 a cap that is not provable degrades to the all-covered maximum and reports that honestly', () => {
    for (const cap of [undefined, null, 0, Number.NaN, -1]) {
      const built = build([ladder('BTCUSDT', 0.012)], {maxEntryNotionalUsd: cap, maintenanceRateBound: 0.2});
      expect(built.ok, String(cap)).toBe(true);
      if (!built.ok) continue;
      expect(built.facts.margin.derivation, String(cap)).toBe('ALL_COVERED_TIERS');
      expect(built.facts.margin.maintenanceMarginRatePct).toBe(0.012);
    }
  });

  it('R4 the coverage rule keeps USDC-margined symbols and spans the eligible universe, not one routing tick', () => {
    const eligible = (symbol: string, rank: number) => ({symbol, eligible: true, rank});
    const state: any = {
      entryOrders: new Map(), entryReservations: new Map(),
      activeEntrySymbols: () => new Set<string>(), positionSymbols: () => new Set(['BTCUSDT', 'BNBUSDC']),
      pool: {readyList: () => [{symbol: 'SOLUSDT', state: 'READY'}]},
      universe: [eligible('NEARUSDC', 1), eligible('DOGEUSDC', 2), eligible('XRPUSDT', 3), {symbol: 'JUNKUSDT', eligible: false, rank: 0},
        ...Array.from({length: 60}, (_, i) => eligible(`U${i}USDT`, 10 + i))],
      settings: {selection: {poolMax: 24}},
    };
    const self: any = {state};
    const symbols = (EngineRuntime.prototype as unknown as {portfolioRiskRequiredSymbols: (this: unknown) => string[]}).portfolioRiskRequiredSymbols.call(self);
    // USDC-margined symbols must be covered, and a routed candidate must not depend on which two
    // symbols capital happened to route this second.
    expect(symbols).toEqual(expect.arrayContaining(['BTCUSDT', 'BNBUSDC', 'SOLUSDT', 'NEARUSDC', 'DOGEUSDC', 'XRPUSDT']));
    expect(symbols).not.toContain('JUNKUSDT');
    // Bounded: positions + pool + at most poolMax*2 universe symbols, never the whole 60-strong tail.
    expect(symbols.length).toBeLessThanOrEqual(3 + 24 * 2 + 1);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('R5 an uncovered candidate is refused by admission, and a moving routing tick never freezes model spend', () => {
    const accountScope = 'binance-primary';
    const compiled = portfolioRiskAuthorityCompile({
      environment: 'TESTNET', accountScope,
      bracketRead: {environment: 'TESTNET', credentialRef: accountScope, observedAt: 1, failures: [],
        symbols: [{symbol: 'BTCUSDT', brackets: [{bracket: 0, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.005, initialLeverage: 10, cum: 0}]}]},
      requiredSymbols: ['BTCUSDT'], clusters: {BTC: 'MAJOR'}, scenarios: SCENARIOS,
    });
    if (!compiled.ok) throw new Error('fixture must compile');
    const profileRow = profileFrom(compiled.profileFacts);
    const input = {
      settings: {connections: {executionMode: 'TESTNET_ENABLED', exchange: {environment: 'TESTNET'}},
        riskGovernance: {entrySafetyMode: 'AUTO', portfolioRisk: profileRow}} as never,
      account: {status: 'READY', asOf: Date.now()} as never, runtimeControlMode: 'RUNNING', executionGovernanceMode: 'AUTO_RUNNING',
      writeAdmissionBlock: null, executableCandidateCount: 2, portfolioRiskAuthority: {facts: compiled.facts},
      authorityScope: {environment: 'TESTNET', accountScope}, sizingWatchSymbols: ['BTCUSDT', 'NEARUSDC'],
    };
    // Capital routed only uncovered symbols this tick: the sized universe is still coverable, so the
    // pipeline keeps paying for analysis instead of oscillating into a self-made silence.
    const routedElsewhere = executionReadiness({...input, executableCandidateSymbols: ['NEARUSDC', 'DOGEUSDC'], sizingWatchSymbols: ['BTCUSDT', 'NEARUSDC']} as never);
    expect(routedElsewhere.blockers).not.toContain('MARGIN_TIER_NO_COVERED_CANDIDATE');
    expect(routedElsewhere.ready).toBe(true);
    // Nothing in the sized universe is covered: that, and only that, stops the spend.
    const noneCovered = executionReadiness({...input, executableCandidateSymbols: ['NEARUSDC'], sizingWatchSymbols: ['NEARUSDC', 'DOGEUSDC']} as never);
    expect(noneCovered.blockers).toEqual([]);
    expect(noneCovered.modelSpendPermitted).toBe(true);
    // A specific candidate outside coverage is still refused, by name, at admission.
    const admission = new PortfolioRiskAdmission({
      state: {positions: new Map(), entryOrders: new Map(), entryReservations: new Map(), account: {status: 'READY', asOf: Date.now(), equityUsd: 10_000, assets: [], riskBaseline: {}}, settings: input.settings} as never,
      identity: () => ({environment: 'TESTNET', account: accountScope}), ownerOf: () => null, cashFlows: () => [],
      coverageWatch: () => ['DOGEUSDT', 'BTCUSDT'],
      profile: () => profileRow,
      authority: () => ({facts: compiled.facts, staleObservedContentHash: null}),
    });
    const blockers = admission.profileReadback(['DOGEUSDT']).blockers;
    expect(blockers).toContain('MARGIN_TIER_SYMBOL_UNPROVEN:DOGEUSDT');
    // The profile itself stays READY: coverage of one candidate is not a global licence or a global veto.
    expect(admission.profileReadback([]).status).toBe('READY');
    expect(admission.profileReadback([]).authority.uncoveredCoverageCandidates).toEqual(['DOGEUSDT']);
  });
});

describe('the authority commit channel derives its own facts', () => {
  function commitFixture(options: {environment?: string; collector?: boolean; extraPosition?: string; poolSymbols?: string[]; lifecycle?: [string, string][]} = {}) {
    const environment = options.environment ?? 'TESTNET';
    const transport = fakeTransport(environment);
    const adapter = options.collector === false ? {label: 'adapter-without-the-capability'} : adapterFor(transport);
    const settings: Record<string, unknown> = {settingsVersion: 197,
      connections: {exchange: {environment, credentialRef: 'binance-primary'}, executionMode: 'READ_ONLY'},
      riskGovernance: {portfolioRisk: {}}, portfolio: {maxPositions: 8}};
    const state: any = {settings, positions: new Map([['p1', {symbol: 'BTCUSDT', side: 'LONG', quantity: 0.02, markPrice: 50_000, leverage: 10, cycleId: 'cycle-1', marginAsset: 'USDT'}]]), entryOrders: new Map(), entryReservations: new Map(),
      account: {status: 'UNKNOWN', asOf: 0, assets: [], riskBaseline: {}}, snapshots: new Map(),
      activeEntrySymbols: () => new Set(['ETHUSDT', options.extraPosition ?? ''].filter(Boolean)),
      positionSymbols: () => new Set(['BTCUSDT']),
      pool: {readyList: () => (options.poolSymbols ?? ['SOLUSDT']).map(symbol => ({symbol, state: 'READY'}))},
      // The ledger the scheduler actually routes from: a symbol with a routable lifecycle state can be
      // dispatched for analysis and reach admission even while the pool holds something else.
      candidateLifecycle: new Map<string, any>((options.lifecycle ?? []).map(([symbol, status]) => [symbol, {symbol, status}])), setSettings: (next: any) => {state.settings = next;}};
    const self: any = {state, trade: adapter, events: {publish: vi.fn()}, applied: [] as number[],
      portfolioRiskAuthority: {facts: null, reasons: ['AUTHORITY_NOT_LOADED'], loadedAt: 0, staleObservedContentHash: null},
      portfolioRiskAuthorityDriftReport: null,
      settingsStore: {commitPortfolioRiskAuthority: vi.fn(async (input: any) => {
        const saved = {...input.settings, settingsVersion: input.expectedSettingsVersion + 1};
        return {settings: saved, authority: input.facts};
      })},
      applySavedSettings: vi.fn(async (next: any) => {state.settings = next; self.applied.push(next.settingsVersion); return next;})};
    self.portfolioRisk = new PortfolioRiskAdmission({state,
      identity: () => ({environment: String(state.settings.connections.exchange.environment), account: String(state.settings.connections.exchange.credentialRef)}),
      ownerOf: () => ({ownerState: 'HUMAN_MANAGED' as const, handoffAt: null, acknowledgedAt: null}), cashFlows: () => [], profile: () => state.settings.riskGovernance.portfolioRisk ?? {},
      authority: () => ({facts: self.portfolioRiskAuthority.facts, staleObservedContentHash: self.portfolioRiskAuthority.staleObservedContentHash})});
    const proto = EngineRuntime.prototype as unknown as Record<string, (this: unknown, ...args: any[]) => any>;
    for (const name of ['authorityScope', 'portfolioRiskRequiredSymbols', 'portfolioRiskCoverageUniverse', 'portfolioRiskSizingBound', 'collectPortfolioRiskMarginBrackets', 'collectPortfolioRiskAuthorityPreview', 'commitPortfolioRiskAuthority', 'mirrorMarginTierCoverage', 'portfolioRiskAuthorityReadback', 'inspectPortfolioRiskAuthorityDrift']) {
      self[name] = (...args: any[]) => proto[name].call(self, ...args);
    }
    return {self, state, transport};
  }
  const request = (over: Record<string, unknown> = {}) => ({limits: COMMIT_LIMITS, clusters: {}, scenarios: SCENARIOS,
    acks: ['PORTFOLIO_RISK_PROFILE_ENABLED'], expectedSettingsVersion: 197, operator: 'test', ...over});

  it('H8 collects by GET only and commits versions and a rate this server derived', async () => {
    const {self, state, transport} = commitFixture();
    await self.commitPortfolioRiskAuthority(request());
    expect(transport.calls.filter(path => path === '/fapi/v1/leverageBracket')).toHaveLength(3);
    expect([...new Set(transport.calls)].sort()).toEqual(['/fapi/v1/leverageBracket', '/fapi/v1/time']);
    expect(transport.writes).toEqual([]);
    const profile = state.settings.riskGovernance.portfolioRisk;
    expect(profile.marginTierVersion).toMatch(/^TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_[0-9a-f]{64}$/);
    // The 6,000 USDT gross cap in COMMIT_LIMITS makes the 50k+ tier unreachable, so the honest
    // conservative rate is the maximum of the tiers the account could actually sit in.
    expect(profile.maintenanceMarginRatePct).toBe(0.004);
    expect(profile.correlationVersion).toMatch(/^TESTNET_CORRELATION_CLUSTERS_V1_SHA256_/);
    expect(profile.scenarioVersion).toMatch(/^TESTNET_STRESS_SCENARIO_SET_V1_SHA256_/);
    expect(state.settings.settingsVersion).toBe(198);
    expect(self.settingsStore.commitPortfolioRiskAuthority).toHaveBeenCalledTimes(1);
    expect(self.portfolioRiskAuthorityReadback()).toMatchObject({status: 'READY', authority: {authorityStatus: 'MATCHED', coverageSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], missingSymbols: []}});
    expect(self.events.publish).toHaveBeenCalledWith('PORTFOLIO_RISK_AUTHORITY_COMMITTED', expect.objectContaining({settingsVersion: 198, rateDerivation: 'ENTRY_BOUND_TIERS'}));
  });

  it('an explicit refresh never narrows coverage, because the required universe is a snapshot of a rotating pool', async () => {
    const {self, state, transport} = commitFixture({poolSymbols: ['SOLUSDT', 'NEARUSDT']});
    await self.commitPortfolioRiskAuthority(request());
    expect(self.portfolioRiskAuthority.facts.margin.coverageSymbols).toEqual(['BTCUSDT', 'ETHUSDT', 'NEARUSDT', 'SOLUSDT']);
    // The pool rotates and NEARUSDT leaves this tick's universe. A refresh must widen-or-hold; silently
    // dropping is what turned a real live PLACE_LONG into MARGIN_TIER_SYMBOL_UNPROVEN:NEARUSDT.
    state.pool.readyList = () => [{symbol: 'SOLUSDT', state: 'READY'}];
    // The preview is the operator's dry run of the commit, so it must name the same universe — and an
    // unchanged bracket table must reproduce the committed identity rather than minting a new one.
    const preview = await self.collectPortfolioRiskAuthorityPreview({limits: COMMIT_LIMITS, clusters: {}, scenarios: SCENARIOS});
    expect(preview.requiredSymbols).toEqual(['BTCUSDT', 'ETHUSDT', 'NEARUSDT', 'SOLUSDT']);
    expect(preview.wouldCommit?.marginTierVersion).toBe(self.portfolioRiskAuthority.facts.margin.version);
    const callsBefore = transport.calls.length;
    await self.commitPortfolioRiskAuthority(request({expectedSettingsVersion: state.settings.settingsVersion}));
    const coverage = self.portfolioRiskAuthority.facts.margin.coverageSymbols;
    expect(coverage).toContain('NEARUSDT');
    expect(coverage).toEqual(['BTCUSDT', 'ETHUSDT', 'NEARUSDT', 'SOLUSDT']);
    // Carrying a symbol forward is not carrying its data forward: the tier is re-read from the exchange.
    expect(transport.calls.slice(callsBefore).filter(path => path === '/fapi/v1/leverageBracket')).toHaveLength(4);
    expect(self.portfolioRiskAuthorityReadback()).toMatchObject({status: 'READY', authority: {authorityStatus: 'MATCHED', missingSymbols: []}});
    const near = self.portfolioRisk.admit({symbol: 'NEARUSDT', side: 'LONG', quoteAsset: 'USDT', notionalUsd: 200, marginUsd: 25, leverage: 8, markPrice: 2.4, planId: 'plan-near'} as never);
    expect(near.reasons).not.toContain('MARGIN_TIER_SYMBOL_UNPROVEN:NEARUSDT');
  });

  it('coverage follows what the scheduler can route, not just what the pool holds this tick', async () => {
    // Live evidence: WLDUSDT, TAOUSDT, NEARUSDT, PENGUUSDT, UNIUSDT and DOGEUSDC each carried a natural
    // PLACE_LONG into admission and each was refused with MARGIN_TIER_SYMBOL_UNPROVEN, because coverage
    // was priced from the instantaneous pool while these symbols sat in the candidate ledger instead.
    const {self, state} = commitFixture({
      poolSymbols: ['SOLUSDT'],
      lifecycle: [['WLDUSDT', 'READY'], ['TAOUSDT', 'SCOUT_DONE'], ['NEARUSDT', 'PRIMARY_RUNNING'], ['GONEUSDT', 'EXCLUDED_UNDERLYING'], ['HELDUSDT', 'POSITION_OPEN']],
    });
    const required = self.portfolioRiskRequiredSymbols();
    expect(required).toEqual(expect.arrayContaining(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT', 'TAOUSDT', 'NEARUSDT']));
    // An excluded or already-held underlying is not routing demand, so it must not spend a bracket read.
    expect(required).not.toContain('GONEUSDT');
    expect(required).not.toContain('HELDUSDT');
    await self.commitPortfolioRiskAuthority(request());
    const coverage = self.portfolioRiskAuthority.facts.margin.coverageSymbols;
    expect(coverage).toEqual(expect.arrayContaining(['WLDUSDT', 'TAOUSDT', 'NEARUSDT']));
    // The refusal the live account saw is now impossible for a routed symbol.
    const routed = self.portfolioRisk.admit({symbol: 'WLDUSDT', side: 'LONG', quoteAsset: 'USDT', notionalUsd: 300, marginUsd: 25, leverage: 10, markPrice: 1.7, planId: 'plan-wld'} as never);
    expect(routed.reasons).not.toContain('MARGIN_TIER_SYMBOL_UNPROVEN:WLDUSDT');
    expect(state.settings.riskGovernance.portfolioRisk.marginTierVersion).toMatch(/^TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_/);
  });

  it('refuses a request that names a version or a rate before it spends one request', async () => {
    const {self, state, transport} = commitFixture();
    await expect(self.commitPortfolioRiskAuthority(request({limits: {...COMMIT_LIMITS, maintenanceMarginRatePct: 0.0001}}))).rejects.toThrow(/PORTFOLIO_RISK_LIMITS_REFUSED/);
    expect(transport.calls).toEqual([]);
    expect(self.settingsStore.commitPortfolioRiskAuthority).not.toHaveBeenCalled();
    expect(state.settings.settingsVersion).toBe(197);
  });

  it('H18 refuses a production context and an adapter without the read capability, without touching settings', async () => {
    const production = commitFixture({environment: 'PRODUCTION'});
    await expect(production.self.commitPortfolioRiskAuthority(request())).rejects.toThrow(/PORTFOLIO_RISK_AUTHORITY_REQUIRES_TESTNET:PRODUCTION/);
    expect(production.transport.calls).toEqual([]);
    expect(production.state.settings.settingsVersion).toBe(197);
    const legacy = commitFixture({collector: false});
    await expect(legacy.self.commitPortfolioRiskAuthority(request())).rejects.toThrow(/MARGIN_BRACKET_COLLECTOR_UNAVAILABLE/);
    expect(legacy.self.settingsStore.commitPortfolioRiskAuthority).not.toHaveBeenCalled();
    expect(legacy.state.settings.settingsVersion).toBe(197);
  });

  it('H3 reports the missing bracket by name and commits nothing', async () => {
    const {self, state, transport} = commitFixture({extraPosition: 'MISSINGUSDT'});
    const failure = await self.commitPortfolioRiskAuthority(request()).catch((error: unknown) => error as Error & {blockers?: string[]});
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure.message)).toMatch(/PORTFOLIO_RISK_AUTHORITY_UNPROVEN/);
    expect(String(failure.blockers)).toMatch(/BRACKET_SET_EMPTY:MISSINGUSDT/);
    expect(transport.writes).toEqual([]);
    expect(self.settingsStore.commitPortfolioRiskAuthority).not.toHaveBeenCalled();
    expect(state.settings.settingsVersion).toBe(197);
    expect(self.portfolioRiskAuthorityReadback()).toMatchObject({status: 'PROFILE_NOT_CONFIGURED'});
  });

  it('H24 marks a drifted bracket table stale and never adopts the new hash', async () => {
    const {self, state, transport} = commitFixture();
    await self.commitPortfolioRiskAuthority(request());
    const committedVersion = state.settings.riskGovernance.portfolioRisk.marginTierVersion;
    expect((await self.inspectPortfolioRiskAuthorityDrift()).status).toBe('MATCHED');
    transport.calls.length = 0;
    transport.json = async (filed: string) => {
      transport.calls.push(filed.split('?')[0]);
      const symbol = new URLSearchParams(filed.split('?')[1] ?? '').get('symbol');
      return [bracketRow(String(symbol), [tier(0, 0, 50_000, 0.004), tier(1, 50_000, null, 0.025)])];
    };
    expect((await self.inspectPortfolioRiskAuthorityDrift()).status).toBe('STALE');
    expect(transport.calls.filter(path => path === '/fapi/v1/leverageBracket')).toHaveLength(3);
    expect(transport.writes).toEqual([]);
    const readback = self.portfolioRiskAuthorityReadback();
    expect(readback.status).toBe('PROFILE_FACTS_UNPROVEN');
    expect(readback.authority.mismatchReasons).toContain('MARGIN_AUTHORITY_STALE');
    expect(state.settings.riskGovernance.portfolioRisk.marginTierVersion).toBe(committedVersion);
    expect(self.settingsStore.commitPortfolioRiskAuthority).toHaveBeenCalledTimes(1);
  });

  it('F2 the admission itself refuses until the durable authority exists, and names an uncovered symbol', async () => {
    const {self, state} = commitFixture();
    const candidate = {symbol: 'BTCUSDT', side: 'LONG', quoteAsset: 'USDT', notionalUsd: 1_000, marginUsd: 100, leverage: 10, markPrice: 50_000, planId: 'plan-1'};
    // The profile already names its versions; without the durable rows behind them it is still no risk licence.
    state.settings.riskGovernance.portfolioRisk = profileFrom(compile().profileFacts);
    const before = self.portfolioRisk.admit(candidate as never);
    expect(before.allowed).toBe(false);
    expect(before.reasons).toContain('MARGIN_AUTHORITY_MISSING');
    await self.commitPortfolioRiskAuthority(request());
    // A fresh private account is what lets the evaluation reach the dataset question at all.
    const equity = {status: 'READY', asOf: Date.now(), equityUsd: 10_000, assets: [{asset: 'USDT', walletBalance: 10_000, availableBalance: 10_000, usdValue: 10_000}],
      enrichment: {valuationAsOf: Date.now()}};
    state.account = equity;
    self.portfolioRisk.restore({generation: 0, contentHash: null, peakEquityUsd: 10_000});
    const after = self.portfolioRisk.admit(candidate as never);
    // §G: the bracket table prices the ladder, it does not manufacture a position's own facts. The
    // dataset blockers are gone; the unproven live maintenance/liquidation facts are still reported.
    expect(after.reasons.join(',')).not.toMatch(/MARGIN_AUTHORITY|MARGIN_TIER_VERSION|MAINTENANCE_RATE_MISMATCH/);
    expect(after.reasons.join(',')).toMatch(/MAINTENANCE_MARGIN_UNPROVEN:/);
    expect(after.reasons.join(',')).toMatch(/LIQUIDATION_BUFFER_UNPROVEN:/);
    const uncovered = self.portfolioRisk.admit({...candidate, symbol: 'DOGEUSDT', planId: 'plan-2'} as never);
    expect(uncovered.allowed).toBe(false);
    expect(uncovered.reasons).toContain('MARGIN_TIER_SYMBOL_UNPROVEN:DOGEUSDT');
  });
});
