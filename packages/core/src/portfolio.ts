import type {
  AllocationPlan,
  AssetRiskTier,
  DirectionPolicy,
  DirectionPreference,
  MarketSymbolSnapshot,
  PortfolioExposure,
  PortfolioIntelligenceSettings,
  SystemSettings,
  UniverseCandidate,
} from "@zdj/contracts";
import { AllocationPlanSchema, PortfolioExposureSchema } from "@zdj/contracts";
import { clamp, safeDiv, uid } from "./math.js";
type AccountAsset = {
  asset: string;
  availableBalance: number;
  usdValue: number | null;
};

export function resolveUnderlying(symbol: string) {
  const s = symbol.toUpperCase();
  for (const quote of ["USDT", "USDC", "BUSD"])
    if (s.endsWith(quote) && s.length > quote.length)
      return s.slice(0, -quote.length);
  return s;
}
export function resolveQuoteAsset(
  symbol: string,
): "USDT" | "USDC" | "BUSD" | "UNKNOWN" {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT")) return "USDT";
  if (s.endsWith("USDC")) return "USDC";
  if (s.endsWith("BUSD")) return "BUSD";
  return "UNKNOWN";
}
export function riskTier(
  snapshot: MarketSymbolSnapshot,
  settings: PortfolioIntelligenceSettings,
): AssetRiskTier {
  const override =
    settings.symbolOverrides[snapshot.symbol.toUpperCase()]?.riskTier;
  if (override) return override;
  if (
    ["BTCUSDT", "BTCUSDC", "ETHUSDT", "ETHUSDC"].includes(
      snapshot.symbol.toUpperCase(),
    )
  )
    return "CORE";
  const q = snapshot.quote,
    t = snapshot.technical["15m"],
    d = snapshot.derivatives,
    spread = safeDiv(q.ask - q.bid, (q.ask + q.bid) / 2, 0) * 10000,
    depth =
      snapshot.orderBook.bids.slice(0, 5).reduce((n, x) => n + x[0] * x[1], 0) +
      snapshot.orderBook.asks.slice(0, 5).reduce((n, x) => n + x[0] * x[1], 0);
  if (
    q.quoteVolumeUsd24h >= 1e8 &&
    spread <= 10 &&
    depth >= 1e6 &&
    (d.openInterest ?? 0) > 0
  )
    return "LIQUID_ALT";
  if (
    q.quoteVolumeUsd24h < 2e7 ||
    spread > 18 ||
    snapshot.dataCompleteness < 0.9
  )
    return "NEW_LISTING";
  if (Math.abs(d.fundingRate ?? 0) > 0.003 || t.atrPercent > 6 || depth < 2e5)
    return "SPECULATIVE";
  return "LIQUID_ALT";
}
export function directionPolicy(
  symbol: string,
  tier: AssetRiskTier,
  settings: PortfolioIntelligenceSettings,
): DirectionPolicy {
  return (
    settings.symbolDirectionPolicies[symbol.toUpperCase()] ??
    settings.tierDirectionPolicies[tier] ??
    settings.globalDirectionPolicy
  );
}
export function directionPreference(
  symbol: string,
  tier: AssetRiskTier,
  settings: PortfolioIntelligenceSettings,
): DirectionPreference {
  return (
    settings.symbolDirectionPreferences[symbol.toUpperCase()] ??
    settings.tierDirectionPreferences[tier] ??
    settings.globalDirectionPreference
  );
}
export function preferencePolicy(
  preference: DirectionPreference,
): DirectionPolicy {
  return preference === "BALANCED"
    ? "BOTH"
    : preference === "SHORT_ONLY"
      ? "SHORT_ONLY"
      : preference === "CUSTOM"
        ? "BOTH"
        : "SHORT_BIASED";
}
/** One permission source: explicit bans intersect preference permissions. */
export function directionPermissions(symbol:string,tier:AssetRiskTier,settings:PortfolioIntelligenceSettings) {
  const preference=directionPreference(symbol,tier,settings),policy=directionPolicy(symbol,tier,settings);
  const allowedDirections=(['LONG','SHORT'] as const).filter(side=>policy!=='DISABLED'&&
    (policy!=='LONG_ONLY'||side==='LONG')&&(policy!=='SHORT_ONLY'||side==='SHORT')&&
    (preference!=='SHORT_ONLY'||side==='SHORT'));
  return {preference,policy,allowedDirections,longExceptionRequired:preference==='STRICT_SHORT_BIAS'};
}
export function locationScore(
  snapshot: MarketSymbolSnapshot,
  direction: "LONG" | "SHORT",
): number {
  const t = snapshot.technical["15m"],
    price = snapshot.quote.last,
    atr = Math.max(t.atr14, price * 0.0001),
    emaDistance = Math.abs(price - t.ema21) / atr,
    bb = t.bbPosition,
    impulse = Math.abs(price - t.bbMiddle) / atr;
  let score =
    100 -
    Math.min(35, emaDistance * 18) -
    Math.min(25, Math.max(0, impulse - 1) * 12);
  if (direction === "LONG") {
    if (bb > 0.9) score -= 25;
    if (t.trend === "UP" && t.volumeZScore > 2) score -= 10;
  } else {
    if (bb < 0.1) score -= 25;
    if (t.trend === "DOWN" && t.volumeZScore > 2) score -= 10;
  }
  return Math.round(clamp(score, 0, 100));
}
function assetAvailable(assets: AccountAsset[] | undefined, quote: string) {
  return assets?.find((x) => x.asset === quote)?.availableBalance ?? null;
}
export function routeContract(
  underlying: string,
  snapshots: MarketSymbolSnapshot[],
  settings: PortfolioIntelligenceSettings,
  assets: AccountAsset[] | undefined,
) {
  const rows = snapshots.filter(
    (s) => resolveUnderlying(s.symbol) === underlying,
  );
  const policy = settings.quoteAssetPolicy;
  const allowed = (quote: string) =>
    policy === "AUTO" ||
    (policy === "USDT_ONLY" && quote === "USDT") ||
    (policy === "USDC_ONLY" && quote === "USDC");
  const eligible = rows
    .filter((s) => allowed(resolveQuoteAsset(s.symbol)))
    .filter((s) => s.dataCompleteness >= 0.86)
    .sort((a, b) => {
      const aq = assetAvailable(assets, resolveQuoteAsset(a.symbol)) ?? 0,
        bq = assetAvailable(assets, resolveQuoteAsset(b.symbol)) ?? 0;
      const aok = aq > 0 ? 1 : 0,
        bok = bq > 0 ? 1 : 0;
      return bok - aok || b.quote.quoteVolumeUsd24h - a.quote.quoteVolumeUsd24h;
    });
  if (policy === "AUTO") {
    const usdt = eligible.find((x) => resolveQuoteAsset(x.symbol) === "USDT"),
      usdc = eligible.find((x) => resolveQuoteAsset(x.symbol) === "USDC");
    if (usdt && usdc) {
      const at = assetAvailable(assets, "USDT") ?? 0,
        ac = assetAvailable(assets, "USDC") ?? 0;
      if (ac > 0 && at <= 0) return usdc;
      if (at > 0 && ac <= 0) return usdt;
      if (ac > at * 1.05) return usdc;
      if (at > ac * 1.05) return usdt;
      const parity =
        [...underlying].reduce((n, c) => n + c.charCodeAt(0), 0) % 2;
      return parity === 0 ? usdc : usdt;
    }
  }
  return eligible[0] ?? null;
}
export function exposure(
  positions: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    markPrice: number;
    leverage: number;
  }>,
  assets: AccountAsset[] | undefined,
  settings: PortfolioIntelligenceSettings,
): PortfolioExposure {
  const equity = Math.max(
      1,
      assets?.reduce((n, a) => n + (a.usdValue ?? 0), 0) ?? 0,
    ),
    long = positions
      .filter((p) => p.side === "LONG")
      .reduce((n, p) => n + p.quantity * p.markPrice, 0),
    short = positions
      .filter((p) => p.side === "SHORT")
      .reduce((n, p) => n + p.quantity * p.markPrice, 0),
    spec = positions
      .filter((p) =>
        ["SPECULATIVE", "NEW_LISTING", "RESTRICTED"].includes(
          riskTierForSymbol(p.symbol, settings),
        ),
      )
      .reduce((n, p) => n + p.quantity * p.markPrice, 0),
    quoteMargin = (quote: string) =>
      positions
        .filter((p) => resolveQuoteAsset(p.symbol) === quote)
        .reduce(
          (n, p) => n + (p.quantity * p.markPrice) / Math.max(1, p.leverage),
          0,
        ),
    out = {
      longNotionalUsd: long,
      shortNotionalUsd: short,
      longExposurePct: long / equity,
      shortExposurePct: short / equity,
      speculativeNotionalUsd: spec,
      speculativeExposurePct: spec / equity,
      usdtMarginUsd: quoteMargin("USDT"),
      usdcMarginUsd: quoteMargin("USDC"),
      sameUnderlyingExposure: 0,
      duplicateBlocks: 0,
      locationBlocks: 0,
    };
  return PortfolioExposureSchema.parse(out);
}
function riskTierForSymbol(
  symbol: string,
  settings: PortfolioIntelligenceSettings,
): AssetRiskTier {
  return (
    settings.symbolOverrides[symbol.toUpperCase()]?.riskTier ?? "LIQUID_ALT"
  );
}
function tierFactor(
  tier: AssetRiskTier,
  settings: PortfolioIntelligenceSettings,
) {
  return settings.tierMarginFactors[tier] ?? 1;
}
function maxTierLeverage(
  tier: AssetRiskTier,
  settings: PortfolioIntelligenceSettings,
) {
  return Math.min(
    settings.globalMaxLeverage,
    settings.tierMaxLeverage[tier] ?? settings.globalMaxLeverage,
  );
}
export function buildAllocationPlan(input: {
  candidate: UniverseCandidate;
  snapshot: MarketSymbolSnapshot;
  direction: "LONG" | "SHORT";
  confidence: number;
  settings: SystemSettings;
  positions: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    markPrice: number;
    leverage: number;
  }>;
  assets?: AccountAsset[];
  admissionContext?: { reservedIntents?: number; workingEntryOrders?: number };
  /** Runtime side/gross/quote capacity cap computed immediately before execution. */
  notionalCapUsd?: number;
}): AllocationPlan {
  const p = input.settings.portfolioIntelligence,
    candidate = input.candidate,
    s = input.snapshot,
    tier = (candidate.riskTier as AssetRiskTier | undefined) ?? riskTier(s, p),
    underlying = candidate.underlyingAsset ?? resolveUnderlying(s.symbol),
    quote =
      (candidate.quoteAsset as
        "USDT" | "USDC" | "BUSD" | "UNKNOWN" | undefined) ??
      resolveQuoteAsset(s.symbol),
    preference = directionPreference(s.symbol, tier, p),
    policy =
      (candidate.directionPolicy as DirectionPolicy | undefined) ??
      preferencePolicy(preference),
    before = exposure(input.positions, input.assets, p),
    same = input.positions.filter(
      (x) => resolveUnderlying(x.symbol) === underlying,
    ),
    sameSide = same.filter((x) => x.side === input.direction),
    score = locationScore(s, input.direction),
    reasons: string[] = [];
  if (tier === "RESTRICTED") reasons.push("RESTRICTED_RISK_TIER");
  if (
    policy === "DISABLED" ||
    (policy === "LONG_ONLY" && input.direction !== "LONG") ||
    (policy === "SHORT_ONLY" && input.direction !== "SHORT")
  )
    reasons.push("DIRECTION_POLICY");
  if (p.underlyingExposurePolicy === "BLOCK_ALL" && same.length)
    reasons.push("DUPLICATE_UNDERLYING");
  if (p.underlyingExposurePolicy === "BLOCK_SAME_DIRECTION" && sameSide.length)
    reasons.push("DUPLICATE_UNDERLYING");
  if (same.length >= p.maxSameUnderlyingPositions)
    reasons.push("MAX_SAME_UNDERLYING");
  // Location is an uncalibrated market-quality heuristic. V3.7 records the
  // counterfactual but does not duplicate Primary timing as an online veto.
  const locationWouldBlock=p.locationProtectionEnabled&&score<p.minLocationScore;
  const working = input.admissionContext?.workingEntryOrders ?? 0,
    reserved = input.admissionContext?.reservedIntents ?? 0;
  if (
    input.positions.length + working + reserved >=
    input.settings.portfolio.maxPositions
  )
    reasons.push("MAX_POSITIONS");
  const altLongMarginFactor =
      input.direction === "LONG" && tier !== "CORE"
        ? (p.altLongMarginFactors[tier] ?? 1)
        : 1,
    directionLeverageCap =
      input.direction === "LONG" && tier !== "CORE"
        ? (p.altLongLeverageCaps[tier] ?? p.globalMaxLeverage)
        : p.globalMaxLeverage,
    leverage = Math.max(
      1,
      Math.min(
        maxTierLeverage(tier, p),
        directionLeverageCap,
        p.dynamicLeverageEnabled
          ? Math.floor(
              20 / (1 + Math.max(0, s.technical["15m"].atrPercent) / 3),
            )
          : maxTierLeverage(tier, p),
      ),
    ),
    exchangeMinimumNotional = Math.max(
      s.quote.minNotional,
      s.quote.minQty * s.quote.last,
    ),
    exchangeMinimumMargin =
      (exchangeMinimumNotional / Math.max(1, leverage)) * 1.1,
    minMargin = Math.max(exchangeMinimumMargin, p.minMarginUsd),
    equity = Math.max(
      1,
      input.assets?.reduce((n, a) => n + (a.usdValue ?? 0), 0) ?? 0,
    ),
    liquidity = clamp(
      Math.log10(1 + s.quote.quoteVolumeUsd24h) / 10,
      0.45,
      1.15,
    ),
    volatility = clamp(1 - s.technical["15m"].atrPercent / 10, 0.35, 1),
    confidenceFactor = 0.5 + 0.5 * clamp(input.confidence, 0, 1),
    exposureFactor =
      input.direction === "LONG"
        ? clamp(1 - before.longExposurePct / p.maxLongExposurePct, 0.25, 1)
        : clamp(1 - before.shortExposurePct / p.maxShortExposurePct, 0.25, 1),
    raw =
      (p.dynamicMarginEnabled
        ? p.baseMarginUsd
        : input.settings.portfolio.entryMarginUsd) *
      tierFactor(tier, p) *
      altLongMarginFactor *
      liquidity *
      volatility *
      confidenceFactor *
      exposureFactor,
    maxByEquity = equity * p.maxEquityPct,
    marginCap = Math.min(p.maxMarginPerPositionUsd, maxByEquity,Number.isFinite(input.notionalCapUsd)?Math.max(0,Number(input.notionalCapUsd))/Math.max(1,leverage):Number.POSITIVE_INFINITY),
    riskMove = Math.max(0.0001, (s.technical["15m"].atrPercent / 100) * 2),
    riskLimitedNotional =
      (equity *
        (input.settings.riskGovernance?.perTradeRiskPctEquity ?? 0.01)) /
      riskMove,
    riskLimitedMargin = riskLimitedNotional / Math.max(1, leverage),
    marginUsd = Math.max(0, Math.min(raw, marginCap, riskLimitedMargin)),
    notionalUsd = marginUsd * leverage,
    after = exposure(
      [
        ...input.positions,
        {
          symbol: s.symbol,
          side: input.direction,
          quantity: notionalUsd / s.quote.last,
          markPrice: s.quote.last,
          leverage,
        },
      ],
      input.assets,
      p,
    );
  const longRoom =
      Math.max(0, p.maxLongExposurePct - before.longExposurePct) * equity,
    shortRoom =
      Math.max(0, p.maxShortExposurePct - before.shortExposurePct) * equity,
    specRoom =
      Math.max(0, p.maxSpeculativeExposurePct - before.speculativeExposurePct) *
      equity,
    quoteAvailable = assetAvailable(input.assets, quote),
    quoteMargin =
      quote === "USDT"
        ? before.usdtMarginUsd
        : quote === "USDC"
          ? before.usdcMarginUsd
          : 0,
    quoteRoom =
      quoteAvailable == null
        ? Number.POSITIVE_INFINITY
        : Math.max(
            0,
            quoteAvailable * p.maxQuoteAssetMarginUsagePct - quoteMargin,
          ),
    room = Math.min(
      input.direction === "LONG" ? longRoom : shortRoom,
      tier === "SPECULATIVE" || tier === "NEW_LISTING" || tier === "RESTRICTED"
        ? specRoom
        : Number.POSITIVE_INFINITY,
      quoteRoom,
    );
  // Which capacity sizing consumed is a fact the operator has to see: a side that sizes to zero has to
  // arrive with the ceiling and the used number behind it, not with a bare rejection label.
  const directionRoom = input.direction === "LONG" ? longRoom : shortRoom,
    directionUsedUsd = input.direction === "LONG" ? before.longNotionalUsd : before.shortNotionalUsd,
    directionLimitPct = input.direction === "LONG" ? p.maxLongExposurePct : p.maxShortExposurePct,
    roomSources: Array<{source: string; ceilingUsd: number; usedUsd: number; roomUsd: number; limitPct: number; usedPct: number; equityUsd: number}> = [
      {source: input.direction === "LONG" ? "LONG_EXPOSURE" : "SHORT_EXPOSURE", ceilingUsd: directionLimitPct * equity, usedUsd: directionUsedUsd, roomUsd: directionRoom,
        limitPct: directionLimitPct, usedPct: input.direction === "LONG" ? before.longExposurePct : before.shortExposurePct, equityUsd: equity},
    ];
  if (tier === "SPECULATIVE" || tier === "NEW_LISTING" || tier === "RESTRICTED")
    roomSources.push({source: "SPECULATIVE_EXPOSURE", ceilingUsd: p.maxSpeculativeExposurePct * equity, usedUsd: before.speculativeNotionalUsd, roomUsd: specRoom,
      limitPct: p.maxSpeculativeExposurePct, usedPct: before.speculativeExposurePct, equityUsd: equity});
  if (quoteAvailable != null)
    roomSources.push({source: "QUOTE_ASSET_MARGIN", ceilingUsd: quoteAvailable * p.maxQuoteAssetMarginUsagePct, usedUsd: quoteMargin, roomUsd: quoteRoom,
      limitPct: p.maxQuoteAssetMarginUsagePct, usedPct: quoteAvailable > 0 ? quoteMargin / quoteAvailable : 0, equityUsd: equity});
  const boundedRooms = roomSources.filter((row) => Number.isFinite(row.roomUsd));
  const capacityRoom = boundedRooms.length
    ? boundedRooms.reduce((tightest, row) => (row.roomUsd < tightest.roomUsd ? row : tightest))
    : undefined;
  let admission: AllocationPlan["admission"] = reasons.length
    ? reasons.includes("DUPLICATE_UNDERLYING") ||
      reasons.includes("MAX_SAME_UNDERLYING")
      ? "REJECT_DUPLICATE_UNDERLYING"
      : reasons.includes("DIRECTION_POLICY")
        ? "REJECT_DIRECTION_POLICY"
        : reasons.includes("RESTRICTED_RISK_TIER")
          ? "REJECT_RISK_TIER"
          : reasons.includes("MAX_POSITIONS")
            ? "REJECT_MAX_POSITIONS"
            : "REJECT_LOCATION"
    : after.speculativeExposurePct > p.maxSpeculativeExposurePct ||
        after.longExposurePct > p.maxLongExposurePct ||
        after.shortExposurePct > p.maxShortExposurePct ||
        after.usdtMarginUsd >
          quoteAvailable! *
            (quote === "USDT" ? p.maxQuoteAssetMarginUsagePct : 1) ||
        after.usdcMarginUsd >
          quoteAvailable! *
            (quote === "USDC" ? p.maxQuoteAssetMarginUsagePct : 1)
      ? "ALLOW_REDUCED_SIZE"
      : marginUsd < minMargin
        ? "REJECT_RISK_TIER"
        : "ALLOW";
  let scaled = marginUsd;
  if (admission === "ALLOW_REDUCED_SIZE") {
    if (room < minMargin) {
      admission =
        quoteRoom < minMargin ? "REJECT_QUOTE_MARGIN" : "REJECT_EXPOSURE_LIMIT";
      scaled = minMargin;
    } else scaled = Math.min(marginUsd, room);
  }
  if (admission === "ALLOW" && room < minMargin) {
    admission =
      quoteRoom < minMargin ? "REJECT_QUOTE_MARGIN" : "REJECT_EXPOSURE_LIMIT";
    scaled = minMargin;
  }
  const afterScaled = exposure(
      [
        ...input.positions,
        {
          symbol: s.symbol,
          side: input.direction,
          quantity: (scaled * leverage) / s.quote.last,
          markPrice: s.quote.last,
          leverage,
        },
      ],
      input.assets,
      p,
    ),
    reasonsOut =
      admission === "ALLOW_REDUCED_SIZE"
        ? [...reasons, "EXPOSURE_REDUCED_SIZE"]
        : admission.startsWith("REJECT_")
          ? [...reasons, admission]
          : reasons;
  return AllocationPlanSchema.parse({
    planId: uid("alloc"),
    underlying,
    symbol: s.symbol,
    quoteAsset: quote,
    riskTier: tier,
    directionPolicy: policy,
    directionPreference: preference,
    direction: input.direction,
    locationScore: score,
    locationWouldBlock,
    marginMode:
      p.symbolMarginModes[s.symbol] ?? p.tierMarginModes[tier] ?? p.marginMode,
    leverage,
    marginUsd: scaled,
    notionalUsd: scaled * leverage,
    minExecutableMarginUsd: minMargin,
    altLongMarginFactor,
    directionLeverageCap,
    exposureBefore: before,
    exposureAfter: afterScaled,
    admission,
    policySource: "V3.8.0_SINGLE_PERMISSION_SOURCE",
    reasons: reasonsOut,
    capacityRoom,
    createdAt: Date.now(),
  });
}
export function decorateUniverse(
  candidates: UniverseCandidate[],
  snapshots: MarketSymbolSnapshot[],
  settings: SystemSettings,
  assets: AccountAsset[] | undefined,
  positions: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    markPrice: number;
    leverage: number;
  }>,
) {
  const p = settings.portfolioIntelligence,
    groups = new Map<string, UniverseCandidate[]>();
  for (const c of candidates) {
    const underlying = resolveUnderlying(c.symbol);
    const g = groups.get(underlying) ?? [];
    g.push(c);
    groups.set(underlying, g);
  }
  const out: UniverseCandidate[] = [];
  for (const [underlying, rows] of groups) {
    const transient=new Set(['ACTIVE_POSITION','ACTIVE_ENTRY_ORDER']);
    const qualifiedRows=rows.filter(row=>row.eligible||row.exclusionReasons.every(reason=>transient.has(reason))),
      qualifiedSymbols=new Set(qualifiedRows.map(row=>row.symbol)),
      routed = routeContract(underlying, snapshots.filter(snapshot=>qualifiedSymbols.has(snapshot.symbol)), p, assets),
      chosen =
        rows.find((x) => x.symbol === routed?.symbol) ??
        qualifiedRows.sort((a, b) => b.score - a.score)[0] ?? rows.sort((a, b) => b.score - a.score)[0]!;
    const ss = snapshots.find((s) => s.symbol === chosen.symbol);
    if (!ss) {
      out.push(chosen);
      continue;
    }
    const tier = riskTier(ss, p),
      policy = directionPolicy(chosen.symbol, tier, p),
      preference = directionPreference(chosen.symbol, tier, p),
      direction = ss.technical["15m"].trend === "DOWN" ? "SHORT" : "LONG",
      score = locationScore(ss, direction),
      plan = buildAllocationPlan({
        candidate: chosen,
        snapshot: ss,
        direction,
        confidence: 0.65,
        settings,
        positions,
        assets,
      });
    out.push({
      ...chosen,
      underlyingAsset: underlying,
      quoteAsset: resolveQuoteAsset(chosen.symbol),
      selectedContract: chosen.symbol,
      riskTier: tier,
      directionPolicy: policy,
      directionPreference: preference,
      locationScore: score,
      recommendedMargin: plan.marginUsd,
      recommendedLeverage: plan.leverage,
      existingUnderlyingExposure: positions
        .filter((x) => resolveUnderlying(x.symbol) === underlying)
        .reduce((n, x) => n + x.quantity * x.markPrice, 0),
      eligibleContracts: rows.map((x) => x.symbol),
    });
    for (const dup of rows.filter((x) => x !== chosen))
      out.push({
        ...dup,
        underlyingAsset: underlying,
        selectedContract: chosen.symbol,
        eligible: false,
        rank: 0,
        exclusionReasons: [
          ...dup.exclusionReasons,
          "DUPLICATE_UNDERLYING_CONTRACT",
        ],
      });
  }
  return out.sort(
    (a, b) => (b.eligible ? 1 : 0) - (a.eligible ? 1 : 0) || b.score - a.score,
  );
}
