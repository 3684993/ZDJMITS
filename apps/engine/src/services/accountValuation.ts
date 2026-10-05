/** Cockpit account-total reconciliation.
 * The displayed total is intentionally USDT + USDC only. BTC/BUSD/other assets remain visible
 * as separate asset rows but never enter total assets or Entry-capital equity.
 * Binance V2 top-level totals are kept only as a USDT-side consistency cross-check. */
export function reconcileAccountValuation(account:any,assets:Array<{asset:string;walletBalance:number;availableBalance?:number;unrealizedPnl:number;usdValue:number|null}>){
  const number=(value:unknown):number|null=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
  const included=assets.filter(row=>row.asset==='USDT'||row.asset==='USDC');
  const excludedAssets=assets.filter(row=>row.asset!=='USDT'&&row.asset!=='USDC').map(row=>row.asset);
  const usdt=included.find(row=>row.asset==='USDT');
  const totalWalletUsd=included.reduce((sum,row)=>sum+Number(row.walletBalance||0),0);
  const totalAvailableUsd=included.reduce((sum,row)=>sum+Number(row.availableBalance||0),0);
  const totalUnrealizedPnlUsd=included.reduce((sum,row)=>sum+Number(row.unrealizedPnl||0),0);
  const totalEquityUsd=totalWalletUsd+totalUnrealizedPnlUsd;
  const exchangeUsdtWallet=number(account.totalWalletBalance);
  const exchangeUsdtUnrealized=number(account.totalUnrealizedProfit);
  const exchangeUsdtMargin=number(account.totalMarginBalance);
  const usdtWallet=usdt?.walletBalance??null,usdtUnrealized=usdt?.unrealizedPnl??null;
  const toleranceUsd=.02;
  const usdtCrossCheck=exchangeUsdtMargin===null||usdtWallet===null||usdtUnrealized===null?true:
    Math.abs(exchangeUsdtMargin-(usdtWallet+usdtUnrealized))<=toleranceUsd&&
    (exchangeUsdtWallet===null||Math.abs(exchangeUsdtWallet-usdtWallet)<=toleranceUsd)&&
    (exchangeUsdtUnrealized===null||Math.abs(exchangeUsdtUnrealized-usdtUnrealized)<=toleranceUsd);
  const includedFinite=included.every(row=>Number.isFinite(row.walletBalance)&&Number.isFinite(row.unrealizedPnl)&&Number.isFinite(Number(row.availableBalance??0)));
  return{
    status:usdtCrossCheck&&includedFinite?'RECONCILED':'ACCOUNT_VALUATION_INCONSISTENT',
    scope:'BINANCE_ASSET_ROWS_USDT_USDC_ONLY',
    exchangeUsdtWallet,exchangeUsdtUnrealized,exchangeUsdtMargin,
    stablecoinWalletUsd:totalWalletUsd,stablecoinMarginUsd:totalEquityUsd,
    totalWalletUsd,totalAvailableUsd,totalUnrealizedPnlUsd,totalEquityUsd,
    includedAssets:included.map(row=>row.asset),excludedAssets,unknownAssets:[],
    toleranceUsd,assetValuationComplete:includedFinite,
  };
}
