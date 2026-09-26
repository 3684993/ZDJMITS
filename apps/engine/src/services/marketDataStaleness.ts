/**
 * Pipeline market-data diagnosis. Choosing the label is separated from the gate so the two can
 * be tested independently: the pause decision must never become looser than before, while the
 * reported reason has to name the fact that actually failed.
 *
 * G3: one symbol's broken candle sequence is a fact about that symbol. It isolates that symbol and
 * leaves the pipeline working; only a source-level failure, or a book with no healthy candidate left,
 * may pause the whole Entry pipeline.
 */
export type MarketFreshnessFacts = {
  quoteFreshRatio?: number;
  sequenceInvalid?: number;
  fresh: number;
  total: number;
};

export type MarketDataIsolationFacts = {
  isolated: Array<{symbol: string; reasons: string[]}>;
  healthyCandidates: number;
  candidateCount: number;
};

/** Per-symbol market-data isolation, read from the same readiness facts the dispatcher uses. */
export function marketDataIsolation(input: {
  candidateSymbols: Iterable<string>;
  readinessReasons: (symbol: string) => string[];
}): MarketDataIsolationFacts {
  const symbols = [...new Set([...input.candidateSymbols].map((symbol) => String(symbol).toUpperCase()).filter(Boolean))];
  const isolated = symbols.flatMap((symbol) => {
    const reasons = input.readinessReasons(symbol) ?? [];
    return reasons.length ? [{symbol, reasons: [...reasons]}] : [];
  });
  return {isolated, healthyCandidates: symbols.length - isolated.length, candidateCount: symbols.length};
}

/** The label a system-level pause is allowed to carry, given which symbols are isolated instead. */
export function marketDataIsolationReason(isolated: Array<{symbol: string; reasons: string[]}>): string {
  return isolated.some((row) => row.reasons.some((reason) => reason.endsWith('_SEQUENCE_INVALID')))
    ? 'MARKET_KLINE_SEQUENCE_INVALID'
    : 'MARKET_TECHNICAL_STALE';
}

export function marketDataStaleReason(input: {
  freshness: MarketFreshnessFacts;
  marketInsufficient: boolean;
  streamState: string;
  streamError?: unknown;
  isolation?: MarketDataIsolationFacts | null;
}): string | null {
  if(input.streamState==='BACKOFF'){
    return /certificate|altnames|hostname/i.test(String(input.streamError ?? ''))
      ? 'MARKET_WS_TLS_CERT_MISMATCH'
      : 'MARKET_WS_BACKOFF';
  }
  if(!input.marketInsufficient)return null;
  // Quotes really are the problem: the source itself is stale for the whole book, not for one symbol.
  if((input.freshness.quoteFreshRatio ?? 1) < 0.5)return 'MARKET_QUOTES_STALE';
  const isolation = input.isolation;
  if (isolation) {
    // Candidates still healthy: the failing symbols are held back individually and Entry keeps running.
    if (isolation.healthyCandidates > 0) return null;
    // Nothing healthy is left to dispatch, so the pause is real — and it names the data fact that ate it.
    if (isolation.candidateCount > 0 && isolation.isolated.length > 0) return marketDataIsolationReason(isolation.isolated);
  }
  // A WebSocket candle hole leaves quotes fresh and every closed sequence unusable.
  if((input.freshness.sequenceInvalid ?? 0) > 0)return 'MARKET_KLINE_SEQUENCE_INVALID';
  return 'MARKET_TECHNICAL_STALE';
}
