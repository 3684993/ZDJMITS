import {expect,it} from 'vitest';
import {reconcileAccountValuation} from './accountValuation.js';
it('reconciles USDT account totals while keeping USDC and unpriced BTC distinct',()=>{
  const value=reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'-30',totalMarginBalance:'470'},[
    {asset:'USDT',walletBalance:500,unrealizedPnl:-30,usdValue:500},
    {asset:'USDC',walletBalance:300,unrealizedPnl:-5,usdValue:300},
    {asset:'BTC',walletBalance:.01,unrealizedPnl:0,usdValue:null},
  ]);
  expect(value).toMatchObject({status:'PARTIAL',exchangeUsdtMargin:470,stablecoinWalletUsd:800,stablecoinMarginUsd:765,unknownAssets:['BTC']});
  expect(reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'0',totalMarginBalance:'500'},[{asset:'USDT',walletBalance:500,unrealizedPnl:0,usdValue:500}]).status).toBe('RECONCILED');
  expect(reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'0',totalMarginBalance:'400'},[{asset:'USDT',walletBalance:500,unrealizedPnl:0,usdValue:500}]).status).toBe('ACCOUNT_VALUATION_INCONSISTENT');
});
