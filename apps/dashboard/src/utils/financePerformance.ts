import {numberOrNull,stale,type LampTone} from './performanceFacts';
export const fundingTone=(value:number|null):LampTone=>value===null?'unknown':value<500?'bad':value<1000?'warn':'good';
/** Use the separately signed account-assets endpoint when DashboardSnapshot intentionally omits asset rows.
 * Snapshot and account-assets facts are never summed; stale/duplicate/no-source values stay null.
 */
export function financePerformance(snapshot:any,now=Date.now(),accountRead?:any){
 const snapshotAccount=snapshot?.account;
 const live=(a:any)=>['BINANCE_TESTNET_ACCOUNT','BINANCE_TESTNET_PRIVATE','BINANCE_ACCOUNT'].includes(a?.source)&&a?.status==='READY'&&!stale(a.asOf,now,60_000)&&Array.isArray(a.assets);
 const account=accountRead!==undefined?(live(accountRead)?accountRead:null):(live(snapshotAccount)?snapshotAccount:null);
 return ['USDT','USDC'].map(asset=>{
  const balances=Array.isArray(account?.assets)?account.assets.filter((r:any)=>r?.asset===asset):[];
  const row=balances.length===1?balances[0]:null;
  const available=numberOrNull(row?.availableBalance);
  const earnings=snapshot?.localAccounting?.byAsset?.[asset];
  const incomeFresh=account!==null;
  return {asset,asOf:account?.asOf??null,available,tone:fundingTone(available),wallet:numberOrNull(row?.walletBalance),
   source:account?.source??null,
   status:available===null?'等待签名账户余额':null,
   unrealized:incomeFresh?numberOrNull(row?.unrealizedPnl):null,
   exFundingNet:incomeFresh&&earnings?.completeCycles>0?numberOrNull(earnings.exFundingNet):null,
   allInNet:incomeFresh&&earnings?.canonicalEligible>0?numberOrNull(earnings.canonicalNetPnl):null,
   completeCycles:numberOrNull(earnings?.completeCycles),canonicalEligible:numberOrNull(earnings?.canonicalEligible)};
 });
}
