import {stableRiskHash} from './portfolioRiskSnapshot.js';

/**
 * The margin tier / correlation / stress-scenario facts behind a PortfolioRisk profile are datasets,
 * not adjectives. Their only honest identity is a hash of their own content, computed here, persisted
 * durably, and re-checked on every admission — so a profile can never become "proven" because somebody
 * typed a plausible version string into Settings.
 */

export const MARGIN_AUTHORITY_SCHEMA = 'TESTNET_BINANCE_LEVERAGE_BRACKET_V1';
export const CORRELATION_AUTHORITY_SCHEMA = 'TESTNET_CORRELATION_CLUSTERS_V1';
export const SCENARIO_AUTHORITY_SCHEMA = 'TESTNET_STRESS_SCENARIO_SET_V1';

export type MarginBracketTier = {bracket: number; notionalFloor: number; notionalCap: number | null; maintenanceMarginRatio: number; initialLeverage: number; cum: number | null};
export type MarginBracketSymbolDataset = {symbol: string; tiers: MarginBracketTier[]};
/** What a collector returns before canonicalisation: exchange rows as read, nothing asserted. */
export type MarginBracketRawRead = {symbol: string; brackets: unknown[]};
export type MarginBracketFailure = {symbol: string; reason: string};
export type MarginBracketAuthorityRead = {environment: string; credentialRef: string; observedAt: number; symbols: MarginBracketRawRead[]; failures: MarginBracketFailure[]};
export type SizingReachability = {symbol: string; minNotionalUsd: number; maxNotionalUsd: number};

export type PortfolioRiskAuthorityFacts = {
  environment: string; accountScope: string; committedAt: number;
  /** The exact objects each hash was computed from. A durable row without its content cannot be re-verified. */
  canonical: {margin: unknown; correlation: unknown; scenarios: unknown};
  reachability: SizingReachability[];
  margin: {contentHash: string; version: string; maintenanceMarginRatePct: number; coverageSymbols: string[]; observedAt: number; derivation: 'REACHABLE_TIERS' | 'ALL_COVERED_TIERS'};
  correlation: {contentHash: string; version: string; clusters: Record<string, string>};
  scenarios: {contentHash: string; version: string; scenarios: Record<string, unknown>[]};
};

export type PortfolioRiskProfileFacts = {
  marginTierVersion: string; maintenanceMarginRatePct: number;
  correlationVersion: string; clusters: Record<string, string>;
  scenarioVersion: string; scenarios: Record<string, unknown>[];
};

export type PortfolioRiskAuthorityContext = {
  facts: PortfolioRiskAuthorityFacts | null;
  /** A later collection that differs from the committed one. Marked stale, never adopted silently. */
  staleObservedContentHash?: string | null;
  environment: string;
  accountScope: string;
  /** Symbols the admission path wants to size right now; anything uncovered fails closed. */
  requiredSymbols?: string[];
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const hex = (value: unknown) => stableRiskHash(value).replace(/^v396r/, '');
const versionFor = (schema: string, value: unknown) => `${schema}_SHA256_${hex(value)}`;
const AUTHORITY_SCHEMAS = [MARGIN_AUTHORITY_SCHEMA, CORRELATION_AUTHORITY_SCHEMA, SCENARIO_AUTHORITY_SCHEMA];

/**
 * Recompute an identity from stored content instead of trusting a stored identity. Every durable
 * authority row must survive this, so a row that names a hash its own payload does not produce is
 * not authority — it is corruption or a hand-edited database.
 */
export function authorityIdentityOf(content: unknown): {contentHash: string; version: string} {
  const schema = String((content as {schema?: unknown} | null)?.schema ?? '');
  if (!AUTHORITY_SCHEMAS.includes(schema)) throw new Error(`AUTHORITY_SCHEMA_UNSUPPORTED:${schema || 'MISSING'}`);
  return {contentHash: hex(content), version: versionFor(schema, content)};
}

function normalizeTier(raw: unknown, index: number): {tier?: MarginBracketTier; reason?: string} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {reason: 'BRACKET_TIER_NOT_AN_OBJECT'};
  const row = raw as Record<string, unknown>;
  const bracket = finite(row.bracket) ? Number(row.bracket) : finite(row.tier) ? Number(row.tier) : index;
  const notionalFloor = Number(row.notionalFloor);
  const capRaw = row.notionalCap === null || row.notionalCap === undefined || String(row.notionalCap) === '' ? null : Number(row.notionalCap);
  const ratioRaw = row.maintenanceMarginRatio ?? row.maintMarginRatio;
  const maintenanceMarginRatio = Number(ratioRaw);
  const initialLeverage = Number(row.initialLeverage);
  const cum = finite(row.cum) ? Number(row.cum) : null;
  if (!Number.isInteger(bracket) || bracket < 0) return {reason: 'BRACKET_ID_INVALID'};
  if (!finite(notionalFloor) || notionalFloor < 0) return {reason: 'NOTIONAL_FLOOR_INVALID'};
  if (capRaw !== null && (!finite(capRaw) || capRaw <= notionalFloor)) return {reason: 'NOTIONAL_CAP_INVERTED'};
  if (!finite(maintenanceMarginRatio) || maintenanceMarginRatio < 0 || maintenanceMarginRatio > 1) return {reason: 'MAINTENANCE_RATIO_UNPROVEN'};
  if (!finite(initialLeverage) || initialLeverage <= 0) return {reason: 'INITIAL_LEVERAGE_UNPROVEN'};
  return {tier: {bracket, notionalFloor, notionalCap: capRaw, maintenanceMarginRatio, initialLeverage, cum}};
}

