import { isEntryQuoteAsset, quoteSuffixOf, type AllocationCapacityRoom } from '@zdj/contracts';
import { entryTradingCapital } from './capitalCapacity.js';
import type { BindingConstraint } from './executableRiskHeadroom.js';

/**
 * §B: one row per candidate and side, assembled only from facts the gates already computed. The point
 * of the trace is that "SHORT = $0" always arrives with the specific number that is too small and the
 * specific number it must clear — never with a bare label, and never with the exchange minimum blamed
 * for a shortage that some earlier fact caused.
 */

export type SideCapacityTrace = {
  symbol: string;
  underlying: string;
  side: 'LONG' | 'SHORT';
  quoteAsset: string;
  entryFundingEligible: boolean;
  referencePrice: number | null;
  exchangeFilters: {tickSize: number | null; stepSize: number | null; minQty: number | null; minNotional: number | null; factsComplete: boolean; reasons: string[]};
  minimumLegalNotionalUsd: number | null;
  leverage: number | null;
  leverageFact: string | null;
  funding: {availableBalanceUsd: number; reservedMarginUsd: number; executionLeaseMarginUsd: number; executableMarginUsd: number; policyMarginCapUsd: number; executableNotionalUsd: number; bindingConstraint: string};
  risk: {marginTierProven: boolean; portfolioRiskBlockersSeen: number; grossRemainingUsd: number; grossMode: string; grossEnforced: boolean; directionRemainingUsd: number; directionMode: string; directionEnforced: boolean;
    clusterRemainingUsd: number; clusterDirectionRemainingUsd: number; perTradeRiskRemainingUsd: number; portfolioRiskAllowed: boolean; portfolioRiskBlockers: string[];
    admissionCeilingUsd: number | null; admissionGate: string | null; admissionRefusal: string | null; admissionDetail: string | null};
  plan: {present: boolean; admission: string | null; reasons: string[]; recommendedNotionalUsd: number; minExecutableMarginUsd: number | null; capacityRoom: AllocationCapacityRoom | null};
  plannedNotionalUsd: number;
  finalNotionalBeforeRoundingUsd: number;
  rounded: {quantityUnits: number; legalNotionalUsd: number; stepSize: number | null; minQty: number | null};
  executable: boolean;
  blockers: string[];
  firstBindingConstraint: BindingConstraint | string;
  actualUsd: number | null;
  requiredUsd: number | null;
  explanation: string;
  evaluatedAt: number;
};

const numberOrNull = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : null);
const minimumConstraints = new Set(['MINIMUM_NOTIONAL', 'BELOW_MINIMUM_NOTIONAL']);

/**
 * The precedence order is the substance of §B2: everything that happens *before* a size can be
 * compared with the exchange floor must be named first, so the floor is only ever blamed for a
 * quantity that really was computed, really is finite, and really is below a verified minimum.
 */
