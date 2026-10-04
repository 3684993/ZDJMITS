/** Read-side reconciliation only. Binance V2 account totals are USDT-denominated account fields;
 * other margin assets must be displayed separately unless their conversion is proven. */
export function reconcileAccountValuation(account:any,assets:Array<{asset:string;walletBalance:number;unrealizedPnl:number;usdValue:number|null}>){
  const usdt=assets.find(row=>row.asset==='USDT');
  const stable=assets.filter(row=>['USDT','USDC','BUSD'].includes(row.asset));
  const unknownAssets=assets.filter(row=>row.usdValue===null).map(row=>row.asset);
  const number=(value:unknown):number|null=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
  const exchangeUsdtWallet=number(account.totalWalletBalance);
  const exchangeUsdtUnrealized=number(account.totalUnrealizedProfit);
  const exchangeUsdtMargin=number(account.totalMarginBalance);
  const usdtWallet=usdt?.walletBalance??null;
  const usdtUnrealized=usdt?.unrealizedPnl??null;
  const stablecoinWalletUsd=stable.reduce((sum,row)=>sum+(row.usdValue??0),0);
  const stablecoinMarginUsd=stable.reduce((sum,row)=>sum+row.walletBalance+row.unrealizedPnl,0);
  const toleranceUsd=.02;
  const consistent=exchangeUsdtMargin!==null&&usdtWallet!==null&&usdtUnrealized!==null&&
    Math.abs(exchangeUsdtMargin-(usdtWallet+usdtUnrealized))<=toleranceUsd&&
    (exchangeUsdtWallet===null||Math.abs(exchangeUsdtWallet-usdtWallet)<=toleranceUsd)&&
    (exchangeUsdtUnrealized===null||Math.abs(exchangeUsdtUnrealized-usdtUnrealized)<=toleranceUsd);
  return {status:consistent?(unknownAssets.length?'PARTIAL':'RECONCILED'):'ACCOUNT_VALUATION_INCONSISTENT',
    scope:'BINANCE_V2_ACCOUNT_TOTALS_USDT_ONLY',exchangeUsdtWallet,exchangeUsdtUnrealized,exchangeUsdtMargin,
    stablecoinWalletUsd,stablecoinMarginUsd,unknownAssets,toleranceUsd,
    assetValuationComplete:unknownAssets.length===0};
}