/** Contiguity is what makes "the maximum applicable rate" mean something: a hole would hide a tier. */
function validateLadder(symbol: string, tiers: MarginBracketTier[]): string | null {
  const sorted = [...tiers].sort((a, b) => a.notionalFloor - b.notionalFloor || a.bracket - b.bracket);
  if (!sorted.length) return 'BRACKET_SET_EMPTY';
  if (sorted[0].notionalFloor > 0) return 'BRACKET_FLOOR_NOT_ANCHORED_AT_ZERO';
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const tier = sorted[index], next = sorted[index + 1];
    // A finite cap on the last tier is normal on Binance; only a hole between tiers is a proof gap.
    if (tier.notionalCap === null) return 'BRACKET_OPEN_ENDED_BEFORE_LAST_TIER';
    if (next.notionalFloor < tier.notionalCap) return 'BRACKET_RANGES_OVERLAP';
    if (next.notionalFloor > tier.notionalCap) return 'BRACKET_RANGE_GAP';
  }
  const conflict = new Map<string, MarginBracketTier>();
  for (const tier of sorted) {
    const key = `${tier.notionalFloor}|${tier.notionalCap ?? 'open'}`;
    const seen = conflict.get(key);
    if (seen && (seen.maintenanceMarginRatio !== tier.maintenanceMarginRatio || seen.initialLeverage !== tier.initialLeverage)) return 'BRACKET_TIER_CONFLICT';
    conflict.set(key, tier);
  }
  return null;
}

/** The largest notional the ladder can price; anything a candidate could reach above this is uncovered. */
export function marginLadderCeiling(tiers: MarginBracketTier[]): number {
  return tiers.reduce((top, tier) => Math.max(top, tier.notionalCap ?? Number.POSITIVE_INFINITY), 0);
}

export type CanonicalMarginResult = {ok: true; dataset: MarginBracketSymbolDataset[]; failures: MarginBracketFailure[]} | {ok: false; failures: MarginBracketFailure[]; dataset: MarginBracketSymbolDataset[]};

