/**
 * S09: the offline replay and event/cost simulator.
 *
 * It exists to answer one question without touching a live account: when the same frozen market event
 * stream is run through the same rules twice, does the account still look good once every cost, delay
 * and unresolved state is counted? The pieces that make that question meaningful are the boring ones:
 *
 *  - nothing is visible before its own `availableAt`, so news or a final corrected candle cannot leak
 *    backwards into the decision that should not have known it;
 *  - a bar that crossed both the target and the loss line inside itself is reported as a *pair* of
 *    bounds, never as the favourable one;
 *  - a lost acknowledgement leaves the cycle open with its capital still occupied, and a handoff that
 *    nobody answers stays right-censored instead of vanishing from the denominator;
 *  - delisting, liquidation before target, partial fills and re-delivered messages are modelled, so a
 *    result that ignores them cannot claim to describe tail safety.
 */

export type ReplayEvent = {
  id: string;
  /** When the fact became observable to a consumer, not when it was produced. */
  availableAt: number;
  kind: 'QUOTE' | 'BAR' | 'FUNDING' | 'DELIST_NOTICE' | 'LIQUIDATION' | 'EXIT_ACK_LOST' | 'EXIT_FACT';
  symbol: string;
  payload: { bid?: number; ask?: number; mark?: number; high?: number; low?: number; close?: number; fundingRate?: number; quantityFilled?: number };
};

export type SimCycle = {
  cycleId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  openedAt: number;
  /** Event ids the entry decision actually used, so their availability can be audited afterwards. */
  entryEvidenceIds: string[];
  entryPrice: number;
  quantity: number;
  marginUsd: number;
  targetPrice: number;
  /** Where the AI's realised-loss permission line sits, in USDT (negative). */
  lossPermissionUsd: number;
  horizonMs: number;
  fundingIntervalMs: number;
  liquidationPrice: number | null;
  stepSize: number;
  tickSize: number;
  /** Where the plan came from: an archived model answer, or a fresh inference during the replay. */
  planSource: 'REPLAY_RESPONSE' | 'FRESH_INFERENCE';
};

export type CostModel = { makerRate: number; takerRate: number; slippageBps: number; modelLatencyMs: number; fundingSign: 'APPLIED' | 'UNKNOWN' };

export type HumanScenario = { id: string; responseMs: number | null };

export type CycleStatus = 'CLOSED_TARGET' | 'CLOSED_LOSS_LINE' | 'CLOSED_DELIST' | 'LIQUIDATED' | 'HANDOFF_RESOLVED' | 'CENSORED_OPEN' | 'UNRESOLVED_ACK';

export type ReplayCycle = {
  cycleId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  status: CycleStatus;
  resolvedAt: number | null;
  holdingMs: number;
  grossPnlUsd: number | null;
  feesUsd: number | null;
  fundingUsd: number | null;
  slippageUsd: number | null;
  netPnlUsd: number | null;
  /** Cost facts the stream could not supply. netPnlUsd stays null when this is non-empty. */
  unresolvedCosts: string[];
  intraBarAmbiguous: boolean;
  optimisticNetUsd: number | null;
  partialFills: number;
  ackLoss: boolean;
  capitalUsd: number;
  planSource: SimCycle['planSource'];
  guardedFutureEvents: number;
  duplicateEvents: number;
  reorderedEvents: number;
};

export type ReplayAccount = {
  startEquityUsd: number;
  finalEquityUsd: number;
  accountNetReturnPct: number | null;
  realisedNetUsd: number | null;
  /** How many cycles have no net figure at all. They stay in every denominator. */
  unresolvedCycles: number;
  maxDrawdownPct: number | null;
  tailLossUsd: number | null;
  capitalUsageUsdSeconds: number;
  openAgeMsP95: number | null;
  handoffBacklog: number;
  exitSlippageBpsAvg: number | null;
  modelCostMsTotal: number;
  cycles: number;
  resolvedCycles: number;
  censoredCycles: number;
  coverageRatio: number;
  costsComplete: boolean;
};

