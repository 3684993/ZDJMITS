import { DashboardSnapshotSchema, type DashboardSnapshot } from '@zdj/contracts';

/**
 * Snapshot fixtures for dashboard component tests.
 *
 * These are built from the real `DashboardSnapshot` contract and run through
 * `DashboardSnapshotSchema.parse`, so a test cannot silently invent a shape the Engine does not send
 * (a hand-rolled object literal hides renamed or missing fields until the page renders `undefined`).
 */

const MINIMAL_SETTINGS = {
  settingsVersion: 1,
  connections: {
    proxy: { url: 'socks5h://127.0.0.1:7890' },
    exchange: {
      environment: 'TESTNET',
      productionBaseUrl: 'https://fapi.binance.com',
      testnetBaseUrl: 'https://testnet.binancefuture.com',
    },
  },
  aiResources: [{ id: 'primary-1', role: 'PRIMARY_BRAIN', baseUrl: 'http://127.0.0.1:8081/v1', model: 'qwen27b', maxConcurrency: 1, gpu: 'RTX4090' }],
  aiDutyRoutes: [
    { duty: 'ENTRY_PRIMARY', resourceId: 'primary-1', enabled: true, priority: 100 },
  ],
  selection: {
    mode: 'COMPREHENSIVE_MAINSTREAM',
    universeTopN: 120,
    poolTarget: 8,
    poolMax: 12,
    replacementDelta: 5,
    minQuoteVolumeUsd24h: 1_000_000,
    maxSpreadBps: 40,
    minDataCompleteness: 0.7,
  },
  entryProfile: 'BALANCED',
  directionReference: 'DEFAULT',
  leverage: { mode: 'DEFAULT' },
  portfolio: { maxPositions: 10, maxPendingEntries: 5, entryMarginUsd: 100 },
  ai: { scoutEnabled: true, secondBrainReview: 'SELECTIVE', maxEvidenceToolRounds: 1, maxEvidenceToolsPerRound: 2, minEvidenceCompleteness: 0.6, decisionTimeoutMs: 30_000 },
  entry: { absoluteTtlMinutes: 60, reviewIntervalSeconds: 30, maxReprices: 3, minReachability: 0.3, makerOffsetTicks: 1, minimumInitialMarginByQuote:{USDT:1,USDC:1}, minimumOrderNotionalByQuote:{USDT:200,USDC:200} },
  takeProfit: { enabled: true, mode: 'PRICE_MOVE_PERCENT', targetPriceMovePercent: 0.6, quantityPercent: 100 },
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function merge<T>(base: T, overrides: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) out[key] = merge(out[key] as never, value);
  return out as T;
}

/** One position row as the contract defines it; only the fields a test cares about are overridden. */
export function makePosition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return merge({
    id: 'pos_entry_cycle_1',
    cycleId: 'cycle_BTCUSDT_LONG_1',
    physicalCycleKey: 'TESTNET|BINANCE_USDM_TESTNET|BTCUSDT|LONG|cycle_BTCUSDT_LONG_1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    quantity: 0.5,
    entryPrice: 60_000,
    markPrice: 61_000,
    leverage: 10,
    unrealizedPnl: 500,
    unrealizedPnlPercent: 8.3,
    openedAt: 1_770_000_000_000,
    firstObservedAt: 1_770_000_000_000,
    entryTimeSource: 'SYSTEM_FILL',
    managementStatus: 'AUTO_MANAGED',
    humanManagedAt: null,
    lastAddAt: null,
    addCount: 0,
    lastReviewAt: null,
    nextReviewAt: null,
    tpStatus: 'PROTECTED',
    tpOrderId: 'tp_1',
    tpCoverageSource: 'BINANCE_OPEN_ORDER',
  }, overrides);
}

const EXECUTION_TRUTH = {
  evaluatedAt: 1_770_000_000_000,
  exchangeIngestion: { status: 'HEALTHY', detail: '{"fresh":320,"total":320,"gaps":0}' },
  orderTerminalParity: { status: 'HEALTHY', mismatchCount: 0, detail: 'lastRunAt=1770000000000;drift=0;unresolved=0' },
  exitClaimConvergence: { status: 'DEGRADED', openTasks: 3, terminalUnreleasedClaims: 1, oldestUnpolledAgeMs: 900_000, detail: 'queue=3;eligible=1;batch=4;interval=5000;maxService=300000' },
  takeProfitCoverage: { status: 'HEALTHY', required: 2, protected: 2, missing: 0, unresolved: 0, detail: '{"missing":0,"positionFactUnresolved":0}' },
  positionCoverage: { status: 'HEALTHY', local: 2, remote: 2, detail: null },
  fillCycleConservation: { status: 'HEALTHY', ledgerInconsistent: 0, unconserved: 0, detail: 'records=7' },
  fundingCoverage: { status: 'PARTIAL', recordsWithExactFunding: 5, recordsUnknown: 2, incomeRows: 4, coverageComplete: false, detail: 'coverage=INCOMPLETE;since=NONE' },
  reviewAuthority: { status: 'DISABLED', enabled: false, aiActiveCycles: 0, scheduledDue: 0, lastOutcome: null, detail: 'review disabled by governance' },
  activeCommissions: { remoteConfirmedEntry: 1, remoteConfirmedTakeProfit: 2, manual: 0, localUnresolvedUnknown: 4 },
};

