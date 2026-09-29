import {canonicalPnlEligible,ledgerClosedComplete} from '../services/tradingQualityEligibility.js';
import {projectTradeRecordSummary} from '../services/tradeRecordReadModel.js';
import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "@zdj/contracts";
import type { EngineRuntime } from "../runtime/appRuntime.js";
import { exposure, resolveUnderlying } from "@zdj/core";
import { createHash } from 'node:crypto';
import { byOpenedAtDesc } from './chronologicalSort.js';
import { candidateSupplyHealth } from '../services/candidateSupplyHealth.js';
import { entryOrderOccupiesRisk } from '../services/entryRiskOccupancy.js';
function auditJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, item) => {
      if (/^(apiKey|apiSecret|secret|signature|authorization)$/i.test(_key)) return '[REDACTED]';
      if (typeof item === 'string') return item.replace(/("(?:apiKey|apiSecret|secret|signature|authorization)"\s*:\s*")[^"]*/gi,'$1[REDACTED]').replace(/\b(apiKey|apiSecret|secret|signature|authorization)\s*[=:]\s*[^\s,}\]"']+/gi,'$1=[REDACTED]');
      if (item instanceof Error)
        return { name: item.name, message: item.message, stack: item.stack };
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "function")
        return `[Function ${item.name || "anonymous"}]`;
      if (typeof item === "symbol") return item.toString();
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    });
    return json ?? String(value);
  } catch (error) {
    return JSON.stringify({
      serializationError:
        error instanceof Error ? error.message : String(error),
      valueType: typeof value,
    });
  }
}
export function redactAudit(value: unknown, limit = 8000) {
  const json=auditJson(value);
  if(json.length<=limit)return json;
  const compact=(item:any,depth=0):any=>typeof item==='string'?item.slice(0,300):
    item&&typeof item==='object'?(depth>=3?'[OMITTED]':Array.isArray(item)?item.slice(0,8).map(x=>compact(x,depth+1)):
      Object.fromEntries(Object.entries(item).filter(([k])=>!['inputPreview','outputPreview','normalizedPreview','rawOutput','prompt','packet'].includes(k)).slice(0,40).map(([k,v])=>[k,compact(v,depth+1)]))):item;
  const envelope={auditTruncated:true,originalCharacters:json.length,sha256:createHash('sha256').update(json).digest('hex'),summary:compact(JSON.parse(json))};
  const bounded=JSON.stringify(envelope);
  return bounded.length<=limit?bounded:JSON.stringify({...envelope,summary:'See archived artifact by hash'});
}
export function activeEntryOrdersForProjection(orders:Iterable<any>,now=Date.now()){
  return [...orders].filter(order=>entryOrderOccupiesRisk(order,now));
}
const directionalDecision=(decision:unknown)=>['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE'].includes(String(decision??''));

/**
 * P7: one section per question. `HEALTHY` used to be reported from a reconciliation pass whose checks
 * were a different scope from the take-profit gap, the exit claim drift and the historical UNKNOWN
 * rows, so a single label covered all of them. Each check below states its own evidence.
 */
