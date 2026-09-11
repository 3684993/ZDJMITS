import { MockMarketDataProvider } from '../adapters/market/MockMarketDataProvider.js';
import { MockExchangeAdapter } from '../adapters/exchange/MockExchangeAdapter.js';

export function createTestAdapters(symbolLimit:number){
  return {provider:new MockMarketDataProvider(symbolLimit),trade:new MockExchangeAdapter()};
}
