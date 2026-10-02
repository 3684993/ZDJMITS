import type { MarketSymbolSnapshot, Timeframe } from '@zdj/contracts';

export const EIP_REFERENCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;
const TECHNICAL_MAX_AGE_MS: Record<Timeframe, number> = {
  '1m': 125_000, '5m': 605_000, '15m': 1_805_000, '1h': 7_205_000,
  '4h': 28_805_000, '1d': 172_805_000, '1w': 1_209_605_000,
};
const REFERENCE_TIMEFRAMES = new Set<Timeframe>(['15m', '1h', '4h', '1d', '1w']);

/** The same evidence contract governs repair selection and the final EIP build. */
export function eipEvidenceError(snapshot: MarketSymbolSnapshot, minDataCompleteness: number, regimeOnly = false, now = Date.now()): string | null {
  const stale = (label: string, ts: number, maxAge: number) => !Number.isFinite(ts) || now - ts > maxAge
    ? `EIP_EVIDENCE_STALE: ${snapshot.symbol} ${label} age=${now - ts}ms` : null;
  const quoteError = stale('quote', snapshot.quote?.ts, 15_000);
  if (quoteError) return quoteError;
  if (!regimeOnly) {
    const bookError = stale('orderBook', snapshot.orderBook?.ts, 15_000);
    if (bookError) return bookError;
    if (snapshot.dataCompleteness + 1e-9 < minDataCompleteness)
      return `EIP_EVIDENCE_INCOMPLETE: ${snapshot.symbol} completeness=${snapshot.dataCompleteness}`;
  }
  for (const [timeframe, maxAge] of Object.entries(TECHNICAL_MAX_AGE_MS) as [Timeframe, number][]) {
    if (regimeOnly && !REFERENCE_TIMEFRAMES.has(timeframe)) continue;
    const card = snapshot.technical?.[timeframe];
    if (!card) return `EIP_EVIDENCE_MISSING: ${snapshot.symbol} technical.${timeframe}`;
    const error = stale(`technical.${timeframe}`, card.asOf, maxAge);
    if (error) return error;
  }
  return null;
}

export function eipDependencyIssues(symbol: string, snapshots: ReadonlyMap<string, MarketSymbolSnapshot>, minDataCompleteness: number, now = Date.now()) {
  return [...new Set([symbol, ...EIP_REFERENCE_SYMBOLS])].flatMap(required => {
    const snapshot = snapshots.get(required);
    const reason = snapshot
      ? eipEvidenceError(snapshot, minDataCompleteness, required !== symbol, now)
      : `EIP_EVIDENCE_MISSING: ${required} snapshot`;
    return reason ? [{symbol: required, reason}] : [];
  });
}