export function executionTruthProjection(runtime: EngineRuntime, now = Date.now()) {
  const s = runtime.state;
  const services: any[] = (runtime.health?.() ?? []) as any[];
  const service = (id: string) => services.find(row => row?.id === id) ?? null;
  const market = service('market'), tpService = service('tp'), ai = service('ai');
  const reconciliation = (runtime as any).reconciliation?.health?.() ?? null;
  const convergence = (runtime as any).exitConvergenceHealth?.() ?? { available: false };
  const tpMetrics = (runtime as any).tp?.metrics?.() ?? null;
  const records = [...s.tradeRecords.values()] as any[];
  const inconsistent = records.filter(record => record.ledgerConservation === 'LEDGER_INCONSISTENT' || (record.integrityFlags ?? []).includes('LEDGER_INCONSISTENT')).length;
  const unconserved = records.filter(record => record.ledgerConservation === 'UNCONSERVED').length;
  // An open holding is not a conservation failure, and a record with no Entry fill proves nothing. Both
  // are counted so DEGRADED means only "the ledger contradicts itself".
  const conservedRecords = records.filter(record => record.ledgerConservation === 'CONSERVED').length;
  const unprovenRecords = records.filter(record => !record.ledgerConservation || record.ledgerConservation === 'UNKNOWN').length;
  const openConserved = records.filter(record => record.ledgerConservation === 'CONSERVED' && record.status !== 'CLOSED').length;
  const fundingExact = records.filter(record => record.fundingAttributionStatus === 'EXACT').length;
  const fundingUnknown = records.filter(record => record.fundingAttributionStatus !== 'EXACT').length;
  const fundingLedger = (runtime as any).fundingIncome?.coverageSummary?.() ?? null;
  const coordination = (s.settings.riskGovernance as any)?.exitCoordination ?? {};
  const aiActiveCycles = (runtime as any).exitRuntime ? [...s.positions.values()].filter((position: any) => {
    const scope = (runtime as any).exitRuntime.scope({ symbol: position.symbol, side: position.side });
    const owner = (runtime as any).exitRuntime.ownerOfScope(scope, position.cycleId);
    return owner?.ownerState === 'AI_ACTIVE';
  }).length : 0;
  const reviewRunner = (runtime as any).positionReviewRunner;
  const reviewReadback = (runtime as any).positionReviewScheduler?.reviewReadback?.(now) ?? null;
  // The runner reports the last tick and the last verdict; the scheduler reports the per-cycle
  // obligation. Both are normalised here so a page never has to guess which one it is looking at.
  const rawOutcome = reviewRunner?.lastOutcome?.() ?? null;
  const reviewOutcome = rawOutcome ? {
    lastTickAt: Number.isFinite(Number(rawOutcome.lastTickAt)) ? Number(rawOutcome.lastTickAt) : null,
    lastVerdictAt: Number.isFinite(Number(rawOutcome.lastVerdictAt)) ? Number(rawOutcome.lastVerdictAt) : null,
    lastDecision: rawOutcome.lastDecision == null ? null : String(rawOutcome.lastDecision),
    lastReason: rawOutcome.lastReason == null ? null : String(rawOutcome.lastReason),
    usable: rawOutcome.usable === true,
    enabled: rawOutcome.enabled === true,
    considered: Math.max(0, Math.trunc(Number(rawOutcome.considered ?? 0))),
    reserved: Math.max(0, Math.trunc(Number(rawOutcome.reserved ?? 0))),
    completed: Math.max(0, Math.trunc(Number(rawOutcome.completed ?? 0))),
    discarded: Math.max(0, Math.trunc(Number(rawOutcome.discarded ?? 0))),
    failed: Math.max(0, Math.trunc(Number(rawOutcome.failed ?? 0))),
    due: Math.max(0, Math.trunc(Number(reviewReadback?.due ?? 0))),
    exhausted: Math.max(0, Math.trunc(Number(reviewReadback?.exhausted ?? 0))),
    failureBlocked: Math.max(0, Math.trunc(Number(reviewReadback?.failureBlocked ?? 0))),
    skippedReason: rawOutcome.skippedReason == null ? null : String(rawOutcome.skippedReason),
  } : null;
  const entryRows = [...s.entryOrders.values()] as any[], tpRows = [...s.tpOrders.values()] as any[], manualRows = [...s.manualOrders.values()] as any[];
  const confirmed = (row: any) => String(row.factSource ?? '') === 'BINANCE_EXACT_ORDER' || String(row.factSource ?? '') === 'BINANCE_OPEN_ORDERS' || (String(row.status ?? '') === 'WORKING' && Boolean(row.exchangeOrderId));
  const parse = (detail: unknown) => { try { return typeof detail === 'string' ? JSON.parse(detail) : detail; } catch { return null; } };
  const statusFor = (row: any, degradedWhen: (value: any) => boolean) => {
    if (!row) return { status: 'UNKNOWN' as const, detail: 'SERVICE_NOT_REPORTED' };
    const value = parse(row.detail);
    return { status: (degradedWhen(value) ? 'DEGRADED' : 'HEALTHY') as 'DEGRADED' | 'HEALTHY', detail: row.detail ? String(row.detail).slice(0, 400) : null };
  };
  const marketState = statusFor(market, (value: any) => (value?.gaps ?? 0) > 0 || value?.fresh !== value?.total);
  const tpState = statusFor(tpService, (value: any) => Number(value?.missing ?? 0) > 0 || Number(value?.positionFactUnresolved ?? 0) > 0);
  return {
    evaluatedAt: now,
    exchangeIngestion: {status: marketState.status, detail: marketState.detail},
    orderTerminalParity: reconciliation
      ? {status: Number(reconciliation.verifiedOrderFactMismatchCount ?? 0) > 0 ? 'DEGRADED' as const : 'HEALTHY' as const,
         mismatchCount: Math.max(0, Number(reconciliation.verifiedOrderFactMismatchCount ?? 0)),
         detail: `lastRunAt=${reconciliation.lastRun ?? 0};drift=${reconciliation.driftCount ?? 0};unresolved=${reconciliation.unresolvedDriftCount ?? 0}`}
      : {status: 'UNKNOWN' as const, mismatchCount: 0, detail: 'RECONCILIATION_NOT_REPORTED'},
    exitClaimConvergence: convergence.available
      ? {status: Number(convergence.terminalUnreleasedClaims ?? 0) > 0 || Number(convergence.oldestUnpolledAgeMs ?? 0) > Number(convergence.maxServiceIntervalMs ?? 0) * 2 ? 'DEGRADED' as const : 'HEALTHY' as const,
         openTasks: Number(convergence.openTasks ?? 0), terminalUnreleasedClaims: Number(convergence.terminalUnreleasedClaims ?? 0),
         oldestUnpolledAgeMs: Number(convergence.oldestUnpolledAgeMs ?? 0),
         detail: `queue=${convergence.openTasks};eligible=${convergence.eligibleNow};batch=${convergence.batchLimit};interval=${convergence.intervalMs};maxService=${convergence.maxServiceIntervalMs}`}
      : {status: 'UNKNOWN' as const, openTasks: 0, terminalUnreleasedClaims: 0, oldestUnpolledAgeMs: 0, detail: convergence.reason ?? 'EXIT_RUNTIME_NOT_ATTACHED'},
    takeProfitCoverage: tpMetrics
      ? {status: Number(tpMetrics.missing ?? 0) > 0 || Number(tpMetrics.positionFactUnresolved ?? 0) > 0 ? 'DEGRADED' as const : 'HEALTHY' as const,
         required: Number(tpMetrics.required ?? 0), protected: Number(tpMetrics.protected ?? 0), missing: Number(tpMetrics.missing ?? 0),
         unresolved: Number(tpMetrics.positionFactUnresolved ?? 0), detail: tpService?.detail ? String(tpService.detail).slice(0, 400) : null}
      : {status: 'UNKNOWN' as const, required: 0, protected: 0, missing: 0, unresolved: 0, detail: 'GUARDIAN_NOT_REPORTED'},
    positionCoverage: (() => {
      // The two counts have to come from the same reconciliation pass, otherwise "local == remote" is
      // true by construction. `exchangePositions` is what that pass last saw at the exchange.
      const remote = reconciliation ? Number(reconciliation.exchangePositions ?? Number.NaN) : Number.NaN;
      const local = s.positions.size;
      const compared = Number.isFinite(remote);
      return {status: !compared ? 'UNKNOWN' as const : remote === local ? 'HEALTHY' as const : 'DEGRADED' as const,
        local, remote: compared ? Math.max(0, remote) : 0,
        detail: compared ? `local=${local};remote=${remote}` : 'RECONCILIATION_HAS_NOT_REPORTED_POSITION_COUNT'};
    })(),
    fillCycleConservation: {status: inconsistent + unconserved > 0 ? 'DEGRADED' as const
      : conservedRecords > 0 ? 'HEALTHY' as const : 'UNKNOWN' as const,
      ledgerInconsistent: inconsistent, unconserved, conserved: conservedRecords, openConserved, unproven: unprovenRecords,
      detail: `records=${records.length};conserved=${conservedRecords}(open ${openConserved}/closed ${conservedRecords - openConserved});inconsistent=${inconsistent};unconserved=${unconserved};unproven=${unprovenRecords}`},
    fundingCoverage: {status: fundingLedger?.complete ? 'HEALTHY' as const : fundingExact > 0 ? 'PARTIAL' as const : 'UNKNOWN' as const,
      recordsWithExactFunding: fundingExact, recordsUnknown: fundingUnknown,
      incomeRows: Math.max(0, Number(fundingLedger?.rows ?? 0)), coverageComplete: fundingLedger?.complete === true,
      detail: fundingLedger ? `coverage=${fundingLedger.complete?'COMPLETE':'INCOMPLETE'};since=${fundingLedger.coveredSinceMs??'NONE'}` : 'FUNDING_LEDGER_NOT_ATTACHED'},
    reviewAuthority: {status: coordination.positionReviewEnabled !== true ? 'DISABLED' as const : (reviewRunner ? 'HEALTHY' as const : 'UNKNOWN' as const),
      enabled: coordination.positionReviewEnabled === true, aiActiveCycles,
      scheduledDue: Math.max(0, Number((runtime as any).positionReviewScheduler?.dueCount?.() ?? 0)),
      lastOutcome: reviewOutcome ?? null,
      reviewFairness: (runtime as any).ai?.reviewFairness?.(now) ?? null,
      detail: ai?.detail ? String(ai.detail).slice(0, 200) : null},
    reviewCycles: reviewReadback?.rows?.slice(0, 50) ?? [],
    activeCommissions: {
      remoteConfirmedEntry: entryRows.filter(row => ['NEW','WORKING','PARTIALLY_FILLED'].includes(String(row.status))).filter(confirmed).length,
      // P7: a take-profit the engine's own order row calls WORKING is not the same claim as one the
      // exchange has answered for. Applying the entry-side confirmation rule here keeps "TP orders"
      // meaning "the exchange says these are live" instead of "we last wrote WORKING".
      remoteConfirmedTakeProfit: tpRows.filter(row => row.status === 'WORKING' || row.status === 'PARTIALLY_FILLED').filter(confirmed).length,
      takeProfitRowsHeldLocally: tpRows.filter(row => row.status === 'WORKING' || row.status === 'PARTIALLY_FILLED').length,
      manual: manualRows.filter(row => ['NEW','WORKING','PARTIALLY_FILLED','SUBMITTING'].includes(String(row.status))).length,
      // Historical UNKNOWN rows are a local accounting exposure, not orders the exchange says are live.
      localUnresolvedUnknown: entryRows.filter(row => row.status === 'UNKNOWN').length + tpRows.filter(row => row.status === 'UNKNOWN').length + manualRows.filter(row => row.status === 'UNKNOWN').length,
    },
  };
}