export function canonicalizeMarginBrackets(read: unknown): CanonicalMarginResult {
  const failures: MarginBracketFailure[] = [];
  const bySymbol = new Map<string, MarginBracketTier[]>();
  const rows = (read && typeof read === 'object' ? (read as {symbols?: unknown}).symbols : null);
  if (!Array.isArray(rows) || !rows.length) return {ok: false, failures: [{symbol: '*', reason: 'BRACKET_READ_EMPTY'}], dataset: []};
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {failures.push({symbol: '*', reason: 'BRACKET_ROW_INVALID'}); continue;}
    const row = raw as Record<string, unknown>;
    const symbol = String(row.symbol ?? '').trim().toUpperCase();
    if (!symbol) {failures.push({symbol: '*', reason: 'BRACKET_SYMBOL_MISSING'}); continue;}
    const rawTiers = Array.isArray(row.brackets) ? row.brackets : Array.isArray(row.tiers) ? row.tiers : null;
    if (!rawTiers?.length) {failures.push({symbol, reason: 'BRACKET_SET_EMPTY'}); continue;}
    const tiers: MarginBracketTier[] = [];
    for (const [index, tierRaw] of rawTiers.entries()) {
      const normalized = normalizeTier(tierRaw, index);
      if (normalized.reason || !normalized.tier) {failures.push({symbol, reason: normalized.reason ?? 'BRACKET_TIER_UNPROVEN'}); continue;}
      tiers.push(normalized.tier);
    }
    if (tiers.length !== rawTiers.length) continue;
    const ladder = validateLadder(symbol, tiers);
    if (ladder) {failures.push({symbol, reason: ladder}); continue;}
    const existing = bySymbol.get(symbol);
    const sorted = [...tiers].sort((a, b) => a.notionalFloor - b.notionalFloor);
    if (existing && JSON.stringify(existing) !== JSON.stringify(sorted)) {failures.push({symbol, reason: 'BRACKET_TIER_CONFLICT'}); continue;}
    bySymbol.set(symbol, sorted);
  }
  const extra = (read as {failures?: unknown}).failures;
  if (Array.isArray(extra)) for (const failure of extra) {
    if (!failure || typeof failure !== 'object') continue;
    const row = failure as {symbol?: unknown; reason?: unknown};
    failures.push({symbol: String(row.symbol ?? '*').toUpperCase(), reason: String(row.reason ?? 'BRACKET_READ_FAILED')});
  }
  const dataset = [...bySymbol.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([symbol, tiers]) => ({symbol, tiers}));
  if (!dataset.length || failures.length) return {ok: false, failures: failures.sort((a, b) => `${a.symbol}${a.reason}`.localeCompare(`${b.symbol}${b.reason}`)), dataset};
  return {ok: true, dataset, failures: []};
}

function reachableTiers(tiers: MarginBracketTier[], reach?: SizingReachability): MarginBracketTier[] | null {
  if (!reach || !finite(reach.minNotionalUsd) || !finite(reach.maxNotionalUsd) || reach.maxNotionalUsd < reach.minNotionalUsd) return null;
  const covered: MarginBracketTier[] = [];
  let cursor = reach.minNotionalUsd;
  for (const tier of tiers) {
    if (cursor >= reach.maxNotionalUsd) break;
    const top = tier.notionalCap ?? Number.POSITIVE_INFINITY;
    if (top <= cursor) continue;
    if (tier.notionalFloor > cursor) return null;
    covered.push(tier);
    cursor = Math.min(reach.maxNotionalUsd, top);
    if (!Number.isFinite(top)) break;
  }
  return cursor >= Math.min(reach.maxNotionalUsd, reach.maxNotionalUsd) && covered.length ? covered : null;
}

/** The conservative bound: the largest maintenance ratio the book can actually land in. Never an average. */
export function deriveMaintenanceMarginRatePct(dataset: MarginBracketSymbolDataset[], reachability: SizingReachability[] = []): {ratePct: number; derivation: 'REACHABLE_TIERS' | 'ALL_COVERED_TIERS'} {
  const bySymbol = new Map(dataset.map(row => [row.symbol, row.tiers]));
  const reachBySymbol = new Map((reachability ?? []).map(row => [String(row.symbol ?? '').toUpperCase(), row]));
  const reachable: MarginBracketTier[] = [];
  let provable = dataset.length > 0;
  for (const [symbol, tiers] of bySymbol) {
    const reach = reachBySymbol.get(symbol);
    const tiersForSymbol = reach ? reachableTiers(tiers, reach) : null;
    if (!tiersForSymbol) {provable = false; break;}
    reachable.push(...tiersForSymbol);
  }
  const source = provable ? reachable : dataset.flatMap(row => row.tiers);
  const ratePct = source.reduce((max, tier) => Math.max(max, tier.maintenanceMarginRatio), 0);
  return {ratePct, derivation: provable ? 'REACHABLE_TIERS' : 'ALL_COVERED_TIERS'};
}

export const SCENARIO_FIELDS = ['id', 'priceShockPct', 'spreadWidenPct', 'fundingShockPct', 'markBasisShockPct', 'depthPenaltyPct', 'exchangeUnavailable', 'unavailablePenaltyPct', 'clusterConvergencePct'] as const;

export type CanonicalScenarioResult = {ok: boolean; scenarios: Record<string, unknown>[]; reasons: string[]};