export function classifySideCapacityBinding(input: {
  symbol: string; side: 'LONG' | 'SHORT'; executable: boolean; blockers: string[]; firstBindingConstraint: string | null;
  plannedNotionalUsd: number; finalNotionalUsd: number; minimumLegalNotionalUsd: number | null; exchangeFiltersComplete: boolean;
  planPresent: boolean; routePresent: boolean; marginTierProven: boolean; portfolioRiskAllowed: boolean; capitalBindingConstraint: string | null;
  capitalExecutableNotionalUsd?: number | null;
  planAdmission?: string | null; capacityRoom?: AllocationCapacityRoom | null;
  riskAdmission?: {ceilingUsd: number | null; refusal: string | null; gate: string | null; detail: string | null} | null;
}): {constraint: BindingConstraint | string; detail: string; actualUsd: number | null; requiredUsd: number | null} {
  const {symbol, side} = input;
  const verdict = (constraint: string, detail: string, actualUsd: number | null = null, requiredUsd: number | null = null) => ({constraint, detail, actualUsd, requiredUsd});
  // Facts that make a capacity claim impossible come first: no allowed funding asset, no route at all,
  // a risk layer that denied the candidate before sizing, no verified bracket row, no verified leverage.
  if (input.capitalBindingConstraint === 'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE') return verdict('QUOTE_ASSET_NOT_ENTRY_ELIGIBLE', `${symbol} 的计价资产 ${quoteSuffixOf(symbol)} 不在 Entry 资金白名单（仅 USDT/USDC）内`);
  if (!input.routePresent) return verdict(`NO_ROUTABLE_${side}_CANDIDATE`, `${symbol} 没有 ${side} 侧的可路由资本计划，容量尚未被任何数字压小`);
  // The gate's own verdict wins: an executable side is never relabelled by a fact that sits in front of
  // capacity, and those facts stay on the trace as annotations instead.
  if (input.executable) return verdict(input.firstBindingConstraint ?? 'EXECUTABLE_HEADROOM', `${symbol} ${side} 可执行`, input.finalNotionalUsd, null);
  // The committing gate speaks for itself, with its own numbers: a refusal that holds at every size is
  // named as that refusal, and a ceiling is stated as the room left against the floor it must clear.
  const refusal = input.riskAdmission?.refusal ?? null;
  if (refusal && !input.portfolioRiskAllowed) {
    return verdict(refusal, `组合准入在任何名义下拒绝 ${symbol} ${side}：${input.riskAdmission?.detail ?? refusal}；缩小订单不能通过这道门`, null, null);
  }
  if (!input.portfolioRiskAllowed && input.blockers.includes('REJECT_RISK_ADMISSION_CEILING')) {
    const ceiling = Number(input.riskAdmission?.ceilingUsd ?? 0), floor = input.minimumLegalNotionalUsd;
    return verdict('RISK_ADMISSION_CEILING',
      `${symbol} ${side}：组合准入上限只剩 ${ceiling.toFixed(2)} USD（${input.riskAdmission?.gate ?? '见逐门数值'}）${floor != null ? `，交易所最小合法名义 ${floor.toFixed(2)} USD` : ''}——资金充足，是现有敞口已占用该上限`,
      ceiling, floor);
  }
  if (!input.portfolioRiskAllowed) return verdict('PORTFOLIO_RISK_DENIED', `PortfolioRisk 在容量计算之前拒绝 ${symbol} 的新增风险`);
  if (!input.marginTierProven) return verdict(`MARGIN_TIER_SYMBOL_UNPROVEN:${symbol}`, `${symbol} 在 margin-tier 权威里没有已验证的 bracket 行`);
  if (input.capitalBindingConstraint === 'LEVERAGE_UNPROVEN') return verdict('LEVERAGE_UNPROVEN', `${symbol} 没有可验证的杠杆事实，容量不成立（不会用全局默认杠杆凑数）`);
  // A gate that already denied the side by name outranks any inference about the exchange floor.
  if (input.firstBindingConstraint && !minimumConstraints.has(input.firstBindingConstraint)) {
    return verdict(input.firstBindingConstraint, `${symbol} ${side} 由 ${input.firstBindingConstraint} 决定`, input.finalNotionalUsd, null);
  }
  if (!input.exchangeFiltersComplete) return verdict('EXCHANGE_FILTERS_UNPROVEN', `${symbol} 的 minQty/stepSize/minNotional 未全部验证，不能声称交易所最小名义`);
  if (!input.planPresent) return verdict('SIDE_PLAN_ABSENT', `${symbol} 的 ${side} 侧没有生成 AllocationPlan，plannedNotional 从未被计算，不是最小名义问题`);
  // The sizing layer refused this side for one bounded capacity. Its own reason and the two numbers that
  // made it zero come next, before any inference about the exchange floor.
  const admission = String(input.planAdmission ?? '');
  if (admission.startsWith('REJECT_')) {
    const room = input.capacityRoom ?? null;
    const money = (value: number) => Number(value).toFixed(2);
    const detail = room
      ? `${symbol} 的 ${side} 侧被 sizing 以 ${admission} 拒绝：${room.source} 上限 ${money(room.ceilingUsd)} 已用 ${money(room.usedUsd)}，剩余 ${money(room.roomUsd)}；计划名义被容量压成 0，不是交易所最小名义问题`
      : `${symbol} 的 ${side} 侧被 sizing 以 ${admission} 拒绝，计划名义为 0，不是交易所最小名义问题`;
    return verdict(`SIDE_PLAN_${admission}`, detail, Number(input.plannedNotionalUsd), input.minimumLegalNotionalUsd);
  }
  if (!(input.plannedNotionalUsd > 0)) return verdict('PLANNED_NOTIONAL_ZERO', `${symbol} 的 ${side} 侧计划名义为 0（sizing 未落地），不是最小名义问题`);
  if (!(input.finalNotionalUsd > 0)) return verdict('FINAL_NOTIONAL_ZERO', `${symbol} 的 ${side} 侧经过容量与风险后剩余为 0`, input.finalNotionalUsd, input.minimumLegalNotionalUsd);
  // Only now is there a real, finite size to compare with a real, verified floor — and if funding is
  // what made it small, the funding constraint is named rather than the floor.
  if (input.minimumLegalNotionalUsd !== null && Number(input.capitalExecutableNotionalUsd ?? Number.POSITIVE_INFINITY) + 1e-8 < input.minimumLegalNotionalUsd) {
    const constraint = input.capitalBindingConstraint === 'AVAILABLE_MARGIN' ? 'AVAILABLE_MARGIN' : 'MARGIN_POLICY_CAP';
    return verdict(constraint, `${symbol} ${side} 的资金可执行名义 ${Number(input.capitalExecutableNotionalUsd).toFixed(2)} < 交易所最小合法名义 ${input.minimumLegalNotionalUsd.toFixed(2)}`,
      Number(input.capitalExecutableNotionalUsd), input.minimumLegalNotionalUsd);
  }
  if (input.finalNotionalUsd + 1e-8 < input.minimumLegalNotionalUsd!) {
    return verdict('BELOW_EXCHANGE_MIN_NOTIONAL', `最终可执行名义 ${input.finalNotionalUsd.toFixed(2)} < 交易所最小合法名义 ${input.minimumLegalNotionalUsd!.toFixed(2)}`, input.finalNotionalUsd, input.minimumLegalNotionalUsd);
  }
  return verdict('MINIMUM_NOTIONAL', `${symbol} ${side} 低于本系统最小可执行名义`, input.finalNotionalUsd, input.minimumLegalNotionalUsd);
}

