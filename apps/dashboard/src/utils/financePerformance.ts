import {numberOrNull,stale,type LampTone} from './performanceFacts';
export const fundingTone=(value:number|null):LampTone=>value===null?'unknown':value<500?'bad':value<1000?'warn':'good';
export function financePerformance(snapshot:any,now=Date.now()){
 const account=snapshot?.account,fresh=account?.status==='READY'&&!stale(account.asOf,now,60000);
 return ['USDT','USDC'].map(asset=>{
  const balances=Array.isArray(account?.assets)?account.assets.filter((r:any)=>r.asset===asset):[];
  const row=balances.length===1?balances[0]:null,available=fresh?numberOrNull(row?.availableBalance):null;
  const earnings=snapshot?.localAccounting?.byAsset?.[asset];
  return {asset,asOf:account?.asOf??null,available,tone:fundingTone(available),unrealized:fresh?numberOrNull(row?.unrealizedPnl):null,
   exFundingNet:fresh&&earnings?.completeCycles>0?numberOrNull(earnings.exFundingNet):null,
   allInNet:fresh&&earnings?.canonicalEligible>0?numberOrNull(earnings.canonicalNetPnl):null,
   completeCycles:numberOrNull(earnings?.completeCycles),canonicalEligible:numberOrNull(earnings?.canonicalEligible)};
 });
}