export function canonicalScenarios(raw: unknown): CanonicalScenarioResult {
  if (!Array.isArray(raw) || !raw.length) return {ok: false, scenarios: [], reasons: ['STRESS_SCENARIO_SET_EMPTY']};
  const reasons: string[] = [], seen = new Set<string>();
  const scenarios = raw.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {reasons.push('STRESS_SCENARIO_NOT_AN_OBJECT'); return {};}
    const source = row as Record<string, unknown>;
    const id = String(source.id ?? '').trim().toUpperCase();
    if (!id) reasons.push('STRESS_SCENARIO_ID_MISSING');
    else if (seen.has(id)) reasons.push(`STRESS_SCENARIO_ID_DUPLICATE:${id}`);
    else seen.add(id);
    const out: Record<string, unknown> = {id};
    for (const field of SCENARIO_FIELDS) {
      if (field === 'id') continue;
      const value = source[field];
      if (field === 'exchangeUnavailable') {
        if (typeof value !== 'boolean') reasons.push(`STRESS_SCENARIO_FLAG_UNPROVEN:${id}:${field}`);
        out[field] = value;
        continue;
      }
      if (!finite(value)) {reasons.push(`STRESS_SCENARIO_NUMBER_UNPROVEN:${id}:${field}`); out[field] = null; continue;}
      out[field] = value;
    }
    return out;
  }).filter(row => Object.keys(row).length);
  if (reasons.length || !scenarios.length) return {ok: false, scenarios: [], reasons};
  return {ok: true, scenarios: scenarios.sort((a, b) => String(a.id).localeCompare(String(b.id))), reasons: []};
}

export type CanonicalClusterResult = {ok: boolean; clusters: Record<string, string>; reasons: string[]};

export function canonicalClusters(raw: unknown): CanonicalClusterResult {
  if (raw === null || raw === undefined) return {ok: false, clusters: {}, reasons: ['CORRELATION_CLUSTER_MAP_MISSING']};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, clusters: {}, reasons: ['CORRELATION_CLUSTER_MAP_INVALID']};
  const clusters: Record<string, string> = {};
  for (const [underlying, cluster] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(underlying ?? '').trim().toUpperCase(), value = String(cluster ?? '').trim().toUpperCase();
    if (!key || !value) return {ok: false, clusters: {}, reasons: ['CORRELATION_CLUSTER_ENTRY_UNPROVEN']};
    clusters[key] = value;
  }
  return {ok: true, clusters: Object.fromEntries(Object.entries(clusters).sort((a, b) => a[0].localeCompare(b[0]))), reasons: []};
}

export type CompileAuthorityInput = {
  environment: string; accountScope: string;
  bracketRead: unknown; requiredSymbols: string[];
  clusters: unknown; scenarios: unknown;
  reachability?: SizingReachability[];
  credentialRef?: string; committedAt?: number;
};

export type CompiledAuthority = {ok: true; facts: PortfolioRiskAuthorityFacts; profileFacts: PortfolioRiskProfileFacts; blockers: []; coverageSymbols: string[]}
  | {ok: false; facts: null; profileFacts: null; blockers: string[]; coverageSymbols: string[]};

/**
 * The only place a PortfolioRisk authority is created. Everything the profile will claim is computed
 * here from submitted content; a caller supplies data, never a version or a rate.
 */