/** The largest whole-step quantity that both fits the notional and clears the exchange minimum. */
function roundToLegalQuantity(finalNotionalUsd: number, price: number | null, stepSize: number | null, minQty: number | null) {
  if (!(finalNotionalUsd > 0) || price === null || price <= 0 || stepSize === null || stepSize <= 0) return {quantityUnits: 0, legalNotionalUsd: 0};
  const units = Math.floor(finalNotionalUsd / (price * stepSize) + 1e-9);
  const quantity = units * stepSize;
  if (units <= 0 || (minQty !== null && quantity + 1e-12 < minQty)) return {quantityUnits: 0, legalNotionalUsd: 0};
  return {quantityUnits: units, legalNotionalUsd: quantity * price};
}

export function entrySideCapacityTrace(input: {
  symbol: string; underlying: string; side: 'LONG' | 'SHORT'; quoteAsset: string;
  snapshot: any; route: any; headroom: any; portfolioRisk?: {allowed: boolean; blockers: string[]} | null; marginTier?: {proven: boolean} | null;
  evaluationSnapshot?: {equityUsd: number; grossNotionalUsd: number; clusterNotionalUsd: number; positions: number; maxPositions: number} | null;
  riskAdmission?: {ceilingUsd: number | null; refusal: string | null; gate: string | null; detail: string | null} | null;
  /** The gate denies this candidate at any size: the money number stays, but the row is no longer executable. */
  admissionDenied?: boolean;
  now?: number;
}): SideCapacityTrace {
  const {symbol, underlying, side, quoteAsset, snapshot, route, headroom} = input;
  const now = input.now ?? Date.now();
  const quote = snapshot?.quote ?? {};
  const price = numberOrNull(quote.last);
  const tickSize = numberOrNull(quote.tickSize), stepSize = numberOrNull(quote.stepSize), minQty = numberOrNull(quote.minQty), minNotional = numberOrNull(quote.minNotional);
  const filterReasons: string[] = [];
  if (stepSize === null || stepSize <= 0) filterReasons.push('STEP_SIZE_UNPROVEN');
  if (minQty === null || minQty <= 0) filterReasons.push('MIN_QTY_UNPROVEN');
  if (minNotional === null || minNotional <= 0) filterReasons.push('MIN_NOTIONAL_UNPROVEN');
  if (price === null || price <= 0) filterReasons.push('REFERENCE_PRICE_UNPROVEN');
  const filtersComplete = filterReasons.length === 0;
  const minimumLegalNotionalUsd = filtersComplete ? Math.max(minNotional as number, (minQty as number) * (price as number)) : null;
  const key = side === 'LONG' ? 'long' : 'short';
  const planFacts = route?.[`${key}PlanFacts`] ?? null;
  const recommendedNotionalUsd = Number(route?.[`${key}RecommendedNotionalUsd`] ?? 0);
  const capital = headroom?.capital ?? null;
  const remaining = headroom?.remaining ?? {};
  const observed = headroom?.observed ?? {};
  const blockers = Array.isArray(headroom?.blockers) ? [...headroom.blockers] : [];
  const plannedNotionalUsd = Number(headroom?.plannedNotional ?? 0);
  const finalNotionalUsd = Number(headroom?.finalNotional ?? 0);
  // A plan the sizing layer refused cannot be executable whatever the capacity probe says: the refusal is
  // the fact that will produce (or not produce) an order size.
  const planRejects = String(planFacts?.admission ?? '').startsWith('REJECT_');
  const gateDenied = input.admissionDenied === true;
  const executable = Boolean(headroom?.executable) && !planRejects && !gateDenied;
  const binding = classifySideCapacityBinding({
    symbol, side, executable, blockers: gateDenied ? [...blockers, 'REJECT_RISK_ADMISSION_CEILING'] : blockers, firstBindingConstraint: headroom?.firstBindingConstraint ?? null,
    plannedNotionalUsd, finalNotionalUsd, minimumLegalNotionalUsd, exchangeFiltersComplete: filtersComplete,
    planPresent: Boolean(planFacts?.present), routePresent: Boolean(route), marginTierProven: input.marginTier?.proven !== false,
    portfolioRiskAllowed: input.portfolioRisk?.allowed !== false, capitalBindingConstraint: capital?.bindingConstraint ?? null,
    capitalExecutableNotionalUsd: numberOrNull(capital?.executableNotionalUsd),
    planAdmission: planFacts?.admission ?? null, capacityRoom: planFacts?.capacityRoom ?? null,
    riskAdmission: input.riskAdmission ?? null,
  });
  const rounded = roundToLegalQuantity(executable ? finalNotionalUsd : plannedNotionalUsd > 0 ? finalNotionalUsd : 0, price, stepSize, minQty);
  return {
    symbol, underlying, side, quoteAsset: String(quoteAsset).toUpperCase(), entryFundingEligible: isEntryQuoteAsset(quoteAsset),
    referencePrice: price,
    exchangeFilters: {tickSize, stepSize, minQty, minNotional, factsComplete: filtersComplete, reasons: filterReasons},
    minimumLegalNotionalUsd,
    leverage: capital?.leverage ?? numberOrNull(route?.leverage), leverageFact: capital?.leverageFact ?? null,
    funding: {availableBalanceUsd: Number(capital?.availableBalanceUsd ?? 0), reservedMarginUsd: Number(capital?.reservedMarginUsd ?? 0),
      executionLeaseMarginUsd: Number(capital?.executionLeaseMarginUsd ?? 0), executableMarginUsd: Number(capital?.executableMarginUsd ?? 0),
      policyMarginCapUsd: Number(capital?.policyMarginCapUsd ?? 0), executableNotionalUsd: Number(capital?.executableNotionalUsd ?? 0),
      bindingConstraint: String(capital?.bindingConstraint ?? 'NONE')},
    risk: {marginTierProven: input.marginTier?.proven !== false, portfolioRiskBlockersSeen: input.portfolioRisk?.blockers?.length ?? 0,
      grossRemainingUsd: Number(remaining.gross ?? 0), grossMode: String(observed.gross?.mode ?? 'ENFORCE'), grossEnforced: Boolean(observed.gross?.enforced ?? true),
      directionRemainingUsd: Number(remaining.direction ?? 0), directionMode: String(observed.direction?.mode ?? 'ENFORCE'), directionEnforced: Boolean(observed.direction?.enforced ?? true),
      clusterRemainingUsd: Number(remaining.cluster ?? 0), clusterDirectionRemainingUsd: Number(remaining.clusterDirection ?? 0),
      perTradeRiskRemainingUsd: Number(remaining.riskSizing ?? 0), portfolioRiskAllowed: input.portfolioRisk?.allowed !== false, portfolioRiskBlockers: input.portfolioRisk?.blockers ?? [],
      admissionCeilingUsd: numberOrNull(input.riskAdmission?.ceilingUsd), admissionGate: input.riskAdmission?.gate ?? null,
      admissionRefusal: input.riskAdmission?.refusal ?? null, admissionDetail: input.riskAdmission?.detail ?? null},
    plan: {present: Boolean(planFacts?.present), admission: planFacts?.admission ?? null, reasons: planFacts?.reasons ?? [], recommendedNotionalUsd,
      minExecutableMarginUsd: numberOrNull(planFacts?.minExecutableMarginUsd), capacityRoom: planFacts?.capacityRoom ?? null},
    plannedNotionalUsd, finalNotionalBeforeRoundingUsd: finalNotionalUsd,
    rounded: {...rounded, stepSize, minQty},
    executable, blockers: gateDenied && !blockers.includes('REJECT_RISK_ADMISSION_CEILING') ? [...blockers, 'REJECT_RISK_ADMISSION_CEILING'] : blockers,
    firstBindingConstraint: binding.constraint, actualUsd: binding.actualUsd, requiredUsd: binding.requiredUsd,
    explanation: `${symbol} ${side}：${binding.detail}`,
    evaluatedAt: now,
  };
}

