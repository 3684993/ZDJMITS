import type { MarketSymbolSnapshot } from '@zdj/contracts';

export function entryDataError(m:MarketSymbolSnapshot|undefined,now=Date.now()):string|null {
  if(!m?.quote||!m.technical?.['15m']||!m.technical?.['1m']||!m.technical?.['5m'])return 'DATA_ERROR: KEY_MARKET_FACT_MISSING';
  const q=m.quote;
  if([q.bid,q.ask,q.last,q.tickSize,q.stepSize,q.minQty,q.minNotional].some(x=>!Number.isFinite(x)||x<=0)||q.bid>q.ask)return 'DATA_ERROR: INVALID_QUOTE_FILTER';
  if(!Number.isFinite(q.ts)||now-q.ts>15_000||q.ts>now+1000)return 'DATA_ERROR: QUOTE_STALE';
  if(!m.orderBook||!Number.isFinite(m.orderBook.ts)||now-m.orderBook.ts>15_000||m.orderBook.ts>now+1000||!m.orderBook.bids?.length||!m.orderBook.asks?.length)return 'DATA_ERROR: ORDER_BOOK_STALE';
  return null;
}
