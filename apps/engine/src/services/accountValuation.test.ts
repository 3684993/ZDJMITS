import {expect,it} from 'vitest';
import {reconcileAccountValuation} from './accountValuation.js';

it('defines cockpit total as USDT plus USDC and excludes BTC',()=>{
  const value=reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'-30',totalMarginBalance:'470'},[
    {asset:'USDT',walletBalance:500,availableBalance:200,unrealizedPnl:-30,usdValue:500},
    {asset:'USDC',walletBalance:300,availableBalance:280,unrealizedPnl:-5,usdValue:300},
    {asset:'BTC',walletBalance:.01,availableBalance:.01,unrealizedPnl:0,usdValue:700},
  ]);
  expect(value).toMatchObject({status:'RECONCILED',scope:'BINANCE_ASSET_ROWS_USDT_USDC_ONLY',totalWalletUsd:800,totalAvailableUsd:480,totalUnrealizedPnlUsd:-35,totalEquityUsd:765,stablecoinWalletUsd:800,stablecoinMarginUsd:765,excludedAssets:['BTC']});
});
it('detects a USDT top-level mismatch without pulling BTC or other assets into the total',()=>{
  const value=reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'0',totalMarginBalance:'400'},[
    {asset:'USDT',walletBalance:500,availableBalance:500,unrealizedPnl:0,usdValue:500},
    {asset:'USDC',walletBalance:300,availableBalance:300,unrealizedPnl:0,usdValue:300},
    {asset:'BTC',walletBalance:.5,availableBalance:.5,unrealizedPnl:0,usdValue:35000},
  ]);
  expect(value.status).toBe('ACCOUNT_VALUATION_INCONSISTENT');
  expect(value.totalEquityUsd).toBe(800);
  expect(value.excludedAssets).toEqual(['BTC']);
});
