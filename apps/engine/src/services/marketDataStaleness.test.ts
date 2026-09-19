import { describe, expect, it } from 'vitest';
import { marketDataStaleReason } from './marketDataStaleness.js';

describe('V3.9.5 market data staleness diagnosis', () => {
  const freshQuotes = { fresh: 4, total: 100, quoteFreshRatio: 1, klineFreshRatio: 0.04, sequenceInvalid: 96 };

  it('names the candle-sequence failure instead of blaming quotes when quotes are fresh', () => {
    expect(marketDataStaleReason({ freshness: freshQuotes, marketInsufficient: true, streamState: 'LIVE' }))
      .toBe('MARKET_KLINE_SEQUENCE_INVALID');
  });

  it('still reports quote staleness when the quote pipeline is what failed', () => {
    expect(marketDataStaleReason({ freshness: { fresh: 4, total: 100, quoteFreshRatio: 0.1, sequenceInvalid: 0 },
      marketInsufficient: true, streamState: 'LIVE' })).toBe('MARKET_QUOTES_STALE');
  });

  it('labels a stale-card-only outage separately from a sequence block', () => {
    expect(marketDataStaleReason({ freshness: { fresh: 4, total: 100, quoteFreshRatio: 1, sequenceInvalid: 0 },
      marketInsufficient: true, streamState: 'LIVE' })).toBe('MARKET_TECHNICAL_STALE');
  });

  it('keeps the WebSocket labels and never pauses while supply is sufficient', () => {
    expect(marketDataStaleReason({ freshness: freshQuotes, marketInsufficient: false, streamState: 'BACKOFF' }))
      .toBe('MARKET_WS_BACKOFF');
    expect(marketDataStaleReason({ freshness: freshQuotes, marketInsufficient: false, streamState: 'BACKOFF',
      streamError: 'unable to verify certificate' })).toBe('MARKET_WS_TLS_CERT_MISMATCH');
    expect(marketDataStaleReason({ freshness: { fresh: 99, total: 100 }, marketInsufficient: false, streamState: 'LIVE' }))
      .toBeNull();
  });
});
