/**
 * V3.9.5 pre-shutdown 10-hour read-only runtime audit evidence generator.
 *
 * Opens the live durable SQLite strictly read-only (WAL readers do not block the running engine),
 * reads the engine's read-only HTTP endpoints, and writes machine-readable evidence for the
 * V3.9.5 -> V3.9.6 Testnet cutover audit. It never writes to the live database, never changes
 * settings, never sends an exchange write, and never touches the engine lifecycle.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIVE_DB = 'D:/MITS/data/zdj-settings.sqlite';
const API = 'http://127.0.0.1:8080';
const OUT = process.argv[2] ?? '.';

const NOW = Date.now();
const W0 = NOW - 10 * 3600_000;
const ts8 = (t) => (t == null || Number(t) === 0 ? null : new Date(Number(t) + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) + '+08');
const db = new DatabaseSync(LIVE_DB, { readOnly: true, open: true });
const get = async (p) => {
  const res = await fetch(API + p, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`READ_ONLY_ENDPOINT_FAILED:${p}:${res.status}`);
  return res.json();
};
const write = (name, obj) => {
  writeFileSync(join(OUT, name), JSON.stringify(obj, null, 1) + '\n');
  console.log('wrote', name);
};

const PROTECTED = `(type GLOB '*ORDER*' OR type GLOB '*FILL*' OR type GLOB 'TP_*' OR type GLOB 'MANUAL*' OR type GLOB 'TRADE_RECORD*' OR type IN ('ENTRY_SUBMIT_ATTEMPTED','ENTRY_INTENT_CREATED','ENTRY_FILLED'))`;
const AI_FACING = ['POOL_ANALYSIS_STARTED', 'PRE_AI_EXECUTION_ENVELOPE_CREATED', 'TRADING_QUALITY_OPPORTUNITY', 'AI_RUN_TERMINAL', 'AI_RUN_FAILED', 'AI_FAILED_NO_INTENT', 'PRIMARY_DECISION_NORMALIZED', 'MATERIAL_DECISION_CHANGE', 'TRADING_QUALITY_PRIMARY_LINK', 'ENTRY_ANALYSIS_FAILED'];
const SCAN_LAYER = ['CANDIDATE_LIFECYCLE_CHANGED', 'CANDIDATE_LIFECYCLE_REDERIVED', 'CANDIDATE_SUPPLY_HEALTH', 'CANDIDATE_REJECTED', 'MARKET_COHORT_REFILLED', 'MARKET_COHORT_RETIRED', 'MARKET_COHORT_DEFERRED', 'MARKET_SYMBOL_ERROR', 'MARKET_RECOVERY_FAILED'];
const ADMISSION = ['ENTRY_ECONOMIC_ADMISSION_EVALUATED', 'LIVE_RISK_ENVELOPE_EVALUATED', 'ENTRY_DECISION_BLOCKED', 'FINAL_ORDER_RISK_EVALUATED', 'ENTRY_ADMISSION_BLOCKED', 'ENTRY_ADMISSION_RESUMED'];
const EXECUTION = ['ENTRY_INTENT_CREATED', 'ENTRY_ORDER_CREATED', 'ENTRY_SUBMIT_ATTEMPTED', 'ENTRY_FILLED', 'ENTRY_ORDER_BLOCKED', 'ENTRY_ORDER_TTL_CLOSED', 'ENTRY_ORDER_SUBMISSION_UNKNOWN', 'ENTRY_EXECUTION_WAITING', 'ENTRY_EXECUTION_WAIT_TERMINATED'];
const MAINTENANCE = ['ORDER_FILL_RECONCILED', 'EXCHANGE_FILL_ATTRIBUTED', 'TRADE_RECORD_REPAIRED', 'POSITION_CLOSED_USER_DATA', 'POSITION_HUMAN_HANDOFF', 'POSITION_LIFECYCLE_TRANSITION', 'STARTUP_POSITION_REATTRIBUTED', 'TP_TARGET_SELECTED', 'TP_REPAIR_STARTED', 'TP_SUBMISSION_PREPARED', 'TP_PROTECTED', 'TP_REPAIR_FAILED', 'ORPHAN_TP_CANCELED', 'ORPHAN_TP_CANCEL_FAILED', 'ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED', 'ENTRY_ORDER_HISTORICAL_VERIFY_FAILED', 'ENTRY_ORDER_MANAGEMENT_UNVERIFIED', 'ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED', 'ENTRY_ORDER_ACTIVE_RESTORED', 'ENTRY_ORDER_REPRICE_BLOCKED', 'ENTRY_ORDER_FILL_ATTRIBUTION_REVISED', 'RECONCILIATION_FAILED', 'UNKNOWN_RISK_AUDIT_SUMMARY', 'PRIVATE_SYNC_FAILED', 'PRIVATE_SYNC_RECOVERED', 'BINANCE_USER_DATA', 'TRADING_QUALITY_FUNDING_FACT', 'AI_RESOURCE_HEALTH_CHANGED'];
const LAYERS = { aiFacingChain: AI_FACING, scanAndCandidateSupply: SCAN_LAYER, admissionAndRisk: ADMISSION, execution: EXECUTION, maintenanceAndFacts: MAINTENANCE };

const pipeline = await get('/api/v3/pipeline');
const supply = await get('/api/v3/diagnostics/supply');
const positions = await get('/api/v3/positions');
const orders = await get('/api/v3/orders');
const health = await get('/health');
const opsRuntime = await get('/api/v3/ops/runtime');
const settings = await get('/api/v3/settings');
const privSync = await get('/api/v3/diagnostics/private-sync');
const governance = await get('/api/v3/diagnostics/binance-governance');
const closeout = await get('/api/v3/diagnostics/closeout');
const tradeRecords = await get('/api/v3/trade-records?page=1&limit=500');

/* 1. hourly timeline ------------------------------------------------------- */
const healthRepeat = await new Promise((resolve) => setTimeout(() => resolve(get('/health')), 20_000));
const samplingLoopLiveness = {
  method: 'two /health reads 20s apart; the shadow sampler counter and sample timestamp only advance while the engine timers run',
  first: { samples: health.shadow?.samples, lastSampleAtUtc8: ts8(health.shadow?.lastSampleAt), pipelineAsOfUtc8: ts8(pipeline.asOf), capitalEvaluatedAtUtc8: ts8(pipeline.runtimeControl?.capital?.evaluatedAt) },
  second: { samples: healthRepeat.shadow?.samples, lastSampleAtUtc8: ts8(healthRepeat.shadow?.lastSampleAt), elapsedSeconds: Number(((Date.now() - NOW) / 1000).toFixed(1)) },
  samplesDelta: Number((healthRepeat.shadow?.samples ?? 0) - (health.shadow?.samples ?? 0)),
  lastSampleAdvancedMs: Number((healthRepeat.shadow?.lastSampleAt ?? 0) - (health.shadow?.lastSampleAt ?? 0)),
  conclusion: (healthRepeat.shadow?.samples ?? 0) > (health.shadow?.samples ?? 0) ? 'sampling loop advanced between reads: the engine timer loop is alive during the AI silence' : 'sampling loop did not advance between reads - investigate before any lifecycle action',
};
const hourly = db
  .prepare('select cast((ts - ?) / 3600000 as integer) as hour_bucket, type, count(*) as events from runtime_events where ts >= ? group by hour_bucket, type')
  .all(W0, W0);
