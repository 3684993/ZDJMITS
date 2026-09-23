// Section C: one authorised profile CAS attempt, built only from a fresh readback, plus the server's
// own answer. If the running governance matrix refuses any dataset field, nothing is written (the patch
// is atomic) and the refusal is kept as the activation blocker evidence. No direct DB write, no
// matrix edit, no fabricated margin tier.
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'docs/evidence/v396/formal-testnet-execution-activation-20260924';
const BASE = 'http://127.0.0.1:8080';
const g = async path => JSON.parse(await (await fetch(BASE + path)).text());

const before = {settings: await g('/api/v3/settings'), health: await g('/health'), governance: await g('/api/v3/settings/governance')};
const privateData = before.health.checks?.privateData ?? {};
const E = Number(privateData.equityUsd), asOf = Number(privateData.asOf ?? 0), now = Date.now();
const G = Number(before.settings.riskGovernance.maxGrossExposurePct);
const D = Number(before.settings.riskGovernance.maxDirectionExposurePct);
const P = Number(before.settings.portfolio.maxPositions);
const preconditions = {equityFinitePositive: Number.isFinite(E) && E > 0, privateStatus: privateData.status, ageMs: asOf ? now - asOf : null, freshWithin60s: asOf ? now - asOf <= 60_000 : false, G, D, P};

const profile = {
  'riskGovernance.portfolioRisk.configured': true,
  'riskGovernance.portfolioRisk.maxCapitalAtRiskUsd': E,
  'riskGovernance.portfolioRisk.maxDrawdownPct': 1.0,
  'riskGovernance.portfolioRisk.maxStressLossUsd': E * 0.50,
  'riskGovernance.portfolioRisk.maxGrossNotionalUsd': E * G,
  'riskGovernance.portfolioRisk.maxDirectionNotionalUsd': E * D,
  'riskGovernance.portfolioRisk.maxClusterNotionalUsd': E * G,
  'riskGovernance.portfolioRisk.minMarginBufferPct': 0,
  'riskGovernance.portfolioRisk.minLiquidationBufferPct': 0,
  'riskGovernance.portfolioRisk.maxHumanPositions': P,
  'riskGovernance.portfolioRisk.maxHumanNotionalUsd': E * G,
  'riskGovernance.portfolioRisk.maxPendingHandoffs': P,
  'riskGovernance.portfolioRisk.maxAckAgeMs': 86_400_000,
  'riskGovernance.portfolioRisk.scenarioVersion': 'TESTNET_DISCOVERY_STRESS_V1',
  'riskGovernance.portfolioRisk.scenarios': [
    {id: 'DOWN_10_LIQUIDITY', priceShockPct: -0.10, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: -0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.50},
    {id: 'UP_10_LIQUIDITY', priceShockPct: 0.10, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: 0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.50},
    {id: 'EXCHANGE_GAP_15', priceShockPct: -0.15, spreadWidenPct: 0.02, fundingShockPct: 0.005, markBasisShockPct: -0.02, depthPenaltyPct: 0.03, exchangeUnavailable: true, unavailablePenaltyPct: 0.03, clusterConvergencePct: 0.75},
  ],
  'riskGovernance.portfolioRisk.correlationVersion': 'TESTNET_DISCOVERY_UNMAPPED_CONSERVATIVE_V1',
  'riskGovernance.portfolioRisk.clusters': {},
};
// marginTierVersion and maintenanceMarginRatePct are deliberately absent: no Binance bracket
// collector is reachable read-only, and §B3 forbids inventing the authority source.

const request = {fields: profile, acks: ['PORTFOLIO_RISK_PROFILE_ENABLED'], expectedSettingsVersion: before.settings.settingsVersion};
const response = await fetch(`${BASE}/api/v3/settings/governance`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(request)});
const body = await response.text();

const after = {settings: await g('/api/v3/settings'), pipeline: await g('/api/v3/pipeline')};
const strip = s => {const {settingsVersion, ...rest} = s; return rest;};
const unchanged = JSON.stringify(strip(before.settings)) === JSON.stringify(strip(after.settings));

const out = {attemptedAt: new Date(now).toISOString(),
  preconditions, profileIntended: profile, requestWithoutSecrets: {...request, fields: Object.keys(profile)},
  http: {status: response.status, body: (() => { try { return JSON.parse(body); } catch { return body.slice(0, 2000); } })()},
  settingsVersionBefore: before.settings.settingsVersion, settingsVersionAfter: after.settings.settingsVersion,
  everythingElseByteEquivalent: unchanged,
  profileReadbackAfter: after.pipeline.portfolioRiskProfile?.status ?? null,
  executionModeAfter: after.settings.connections.executionMode,
  conclusion: response.ok ? 'WRITTEN' : 'REFUSED_BY_RUNNING_AUTHORITY — no settings change occurred'};
writeFileSync(`${DIR}/profile-cas-attempt-C.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({status: response.status, versionBefore: out.settingsVersionBefore, versionAfter: out.settingsVersionAfter, unchanged, refusal: out.http.body?.error?.code ?? out.http.body?.error ?? null,
  blocked: (out.http.body?.refusals ?? out.http.body?.blockedPaths ?? []).map(r => r.path ?? r), profileStatusAfter: out.profileReadbackAfter, executionModeAfter: out.executionModeAfter}, null, 1));