export type ReplayResult = {
  scenarioId: string;
  humanScenarioId: string;
  cycles: ReplayCycle[];
  account: ReplayAccount;
  equityPath: Array<{ at: number; equityUsd: number }>;
  invariants: { futureLeakageEvents: number; duplicateDeliveries: number; outOfOrderDeliveries: number; unclosedLossesKept: number };
};

const priceOf = (event: ReplayEvent) => event.payload.mark ?? event.payload.close ?? event.payload.bid ?? event.payload.ask ?? null;
const crossedTarget = (cycle: SimCycle, price: number) => cycle.side === 'LONG' ? price >= cycle.targetPrice : price <= cycle.targetPrice;
const crossedLoss = (cycle: SimCycle, price: number) => cycle.side === 'LONG'
  ? price <= cycle.entryPrice * (1 + cycle.lossPermissionUsd / Math.max(1e-9, cycle.marginUsd))
  : price >= cycle.entryPrice * (1 - cycle.lossPermissionUsd / Math.max(1e-9, cycle.marginUsd));

/** One cycle against the frozen stream. Everything it cannot know is reported, not estimated. */
export function replayCycle(cycle: SimCycle, stream: ReplayEvent[], costs: CostModel, human: HumanScenario, observedUntilMs?: number): ReplayCycle {
  // The stream arrives in delivery order. Reorder and duplicate counts are measured there, before this
  // function puts the events into causal order for itself - otherwise both would always read zero and
  // the report would claim a clean feed that nobody had checked.
  const delivered = stream.filter(event => event.symbol === cycle.symbol);
  const owned = [...delivered].sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const sign = cycle.side === 'LONG' ? 1 : -1;
  const seen = new Set<string>();
  const unresolvedCosts: string[] = costs.fundingSign === 'UNKNOWN' ? ['FUNDING_SIGN_UNKNOWN'] : [];
  let remaining = cycle.quantity, realizedGross = 0, fees = cycle.entryPrice * cycle.quantity * costs.makerRate;
  let funding = 0, slippage = 0, resolvedAt: number | null = null, partialFills = 0, ackLoss = false;
  let ambiguous = false, optimistic: number | null = null, guarded = 0;
  let status: CycleStatus = 'CENSORED_OPEN';

  const settle = (price: number, quantity: number, rate: number, slip = true) => {
    realizedGross += sign * (price - cycle.entryPrice) * quantity;
    fees += quantity * price * rate;
    if (slip) slippage += quantity * price * costs.slippageBps / 10_000;
    remaining -= quantity;
  };
  const done = () => finish({ cycle, resolvedAt, status, realizedGross: remaining > 0 ? null : realizedGross, fees, funding, slippage,
    ambiguous, optimistic, partialFills, ackLoss, unresolvedCosts, guarded,
    duplicates: delivered.length - new Set(delivered.map(event => event.id)).size,
    reordered: delivered.filter((event, index) => index > 0 && event.availableAt < delivered[index - 1].availableAt).length,
    observedUntilMs });

  for (const event of owned) {
    if (event.availableAt < cycle.openedAt) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.kind === 'EXIT_FACT' && remaining > 0) {
      settle(priceOf(event) ?? cycle.entryPrice, Math.min(remaining, Math.max(0, Number(event.payload.quantityFilled ?? remaining))), costs.takerRate);
      // An exit proven by an exchange fact after a lost acknowledgement is still that exit; the flag
      // records that the acknowledgement had to be recovered rather than received.
      if (remaining <= 0) { status = 'CLOSED_TARGET'; resolvedAt = event.availableAt; return done(); }
      continue;
    }
    if (event.kind === 'EXIT_ACK_LOST') { ackLoss = true; status = 'UNRESOLVED_ACK'; continue; }
    if (event.kind === 'FUNDING') {
      const intervals = Math.max(0, Math.floor((event.availableAt - cycle.openedAt) / Math.max(1, cycle.fundingIntervalMs)));
      if (costs.fundingSign === 'APPLIED') funding += intervals * (event.payload.fundingRate ?? 0) * cycle.entryPrice * remaining;
      continue;
    }
    if (remaining <= 0) continue;
    const mark = priceOf(event);
    if (event.kind === 'LIQUIDATION') {
      // Liquidation is a total loss of the posted margin, not a mark-to-market exit: it also proves the
      // "did the target come first?" question was answered against the position.
      status = 'LIQUIDATED'; resolvedAt = event.availableAt; remaining = 0;
      realizedGross = -cycle.marginUsd;
      return done();
    }
    if (event.kind === 'DELIST_NOTICE') {
      status = 'CLOSED_DELIST'; resolvedAt = event.availableAt;
      settle(mark ?? cycle.entryPrice, remaining, costs.takerRate);
      return done();
    }
    if (mark == null || event.kind !== 'BAR') continue;
    const high = event.payload.high ?? mark, low = event.payload.low ?? mark;
    const hitTarget = crossedTarget(cycle, cycle.side === 'LONG' ? high : low);
    const hitLoss = crossedLoss(cycle, cycle.side === 'LONG' ? low : high);
    if (hitTarget && hitLoss) {
      // Intra-bar order is unknown, so the answer is a pair: the pessimistic branch is the number that
      // is reported and the optimistic one rides along as a bound on how much that ambiguity is worth.
      ambiguous = true;
      optimistic = sign * (cycle.targetPrice - cycle.entryPrice) * remaining;
      status = 'CLOSED_LOSS_LINE'; resolvedAt = event.availableAt;
      settle(cycle.side === 'LONG' ? low : high, remaining, costs.takerRate);
      return done();
    }
    if (hitTarget) {
      const requested = event.payload.quantityFilled != null ? Math.min(remaining, event.payload.quantityFilled) : remaining;
      if (requested < remaining) partialFills++;
      settle(cycle.targetPrice, Math.max(1e-12, requested), costs.makerRate, false);
      if (remaining <= 0) { status = 'CLOSED_TARGET'; resolvedAt = event.availableAt; return done(); }
      continue;
    }
    if (hitLoss) {
      status = 'CLOSED_LOSS_LINE'; resolvedAt = event.availableAt;
      settle(cycle.side === 'LONG' ? low : high, remaining, costs.takerRate);
      return done();
    }
  }
  if (resolvedAt == null) {
    // The plan's own horizon ends AI management. What happens next belongs to the human scenario, and a
    // scenario where nobody answers leaves the cycle right-censored with its capital still occupied.
    const handoffAt = cycle.openedAt + cycle.horizonMs + costs.modelLatencyMs;
    if (human.responseMs == null) { if (!ackLoss) status = 'CENSORED_OPEN'; return done(); }
    const price = owned.filter(event => event.availableAt <= handoffAt + human.responseMs).map(priceOf).filter((value): value is number => value != null).pop() ?? cycle.entryPrice;
    settle(price, remaining, costs.takerRate);
    status = 'HANDOFF_RESOLVED'; resolvedAt = handoffAt + human.responseMs;
  }
  return done();
}

