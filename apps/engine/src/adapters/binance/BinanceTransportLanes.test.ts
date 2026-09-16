import {expect,it} from 'vitest';
import {inferredBinanceSource,shouldDeferAtTransport} from './BinanceTransport.js';

const health=(status:string,used=6106)=>({status,admissionObservedWeight1m:used,softPublicWeight:3000});

it('classifies private truth and exchange rate-limit control separately from background/public REST',()=>{
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v1/time'),'GET')).toBe('CLOCK');
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v1/exchangeInfo'),'GET')).toBe('RATE_LIMIT_CONTROL');
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v2/positionRisk?signature=x'),'GET')).toBe('PRIVATE_STATE');
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v1/positionSide/dual?signature=x'),'GET')).toBe('PRIVATE_STATE');
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v1/openOrders?signature=x'),'GET')).toBe('RECONCILIATION');
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v1/income?signature=x'),'GET')).toBe('BACKGROUND_AUDIT');
  expect(inferredBinanceSource(new URL('https://testnet.binancefuture.com/fapi/v1/klines?symbol=BTCUSDT'),'GET')).toBe('MARKET_DATA');
});

it('never pre-deadlocks clock, private truth or execution just because local health says SATURATED',()=>{
  expect(shouldDeferAtTransport('CLOCK',health('SATURATED'),1)).toBe(false);
  expect(shouldDeferAtTransport('RATE_LIMIT_CONTROL',health('SATURATED'),1)).toBe(false);
  expect(shouldDeferAtTransport('PRIVATE_STATE',health('SATURATED'),5)).toBe(false);
  expect(shouldDeferAtTransport('ORDER_VERIFICATION',health('SATURATED'),1)).toBe(false);
  expect(shouldDeferAtTransport('RECONCILIATION',health('SATURATED'),5)).toBe(false);
  expect(shouldDeferAtTransport('EXECUTION_CRITICAL',health('SATURATED'),0)).toBe(false);
  expect(shouldDeferAtTransport('MARKET_DATA',health('SATURATED'),1)).toBe(true);
  expect(shouldDeferAtTransport('BACKGROUND_AUDIT',health('SATURATED'),30)).toBe(true);
});

it('sheds public/background REST before it consumes the private reserve',()=>{
  expect(shouldDeferAtTransport('MARKET_DATA',health('AVAILABLE',3000),1)).toBe(true);
  expect(shouldDeferAtTransport('BACKGROUND_AUDIT',health('AVAILABLE',2980),30)).toBe(true);
  expect(shouldDeferAtTransport('MARKET_DATA',health('AVAILABLE',2500),1)).toBe(false);
});
