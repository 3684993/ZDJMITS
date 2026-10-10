import {expect,it} from 'vitest';
import {binanceRequestWeight,inferredBinanceSource} from './BinanceTransport.js';
// Official USD-M REST Account spec, retrieved2026-10-10. No network.
it.each([['leverageBracket',1],['commissionRate',20],['multiAssetsMargin',30],['positionSide/dual',30],['income',30],['openOrders',40]])('uses official %s request weight%s without changing its private/source classification',(path,weight)=>{
 const url=new URL('https://demo-fapi.binance.com/fapi/v1/'+path);expect(binanceRequestWeight(url)).toBe(weight);expect(inferredBinanceSource(url,'GET')).not.toBe('MARKET_DATA');
});