/**
 * The per-candidate rows for every routed route, both sides. Each number is read from the object that
 * owns it: filters from the market snapshot, funding from the capital fact, risk remainders from the
 * headroom the gate itself ran, and the side plan from the allocation plan that sized (or refused) it.
 */
export function entrySideCapacityTraces(state: any, routes: any[], facts: {coverageSymbols?: string[] | null; now?: number;
  admission?: {status?: 'AVAILABLE'|'UNAVAILABLE'|'NOT_APPLICABLE'; exhausted: boolean; code: string | null; gate: string | null; detail: string | null; ceilingUsdBySide: {LONG: number; SHORT: number}} | null} = {}): {LONG: SideCapacityTrace[]; SHORT: SideCapacityTrace[]} {
  const now = facts.now ?? Date.now(), coverage = facts.coverageSymbols ?? null, book = facts.admission ?? null,
    positions = [...(state.positions?.values() ?? [])],
    traces: {LONG: SideCapacityTrace[]; SHORT: SideCapacityTrace[]} = {LONG: [], SHORT: []};
  const evaluationSnapshot = {equityUsd: Number(state.account?.equityUsd ?? 0), grossNotionalUsd: positions.reduce((n: number, row: any) => n + Math.abs(Number(row.quantity) * Number(row.markPrice)), 0),
    clusterNotionalUsd: 0, positions: positions.length, maxPositions: Number(state.settings?.portfolio?.maxPositions ?? 0)};
  for (const route of routes ?? []) {
    const snapshot = state.snapshots?.get?.(route.symbol);
    for (const side of ['LONG', 'SHORT'] as const) {
      const headroom = route.riskHeadroom?.[side] ?? null;
      // Either the route was sized against the gate itself, or the projection supplies the gate's book-level
      // answer. One of the two must speak; neither may be inferred from the money number.
      const own = headroom?.observed?.admission ?? null;
      const refusal = own?.refusal ?? (book?.status==='UNAVAILABLE'||book?.exhausted ? book.code : null);
      const ceilingUsd = own?.ceilingUsd ?? book?.ceilingUsdBySide?.[side] ?? null;
      const gate = own?.gate ?? book?.gate ?? null, detail = own?.detail ?? book?.detail ?? null;
      const denied = Boolean(refusal) || (Array.isArray(headroom?.blockers) && headroom.blockers.includes('REJECT_RISK_ADMISSION_CEILING'))
        || Boolean(book?.exhausted)||book?.status==='UNAVAILABLE';
      traces[side].push(entrySideCapacityTrace({symbol: route.symbol, underlying: route.underlying ?? route.symbol, side, quoteAsset: route.quoteAsset,
        snapshot, route, headroom,
        // An uncovered symbol is refused before any capacity number means anything, and the authority's
        // own coverage list is the only place that decides it.
        marginTier: {proven: coverage ? coverage.includes(String(route.symbol).toUpperCase()) : true},
        portfolioRisk: {allowed: !denied, blockers: [refusal, denied && !refusal ? 'RISK_ADMISSION_CEILING' : null].filter(Boolean) as string[]},
        riskAdmission: {ceilingUsd, refusal: refusal ?? null, gate, detail},
        admissionDenied: denied,
        evaluationSnapshot, now}));
    }
  }
  return traces;
}