function finish(input: {
  cycle: SimCycle; resolvedAt: number | null; status: CycleStatus; realizedGross: number | null; fees: number; funding: number;
  slippage: number; ambiguous: boolean; optimistic: number | null; partialFills: number; ackLoss: boolean;
  unresolvedCosts: string[]; guarded: number; duplicates: number; reordered: number; observedUntilMs?: number;
}): ReplayCycle {
  const { cycle, status, resolvedAt, realizedGross } = input;
  const costsKnown = realizedGross != null && input.unresolvedCosts.length === 0;
  // A cycle that never resolved was still occupying margin the whole time it was observed; measuring it
  // as zero holding would remove the very cost an unclosed deep loss is supposed to show. The plan's own
  // management horizon is a known lower bound, so it is used when the observation ends earlier.
  const heldUntil = resolvedAt ?? Math.max(cycle.openedAt, input.observedUntilMs ?? 0, cycle.openedAt + cycle.horizonMs);
  return {
    cycleId: cycle.cycleId, symbol: cycle.symbol, side: cycle.side, status,
    resolvedAt: costsKnown ? resolvedAt : null,
    holdingMs: Math.max(0, heldUntil - cycle.openedAt),
    grossPnlUsd: costsKnown ? realizedGross : null,
    feesUsd: costsKnown ? input.fees : null,
    fundingUsd: costsKnown ? input.funding : null,
    slippageUsd: costsKnown ? input.slippage : null,
    netPnlUsd: costsKnown ? realizedGross - input.fees - input.funding - input.slippage : null,
    unresolvedCosts: input.unresolvedCosts,
    intraBarAmbiguous: input.ambiguous,
    optimisticNetUsd: costsKnown && input.optimistic != null ? input.optimistic - input.fees - input.funding - input.slippage : null,
    partialFills: input.partialFills,
    ackLoss: input.ackLoss,
    capitalUsd: cycle.marginUsd,
    planSource: cycle.planSource,
    guardedFutureEvents: input.guarded,
    duplicateEvents: input.duplicates,
    reorderedEvents: input.reordered,
  };
}

