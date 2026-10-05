/** All stablecoin values are taken from one signed account response. Top-level V2 totals
 * are USDT-only in single-asset mode and serve only as a USDT invariant. */
export function reconcileAccountValuation(account:any,assets:Array<{asset:string;walletBalance:number;availableBalance?:number;unrealizedPnl:number;marginBalance?:number|null;usdValue:number|null}>){
  const usdt=assets.find(row=>row.asset==='USDT');
  const usdc=assets.find(row=>row.asset==='USDC');
  const unknownAssets=assets.filter(row=>row.usdValue===null&&(Number(row.walletBalance)!==0||Number(row.unrealizedPnl)!==0||Number(row.availableBalance??0)!==0)).map(row=>row.asset);
  const number=(value:unknown):number|null=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
  const exchangeUsdtWallet=number(account.totalWalletBalance);
  const exchangeUsdtUnrealized=number(account.totalUnrealizedProfit);
  const exchangeUsdtMargin=number(account.totalMarginBalance);
  const usdtWallet=number(usdt?.walletBalance),usdcWallet=number(usdc?.walletBalance);
  const usdtUnrealized=number(usdt?.unrealizedPnl),usdcUnrealized=number(usdc?.unrealizedPnl);
  const usdtMarginEquityUsd=number(usdt?.marginBalance)??(usdtWallet!==null&&usdtUnrealized!==null?usdtWallet+usdtUnrealized:null);
  const usdcMarginEquityUsd=number(usdc?.marginBalance)??(usdcWallet!==null&&usdcUnrealized!==null?usdcWallet+usdcUnrealized:null);
  const combinedStablecoinMarginEquityUsd=usdtMarginEquityUsd!==null&&usdcMarginEquityUsd!==null?usdtMarginEquityUsd+usdcMarginEquityUsd:null;
  const combinedStablecoinWalletUsd=usdtWallet!==null&&usdcWallet!==null?usdtWallet+usdcWallet:null;
  const usdtAvailableUsd=number(usdt?.availableBalance),usdcAvailableUsd=number(usdc?.availableBalance);
  const combinedStablecoinAvailableUsd=usdtAvailableUsd!==null&&usdcAvailableUsd!==null?usdtAvailableUsd+usdcAvailableUsd:null;
  const combinedStablecoinUnrealizedPnlUsd=usdtUnrealized!==null&&usdcUnrealized!==null?usdtUnrealized+usdcUnrealized:null;
  const stablecoinWalletUsd=combinedStablecoinWalletUsd,stablecoinMarginUsd=combinedStablecoinMarginEquityUsd;
  const toleranceUsd=.02;
  const consistent=exchangeUsdtMargin!==null&&usdtWallet!==null&&usdtUnrealized!==null&&
    Math.abs(exchangeUsdtMargin-(usdtWallet+usdtUnrealized))<=toleranceUsd&&
    (exchangeUsdtWallet===null||Math.abs(exchangeUsdtWallet-usdtWallet)<=toleranceUsd)&&
    (exchangeUsdtUnrealized===null||Math.abs(exchangeUsdtUnrealized-usdtUnrealized)<=toleranceUsd);
  return {status:!usdt||!usdc?'PARTIAL':consistent?(unknownAssets.length?'PARTIAL':'RECONCILED'):'ACCOUNT_VALUATION_INCONSISTENT',
    scope:'BINANCE_V2_ACCOUNT_TOTALS_USDT_ONLY',exchangeUsdtWallet,exchangeUsdtUnrealized,exchangeUsdtMargin,
    usdtMarginEquityUsd,usdcMarginEquityUsd,combinedStablecoinMarginEquityUsd,usdtWalletUsd:usdtWallet,usdcWalletUsd:usdcWallet,usdtAvailableUsd,usdcAvailableUsd,combinedStablecoinWalletUsd,combinedStablecoinAvailableUsd,combinedStablecoinUnrealizedPnlUsd,
    stablecoinWalletUsd,stablecoinMarginUsd,unknownAssets,excludedAssets:assets.filter(row=>!['USDT','USDC'].includes(row.asset)&&(Number(row.walletBalance)!==0||Number(row.unrealizedPnl)!==0||Number(row.availableBalance??0)!==0)).map(row=>row.asset),toleranceUsd,
    assetValuationComplete:unknownAssets.length===0&&combinedStablecoinMarginEquityUsd!==null};
}