function baseDashboardProjection(runtime: EngineRuntime): DashboardSnapshot {
  const s = runtime.state,
    now = Date.now(),
    since = now - 3600000,
    unreal = s.account.unrealizedPnlUsd ?? null,
    activeEntries = activeEntryOrdersForProjection(s.entryOrders.values(), now),
    activeTps = [...s.tpOrders.values()].filter(
      (order) => order.status === "WORKING",
    ),
    closed = [...s.tradeRecords.values()].filter(record=>canonicalPnlEligible(record,runtime.qualityObserver?.readContext()).eligible),
    closedExFunding = [...s.tradeRecords.values()].filter(record=>ledgerClosedComplete(record).eligible),
    net = closed.reduce((sum, record) => sum + (record.netPnl ?? 0), 0),
    tradingNetExFunding = closedExFunding.reduce(
      (sum, record) => sum + (record.tradingNetPnlExFunding ?? 0),
      0,
    ),
    fills = s.executionFills.filter((fill: any) => fill.executionTime >= since),
    // P2/R5: the gap an operator must act on is a fill that references an order this engine owns but
    // that the attribution pass could not prove. Provenance is now a recorded fact on the fill, so a
    // `v396x...` take-profit fill is no longer counted as external merely because its id shape is new.
    systemOrderKeys = new Set(
      [...s.entryOrders.values(), ...s.tpOrders.values(), ...s.manualOrders.values()]
        .flatMap((order: any) => [order.id, order.exchangeOrderId, order.clientOrderId])
        .filter(Boolean)
        .map(String),
    ),
    provenanceOf = (fill: any) => String(fill.provenanceSource ?? 'UNPROVEN'),
    referencesSystemOrder = (fill: any) =>
      provenanceOf(fill) !== 'UNPROVEN' ||
      systemOrderKeys.has(String(fill.orderId ?? '')) ||
      systemOrderKeys.has(String(fill.clientOrderId ?? '')),
    fillsByProvenance = fills.reduce<Record<string, number>>((tally, fill: any) => {
      const key = provenanceOf(fill);
      tally[key] = (tally[key] ?? 0) + 1;
      return tally;
    }, {}),
    entryFills = fills.filter(
      (fill: any) => fill.side === (fill.direction === "LONG" ? "BUY" : "SELL"),
    ),
    exitFills = fills.length - entryFills.length,
    attributed = fills.filter(
      (fill: any) => fill.attributionStatus === "SYSTEM_ATTRIBUTED",
    ).length,
    unattributed = fills.filter(
      (fill: any) => fill.attributionStatus === "EXTERNAL_OR_UNLINKED",
    ).length,
    systemFillAttributionGap = fills.filter(
      (fill: any) =>
        fill.attributionStatus === "EXTERNAL_OR_UNLINKED" &&
        referencesSystemOrder(fill),
    ).length,
    closedHour = closed.filter(
      (record: any) => (record.closedAt ?? 0) >= since,
    ),
    positions = [...s.positions.values()].map((p) => ({
      symbol: String(p.symbol),
      side: p.side as "LONG" | "SHORT",
      quantity: Number(p.quantity),
      markPrice: Number(p.markPrice),
      leverage: Number(p.leverage),
    })),
    portfolio = exposure(
      positions,
      s.account.assets,
      s.settings.portfolioIntelligence,
    ),
    tierDistribution: Record<string, number> = {},
    policyDistribution: Record<string, number> = {};
  for (const c of s.universe) {
    if (c.riskTier)
      tierDistribution[c.riskTier] = (tierDistribution[c.riskTier] ?? 0) + 1;
    if (c.directionPolicy)
      policyDistribution[c.directionPolicy] =
        (policyDistribution[c.directionPolicy] ?? 0) + 1;
  }
  const aiResources=runtime.ai.resourceMetrics().map((resource:any)=>directionalDecision(resource.lastDecision)?resource:{...resource,lastDirection:null});
  const recentAiRuns=s.aiRuns.slice(0,30).map(({inputPreview:_input,outputPreview:_output,normalizedPreview:_normalized,failure,...run})=>({
    ...run,direction:directionalDecision(run.decision)?run.direction:null,
    failure:failure?{...failure,rawOutput:null}:failure,
  })).sort(byOpenedAtDesc);
  return DashboardSnapshotSchema.parse({
    ts: now,
    account: {
      ...s.account,
      realizedPnlUsd24h: s.account.realizedPnlUsd24h ?? null,
      assets: s.account.assets ?? [],
      unrealizedPnlUsd: unreal,
      activePositions: s.positions.size,
      pendingEntries: activeEntries.length,
      activeEntryOrders: activeEntries.length,
      activeTpOrders: activeTps.length,
    },
    tradeNetPnl: closed.length ? net : 0,
    tradeCompletedCount: closed.length,
    tradeTradingNetExFunding: tradingNetExFunding,
    tradeCompletedExFundingCount: closedExFunding.length,
    tradeFundingUnknownCount: closedExFunding.filter(
      (record) => record.fundingAttributionStatus !== "EXACT",
    ).length,
    tradeActivity: s.activity,
    exchangeFillFacts: {
      entryFillsLast1h: entryFills.length,
      exitFillsLast1h: exitFills,
      closedTradesLast1h: closedHour.length,
      netPnlLast1h: closedHour.reduce(
        (n: number, row: any) => n + (row.netPnl ?? 0),
        0,
      ),
      exchangeFillsLast1h: fills.length,
      attributedFillsLast1h: attributed,
      unattributedFillsLast1h: unattributed,
      externalFillsLast1h: unattributed,
      systemFillAttributionGapLast1h: systemFillAttributionGap,
      systemFillParityAlert: systemFillAttributionGap > 0,
      // P2: raw exchange fills, provenance breakdown and closed-trade accounting are three different
      // questions. Reporting only one of them is what made an external label look like a missing exit.
      fillsByProvenanceLast1h: fillsByProvenance,
      tradeRecordLag: Math.max(0, attributed - closedHour.length),
    },
    // P2: the physical-cycle accounting readback. The contract declares this at the top level, and a
    // key the snapshot schema does not declare is dropped on parse - which is exactly how a projected
    // fact can exist in code and never reach the page.
    positionCycleFacts: {
      records: [...s.tradeRecords.values()].length,
      lotsRecorded: [...s.tradeRecords.values()].reduce((sum, record) => sum + ((record as any).entryLots?.length ?? 0), 0),
      ledgerInconsistent: [...s.tradeRecords.values()].filter(record => (record as any).ledgerConservation === 'LEDGER_INCONSISTENT' || record.integrityFlags.includes('LEDGER_INCONSISTENT')).length,
      unconserved: [...s.tradeRecords.values()].filter(record => (record as any).ledgerConservation === 'UNCONSERVED').length,
      lotAllocation: [...s.tradeRecords.values()].reduce<Record<string, number>>((tally, record) => {
        const key = String((record as any).lotAllocationMethod ?? 'UNKNOWN');
        tally[key] = (tally[key] ?? 0) + 1;
        return tally;
      }, {}),
    },
    portfolioIntelligence: {
      ...portfolio,
      availableUsdt:
        s.account.assets.find((x) => x.asset === "USDT")?.availableBalance ??
        null,
      availableUsdc:
        s.account.assets.find((x) => x.asset === "USDC")?.availableBalance ??
        null,
      riskTierDistribution: tierDistribution,
      directionPolicyDistribution: policyDistribution,
      recentAllocationPlans: s.allocationPlans.size,
    },
    runtimeControl: s.runtimeControl,
    externalResearch: runtime.externalResearch?.metrics?.(),
    exitConvergence: (runtime as any).exitConvergenceHealth?.() ?? {available:false,reason:'EXIT_RUNTIME_NOT_ATTACHED'},
    executionTruth: executionTruthProjection(runtime, now),
    universe: {
      total: s.universe.length,
      eligible: s.universe.filter((x) => x.eligible && x.rank > 0).length,
      topN: s.settings.selection.universeTopN,
      generation: s.generation,
    },
    // `supply` is the canonical source-closure projection.  Keep the Phase A
    // candidate diagnostic as a backwards-compatible, read-only detail view.
    supply: runtime.supplyHealth(),
    candidateSupply: candidateSupplyHealth(s),
    pool: s.pool.list(),
    positions: [...s.positions.values()],
    entryOrders: activeEntries.sort((a, b) => b.updatedAt - a.updatedAt),
    tpOrders: activeTps.sort((a, b) => b.updatedAt - a.updatedAt),
    aiResources,
    recentAiRuns,
    health: runtime.health(),
    readiness: runtime.readinessProjection(),
    settings: s.settings,
  });
}

/** V3.9.3 economics overlay; no mutation/backfill/reconciliation is allowed here. */
export function dashboardProjection(runtime:EngineRuntime):DashboardSnapshot{
  const base=baseDashboardProjection(runtime),economics=projectTradeRecordSummary({records:[...runtime.state.tradeRecords.values()],asOf:Date.now(),...runtime.qualityObserver?.readContext()});
  return {...base,
    tradeNetPnl:economics.canonicalNetPnl??0,
    tradeCompletedCount:economics.canonicalPnlEligibleCount,
    tradeTradingNetExFunding:economics.tradingNetExFunding,
    tradeCompletedExFundingCount:economics.tradingNetExFundingEligibleCount,
    tradeFundingUnknownCount:economics.fundingUnknownCount,
    tradeQualityEconomics:economics,
  } as DashboardSnapshot;
}