/** Full account over a set of cycles sharing one frozen stream. */
export function replayScenario(input: { scenarioId: string; human: HumanScenario; cycles: SimCycle[]; stream: ReplayEvent[]; costs: CostModel; startEquityUsd: number; asOf: number; observedUntilMs?: number }): ReplayResult {
  const observedUntil = input.observedUntilMs ?? Math.max(input.asOf, ...input.stream.map(event => event.availableAt));
  const cycles = input.cycles.map(cycle => replayCycle(cycle, input.stream, input.costs, input.human, observedUntil));
  const closed = [...cycles].filter(cycle => cycle.resolvedAt != null).sort((a, b) => Number(a.resolvedAt) - Number(b.resolvedAt));
  const equityPath: Array<{ at: number; equityUsd: number }> = [{ at: input.asOf, equityUsd: input.startEquityUsd }];
  let equity = input.startEquityUsd, peak = equity, maxDrawdown = 0;
  for (const cycle of closed) {
    equity += cycle.netPnlUsd ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    equityPath.push({ at: Number(cycle.resolvedAt), equityUsd: equity });
  }
  const realised = cycles.filter(cycle => cycle.netPnlUsd != null);
  const unresolved = cycles.filter(cycle => cycle.netPnlUsd == null);
  const tails = realised.map(cycle => Number(cycle.netPnlUsd)).sort((a, b) => a - b);
  const worstCount = Math.max(1, Math.ceil(tails.length / 10));
  const ages = cycles.map(cycle => cycle.holdingMs).sort((a, b) => a - b);
  const slipped = cycles.filter(cycle => cycle.slippageUsd != null && Number(cycle.grossPnlUsd) !== 0);
  return {
    scenarioId: input.scenarioId, humanScenarioId: input.human.id, cycles,
    account: {
      startEquityUsd: input.startEquityUsd, finalEquityUsd: equity,
      accountNetReturnPct: unresolved.length || realised.length !== cycles.length ? null : (equity - input.startEquityUsd) / input.startEquityUsd * 100,
      realisedNetUsd: realised.length ? realised.reduce((sum, cycle) => sum + Number(cycle.netPnlUsd), 0) : null,
      unresolvedCycles: unresolved.length,
      maxDrawdownPct: closed.length ? maxDrawdown * 100 : null,
      tailLossUsd: tails.length ? tails.slice(0, worstCount).reduce((sum, value) => sum + value, 0) / worstCount : null,
      capitalUsageUsdSeconds: cycles.reduce((sum, cycle) => sum + cycle.capitalUsd * (cycle.holdingMs / 1000), 0),
      openAgeMsP95: ages.length ? ages[Math.min(ages.length - 1, Math.floor(ages.length * 0.95))] : null,
      handoffBacklog: cycles.filter(cycle => cycle.status === 'CENSORED_OPEN' || cycle.status === 'UNRESOLVED_ACK').length,
      exitSlippageBpsAvg: slipped.length ? slipped.reduce((sum, cycle) => sum + Number(cycle.slippageUsd), 0) / Math.max(1e-9, slipped.reduce((sum, cycle) => sum + Math.abs(Number(cycle.grossPnlUsd)), 0)) * 10_000 : null,
      modelCostMsTotal: cycles.length * input.costs.modelLatencyMs,
      cycles: cycles.length, resolvedCycles: realised.length, censoredCycles: unresolved.length,
      coverageRatio: cycles.length ? realised.length / cycles.length : 0,
      costsComplete: cycles.every(cycle => cycle.unresolvedCosts.length === 0),
    },
    equityPath,
    invariants: {
      futureLeakageEvents: cycles.reduce((sum, cycle) => sum + cycle.guardedFutureEvents, 0),
      duplicateDeliveries: cycles.reduce((sum, cycle) => sum + cycle.duplicateEvents, 0),
      outOfOrderDeliveries: cycles.reduce((sum, cycle) => sum + cycle.reorderedEvents, 0),
      unclosedLossesKept: cycles.filter(cycle => cycle.netPnlUsd == null).length,
    },
  };
}

