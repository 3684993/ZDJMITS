/**
 * The one reading of an exchange-reported liquidation price.
 *
 * A position row carries direction, so a liquidation price is only meaningful relative to the mark:
 * below it for a long, above it for a short. The formula this replaces used `Math.abs()`, which made
 * an impossible price look like a healthy 20 % buffer, and it collapsed `liquidationPrice = 0` into
 * "missing" even though V3 reports 0 for positions the exchange itself cannot liquidate at any price.
 * Both readings are wrong in opposite directions, so both are pinned here: 0 is a proven boundary for
 * a long and unproven for a short, and a finite positive price must satisfy the direction.
 */
export type LiquidationPriceFact = 'EXCHANGE_REPORTED_ZERO' | 'EXCHANGE_REPORTED_PRICE' | 'UNPROVEN';
export type LiquidationBufferFact = { bufferPct: number | null; fact: LiquidationPriceFact; blocker?: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function liquidationBufferFact(input: { symbol: string; side: 'LONG' | 'SHORT'; markPrice: number | null | undefined; liquidationPrice: number | null | undefined }): LiquidationBufferFact {
  const symbol = String(input.symbol ?? '').trim().toUpperCase(), side = input.side === 'SHORT' ? 'SHORT' : 'LONG';
  const mark = finite(input.markPrice) ? Number(input.markPrice) : null;
  const liquidation = finite(input.liquidationPrice) ? Number(input.liquidationPrice) : null;
  const unproven = `LIQUIDATION_BUFFER_UNPROVEN:${symbol}:${side}`;
  if (liquidation === null || mark === null || mark <= 0) return { bufferPct: null, fact: 'UNPROVEN', blocker: unproven };
  if (liquidation === 0) {
    // The exchange says the position cannot be liquidated by price alone. For a long that is the
    // zero-price boundary itself: a finite, auditable 100 %, and deliberately not Infinity.
    if (side === 'LONG') return { bufferPct: 1, fact: 'EXCHANGE_REPORTED_ZERO' };
    return { bufferPct: null, fact: 'UNPROVEN', blocker: unproven };
  }
  if (liquidation < 0) return { bufferPct: null, fact: 'UNPROVEN', blocker: unproven };
  if (side === 'LONG') {
    if (!(liquidation < mark)) return { bufferPct: null, fact: 'UNPROVEN', blocker: `LIQUIDATION_PRICE_DIRECTION_INVALID:${symbol}:LONG` };
    return { bufferPct: Math.max(0, (mark - liquidation) / mark), fact: 'EXCHANGE_REPORTED_PRICE' };
  }
  if (!(liquidation > mark)) return { bufferPct: null, fact: 'UNPROVEN', blocker: `LIQUIDATION_PRICE_DIRECTION_INVALID:${symbol}:SHORT` };
  return { bufferPct: Math.max(0, (liquidation - mark) / mark), fact: 'EXCHANGE_REPORTED_PRICE' };
}

/**
 * A position's leverage, and the honest answer about where it came from.
 *
 * The live Testnet payload proved the two contracts differ here: `/fapi/v2/positionRisk` states
 * `leverage`, `/fapi/v3/positionRisk` does not. `PositionSchema` requires a positive integer, so a
 * blind `Number(row.leverage)` produced NaN, the durable row kept it, and `core.exposure()` divided by
 * `Math.max(1, NaN)` inside the 250 ms dashboard projection — an uncaught ZodError and exit 1.
 *
 * V3 does state the two numbers whose quotient *is* leverage (`notional` and `initialMargin`, both
 * from the same row), so a derivation there is the exchange's own arithmetic, not our guess. Anything
 * that is neither stated nor exactly reconcilable is reported as unproven so a caller keeps the last
 * value the exchange actually supported instead of writing a fabricated one.
 */
export type PositionLeverageFact = { leverage: number | null; fact: 'EXCHANGE_STATED' | 'EXCHANGE_DERIVED_FROM_INITIAL_MARGIN' | 'UNPROVEN' };

export function validPositionLeverage(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function positionLeverageFact(input: { leverage?: unknown; notional?: unknown; initialMargin?: unknown }): PositionLeverageFact {
  const stated = validPositionLeverage(input.leverage);
  if (stated !== null) return { leverage: stated, fact: 'EXCHANGE_STATED' };
  // The exchange sends amounts as decimal strings, so the same row can be read either way.
  const notional = Math.abs(Number(input.notional)), initial = Number(input.initialMargin);
  if (Number.isFinite(notional) && notional > 0 && Number.isFinite(initial) && initial > 0) {
    const quotient = notional / initial, rounded = Math.round(quotient);
    // The exchange rounds each amount to 8 decimals, so a genuine integer leverage reconciles to
    // within ~1e-7 relative. Outside that band the pair is not describing one leverage: unproven.
    if (rounded >= 1 && Math.abs(quotient - rounded) / rounded < 1e-6) return { leverage: rounded, fact: 'EXCHANGE_DERIVED_FROM_INITIAL_MARGIN' };
  }
  return { leverage: null, fact: 'UNPROVEN' };
}