export function portfolioRiskAuthorityCompile(input: CompileAuthorityInput): CompiledAuthority {
  const blockers: string[] = [];
  const required = [...new Set((input.requiredSymbols ?? []).map(symbol => String(symbol).trim().toUpperCase()).filter(Boolean))].sort();
  const readEnvironment = String((input.bracketRead as {environment?: unknown})?.environment ?? '').toUpperCase();
  if (String(input.environment ?? '').toUpperCase() !== 'TESTNET' || readEnvironment !== 'TESTNET') {
    blockers.push(`MARGIN_AUTHORITY_ENVIRONMENT_REQUIRED_TESTNET:${[String(input.environment).toUpperCase() || 'UNKNOWN', readEnvironment || 'UNKNOWN'].join('/')}`);
  }
  if (!String(input.accountScope ?? '').trim()) blockers.push('MARGIN_AUTHORITY_ACCOUNT_SCOPE_MISSING');
  const canonical = canonicalizeMarginBrackets(input.bracketRead);
  if (!canonical.ok) blockers.push(...[...new Set(canonical.failures.map(f => f.symbol === '*' ? f.reason : `MARGIN_BRACKET_${f.reason}:${f.symbol}`))]);
  const covered = canonical.dataset.map(row => row.symbol);
  for (const symbol of required) if (!covered.includes(symbol)) blockers.push(`MARGIN_BRACKET_MISSING:${symbol}`);
  // A sizing envelope that reaches past the priced ladder is a proof gap, not a licence to guess.
  for (const reach of input.reachability ?? []) {
    const row = canonical.dataset.find(item => item.symbol === String(reach?.symbol ?? '').toUpperCase());
    if (!row || !finite(reach.maxNotionalUsd)) continue;
    if (reach.maxNotionalUsd > marginLadderCeiling(row.tiers)) blockers.push(`MARGIN_BRACKET_RANGE_UNCOVERED:${row.symbol}`);
  }
  const scenarioSet = canonicalScenarios(input.scenarios);
  if (!scenarioSet.ok) blockers.push(...scenarioSet.reasons);
  const clusterSet = canonicalClusters(input.clusters);
  if (!clusterSet.ok) blockers.push(...clusterSet.reasons);
  if (blockers.length || !canonical.ok || !scenarioSet.ok || !clusterSet.ok) {
    return {ok: false, facts: null, profileFacts: null, blockers: [...new Set(blockers)].sort(), coverageSymbols: covered};
  }
  const dataset = canonical.dataset;
  const observedAt = Number((input.bracketRead as {observedAt?: unknown}).observedAt ?? 0);
  const reachability = (input.reachability ?? []).filter(row => row && String(row.symbol ?? '').trim());
  // Observation time and the sizing envelope stay out of the content identity: the same bracket table
  // must not mint a new version because it was read a second later or because sizing moved.
  const content = {schema: MARGIN_AUTHORITY_SCHEMA, environment: 'TESTNET', accountScope: input.accountScope, credentialRef: String(input.credentialRef ?? (input.bracketRead as {credentialRef?: unknown})?.credentialRef ?? ''), dataset};
  const correlationContent = {schema: CORRELATION_AUTHORITY_SCHEMA, clusters: clusterSet.clusters};
  const scenarioContent = {schema: SCENARIO_AUTHORITY_SCHEMA, scenarios: scenarioSet.scenarios};
  const rate = deriveMaintenanceMarginRatePct(dataset, reachability);
  const facts: PortfolioRiskAuthorityFacts = {
    environment: 'TESTNET', accountScope: input.accountScope, committedAt: Number(input.committedAt ?? 0),
    canonical: {margin: content, correlation: correlationContent, scenarios: scenarioContent},
    reachability,
    margin: {contentHash: hex(content), version: versionFor(MARGIN_AUTHORITY_SCHEMA, content), maintenanceMarginRatePct: rate.ratePct, coverageSymbols: covered, observedAt: Number.isFinite(observedAt) ? observedAt : 0, derivation: rate.derivation},
    correlation: {contentHash: hex(correlationContent), version: versionFor(CORRELATION_AUTHORITY_SCHEMA, correlationContent), clusters: clusterSet.clusters},
    scenarios: {contentHash: hex(scenarioContent), version: versionFor(SCENARIO_AUTHORITY_SCHEMA, scenarioContent), scenarios: scenarioSet.scenarios},
  };
  const profileFacts: PortfolioRiskProfileFacts = {
    marginTierVersion: facts.margin.version, maintenanceMarginRatePct: facts.margin.maintenanceMarginRatePct,
    correlationVersion: facts.correlation.version, clusters: facts.correlation.clusters,
    scenarioVersion: facts.scenarios.version, scenarios: facts.scenarios.scenarios,
  };
  return {ok: true, facts, profileFacts, blockers: [], coverageSymbols: covered};
}

const sameObject = (a: unknown, b: unknown) => stableRiskHash(a) === stableRiskHash(b);

export type PortfolioRiskAuthorityKind = 'margin' | 'correlation' | 'scenarios';
/** One durable row as read back from SQLite. */
export type PortfolioRiskAuthorityRow = {
  kind: PortfolioRiskAuthorityKind; environment: string; accountScope: string; schemaVersion: string;
  contentHash: string; version: string; canonical: unknown; observedAt: number; committedAt: number;
  settingsVersion: number; provenance: Record<string, unknown>;
};