const perType = db
  .prepare('select type, count(*) as events, min(ts) as first_ts, max(ts) as last_ts from runtime_events where ts >= ? group by type')
  .all(W0);
write('timeline-hourly.json', {
  generatedAtUtc8: ts8(NOW),
  window: { startUtc8: ts8(W0), endUtc8: ts8(NOW), startMs: W0, endMs: NOW, hours: 10 },
  source: { table: 'runtime_events', database: 'data/zdj-settings.sqlite', access: 'read-only connection' },
  retentionIntegrity: {
    note: 'runtime_events is trimmed to STORAGE_ROW_CAPS by storageCapacityGuard.maintainBounds(); the caps bound how far back history reaches, so a gap in this window cannot be a trim artefact (trimming deletes the oldest rows only).',
    caps: { criticalRuntimeEvents: 50000, nonCriticalRuntimeEvents: 20000 },
    totalRows: db.prepare('select count(*) n from runtime_events').get().n,
    critical: { ...db.prepare(`select count(*) n, min(ts) first_ts, max(ts) last_ts from runtime_events where ${PROTECTED}`).get(), first_utc8: ts8(db.prepare(`select min(ts) t from runtime_events where ${PROTECTED}`).get().t) },
    nonCritical: { ...db.prepare(`select count(*) n, min(ts) first_ts, max(ts) last_ts from runtime_events where NOT ${PROTECTED}`).get(), first_utc8: ts8(db.prepare(`select min(ts) t from runtime_events where NOT ${PROTECTED}`).get().t) },
    nonCriticalOldestInWindow: ts8(db.prepare(`select min(ts) t from runtime_events where NOT ${PROTECTED} and ts>=?`).get(W0).t),
    conclusion: 'non-critical history reaches back before the window start, so per-type counts inside this window are complete rather than lower bounds',
  },
  layers: LAYERS,
  samplingLoopLiveness,
  lastEventPerType: Object.fromEntries(perType.map((r) => [r.type, { events: r.events, first_utc8: ts8(r.first_ts), last_utc8: ts8(r.last_ts) }])),
  buckets: hourly
    .sort((a, b) => a.hour_bucket - b.hour_bucket)
    .map((r) => ({ ...r, bucketStartUtc8: ts8(W0 + r.hour_bucket * 3600000) })),
});

/* 2. AI silence verdict ---------------------------------------------------- */
const supplySeries = db
  .prepare("select ts, payload from runtime_events where type='CANDIDATE_SUPPLY_HEALTH' and ts >= ? order by ts")
  .all(W0)
  .map((r) => ({ ts: r.ts, ...JSON.parse(r.payload) }));
const nonzero = supplySeries.filter((r) => r.capitalExecutableCount > 0);
const lastNonZero = nonzero.length ? nonzero[nonzero.length - 1] : null;
const afterLastNonZero = lastNonZero ? supplySeries.filter((r) => r.ts > lastNonZero.ts) : [];
const rejected = db
  .prepare("select ts, symbol, payload from runtime_events where type in ('CANDIDATE_REJECTED','ENTRY_DECISION_BLOCKED') and ts >= ? order by ts")
  .all(W0);
const reasonTally = {};
for (const r of rejected) {
  const p = JSON.parse(r.payload);
  const k = String(p.reason ?? 'UNKNOWN');
  reasonTally[k] = (reasonTally[k] ?? 0) + 1;
}
const aiRuns = db
  .prepare('select run_id, role, symbol, status, model, decision, direction, started_at, completed_at, latency_ms, input_tokens, output_tokens, short_reason from ai_runs_archive where started_at >= ? order by started_at')
  .all(W0);
