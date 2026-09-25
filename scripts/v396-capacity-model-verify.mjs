// §C3/§D/§G live verification for the capital-capacity model.
// Read-mostly: the single write it performs is the authorized Testnet exposure-capacity policy
// migration through the governance boundary, and it refuses to run if that write would move a ratio.
const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const mode = process.argv[3] ?? 'migrate'; // 'snapshot' | 'migrate'

const get = async (path) => {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
};
const patch = async (path, body) => {
  const response = await fetch(`${base}${path}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const text = await response.text();
  return {status: response.status, body: text ? JSON.parse(text) : null};
};

const capacityFacts = (settings, pipeline) => {
  const governance = settings.riskGovernance ?? {}, capital = pipeline.runtimeControl?.capital ?? {}, view = pipeline.capacityVisibility ?? {};
  return {
    settingsVersion: settings.settingsVersion,
    ratios: {maxGrossExposurePct: governance.maxGrossExposurePct, maxDirectionExposurePct: governance.maxDirectionExposurePct, maxClusterExposurePct: governance.maxClusterExposurePct, maxClusterDirectionExposurePct: governance.maxClusterDirectionExposurePct, perTradeRiskPctEquity: governance.perTradeRiskPctEquity},
    policy: governance.exposureCapacityPolicy ?? null,
    equityUsd: pipeline.account?.equityUsd ?? capital.equityUsd ?? null,
    funding: view.funding ?? null,
    exposure: view.exposure ?? null,
    limits: view.limits ?? null,
    entryCapacity: view.entryCapacity ?? null,
    firstBlocker: view.firstBlocker ?? null,
    exhaustedForNewRisk: view.exhaustedForNewRisk ?? null,
    executableCandidateCount: capital.executableCandidateCount ?? null,
    routedCandidates: (capital.routedCandidates ?? []).slice(0, 8).map(row => ({
      symbol: row.symbol, quoteAsset: row.quoteAsset, leverage: row.leverage,
      long: {feasibleNotionalUsd: row.longFeasibleNotionalUsd, executable: row.longExecutable, constraint: row.riskHeadroom?.LONG?.firstBindingConstraint, capital: row.riskHeadroom?.LONG?.capital?.executableNotionalUsd, blockers: row.riskHeadroom?.LONG?.blockers},
      short: {feasibleNotionalUsd: row.shortFeasibleNotionalUsd, executable: row.shortExecutable, constraint: row.riskHeadroom?.SHORT?.firstBindingConstraint, capital: row.riskHeadroom?.SHORT?.capital?.executableNotionalUsd, blockers: row.riskHeadroom?.SHORT?.blockers},
    })),
  };
};

const closeoutFacts = (closeout) => ({
  runtime: (({pid, buildId, instanceId, restartCount, lastRestartAt, lastRestartReason, uptimeMs}) => ({pid, buildId, instanceId, restartCount, lastRestartAt, lastRestartReason, uptimeMs}))(closeout.runtime ?? {}),
  productionWriteBoundary: closeout.productionWriteBoundary ?? null,
  pipelineState: closeout.pipeline?.pipelineState ?? null,
  entryPermission: closeout.pipeline?.entryPermission ?? null,
  executionReadiness: closeout.pipeline?.executionReadiness ?? null,
  activity: closeout.pipeline?.activity ?? null,
});

const settings = await get('/settings');
const pipeline = await get('/pipeline');
const closeout = await get('/diagnostics/closeout');
const governanceReadback = await get('/settings/governance');
const before = capacityFacts(settings, pipeline);
const policyRows = (governanceReadback.fields ?? []).filter(field => String(field.path).startsWith('riskGovernance.exposureCapacityPolicy'));

let write = {performed: false};
if (mode === 'migrate') {
  const target = {gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE'};
  const already = ['gross', 'direction', 'cluster'].every(key => String(settings.riskGovernance?.exposureCapacityPolicy?.[key] ?? 'ENFORCE') === target[key]);
  if (!policyRows.length) throw new Error('GOVERNANCE_MATRIX_MISSING: the policy fields are not registered in the write boundary');
  if (!policyRows.every(field => field.editable === true)) throw new Error('GOVERNANCE_NOT_EDITABLE');
  if (already) write = {performed: false, reason: 'ALREADY_MARGIN_DRIVEN', target};
  else {
    const fields = Object.fromEntries(Object.entries(target).map(([key, value]) => [`riskGovernance.exposureCapacityPolicy.${key}`, value]));
    const result = await patch('/settings/governance', {fields, acks: ['EXPOSURE_CAPACITY_OBSERVE'], expectedSettingsVersion: settings.settingsVersion});
    write = {performed: true, target, httpStatus: result.status, applied: result.body?.applied ?? result.body ?? null};
    if (result.status !== 200) throw new Error(`GOVERNANCE_PATCH_REJECTED ${result.status} ${JSON.stringify(result.body)}`);
  }
}

const settingsAfter = await get('/settings');
const pipelineAfter = await get('/pipeline');
const closeoutAfter = await get('/diagnostics/closeout');
const after = capacityFacts(settingsAfter, pipelineAfter);
const unchanged = JSON.stringify(before.ratios) === JSON.stringify(after.ratios);
if (!unchanged) throw new Error(`RATIO_MOVED ${JSON.stringify(before.ratios)} -> ${JSON.stringify(after.ratios)}`);

const unknownRows = await get('/diagnostics/p0-entry-integrity').catch(() => null);
console.log(JSON.stringify({
  capturedAt: new Date().toISOString(), mode, write,
  governancePolicyRows: policyRows.map(row => ({path: row.path, kind: row.kind, enum: row.enum, defaultValue: row.defaultValue, editable: row.editable, effectiveAt: row.effectiveAt, ack: row.ack ?? null, consumers: row.consumers})),
  before, after, ratiosUnchangedByPolicyWrite: unchanged,
  closeout: closeoutFacts(closeoutAfter),
  pendingRisk: unknownRows,
}, null, 2));
