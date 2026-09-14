import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "@zdj/contracts";
import type { EngineRuntime } from "../runtime/appRuntime.js";
import { exposure, resolveUnderlying } from "@zdj/core";
import { createHash } from 'node:crypto';
import { byOpenedAtDesc } from './chronologicalSort.js';
import { candidateSupplyHealth } from '../services/candidateSupplyHealth.js';
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
const directionalDecision=(decision:unknown)=>['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE'].includes(String(decision??''));
export function dashboardProjection(runtime: EngineRuntime): DashboardSnapshot {
  const s = runtime.state,
    now = Date.now(),
    since = now - 3600000,
    unreal = s.account.unrealizedPnlUsd ?? null,
    activeEntries = [...s.entryOrders.values()].filter((order) =>
      ["NEW", "SUBMITTING", "UNKNOWN", "WORKING", "PARTIALLY_FILLED"].includes(order.status),
    ),
    activeTps = [...s.tpOrders.values()].filter(
      (order) => order.status === "WORKING",
    ),
    closed = [...s.tradeRecords.values()].filter(
      (record) =>
        record.canonical &&
        record.classification === "COMPLETE" &&
        record.status === "CLOSED" &&
        record.recordCompleteness === "COMPLETE" &&
        record.feeCompleteness === "COMPLETE" && record.fundingAttributionStatus === "EXACT" && record.netPnl != null,
    ),
    closedExFunding = [...s.tradeRecords.values()].filter(
      (record) =>
        record.canonical &&
        record.classification === "COMPLETE" &&
        record.status === "CLOSED" &&
        record.recordCompleteness === "COMPLETE" &&
        record.feeCompleteness === "COMPLETE" &&
        record.tradingNetPnlExFunding != null,
    ),
    net = closed.reduce((sum, record) => sum + (record.netPnl ?? 0), 0),
    tradingNetExFunding = closedExFunding.reduce(
      (sum, record) => sum + (record.tradingNetPnlExFunding ?? 0),
      0,
    ),
    fills = s.executionFills.filter((fill: any) => fill.executionTime >= since),
    systemOrderKeys = new Set(
      [...s.entryOrders.values(), ...s.tpOrders.values(), ...s.manualOrders.values()]
        .flatMap((order: any) => [order.id, order.exchangeOrderId, order.clientOrderId])
        .filter(Boolean)
        .map(String),
    ),
    systemClientOrderId = /^(entry_|ml_|tp_|manual_|ma_|mr_|mc_|ec[0-9]*_)/i,
    referencesSystemOrder = (fill: any) =>
      systemClientOrderId.test(String(fill.clientOrderId ?? '')) ||
      systemOrderKeys.has(String(fill.orderId ?? '')) ||
      systemOrderKeys.has(String(fill.clientOrderId ?? '')),
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
      tradeRecordLag: Math.max(0, attributed - closedHour.length),
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
