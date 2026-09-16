import {expect,it} from 'vitest';
import {binanceHealthBlocksEntry,getBinanceRequestBudget,binanceEntryBlockReason} from './requestBudget.js';

it('allows entries under soft pressure and blocks only the hard/private-truth states',()=>{
  expect(binanceHealthBlocksEntry('AVAILABLE')).toBe(false);
  expect(binanceHealthBlocksEntry('PRESSURED')).toBe(false);
  expect(binanceHealthBlocksEntry('PRIVATE_ONLY')).toBe(true);
  expect(binanceHealthBlocksEntry('SATURATED')).toBe(true);
  expect(binanceHealthBlocksEntry('RATE_LIMITED')).toBe(true);
  expect(binanceHealthBlocksEntry('RECOVERING')).toBe(true);
});

it('route-scoped entry gate ignores a stale saturated proxy route',()=>{
  const oldRoute=getBinanceRequestBudget('TESTNET','proxy-old-entry-gate-test'),currentRoute=getBinanceRequestBudget('TESTNET','proxy-current-entry-gate-test');
  oldRoute.configureRequestWeightLimit(6000);currentRoute.configureRequestWeightLimit(6000);
  oldRoute.observe(200,'5800',undefined,{source:'MARKET_DATA',endpoint:'/fapi/v1/ticker/24hr',routeIdentity:'proxy-old-entry-gate-test'});
  currentRoute.observe(200,'100',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/account',routeIdentity:'proxy-current-entry-gate-test'});
  expect(binanceEntryBlockReason('TESTNET','proxy-old-entry-gate-test')).toBe('BINANCE_BUDGET_SATURATED');
  expect(binanceEntryBlockReason('TESTNET','proxy-current-entry-gate-test')).toBeNull();
  expect(binanceEntryBlockReason('TESTNET')).toBeNull();
});