/**
 * Rebuild authority facts from the durable rows, refusing any row that does not reproduce its own
 * identity. This is the read side of the commit: nothing here trusts a stored string, and a partly
 * written or hand-edited set of rows yields no authority at all rather than a weaker one.
 */
export function portfolioRiskAuthorityVerifyRows(rows: PortfolioRiskAuthorityRow[]): {ok: boolean; facts: PortfolioRiskAuthorityFacts | null; reasons: string[]} {
  const reasons: string[] = [];
  const byKind = new Map<PortfolioRiskAuthorityKind, PortfolioRiskAuthorityRow>();
  for (const row of rows ?? []) {
    if (!['margin', 'correlation', 'scenarios'].includes(row.kind)) {reasons.push(`AUTHORITY_KIND_UNSUPPORTED:${row.kind}`); continue;}
    if (byKind.has(row.kind)) reasons.push(`AUTHORITY_ROW_DUPLICATE:${row.kind}`);
    byKind.set(row.kind, row);
  }
  const missing = (['margin', 'correlation', 'scenarios'] as PortfolioRiskAuthorityKind[]).filter(kind => !byKind.has(kind));
  if (missing.length) reasons.push(`AUTHORITY_ROWS_INCOMPLETE:${missing.join(',')}`);
  if (reasons.length || byKind.size !== 3) return {ok: false, facts: null, reasons: [...new Set(reasons)].sort()};
  const margin = byKind.get('margin')!, correlation = byKind.get('correlation')!, scenario = byKind.get('scenarios')!;
  if (new Set([margin, correlation, scenario].map(row => row.committedAt)).size !== 1) reasons.push('AUTHORITY_COMMIT_SPLIT');
  if (new Set([margin, correlation, scenario].map(row => row.settingsVersion)).size !== 1) reasons.push('AUTHORITY_SETTINGS_BINDING_SPLIT');
  if (new Set([margin, correlation, scenario].map(row => `${row.environment}|${row.accountScope}`)).size !== 1) reasons.push('AUTHORITY_SCOPE_SPLIT');
  for (const [kind, row] of [['margin', margin], ['correlation', correlation], ['scenarios', scenario]] as const) {
    let recomputed: {contentHash: string; version: string} | null = null;
    try {recomputed = authorityIdentityOf(row.canonical);} catch {reasons.push(`AUTHORITY_CANONICAL_UNREADABLE:${kind}`); continue;}
    if (recomputed.contentHash !== row.contentHash) reasons.push(`AUTHORITY_CONTENT_HASH_MISMATCH:${kind}`);
    if (recomputed.version !== row.version) reasons.push(`AUTHORITY_VERSION_MISMATCH:${kind}`);
  }
  const content = margin.canonical as {environment?: unknown; accountScope?: unknown; credentialRef?: unknown; dataset?: unknown} | null;
  if (String(content?.environment ?? '').toUpperCase() !== 'TESTNET') reasons.push('AUTHORITY_ENVIRONMENT_NOT_TESTNET');
  if (String(margin.environment).toUpperCase() !== 'TESTNET') reasons.push('AUTHORITY_ENVIRONMENT_NOT_TESTNET');
  if (!String(margin.accountScope ?? '').trim()) reasons.push('AUTHORITY_ACCOUNT_SCOPE_MISSING');
  const canonical = canonicalizeMarginBrackets({symbols: (content?.dataset as unknown[]) ?? []});
  if (!canonical.ok) reasons.push(...canonical.failures.map(f => `AUTHORITY_MARGIN_DATASET_${f.reason}:${f.symbol}`));
  const provenance = margin.provenance ?? {};
  const reachability = Array.isArray(provenance.reachability) ? provenance.reachability as SizingReachability[] : [];
  const rate = deriveMaintenanceMarginRatePct(canonical.dataset, reachability);
  if (Number(provenance.maintenanceMarginRatePct) !== rate.ratePct) reasons.push('AUTHORITY_DERIVED_RATE_MISMATCH');
  if (String(provenance.derivation ?? '') !== rate.derivation) reasons.push('AUTHORITY_DERIVATION_MISMATCH');
  if (reasons.length || !canonical.ok) return {ok: false, facts: null, reasons: [...new Set(reasons)].sort()};
  return {ok: true, facts: {
    environment: String(margin.environment).toUpperCase(), accountScope: String(margin.accountScope), committedAt: margin.committedAt,
    canonical: {margin: margin.canonical, correlation: correlation.canonical, scenarios: scenario.canonical}, reachability,
    margin: {contentHash: margin.contentHash, version: margin.version, maintenanceMarginRatePct: rate.ratePct, coverageSymbols: canonical.dataset.map(row => row.symbol), observedAt: margin.observedAt, derivation: rate.derivation},
    correlation: {contentHash: correlation.contentHash, version: correlation.version, clusters: (correlation.canonical as {clusters: Record<string, string>}).clusters},
    scenarios: {contentHash: scenario.contentHash, version: scenario.version, scenarios: (scenario.canonical as {scenarios: Record<string, unknown>[]}).scenarios},
  }, reasons: []};
}

