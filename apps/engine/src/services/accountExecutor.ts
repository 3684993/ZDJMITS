import type { ExchangeTradeAdapter } from '../types.js';
import type { ManualOrder } from '@zdj/contracts';

/** The only write boundary used by human position actions. */
export class AccountExecutor {
  constructor(private readonly exchange:ExchangeTradeAdapter){}
  submit(request:Parameters<ExchangeTradeAdapter['placeManualOrder']>[0]):Promise<ManualOrder>{return this.exchange.placeManualOrder(request);}
}
