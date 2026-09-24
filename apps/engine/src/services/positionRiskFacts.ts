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
