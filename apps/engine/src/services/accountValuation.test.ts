import {expect,it} from 'vitest';
import {reconcileAccountValuation} from './accountValuation.js';
it('reconciles USDT account totals while keeping USDC and unpriced BTC distinct',()=>{
  const value=reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'-30',totalMarginBalance:'470'},[
    {asset:'USDT',walletBalance:500,unrealizedPnl:-30,usdValue:500},
    {asset:'USDC',walletBalance:300,unrealizedPnl:-5,usdValue:300},
    {asset:'BTC',walletBalance:.01,unrealizedPnl:0,usdValue:null},
  ]);
  expect(value).toMatchObject({status:'PARTIAL',exchangeUsdtMargin:470,stablecoinWalletUsd:800,stablecoinMarginUsd:765,combinedStablecoinMarginEquityUsd:765,combinedStablecoinUnrealizedPnlUsd:-35,excludedAssets:['BTC'],unknownAssets:['BTC']});
  expect(reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'0',totalMarginBalance:'500'},[{asset:'USDT',walletBalance:500,unrealizedPnl:0,usdValue:500}])).toMatchObject({status:'PARTIAL',combinedStablecoinMarginEquityUsd:null});
  expect(reconcileAccountValuation({totalWalletBalance:'500',totalUnrealizedProfit:'0',totalMarginBalance:'400'},[{asset:'USDT',walletBalance:500,unrealizedPnl:0,usdValue:500},{asset:'USDC',walletBalance:0,unrealizedPnl:0,usdValue:0}]).status).toBe('ACCOUNT_VALUATION_INCONSISTENT');
});
it('uses same-snapshot asset margin balances and excludes BTC from combined equity',()=>{
  const rows=[{asset:'USDT',walletBalance:100,availableBalance:70,unrealizedPnl:-4,marginBalance:96,usdValue:100},{asset:'USDC',walletBalance:50,availableBalance:50,unrealizedPnl:2,marginBalance:52,usdValue:50},{asset:'BTC',walletBalance:1,availableBalance:1,unrealizedPnl:0,marginBalance:1,usdValue:90000}];
  expect(reconcileAccountValuation({totalWalletBalance:'100',totalUnrealizedProfit:'-4',totalMarginBalance:'96'},rows)).toMatchObject({combinedStablecoinMarginEquityUsd:148,combinedStablecoinWalletUsd:150,combinedStablecoinAvailableUsd:120,combinedStablecoinUnrealizedPnlUsd:-2,excludedAssets:['BTC']});
});
it('does not replace a missing USDT or USDC fact with the top-level USDT total',()=>{
  const account={totalWalletBalance:'100',totalUnrealizedProfit:'0',totalMarginBalance:'100'};
  const usdt={asset:'USDT',walletBalance:100,availableBalance:90,unrealizedPnl:0,usdValue:100};
  const usdc={asset:'USDC',walletBalance:50,availableBalance:50,unrealizedPnl:0,usdValue:50};
  expect(reconcileAccountValuation(account,[usdt])).toMatchObject({status:'PARTIAL',combinedStablecoinMarginEquityUsd:null,assetValuationComplete:false});
  expect(reconcileAccountValuation(account,[usdc])).toMatchObject({status:'PARTIAL',combinedStablecoinMarginEquityUsd:null,assetValuationComplete:false});
  expect(reconcileAccountValuation(account,[usdt,usdc])).toMatchObject({status:'RECONCILED',combinedStablecoinMarginEquityUsd:150});
  expect(reconcileAccountValuation(account,[usdt,usdc,{asset:'BNB',walletBalance:0,availableBalance:0,unrealizedPnl:0,usdValue:null}])).toMatchObject({status:'RECONCILED',unknownAssets:[],excludedAssets:[]});
  expect(reconcileAccountValuation(account,[{...usdt,unrealizedPnl:null as any},usdc])).toMatchObject({status:'ACCOUNT_VALUATION_INCONSISTENT',combinedStablecoinMarginEquityUsd:null});
});
