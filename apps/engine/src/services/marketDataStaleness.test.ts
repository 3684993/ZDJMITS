import { describe, expect, it } from 'vitest';
import { marketDataIsolation, marketDataIsolationReason, marketDataStaleReason } from './marketDataStaleness.js';

describe('V3.9.5 market data staleness diagnosis', () => {
  const freshQuotes = { fresh: 4, total: 100, quoteFreshRatio: 1, klineFreshRatio: 0.04, sequenceInvalid: 96 };

  it('names the candle-sequence failure instead of blaming quotes when nothing healthy is left', () => {
    const isolation = marketDataIsolation({candidateSymbols: ['BTCUSDT', 'ETHUSDT'], readinessReasons: (symbol) => symbol === 'BTCUSDT' ? ['TECHNICAL_15m_SEQUENCE_INVALID'] : ['TECHNICAL_5m_SEQUENCE_INVALID']});
    expect(marketDataStaleReason({freshness: freshQuotes, marketInsufficient: true, streamState: 'LIVE', isolation}))
      .toBe('MARKET_KLINE_SEQUENCE_INVALID');
  });

  it('still reports quote staleness when the quote pipeline is what failed', () => {
    expect(marketDataStaleReason({ freshness: { fresh: 4, total: 100, quoteFreshRatio: 0.1, sequenceInvalid: 0 },
      marketInsufficient: true, streamState: 'LIVE' })).toBe('MARKET_QUOTES_STALE');
  });

  it('does not pause healthy dispatch candidates for stale quotes elsewhere in the book', () => {
    const isolation = marketDataIsolation({candidateSymbols: ['BTCUSDT', 'ETHUSDT'],
      readinessReasons: symbol => symbol === 'BTCUSDT' ? [] : ['QUOTE_STALE']});
    expect(marketDataStaleReason({freshness: {fresh: 4, total: 100, quoteFreshRatio: 0.1, sequenceInvalid: 0},
      marketInsufficient: true, streamState: 'LIVE', isolation})).toBeNull();
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

/**
 * G3: one symbol's bad candles are that symbol's problem. The tests below pin the boundary in both
 * directions — a healthy candidate must keep the pipeline running, and a book with nothing healthy left
 * must still pause, with the isolated symbols kept visible instead of swallowed.
 */
describe('G3 single-symbol market-data isolation', () => {
  const bad = {fresh: 4, total: 100, quoteFreshRatio: 1, klineFreshRatio: 0.04, sequenceInvalid: 26};

  it('ST-01 isolates the broken symbol and keeps the pipeline for the healthy one', () => {
    const isolation = marketDataIsolation({
      candidateSymbols: ['SOLUSDT', 'DOGEUSDT'],
      readinessReasons: (symbol) => symbol === 'DOGEUSDT' ? ['TECHNICAL_15m_SEQUENCE_INVALID'] : [],
    });
    expect(isolation).toMatchObject({healthyCandidates: 1, candidateCount: 2, isolated: [{symbol: 'DOGEUSDT', reasons: ['TECHNICAL_15m_SEQUENCE_INVALID']}]});
    expect(marketDataStaleReason({freshness: bad, marketInsufficient: true, streamState: 'LIVE', isolation})).toBeNull();
  });

  it('ST-02 pauses only when every candidate lost its data', () => {
    const isolation = marketDataIsolation({
      candidateSymbols: ['SOLUSDT', 'DOGEUSDT', 'ADAUSDC'],
      readinessReasons: (symbol) => symbol === 'ADAUSDC' ? ['ORDER_BOOK_STALE'] : ['TECHNICAL_5m_SEQUENCE_INVALID'],
    });
    expect(isolation.healthyCandidates).toBe(0);
    expect(isolation.isolated.map((row) => row.symbol)).toEqual(['SOLUSDT', 'DOGEUSDT', 'ADAUSDC']);
    expect(marketDataStaleReason({freshness: bad, marketInsufficient: true, streamState: 'LIVE', isolation})).toBe('MARKET_KLINE_SEQUENCE_INVALID');
  });

  it('ST-03 a stale-card-only book pauses as TECHNICAL, not as a fabricated candle hole', () => {
    const isolation = marketDataIsolation({candidateSymbols: ['SOLUSDT'], readinessReasons: () => ['TECHNICAL_15m_STALE']});
    expect(marketDataStaleReason({freshness: {...bad, sequenceInvalid: 0}, marketInsufficient: true, streamState: 'LIVE', isolation})).toBe('MARKET_TECHNICAL_STALE');
    expect(marketDataIsolationReason(isolation.isolated)).toBe('MARKET_TECHNICAL_STALE');
  });

  it('ST-04 a source-level failure outranks healthy candidates, and no candidate means no invented pause', () => {
    const healthy = marketDataIsolation({candidateSymbols: ['SOLUSDT'], readinessReasons: () => []});
    expect(marketDataStaleReason({freshness: bad, marketInsufficient: true, streamState: 'BACKOFF', streamError: 'socket closed', isolation: healthy}))
      .toBe('MARKET_WS_BACKOFF');
    expect(marketDataStaleReason({freshness: bad, marketInsufficient: true, streamState: 'LIVE', isolation: {...healthy, candidateCount: 0, healthyCandidates: 0}}))
      .toBe('MARKET_KLINE_SEQUENCE_INVALID');
  });

  it('ST-05 no duplicate symbols and no swallowed reason: each isolation names its own fact', () => {
    const isolation = marketDataIsolation({
      candidateSymbols: ['SOLUSDT', 'solusdt', 'LINKUSDC', 'ADAUSDC'],
      readinessReasons: (symbol) => symbol === 'SOLUSDT' ? ['TECHNICAL_1m_SEQUENCE_INVALID', 'QUOTE_STALE'] : symbol === 'LINKUSDC' ? ['ORDER_BOOK_STALE'] : [],
    });
    expect(isolation.candidateCount).toBe(3);
    expect(isolation.healthyCandidates).toBe(1);
    expect(isolation.isolated).toEqual([
      {symbol: 'SOLUSDT', reasons: ['TECHNICAL_1m_SEQUENCE_INVALID', 'QUOTE_STALE']},
      {symbol: 'LINKUSDC', reasons: ['ORDER_BOOK_STALE']},
    ]);
    expect(marketDataStaleReason({freshness: bad, marketInsufficient: true, streamState: 'LIVE', isolation})).toBeNull();
  });
});