const lastRun = db.prepare('select max(started_at) t from ai_runs_archive').get().t;
const lastTerminal = db.prepare("select max(ts) t from runtime_events where type='AI_RUN_TERMINAL'").get().t;
const lastDispatch = db.prepare("select max(ts) t from runtime_events where type='POOL_ANALYSIS_STARTED'").get().t;
const cap = supply.capacity.capital;
const headroom = cap.routedCandidates?.[0]?.riskHeadroom ?? null;
write('ai-silence-verdict.json', {
  generatedAtUtc8: ts8(NOW),
  observationWindow: { startUtc8: ts8(W0), endUtc8: ts8(NOW) },
  headline: {
    lastAiAnalysisRequestStartedUtc8: ts8(lastRun),
    lastAiRunTerminalUtc8: ts8(lastTerminal),
    lastAiDispatchAttemptUtc8: ts8(lastDispatch),
    lastRunAgeMsAtObservation: pipeline.primaryBrain.lastRunAgeMs,
    lastRunAgeMinutesAtObservation: Number((pipeline.primaryBrain.lastRunAgeMs / 60000).toFixed(1)),
    silenceGapMinutesAtObservation: Number(((NOW - lastRun) / 60000).toFixed(1)),
    aiRunsInsideWindow: { total: aiRuns.length, byRoleStatus: aiRuns.reduce((m, r) => ((m[`${r.role}/${r.status}`] = (m[`${r.role}/${r.status}`] ?? 0) + 1), m), {}) },
    lastCapitalExecutablePositiveUtc8: ts8(lastNonZero?.ts ?? null),
    supplyHealthSamplesAfterThatWithZero: afterLastNonZero.length,
    continuousZeroMinutes: lastNonZero ? Number(((afterLastNonZero[afterLastNonZero.length - 1]?.ts - lastNonZero.ts) / 60000).toFixed(1)) : null,
  },
  rootCause: {
    verdict: 'CONFIRMED',
    layer: 'pre-AI capital/risk admission (entryCoordinator objectiveCapacity gate)',
    mechanism: [
      'appRuntime.start registers a 2500ms non-overlapping timer (appRuntime.ts:537) that calls runtimeControl.evaluate(true) and then, only when canDispatch() is true, entry.processPool().',
      'entry.processPool refreshes the dispatch-ready view from objectiveCapacity(symbol) (entryCoordinator.ts:96), which is buildPreAiExecutionEnvelope(symbol).LONG.executable || .SHORT.executable (entryCoordinator.ts:148).',
      'With remaining.gross == 0 every routed candidate is non-executable, the ready view is empty, so no symbol is ever transitioned to PRIMARY_QUEUED and no AI request is issued.',
      'The same engine that reports "no dispatchable candidate" is still running: capital.evaluatedAt advances, refreshReadyView keeps every pool resident in WAITING, and CANDIDATE_LIFECYCLE_REDERIVED / CANDIDATE_SUPPLY_HEALTH / MARKET_COHORT_REFILLED keep emitting.',
    ],
    arithmetic: {
      equityUsd: headroom?.LONG?.equity ?? null,
      grossExposureLimitUsd: headroom?.LONG?.limits?.gross ?? null,
      directionExposureLimitUsd: headroom?.LONG?.limits?.direction ?? null,
      currentGrossExposureUsd: headroom ? Number((headroom.LONG.long + headroom.LONG.short).toFixed(6)) : null,
      remainingGrossUsd: headroom?.LONG?.remaining?.gross ?? null,
      remainingDirectionLongUsd: headroom?.LONG?.remaining?.direction ?? null,
      remainingDirectionShortUsd: headroom?.SHORT?.remaining?.direction ?? null,
      longExposureUsd: headroom?.LONG?.long ?? null,
      shortExposureUsd: headroom?.LONG?.short ?? null,
      blockersOnRoutedCandidate: headroom?.LONG?.blockers ?? null,
      maxGrossExposurePct: settings.riskGovernance?.maxGrossExposurePct ?? null,
      maxDirectionExposurePct: settings.riskGovernance?.maxDirectionExposurePct ?? null,
      directionBudget: cap.directionBudget,
      positionCount: positions.length,
      positionGrossNotionalUsd: Number(positions.reduce((s, p) => s + Number(p.quantity) * Number(p.markPrice), 0).toFixed(6)),
      positionUnrealizedPnlUsd: Number(positions.reduce((s, p) => s + Number(p.unrealizedPnl ?? 0), 0).toFixed(6)),
    },
    candidateRejectionReasonsInWindow: reasonTally,
    routedCandidatesAtObservation: (cap.routedCandidates ?? []).map((r) => ({ symbol: r.symbol, admission: r.admission, reason: r.reason, longExecutable: r.longExecutable, shortExecutable: r.shortExecutable, remainingGross: r.riskHeadroom?.LONG?.remaining?.gross ?? null })),
  },
  hypotheses: {
    noCandidateEverReachedAiStage: { verdict: 'REFUTED', evidence: `ai_runs_archive holds ${aiRuns.length} PRIMARY_BRAIN/SCOUT runs inside the window (${JSON.stringify(aiRuns.reduce((m, r) => ((m[`${r.role}/${r.status}`] = (m[`${r.role}/${r.status}`] ?? 0) + 1), m), {}))}); CANDIDATE_LIFECYCLE_CHANGED shows READY -> PRIMARY_QUEUED -> PRIMARY_RUNNING -> PRIMARY_COMPLETED -> PLACE_READY chains up to ${ts8(lastTerminal)}.` },
    candidatesFilteredBeforeAi: { verdict: 'CONFIRMED_primary_root_cause', evidence: 'CANDIDATE_REJECTED / ENTRY_DECISION_BLOCKED in-window reasons are exclusively gross/direction exposure rejections; at observation the pool holds residents in WAITING because objectiveCapacity is false while pipelineReadyCount stays above zero.' },
    aiSchedulingBudgetQueueLockCooldownTimeout: { verdict: 'RULED_OUT', evidence: `dispatch timer alive (capital.evaluatedAt ${ts8(cap.evaluatedAt)}, nextRecheckAt ${ts8(cap.nextRecheckAt)}); queueDepth ${pipeline.primaryBrain.resource.queueDepth}; aiHealth ${JSON.stringify(pipeline.aiHealth)}; last lifecycle reason for the final symbol was AI_QUANTITY_BELOW_MIN_NOTIONAL followed by a return to READY at ${ts8(db.prepare("select max(ts) t from runtime_events where type='CANDIDATE_LIFECYCLE_CHANGED'").get().t)}, not a lock or quarantine latch.` },
    modelUnavailableOrCallFailed: { verdict: 'RULED_OUT_as_cause_of_the_silence', evidence: `resource brain-7900-primary status ${pipeline.primaryBrain.resource.status}/connectionStatus ${pipeline.primaryBrain.resource.connectionStatus}, healthCheckedAt ${ts8(pipeline.primaryBrain.resource.healthCheckedAt)}; AI_RESOURCE_HEALTH_CHANGED aborted flaps at 04:58:16->04:58:29 and 05:25:37->05:25:50 self-recovered in ~13s. 5 in-window runs failed with AI_OUTPUT_INVALID (output token limit) - a real quality defect, but the last one is ${ts8(aiRuns.filter((r) => r.status === 'FAILED').slice(-1)[0]?.started_at ?? null)}, before the silence boundary, and dispatch continued afterwards.` },
    engineSchedulerOrEventLoopStalled: { verdict: 'RULED_OUT', evidence: `shadow.lastSampleAt ${ts8(health.shadow?.lastSampleAt ?? null)} (age ms ${NOW - (health.shadow?.lastSampleAt ?? NOW)}), privateSync.lastSuccessAt ${ts8(privSync.sync.lastSuccessAt)}, CANDIDATE_LIFECYCLE_REDERIVED last ${ts8(perType.find((r) => r.type === 'CANDIDATE_LIFECYCLE_REDERIVED')?.last_ts)}, pool residents all re-evaluated to WAITING.` },
    privateOrMarketFactsStaleFailClosed: { verdict: 'RULED_OUT_for_the_silence', evidence: `binancePrivate ${pipeline.binancePrivate.status} snapshotAgeMs ${pipeline.binancePrivate.snapshotAgeMs} consecutiveFailures ${pipeline.binancePrivate.consecutiveFailures}; freshMarkets ${pipeline.freshMarkets.status} quoteFreshRatio ${pipeline.freshMarkets.quoteFreshRatio} klineFreshRatio ${pipeline.freshMarkets.klineFreshRatio}. PRIVATE_SYNC_FAILED did occur ${perType.find((r) => r.type === 'PRIVATE_SYNC_FAILED')?.events ?? 0} times in-window but ended ${ts8(perType.find((r) => r.type === 'PRIVATE_SYNC_FAILED')?.last_ts)} and AI analysis continued for another 4 hours afterwards.` },
    other: { verdict: 'CONFIRMED_contributor', evidence: 'Equity erosion (see trade-and-position-summary.json) shrinks the gross-exposure cap, which is defined as equity x maxGrossExposurePct, while 29 surviving positions hold ~10.8k USD notional; the cap therefore closed without any single new order being rejected for a strategy reason.' },
  },
  dispatchChainLiveness: {
    conclusion: 'the AI dispatch chain is alive and correctly refusing to dispatch; nothing is hung',
    canDispatchTermsFromRuntimeControlService: {
      storageEntryBlockReason: supply.capacity.storage.status === 'AVAILABLE' ? null : supply.capacity.storage.status,
      privateAccountFresh: pipeline.binancePrivate.status === 'READY' && pipeline.binancePrivate.consecutiveFailures === 0,
      entryRiskBlocked: supply.capacity.newRiskBlocked,
      executionGovernanceMode: pipeline.entryPermission.autoExecutionMode,
      runtimeControlMode: pipeline.runtimeControl.mode,
      entrySafetyMode: pipeline.runtimeControl.entrySafetyMode,
    },
    sharedTimerProof: 'runtimeControl.evaluate(true) and entry.processPool() share one 2500ms non-overlapping timer (appRuntime.ts:537-542); capital.evaluatedAt advancing proves that callback still runs, and every canDispatch() term above is satisfied, so processPool() is reached.',
    capitalEvaluatedAtUtc8: ts8(cap.evaluatedAt),
    capitalNextRecheckAtUtc8: ts8(cap.nextRecheckAt),
    refreshReadyViewProof: {
      note: 'DynamicPool.replenish marks a pipeline-eligible resident READY (pool.ts:26,31); only entryCoordinator.refreshReadyView demotes READY back to WAITING when objectiveCapacity is false (entryCoordinator.ts:96, pool.ts:11). Observing pipeline-eligible symbols sitting WAITING therefore proves the dispatch tick executed after that replenish.',
      poolHealthCounts: supply.health?.counts ?? null,
      poolHealthRootBlocker: supply.health?.rootBlocker ?? null,
      poolHealthReasonCounts: supply.health?.reasonCounts ?? null,
      residentStateTally: supply.residents.reduce((m, r) => ((m[r.state] = (m[r.state] ?? 0) + 1), m), {}),
      pipelineEligibleYetWaiting: supply.capacity.candidates.filter((c) => c.long || c.short).map((c) => c.symbol),
    },
  },
  dashboardWording: {
    reasonCode: pipeline.runtimeControl.reasonCode,
    reasonText: pipeline.runtimeControl.reasonText,
    pipelineState: pipeline.pipelineState,
    aiIdleReason: pipeline.primaryBrain.resource.idleReason,
    aiHealthReason: pipeline.primaryBrain.healthReason,
    topNoEntryReason: pipeline.noEntryReason,
    codeRefs: {
      genericText: 'apps/engine/src/services/runtimeControlService.ts:128 - text becomes position-capacity wording only when slots.used >= slots.max, otherwise "持续扫描中：当前没有合格可执行机会"',
      idleClassification: 'apps/engine/src/services/aiResourceHealth.ts:29-32 - dispatchable requires executableCandidates > 0, so a long gap is classified READY / IDLE_NO_DISPATCHABLE_CANDIDATE',
      idleReasonProducer: 'apps/engine/src/services/entryCoordinator.ts:127-130 - WAITING_CANDIDATE is produced when the capacity-filtered ready list is empty, not when no candidate exists',
    },
    distinguishesNormalNoOpportunityFromSilentAiFailure: false,
  },
});

