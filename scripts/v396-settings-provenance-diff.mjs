// Read-only proof that a settingsVersion bump changed no risk/economic value: deep-diff a saved snapshot against live.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [snapshotPath, base = 'http://127.0.0.1:8080/api/v3', dataDir = 'data'] = process.argv.slice(2);
const saved = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const before = saved.settings ?? saved;
const response = await fetch(`${base}/settings`);
if (!response.ok) throw new Error(`/settings -> HTTP ${response.status}`);
const liveRaw = await response.json();
const after = liveRaw.settings ?? liveRaw;

const leaves = (value, path = '', out = new Map()) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  } else out.set(path, Array.isArray(value) ? JSON.stringify(value) : value);
  return out;
};
const a = leaves(before), b = leaves(after), changed = [];
for (const key of new Set([...a.keys(), ...b.keys()])) {
  if (key === 'settingsVersion') continue;
  if (a.get(key) !== b.get(key)) changed.push({key, before: a.get(key) ?? '<absent>', after: b.get(key) ?? '<absent>'});
}
const frozen = ['portfolio.entryMarginUsd', 'portfolio.maxPositions', 'portfolio.maxPendingEntries', 'leverage.maxLeverage',
  'riskGovernance.maxDirectionExposurePct', 'riskGovernance.exposureCapacityPolicy.gross', 'riskGovernance.exposureCapacityPolicy.direction',
  'riskGovernance.exposureCapacityPolicy.cluster', 'riskGovernance.exitCoordination.aiExitAuthority',
  'riskGovernance.exitCoordination.aiExitLossLimitUsd', 'riskGovernance.exitCoordination.aiExitMinNetProfitUsd',
  'riskGovernance.exitCoordination.aiExitAllowSmallLoss',
  'portfolioIntelligence.maxLongExposurePct', 'portfolioIntelligence.maxShortExposurePct', 'portfolioIntelligence.maxSpeculativeExposurePct',
  'portfolioIntelligence.maxQuoteAssetMarginUsagePct', 'connections.executionMode',
  'tradeEconomics.minHistoricalReachProbability', 'entry.minReachability', 'tradeEconomics.minimumNotionalUsd',
  'takeProfit.defaultRiskRewardRatio', 'positionManagement.unknownPendingRiskTtlMs'];
const present = (key) => (a.has(key) || b.has(key) ? {key, before: a.get(key) ?? '<absent>', after: b.get(key) ?? '<absent>'} : null);

const auditTrail = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true})
  .prepare('SELECT changed_at, source, old_version, new_version, summary FROM settings_audit ORDER BY changed_at DESC LIMIT 6')
  .all().map((r) => ({at: new Date(Number(r.changed_at)).toISOString(), ...r}));

console.log(JSON.stringify({
  snapshotSettingsVersion: before.settingsVersion ?? null, liveSettingsVersion: after.settingsVersion ?? null,
  comparedLeafCount: new Set([...a.keys(), ...b.keys()]).size,
  changedExcludingVersion: changed,
  auditTrail,
  frozenFieldCheck: frozen.map(present).filter(Boolean),
  verdict: changed.length === 0 ? 'SEMANTICALLY_IDENTICAL_EXCEPT_VERSION' : 'FIELDS_CHANGED',
}, null, 1));
