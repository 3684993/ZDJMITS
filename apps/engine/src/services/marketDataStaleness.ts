/**
 * Pipeline market-data diagnosis. Choosing the label is separated from the gate so the two can
 * be tested independently: the pause decision must never become looser than before, while the
 * reported reason has to name the fact that actually failed.
 */
export type MarketFreshnessFacts = {
  quoteFreshRatio?: number;
  sequenceInvalid?: number;
  fresh: number;
  total: number;
};

export function marketDataStaleReason(input:{
  freshness:MarketFreshnessFacts;
  marketInsufficient:boolean;
  streamState:string;
  streamError?:unknown;
}):string|null{
  if(input.streamState==='BACKOFF'){
    return /certificate|altnames|hostname/i.test(String(input.streamError ?? ''))
      ? 'MARKET_WS_TLS_CERT_MISMATCH'
      : 'MARKET_WS_BACKOFF';
  }
  if(!input.marketInsufficient)return null;
  // Quotes really are the problem, or the book/quote pipeline is: keep the historical label.
  if((input.freshness.quoteFreshRatio ?? 1) < 0.5)return 'MARKET_QUOTES_STALE';
  // A WebSocket candle hole leaves quotes fresh and every closed sequence unusable.
  if((input.freshness.sequenceInvalid ?? 0) > 0)return 'MARKET_KLINE_SEQUENCE_INVALID';
  return 'MARKET_TECHNICAL_STALE';
}
