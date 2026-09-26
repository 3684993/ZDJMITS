// Read-only verification of the V3.9.6 governance closeout: authority coverage before/after effect on routed
// candidates, settings/economic invariance, write boundary, protection, UNKNOWN semantics and runtime identity.
// Issues GETs only; opens the durable store read-only. It never writes, restarts, or triggers a model call.
const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const get = async (route) => {
  const response = await fetch(`${base}${route}`);
  if (!response.ok) throw new Error(`${route} -> HTTP ${response.status}`);
  return response.json();
};
const [pipeline, closeout, positions, settings] = await Promise.all(
  [get('/pipeline'), get('/diagnostics/closeout'), get('/positions'), get('/settings')]);
const profile = pipeline.portfolioRiskProfile ?? {}, authority = profile.authority ?? {};
const runtime = closeout.runtime ?? {}, boundary = closeout.productionWriteBoundary ?? {}, projection = pipeline;
const rows = Array.isArray(positions) ? positions : (positions.positions ?? []);
const candidates = (side) => (projection.capacityVisibility?.entryCapacity?.[side]?.candidates ?? [])
  .map((row) => ({ symbol: row.symbol, side: row.side, executable: row.executable, firstBindingConstraint: row.firstBindingConstraint,
    marginTierProvenInTrace: row.risk?.marginTierProven ?? null, plannedNotionalUsd: row.plannedNotionalUsd,
    minimumLegalNotionalUsd: row.minimumLegalNotionalUsd, planAdmission: row.plan?.admission ?? null,
    capacityRoomSource: row.plan?.capacityRoom?.source ?? null }));
const refusedForMarginTier = [...candidates('LONG'), ...candidates('SHORT')].filter((row) => String(row.firstBindingConstraint).includes('MARGIN_TIER'));

console.log(JSON.stringify({
  at: new Date().toISOString(),
  authority: { profileStatus: profile.status, authorityStatus: authority.authorityStatus, marginTierVersion: authority.marginTierVersion,
    contentHash: authority.contentHash, coverageCount: (authority.coverageSymbols ?? []).length, missingSymbols: authority.missingSymbols ?? null,
    mismatchReasons: authority.mismatchReasons ?? null, coverageLag: authority.coverageLag ?? null,
    uncoveredCoverageCandidates: authority.uncoveredCoverageCandidates ?? null,
    correlationVersion: authority.correlationVersion, scenarioVersion: authority.scenarioVersion,
    derivedMaintenanceMarginRatePct: authority.derivedMaintenanceMarginRatePct },
  settings: { settingsVersion: settings.settings?.settingsVersion ?? settings.settingsVersion,
    maxGrossNotionalUsd: profile.values?.maxGrossNotionalUsd, maxHumanNotionalUsd: profile.values?.maxHumanNotionalUsd,
    maxDirectionNotionalUsd: profile.values?.maxDirectionNotionalUsd, maxClusterNotionalUsd: profile.values?.maxClusterNotionalUsd,
    minNetProfitUsd: (settings.settings ?? settings).takeProfit?.minNetProfitUsd,
    minNetProfitRoiPct: (settings.settings ?? settings).tradeEconomics?.minNetProfitRoiPct ?? null,
    exposureCapacityPolicy: (settings.settings ?? settings).riskGovernance?.exposureCapacityPolicy,
    aiExitAuthority: (settings.settings ?? settings).riskGovernance?.exitCoordination?.aiExitAuthority,
    aiExitLossLimitUsd: (settings.settings ?? settings).riskGovernance?.exitCoordination?.aiExitLossLimitUsd,
    executionMode: (settings.settings ?? settings).connections?.executionMode,
    entrySafetyMode: (settings.settings ?? settings).riskGovernance?.entrySafetyMode },
  routedCandidates: (pipeline.runtimeControl?.capital?.routedCandidates ?? []).map((row) => row.symbol).sort(),
  capacityPerCandidate: { LONG: candidates('LONG'), SHORT: candidates('SHORT') },
  refusedForMarginTierNow: refusedForMarginTier,
  pipeline: { state: projection.pipelineState, noEntryReason: projection.noEntryReason ?? null,
    authoritativeBlocker: projection.authoritativeBlocker ?? null, marketDataIsolation: projection.marketDataIsolation ?? null,
    executionReadinessMode: projection.executionReadiness?.mode ?? null },
  writes: boundary,
  protection: { positions: rows.length, protected: rows.filter((row) => row.tpStatus === 'PROTECTED').length,
    notProtected: rows.filter((row) => row.tpStatus !== 'PROTECTED').map((row) => `${row.symbol}:${row.side}:${row.tpStatus}`),
    tpMetrics: { required: projection.takeProfit?.required, protected: projection.takeProfit?.protected, missing: projection.takeProfit?.missing,
      unresolved: projection.takeProfit?.positionFactUnresolved } },
  unknownSemantics: { historicalUnknown: projection.reconciliation?.historicalUnknownCount,
    verifiedNoActiveRisk: projection.reconciliation?.verifiedNoActiveRiskUnknownCount,
    activeRiskUnresolved: projection.reconciliation?.activeRiskUnresolvedCount,
    unresolvedDrift: projection.reconciliation?.unresolvedDriftCount },
  identity: { pid: runtime.pid, buildId: runtime.buildId, version: runtime.version, restartCount: runtime.restartCount,
    lastRestartReason: runtime.lastRestartReason, lastRestartAt: runtime.lastRestartAt, uptimeMs: runtime.uptimeMs },
}, null, 1));