/** What the runtime asks when it decides whether a profile may authorise new risk. */
export function portfolioRiskAuthorityBlockers(context: PortfolioRiskAuthorityContext & {profile: Record<string, unknown>}): string[] {
  const {profile, environment, accountScope} = context;
  if (!context.facts) return ['MARGIN_AUTHORITY_MISSING'];
  const facts = context.facts, out: string[] = [];
  if (String(facts.environment).toUpperCase() !== String(environment).toUpperCase()) out.push('MARGIN_AUTHORITY_ENVIRONMENT_MISMATCH');
  if (String(facts.accountScope) !== String(accountScope)) out.push('MARGIN_AUTHORITY_SCOPE_MISMATCH');
  if (String(profile.marginTierVersion ?? '') !== facts.margin.version) out.push('MARGIN_TIER_VERSION_MISMATCH');
  if (Number(profile.maintenanceMarginRatePct) !== facts.margin.maintenanceMarginRatePct) out.push('MAINTENANCE_RATE_MISMATCH');
  if (String(profile.correlationVersion ?? '') !== facts.correlation.version || !sameObject(profile.clusters ?? {}, facts.correlation.clusters)) out.push('CORRELATION_AUTHORITY_MISMATCH');
  if (String(profile.scenarioVersion ?? '') !== facts.scenarios.version || !sameObject(profile.scenarios ?? [], facts.scenarios.scenarios)) out.push('STRESS_SCENARIO_AUTHORITY_MISMATCH');
  for (const symbol of [...new Set((context.requiredSymbols ?? []).map(row => String(row).trim().toUpperCase()).filter(Boolean))].sort()) {
    if (!facts.margin.coverageSymbols.includes(symbol)) out.push(`MARGIN_TIER_SYMBOL_UNPROVEN:${symbol}`);
  }
  if (context.staleObservedContentHash && context.staleObservedContentHash !== facts.margin.contentHash) out.push('MARGIN_AUTHORITY_STALE');
  return out;
}

/** The projection the cockpit may render; it never re-derives a hash, rate or READY of its own. */
export function portfolioRiskAuthorityReadback(context: PortfolioRiskAuthorityContext & {profile: Record<string, unknown>; operatorStatus: 'PROFILE_NOT_CONFIGURED' | 'PROFILE_FACTS_UNPROVEN' | 'READY'}) {
  const blockers = portfolioRiskAuthorityBlockers(context);
  return {
    source: 'settings portfolio_risk_authority', environment: context.environment, accountScope: context.accountScope,
    committed: context.facts !== null,
    marginTierVersion: context.facts?.margin.version ?? null, contentHash: context.facts?.margin.contentHash ?? null,
    coverageSymbols: context.facts?.margin.coverageSymbols ?? [], derivedMaintenanceMarginRatePct: context.facts?.margin.maintenanceMarginRatePct ?? null,
    rateDerivation: context.facts?.margin.derivation ?? null, observedAt: context.facts?.margin.observedAt ?? null, committedAt: context.facts?.committedAt ?? null,
    correlationVersion: context.facts?.correlation.version ?? null, scenarioVersion: context.facts?.scenarios.version ?? null,
    missingSymbols: blockers.filter(reason => reason.startsWith('MARGIN_TIER_SYMBOL_UNPROVEN:')).map(reason => reason.split(':')[1]),
    mismatchReasons: blockers, authorityStatus: context.facts === null ? 'NOT_COMMITTED' : blockers.length ? 'MISMATCH' : 'MATCHED',
    profileStatus: blockers.length ? (context.operatorStatus === 'READY' ? 'PROFILE_FACTS_UNPROVEN' : context.operatorStatus) : context.operatorStatus,
  };
}