/** One verdict for the whole book, so a page never infers "can it trade?" from two numbers. */
export function entrySideStatus(perSide: {LONG: {executableNotionalUsd: number}; SHORT: {executableNotionalUsd: number}}, routeCount: number, deniedByAdmission = false, denialCode='RISK_ADMISSION_EXHAUSTED') {
  // Money on the side is not permission to use it: when the committing gate refuses at any size, the status
  // line says so instead of naming a side "executable" beside a 0% admission rate.
  if (deniedByAdmission) return {code: denialCode, text: denialCode==='RISK_ADMISSION_UNAVAILABLE'?'组合风险准入结果不可用：新增风险容量 fail-closed':'确定性风险门拒绝任何新增名义：见首因的每道门数值'};
  const long = Number(perSide.LONG?.executableNotionalUsd ?? 0) > 0, short = Number(perSide.SHORT?.executableNotionalUsd ?? 0) > 0;
  if (long && short) return {code: 'BOTH_SIDES_EXECUTABLE' as const, text: 'LONG 与 SHORT 均可新增'};
  if (long) return {code: 'LONG_ONLY_EXECUTABLE' as const, text: 'LONG executable / SHORT blocked'};
  if (short) return {code: 'SHORT_ONLY_EXECUTABLE' as const, text: 'SHORT executable / LONG blocked'};
  return {code: 'NO_EXECUTABLE_SIDE' as const, text: routeCount ? '两侧都无可执行容量：见各侧逐候选首因' : '本轮没有可路由候选'};
}

export { entryTradingCapital };
