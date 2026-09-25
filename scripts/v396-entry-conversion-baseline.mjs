// Read-only capture of the live Testnet facts the entry-conversion closeout must not disturb.
// GET requests only: no settings write, no lifecycle action, no exchange call.
import { createHash } from 'node:crypto';
const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const label = process.argv[3] ?? 'baseline';
const get = async (path) => {
  const response = await fetch(`${base}${path}`, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`HTTP_${response.status}:${path}`);
  return response.json();
};
const [closeout, settings, pipeline, positions, orders] = await Promise.all([
  get('/diagnostics/closeout'), get('/settings'), get('/pipeline'), get('/positions'), get('/orders'),
]);
const governance = settings.riskGovernance ?? {}, portfolio = settings.portfolio ?? {}, intelligence = settings.portfolioIntelligence ?? {};
const summary = {
  capturedAt: new Date().toISOString(),
  label,
  identity: {
    pid: closeout.runtime?.pid ?? null,
    buildId: closeout.runtime?.buildId ?? null,
    version: closeout.runtime?.version ?? null,
    instanceId: closeout.runtime?.instanceId ?? null,
    runtimeDataDir: closeout.runtime?.runtimeDataDir ?? null,
    lastRestartAt: closeout.runtime?.lastRestartAt ?? null,
    lastRestartReason: closeout.runtime?.lastRestartReason ?? null,
    restartCount: closeout.runtime?.restartCount ?? null,
    uptimeMs: closeout.runtime?.uptimeMs ?? null,
  },
  frozenCaps: {
    settingsVersion: settings.settingsVersion ?? null,
    maxGrossExposurePct: governance.maxGrossExposurePct ?? null,
    maxDirectionExposurePct: governance.maxDirectionExposurePct ?? null,
    maxClusterExposurePct: governance.maxClusterExposurePct ?? null,
    maxClusterDirectionExposurePct: governance.maxClusterDirectionExposurePct ?? null,
    maxPositions: portfolio.maxPositions ?? null,
    minNetProfitUsd: settings.takeProfit?.minNetProfitUsd ?? null,
    minNetProfitRoiPct: settings.takeProfit?.minNetProfitRoiPct ?? null,
    admissionMode: settings.tradeEconomics?.admissionMode ?? null,
    executionMode: settings.connections?.executionMode ?? null,
    environment: settings.connections?.exchange?.environment ?? null,
    entrySafetyMode: settings.riskGovernance?.entrySafetyMode ?? null,
    aiExitAuthority: settings.riskGovernance?.exitCoordination?.aiExitAuthority ?? null,
    globalMaxLeverage: intelligence.globalMaxLeverage ?? null,
    perTradeRiskPctEquity: governance.perTradeRiskPctEquity ?? null,
    maxConcurrentReservations: governance.maxConcurrentReservations ?? null,
  },
  risk: {
    portfolioRiskProfile: pipeline.portfolioRiskProfile?.status ?? null,
    portfolioRiskProfileVersion: pipeline.portfolioRiskProfile?.version ?? null,
    executionReadiness: {status: pipeline.executionReadiness?.status ?? null, ready: pipeline.executionReadiness?.ready ?? null, firstBlocker: pipeline.executionReadiness?.firstBlocker ?? null},
    entryPermission: pipeline.entryPermission ?? null,
    runtimeControlMode: pipeline.runtimeControl?.mode ?? null,
    capital: {
      executableCandidateCount: pipeline.runtimeControl?.capital?.executableCandidateCount ?? null,
      routedCandidates: pipeline.runtimeControl?.capital?.routedCandidates?.length ?? null,
      // The capital version is a multi-kilobyte serialisation; the digest is what has to match.
      capitalVersionDigest: createHash('sha256').update(String(pipeline.runtimeControl?.capital?.capitalVersion ?? '')).digest('hex'),
      capitalVersionBytes: String(pipeline.runtimeControl?.capital?.capitalVersion ?? '').length,
    },
  },
  writeBoundary: closeout.productionWriteBoundary ?? null,
  entry: {
    activity: pipeline.entryActivity ?? null,
    conversion: pipeline.entryConversion ?? null,
    candidateLifecycleCounts: pipeline.candidateLifecycle?.counts ?? null,
    positions: Array.isArray(positions) ? positions.length : (positions.items?.length ?? positions.positions?.length ?? 0),
    openOrders: Array.isArray(orders) ? orders.length : (orders.items?.length ?? orders.orders?.length ?? 0),
    tp: pipeline.tp?.status ?? null,
  },
  persistence: closeout.persistence ?? null,
};
console.log(JSON.stringify(summary, null, 2));