/**
 * The entry facts must have been knowable at entry time. A corrected final candle, a news item, or a
 * memory row that only existed later cannot support a decision made before it: this is the check that
 * turns "the backtest was great" into "the backtest was impossible".
 */
export function detectFutureAvailabilityViolation(cycles: SimCycle[], stream: ReplayEvent[]) {
  const byId = new Map(stream.map(event => [event.id, event]));
  const violations: string[] = [];
  for (const cycle of cycles) for (const id of cycle.entryEvidenceIds ?? []) {
    const event = byId.get(id);
    if (!event) { violations.push(`ENTRY_EVIDENCE_UNRESOLVED:${cycle.cycleId}:${id}`); continue; }
    if (event.availableAt > cycle.openedAt) violations.push(`FUTURE_DATA_LEAKAGE:${cycle.cycleId}:${id}@${event.availableAt}>${cycle.openedAt}`);
  }
  return { violations, checked: cycles.reduce((sum, cycle) => sum + (cycle.entryEvidenceIds?.length ?? 0), 0) };
}

/**
 * Which split a cycle belongs to is decided at the moment of the decision, and its evaluation window
 * must not reach across the boundary into the next set. A cycle that never resolves is reported as
 * censored rather than dropped, because dropping it would quietly delete the unprofitable tail.
 */
export function validateSplitIntegrity(splits: { trainEnd: number; validationEnd: number; finalTestEnd: number }, embargoMs: number,
  cycles: Array<SimCycle & { horizonMs: number }>, resolvedAtById: Record<string, number | null> = {}) {
  const boundaryAfter = (decisionAt: number) => (decisionAt <= splits.trainEnd ? splits.trainEnd
    : decisionAt <= splits.validationEnd ? splits.validationEnd : splits.finalTestEnd);
  const violations: string[] = [], censored: string[] = [];
  for (const cycle of cycles) {
    const evaluationEnd = resolvedAtById[cycle.cycleId] ?? cycle.openedAt + cycle.horizonMs;
    const boundary = boundaryAfter(cycle.openedAt);
    if (evaluationEnd > boundary - embargoMs) violations.push(`SPLIT_STRADDLE:${cycle.cycleId}:eval_end=${evaluationEnd}>boundary=${boundary}-embargo=${embargoMs}`);
    if (resolvedAtById[cycle.cycleId] == null) censored.push(cycle.cycleId);
  }
  if (splits.finalTestEnd <= splits.validationEnd || splits.validationEnd <= splits.trainEnd) violations.push('SPLIT_ORDER_INVALID');
  return { violations, censored };
}