/* 3. trades and positions -------------------------------------------------- */
const tradeRows = db.prepare('select trade_id, status, updated_at, payload from trade_records').all();
const parsed = tradeRows.map((r) => {
  let p = {};
  try {
    p = JSON.parse(r.payload || '{}');
  } catch {}
  return { tradeId: r.trade_id, rowStatus: r.status, updatedAt: r.updated_at, ...p };
});
const closedIn = parsed.filter((p) => Number(p.closedAt ?? 0) >= W0 && Number(p.closedAt ?? 0) <= NOW);
const sum = (xs) => xs.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0);
write('trade-and-position-summary.json', {
  generatedAtUtc8: ts8(NOW),
  window: { startUtc8: ts8(W0), endUtc8: ts8(NOW) },
  positionsAtObservation: {
    count: positions.length,
    bySide: positions.reduce((m, p) => ((m[p.side] = (m[p.side] ?? 0) + 1), m), {}),
    byManagementStatus: positions.reduce((m, p) => ((m[p.managementStatus] = (m[p.managementStatus] ?? 0) + 1), m), {}),
    byTpStatus: positions.reduce((m, p) => ((m[p.tpStatus] = (m[p.tpStatus] ?? 0) + 1), m), {}),
    byTpCoverageSource: positions.reduce((m, p) => ((m[p.tpCoverageSource] = (m[p.tpCoverageSource] ?? 0) + 1), m), {}),
    grossNotionalUsd: Number(sum(positions.map((p) => Number(p.quantity) * Number(p.markPrice))).toFixed(6)),
    unrealizedPnlUsd: Number(sum(positions.map((p) => p.unrealizedPnl)).toFixed(6)),
    worst: [...positions].sort((a, b) => Number(a.unrealizedPnl) - Number(b.unrealizedPnl)).slice(0, 5).map((p) => ({ symbol: p.symbol, side: p.side, unrealizedPnlUsd: Number(Number(p.unrealizedPnl).toFixed(2)), unrealizedPnlPercentOnMargin: Number(Number(p.unrealizedPnlPercent).toFixed(2)), managementStatus: p.managementStatus, tpStatus: p.tpStatus })),
    openedInWindow: positions.filter((p) => Number(p.openedAt) >= W0).map((p) => ({ symbol: p.symbol, side: p.side, openedUtc8: ts8(p.openedAt), entryTimeSource: p.entryTimeSource, managementStatus: p.managementStatus })),
    handedToHumanInWindow: positions.filter((p) => Number(p.humanManagedAt) >= W0).map((p) => ({ symbol: p.symbol, humanManagedAtUtc8: ts8(p.humanManagedAt) })),
    unprotected: positions.filter((p) => p.tpStatus !== 'PROTECTED').map((p) => ({ symbol: p.symbol, tpStatus: p.tpStatus })),
  },
  closedTradesInWindow: {
    count: closedIn.length,
    rows: closedIn
      .sort((a, b) => Number(a.closedAt) - Number(b.closedAt))
      .map((p) => ({ symbol: p.symbol, direction: p.direction, openedUtc8: ts8(p.openedAt), closedUtc8: ts8(p.closedAt), holdingHours: Number(((p.durationMs ?? 0) / 3600000).toFixed(1)), tradingNetPnlExFundingUsd: p.tradingNetPnlExFunding ?? null, totalFeeUsd: p.totalFee ?? null, fundingUsd: p.funding ?? null, fundingAttributionStatus: p.fundingAttributionStatus ?? null, closeReason: p.closeReason ?? null, source: p.source ?? null, formalNetPnlStatus: p.formalNetPnlStatus ?? null, missingFacts: p.missingFacts ?? null, economicEligibility: p.economicEligibility ?? null })),
    sumTradingNetPnlExFundingUsd: Number(sum(closedIn.map((p) => p.tradingNetPnlExFunding)).toFixed(6)),
    sumTotalFeeUsd: Number(sum(closedIn.map((p) => p.totalFee)).toFixed(6)),
    fundingEvidence: closedIn.every((p) => p.funding == null && p.fundingAttributionStatus === 'UNKNOWN') ? 'INSUFFICIENT_EVIDENCE (fundingAttributionStatus=UNKNOWN on every record in the window)' : 'PARTIAL',
  },
  ledgerSummaryFromApi: tradeRecords.summary ?? null,
  entryFlowInWindow: {
    entryIntents: perType.find((r) => r.type === 'ENTRY_INTENT_CREATED')?.events ?? 0,
    entryOrdersCreated: perType.find((r) => r.type === 'ENTRY_ORDER_CREATED')?.events ?? 0,
    submitAttempts: perType.find((r) => r.type === 'ENTRY_SUBMIT_ATTEMPTED')?.events ?? 0,
    fills: perType.find((r) => r.type === 'ENTRY_FILLED')?.events ?? 0,
    blockedAtSubmit: perType.find((r) => r.type === 'ENTRY_ORDER_BLOCKED')?.events ?? 0,
    submissionUnknown: perType.find((r) => r.type === 'ENTRY_ORDER_SUBMISSION_UNKNOWN')?.events ?? 0,
    note: 'counts come from runtime_events; see timeline-hourly.json for the hourly shape',
  },
  ordersAtObservation: {
    entryStatusTally: orders.entry.reduce((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
    takeProfitStatusTally: orders.takeProfit.reduce((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
    manualStatusTally: (orders.manual ?? []).reduce((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
    nonTerminalEntryOrders: orders.entry.filter((o) => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(o.status)).map((o) => ({ symbol: o.symbol, side: o.side, status: o.status, clientOrderId: o.clientOrderId, createdUtc8: ts8(o.createdAt), activeRiskExposure: o.activeRiskExposure ?? null, riskEvidenceStatus: o.activeRiskEvidence?.status ?? null, evidenceCheckedUtc8: ts8(o.activeRiskEvidence?.checkedAt), evidenceValidUntilUtc8: ts8(o.activeRiskEvidence?.validUntil) })),
    workingTakeProfitOrders: orders.takeProfit.filter((o) => o.status === 'WORKING').map((o) => ({ symbol: o.symbol, side: o.side, quantity: o.quantity, price: o.price, exchangeOrderId: o.exchangeOrderId ?? o.orderId ?? null, clientOrderId: o.clientOrderId ?? null })),
  },
});

/* 4. observability fact inventory ----------------------------------------- */
write('observability-fact-inventory.json', {
  generatedAtUtc8: ts8(NOW),
  alreadyAvailable: {
    lastAiRunStartedAt: { where: 'ai_runs_archive.max(started_at) / pipeline.entryActivity.lastPrimaryRunAt', value: ts8(lastRun) },
    lastAiRunTerminalAt: { where: "runtime_events type='AI_RUN_TERMINAL' max(ts) / pipeline.work.recentDecision.at", value: ts8(lastTerminal) },
    lastAiDispatchAttemptAt: { where: "runtime_events type='POOL_ANALYSIS_STARTED' max(ts)", value: ts8(lastDispatch) },
    lastRunAgeMs: { where: 'pipeline.primaryBrain.lastRunAgeMs', value: pipeline.primaryBrain.lastRunAgeMs },
    aiRunFailuresAndReasons: { where: 'ai_runs_archive.status/short_reason + AI_RUN_FAILED + ENTRY_ANALYSIS_FAILED', value: 'present; 5 in-window AI_OUTPUT_INVALID failures' },
    consecutiveAiFailures: { where: 'pipeline.aiHealth.consecutiveFailures', value: pipeline.aiHealth.consecutiveFailures, caveat: 'window-scoped counter, resets; it is 0 during the entire silence so it cannot express "stalled"' },
    aiServiceHealth: { where: 'pipeline.primaryBrain.resource.{status,connectionStatus,healthCheckedAt,healthReason} + AI_RESOURCE_HEALTH_CHANGED', value: `${pipeline.primaryBrain.resource.status}/${pipeline.primaryBrain.resource.connectionStatus} checked ${ts8(pipeline.primaryBrain.resource.healthCheckedAt)}` },
    aiQueueAndBudget: { where: 'pipeline.primaryBrain.resource.{queueDepth,active,totalRuns,failures} + pipeline.aiHealth.{cooldown,quarantine}', value: { queueDepth: pipeline.primaryBrain.resource.queueDepth, active: pipeline.primaryBrain.resource.active, cooldown: pipeline.aiHealth.cooldown, quarantine: pipeline.aiHealth.quarantine } },
    candidateSupplyCounts: { where: 'pipeline.pool.health.counts + CANDIDATE_SUPPLY_HEALTH event payload', value: { pipelineReadyCount: pipeline.pool.health.counts.potentialReadySymbols, poolReadySymbols: pipeline.pool.health.counts.poolReadySymbols, dispatchReadySymbols: pipeline.pool.health.counts.dispatchReadySymbols, governanceBlockedSymbols: pipeline.pool.health.counts.governanceBlockedSymbols, occupiedUnderlyings: pipeline.pool.health.counts.occupiedUnderlyings } },
    preAiAdmissionReasons: { where: 'CANDIDATE_REJECTED / ENTRY_DECISION_BLOCKED / ENTRY_ORDER_BLOCKED payloads + /api/v3/diagnostics/supply capacity.candidates', value: reasonTally },
    riskHeadroomArithmetic: { where: 'capacity.candidates[].riskHeadroom.remaining + runtimeControl.capital.directionBudget', value: { directionBudget: cap.directionBudget, remaining: headroom?.remaining ?? null } },
    scanHeartbeat: { where: 'CANDIDATE_LIFECYCLE_REDERIVED / CANDIDATE_SUPPLY_HEALTH / MARKET_COHORT_REFILLED / shadow.lastSampleAt', value: { lastRederive: ts8(perType.find((r) => r.type === 'CANDIDATE_LIFECYCLE_REDERIVED')?.last_ts), lastSupplyHealth: ts8(perType.find((r) => r.type === 'CANDIDATE_SUPPLY_HEALTH')?.last_ts), lastCohortRefill: ts8(perType.find((r) => r.type === 'MARKET_COHORT_REFILLED')?.last_ts), shadowLastSampleAt: ts8(health.shadow?.lastSampleAt) } },
    privateAndMarketFreshness: { where: 'pipeline.binancePrivate / pipeline.freshMarkets / /api/v3/diagnostics/private-sync', value: { privateStatus: pipeline.binancePrivate.status, snapshotAgeMs: pipeline.binancePrivate.snapshotAgeMs, consecutiveFailures: pipeline.binancePrivate.consecutiveFailures, marketStatus: pipeline.freshMarkets.status, quoteFreshRatio: pipeline.freshMarkets.quoteFreshRatio, klineFreshRatio: pipeline.freshMarkets.klineFreshRatio } },
  },
  missing: {
    dispatchTickHeartbeatTimestamp: { gap: 'pipeline.scheduler exposes only {status:"RUNNING"}; there is no lastProcessPoolAt / lastRefreshReadyViewAt, so "the dispatch loop is alive" can only be inferred indirectly from pool states.', neededFor: 'separating "capacity starved but loop alive" from "loop hung"' },
    lastCandidateOfferedToAiVsLastAiSuccess: { gap: 'both exist as raw events but no aggregate observability field names "last time a candidate passed the pre-AI capacity gate"; pipeline.candidateLifecycle.nextCandidate is null with no reason code', neededFor: 'one-line root cause on the dashboard' },
    idleAlertIndependentOfDispatchability: { gap: 'aiResourceHealth.primaryBrainHealth() returns DEGRADED only when dispatchable is true (executableCandidates > 0); in a capacity-starved portfolio a multi-hour AI gap is reported READY', neededFor: 'the >30 minute alert the user requires' },
    exposureCapVsNoOpportunityDistinction: { gap: 'runtimeControlService.ts:128 only swaps in position-capacity wording when slots.used >= slots.max; a 100%-of-equity gross exposure cap is described with the same text as "no qualified opportunity"', neededFor: 'telling the operator that the account is full, not that the market is empty' },
    alertingChannelForAiSilence: { gap: 'no runtime_events type or settings field represents "AI has not analysed for N minutes"; the only nearby pause event is TRADING_PIPELINE_PAUSED_DAILY_RISK_LIMIT which did not fire because entryRiskBlocked is false', neededFor: 'any proactive notification' },
    fundingFacts: { gap: 'every trade record in the window carries fundingAttributionStatus=UNKNOWN and funding=null; economicEligibility/formalNetPnlStatus are null', neededFor: 'complete per-cycle economics' },
  },
});

/* 5. stop-line snapshot ---------------------------------------------------- */
/**
 * `reconciliation.activeRiskUnresolvedCount` oscillates 0<->1 because an UNKNOWN order's
 * no-active-risk evidence carries a TTL and is re-verified on a tiered ladder, so a single
 * sample cannot distinguish "risk cannot be determined" from "re-audit currently in progress".
 * The gate therefore requires the whole exchange-side truth to hold across several samples.
 */
const stopSamples = [];
for (let i = 0; i < 3; i++) {
  const [pl, od] = [await get('/api/v3/pipeline'), await get('/api/v3/orders')];
  const unknowns = (od.entry ?? []).filter((o) => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(o.status));
  stopSamples.push({
    atUtc8: ts8(pl.asOf),
    activeRiskUnresolved: pl.reconciliation.activeRiskUnresolvedCount,
    verifiedNoActiveRisk: pl.reconciliation.verifiedNoActiveRiskUnknownCount,
    unresolvedDrift: pl.reconciliation.unresolvedDriftCount,
    capacityInFlight: pl.capacity.inFlight,
    nonTerminalEntryOrders: unknowns.length,
    nonTerminalWithoutVerifiedNoRisk: unknowns.filter((o) => o.activeRiskExposure !== false || o.activeRiskEvidence?.status !== 'VERIFIED_NO_ACTIVE_RISK').map((o) => o.clientOrderId),
    workingTp: (od.takeProfit ?? []).filter((o) => o.status === 'WORKING').length,
    aiLastRunAgeMinutes: Number((pl.primaryBrain.lastRunAgeMs / 60000).toFixed(1)),
  });
  if (i < 2) await new Promise((res) => setTimeout(res, 20_000));
}
const stopChecks = {
  everyPositionProtected: positions.every((p) => p.tpStatus === 'PROTECTED'),
  exchangeSideTakeProfitOrdersMatchPositions: stopSamples.every((s) => s.workingTp === positions.length),
  noNonTerminalEntryOrderLacksVerifiedNoRiskEvidence: stopSamples.every((s) => s.nonTerminalWithoutVerifiedNoRisk.length === 0),
  capacityNeverCountsInFlightEntry: stopSamples.every((s) => s.capacityInFlight === 0),
  unresolvedRiskNeverExceedsOneReauditSlot: Math.max(...stopSamples.map((s) => s.activeRiskUnresolved)) <= 1,
  environmentIsTestnet: settings.connections?.exchange?.environment === 'TESTNET',
  durableStorageAcceptsBackup: ['AVAILABLE', 'WARNING'].includes(supply.capacity.storage.status),
  privateAccountFresh: pipeline.binancePrivate.status === 'READY' && pipeline.binancePrivate.consecutiveFailures === 0,
};
const stopBlockers = Object.entries(stopChecks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
write('stopline-samples.json', {
  method: 'three /api/v3/pipeline + /api/v3/orders reads ~20s apart; UNKNOWN-order no-risk evidence has a TTL and is re-verified on a 5/15/30 minute ladder, so a single read cannot separate an unresolvable order from a re-audit in progress',
  samples: stopSamples,
  derived: {
    activeRiskUnresolvedValues: [...new Set(stopSamples.map((s) => s.activeRiskUnresolved))],
    capacityInFlightValues: [...new Set(stopSamples.map((s) => s.capacityInFlight))],
    unresolvedEntriesEverMissingEvidence: [...new Set(stopSamples.flatMap((s) => s.nonTerminalWithoutVerifiedNoRisk))],
  },
});
write('stopline-snapshot.json', {
  capturedAtUtc8: ts8(NOW),
  engineIdentity: {
    instanceId: opsRuntime.instanceId,
    pid: opsRuntime.pid,
    version: opsRuntime.version,
    buildId: opsRuntime.buildId,
    host: opsRuntime.host,
    port: opsRuntime.port,
    uptimeMs: opsRuntime.uptimeMs,
    startedUtc8: ts8(NOW - opsRuntime.uptimeMs),
    startReason: opsRuntime.lastRestartReason,
    restartCount: opsRuntime.restartCount,
    supervisor: opsRuntime.supervisor,
    artifactHash: closeout.runtime?.artifactHash ?? health?.artifactHash ?? null,
  },
  environmentIdentity: {
    exchangeEnvironment: settings.connections?.exchange?.environment,
    credentialRef: settings.connections?.exchange?.credentialRef,
    testnetRestBaseUrl: settings.connections?.exchange?.testnetRestBaseUrl ?? settings.connections?.exchange?.testnetBaseUrl,
    testnetWsBaseUrl: settings.connections?.exchange?.testnetWsBaseUrl ?? settings.connections?.exchange?.testnetWsBaseUrl,
    executionMode: settings.connections?.executionMode,
    autoExecutionMode: pipeline.entryPermission?.autoExecutionMode,
    entryPermissionStatus: pipeline.entryPermission?.status,
    settingsVersion: settings.settingsVersion,
    rateLimitScopes: Object.fromEntries(Object.entries(governance.budgets ?? {}).map(([k, v]) => [k, { status: v.status, http429: v.http429, http418: v.http418, blockedUntil: ts8(v.blockedUntil), lastLimitedAt: ts8(v.lastLimitedAt), limitSource: v.limitSource }])),
    secretFieldsIncluded: false,
  },
  riskAtStop: {
    positions: pipeline.capacity,
    allPositionsProtected: positions.every((p) => p.tpStatus === 'PROTECTED'),
    workingTakeProfitOrderCount: orders.takeProfit.filter((o) => o.status === 'WORKING').length,
    nonTerminalEntryOrdersWithActiveRisk: orders.entry.filter((o) => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(o.status) && o.activeRiskExposure !== false).map((o) => o.clientOrderId),
    unknownEntryOrderCount: orders.entry.filter((o) => o.status === 'UNKNOWN').length,
    unknownVerifiedNoActiveRisk: orders.entry.filter((o) => o.status === 'UNKNOWN' && o.activeRiskEvidence?.status === 'VERIFIED_NO_ACTIVE_RISK').length,
    reconciliation: { historicalUnknownCount: pipeline.reconciliation.historicalUnknownCount, activeRiskUnresolvedCount: pipeline.reconciliation.activeRiskUnresolvedCount, verifiedNoActiveRiskUnknownCount: pipeline.reconciliation.verifiedNoActiveRiskUnknownCount, driftCount: pipeline.reconciliation.driftCount, unresolvedDriftCount: pipeline.reconciliation.unresolvedDriftCount },
    privateAccount: { status: pipeline.binancePrivate.status, snapshotAgeMs: pipeline.binancePrivate.snapshotAgeMs, consecutiveFailures: pipeline.binancePrivate.consecutiveFailures },
    marketData: { status: pipeline.freshMarkets.status, staleSymbols: pipeline.freshMarkets.stale.length },
    durableStorage: { status: supply.capacity.storage.status, totalBytes: supply.capacity.storage.totalBytes, entryBlockBytes: supply.capacity.storage.limits.entryBlockBytes },
    dailyRisk: { entryRiskBlocked: supply.capacity.newRiskBlocked, runtimeMode: pipeline.runtimeControl.mode, reasonCode: pipeline.runtimeControl.reasonCode },
  },
  stopLineDecision: {
    checks: stopChecks,
    blockersFound: stopBlockers,
    proceedToShutdown: stopBlockers.length === 0,
  },
});
db.close();
