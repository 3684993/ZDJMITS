import {it,expect} from 'vitest';
import {financePerformance,fundingTone} from './financePerformance';
it('uses exact 500/1000 thresholds; unknown never green and loss stays negative',()=>{
 expect([null,0,499.99,500,999.99,1000].map(fundingTone)).toEqual(['unknown','bad','bad','warn','warn','good']);
 const snapshot={account:{status:'READY',asOf:1000,assets:[{asset:'USDT',availableBalance:400,unrealizedPnl:-7},{asset:'USDC',availableBalance:2000},{asset:'BTC',availableBalance:3}]},localAccounting:{byAsset:{USDT:{completeCycles:1,exFundingNet:-5,canonicalEligible:0,canonicalNetPnl:null},USDC:{completeCycles:1,exFundingNet:2,canonicalEligible:1,canonicalNetPnl:3}}}};
 const rows=financePerformance(snapshot,1000);expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({available:400,tone:'bad',exFundingNet:-5,allInNet:null,unrealized:-7});expect(rows[1]).toMatchObject({available:2000,tone:'good',exFundingNet:2,allInNet:3});expect(financePerformance(snapshot,70000)[0].available).toBeNull();
});
it('rejects duplicate asset balances and unsupported aggregate PnL',()=>{
 const rows=financePerformance({account:{status:'READY',asOf:1000,assets:[{asset:'USDT',availableBalance:1},{asset:'USDT',availableBalance:2}]},localAccounting:{exFundingNet:123}},1000);
 expect(rows[0].available).toBeNull();expect(rows[0].exFundingNet).toBeNull();expect(rows[1].available).toBeNull();
});

it('prefers fresh signed /account/assets facts when the realtime snapshot omits asset rows',()=>{
 const now=200000;
 const snapshot={account:{status:'READY',asOf:199000,assets:[]},localAccounting:{byAsset:{USDT:{completeCycles:2,exFundingNet:1.5},USDC:{completeCycles:1,exFundingNet:-2}}}};
 const signed={status:'READY',asOf:200004,source:'BINANCE_TESTNET_PRIVATE',assets:[
  {asset:'USDT',walletBalance:6308.88812107,availableBalance:472.82854605,unrealizedPnl:-99},
  {asset:'USDC',walletBalance:5172.35005888,availableBalance:3752.3121458,unrealizedPnl:-80}]};
 const balances=financePerformance(snapshot,now,signed);
 expect(balances[0]).toMatchObject({asset:'USDT',available:472.82854605,tone:'bad',source:'BINANCE_TESTNET_PRIVATE',exFundingNet:1.5});
 expect(balances[1]).toMatchObject({asset:'USDC',available:3752.3121458,tone:'good',exFundingNet:-2});
});
it('never invents stablecoin numbers when both signed candidates are stale',()=>{
 const r=financePerformance({account:{status:'READY',asOf:1000,assets:[{asset:'USDT',availableBalance:1000}]}},200000,
   {status:'READY',asOf:1000,assets:[{asset:'USDT',availableBalance:3000}]});
 expect(r[0]).toMatchObject({available:null,tone:'unknown',status:'等待签名账户余额'});
});
