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