const EXIT_CONVERGENCE = {
  available: true,
  reason: null,
  evaluatedAt: 1_770_000_000_000,
  openTasks: 3,
  eligibleNow: 1,
  neverPolled: 1,
  oldestUnpolledAgeMs: 900_000,
  nextEligibleAt: 1_770_000_005_000,
  terminalUnreleasedClaims: 1,
  unreleasedClaims: 2,
  batchLimit: 4,
  intervalMs: 5_000,
  maxServiceIntervalMs: 300_000,
  fullWalkRounds: 2,
  fairness: 'ROUND_ROBIN',
};

const BASE = {
  ts: 1_770_000_000_000,
  snapshotVersion: 12,
  asOf: 1_770_000_000_000,
  reconciliation: { state: 'SETTLED', verifiedOrderFactMismatchCount: 0 },
  account: {
    status: 'READY',
    source: 'BINANCE_USDM_TESTNET',
    asOf: 1_770_000_000_000,
    reason: null,
    equityUsd: 19_685.67,
    availableUsd: 8_834.44,
    walletBalanceUsd: 10_444.31,
    unrealizedPnlUsd: 620.4,
    realizedPnlUsd24h: 88.1,
    assets: [
      { asset: 'USDT', walletBalance: 5_473.13, availableBalance: 3_861.56, crossWalletBalance: 5_473.13, unrealizedPnl: 80.2, usdValue: 5_473.13, marginEligible: true },
      { asset: 'USDC', walletBalance: 4_981.18, availableBalance: 4_972.88, crossWalletBalance: 4_981.18, unrealizedPnl: 0, usdValue: 4_981.18, marginEligible: true },
    ],
    activePositions: 2,
    pendingEntries: 0,
    activeEntryOrders: 1,
    activeTpOrders: 2,
  },
  universe: { total: 320, eligible: 42, topN: 120, generation: 3 },
  pool: [],
  positions: [
    makePosition(),
    makePosition({
      id: 'pos_entry_cycle_2',
      cycleId: 'cycle_ETHUSDT_SHORT_1',
      physicalCycleKey: 'TESTNET|BINANCE_USDM_TESTNET|ETHUSDT|SHORT|cycle_ETHUSDT_SHORT_1',
      symbol: 'ETHUSDT',
      side: 'SHORT',
      quantity: 4,
      entryPrice: 3_000,
      markPrice: 2_980,
      unrealizedPnl: 80,
      unrealizedPnlPercent: 1.3,
      openedAt: 0,
      firstObservedAt: 1_769_900_000_000,
      entryTimeSource: 'IMPORTED_AT_STARTUP',
      tpStatus: 'PENDING',
      tpOrderId: null,
      tpCoverageSource: 'NONE',
    }),
  ],
  entryOrders: [],
  tpOrders: [],
  aiResources: [],
  recentAiRuns: [],
  health: [
    { id: 'market', label: '行情中心', status: 'HEALTHY', detail: '{"fresh":320,"total":320,"gaps":0}', updatedAt: 1_770_000_000_000 },
    { id: 'tp', label: '止盈保护', status: 'HEALTHY', detail: '{"missing":0}', updatedAt: 1_770_000_000_000 },
  ],
  readiness: { overall: 'READY', privateDataStatus: 'READY', reason: null },
  settings: MINIMAL_SETTINGS,
  tradeNetPnl: 88.1,
  tradeCompletedCount: 5,
  tradeTradingNetExFunding: 80.1,
  tradeCompletedExFundingCount: 5,
  tradeFundingUnknownCount: 1,
  exchangeFillFacts: {
    entryFillsLast1h: 2,
    exitFillsLast1h: 1,
    closedTradesLast1h: 1,
    netPnlLast1h: 42.5,
    exchangeFillsLast1h: 4,
    attributedFillsLast1h: 3,
    unattributedFillsLast1h: 1,
    externalFillsLast1h: 1,
    systemFillAttributionGapLast1h: 0,
    systemFillParityAlert: false,
    tradeRecordLag: 1,
    fillsByProvenanceLast1h: { SYSTEM_ORDER_LINK: 2, UNPROVEN: 1, EXTERNAL_AUDIT: 1 },
  },
  positionCycleFacts: { records: 7, lotsRecorded: 9, ledgerInconsistent: 0, unconserved: 0, lotAllocation: { PER_LOT: 5, PRO_RATA: 2 } },
  exitConvergence: EXIT_CONVERGENCE,
  executionTruth: EXECUTION_TRUTH,
  runtimeControl: undefined,
  externalResearch: undefined,
};

/** A contract-valid `DashboardSnapshot`; nested overrides are merged, arrays are replaced. */
export function makeDashboardSnapshot(overrides: Record<string, unknown> = {}): DashboardSnapshot {
  return DashboardSnapshotSchema.parse(merge(BASE, overrides));
}

export const FIXTURE_NOW = 1_770_000_000_000;
