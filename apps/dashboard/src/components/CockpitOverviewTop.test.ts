// @vitest-environment jsdom
import {mount} from '@vue/test-utils';
import {it,expect,vi} from 'vitest';
import CockpitOverviewTop from './CockpitOverviewTop.vue';
vi.mock('./PerformanceTrend.vue',()=>({default:{template:'<div data-trend-stub />'}}));
const now=200000;
const accountRead={status:'READY',source:'BINANCE_TESTNET_ACCOUNT',asOf:now,assets:[{asset:'USDT',availableBalance:897.73253986,walletBalance:6348.65},{asset:'USDC',availableBalance:3764.21320535,walletBalance:5171.46}]};
const snapshot={ts:now,snapshotVersion:1,account:{status:'READY',asOf:now,valuation:{status:'RECONCILED',combinedStablecoinMarginEquityUsd:8912.21}},positions:[],performanceTracking:{rolling:{exchange:{status:'READY',source:'BINANCE_INCOME',fetchedAt:now,tradingNetExFunding:1084.16,funding:-56.55,allInNet:1027.61}}}};
it('draws real first-point structures without fabricating historical lines; separate accounting and native thresholds',async()=>{
 const w=mount(CockpitOverviewTop,{props:{snapshot,accountRead,now,trade24h:null}});
 expect(w.find('[data-finance-first-screen] svg').exists()).toBe(true);
 expect(w.findAll('[data-trend-stub]')).toHaveLength(0);
 expect(w.find('[data-asset-chart="USDT"] .availability').classes()).toContain('warn');
 expect(w.find('[data-asset-chart="USDC"] .availability').classes()).toContain('good');
 expect(w.text()).toContain('1,084.16');expect(w.text()).toContain('-56.55');expect(w.text()).toContain('1,027.61');
 await w.setProps({snapshot:{...snapshot,ts:now+14980,snapshotVersion:2},now:now+15000});
 expect(w.findAll('[data-trend-stub]').length).toBeGreaterThan(0);
 w.unmount();
});
it('hides stale financial values and does not use cached snapshot values to mask rejected signed asset facts',()=>{
 const w=mount(CockpitOverviewTop,{props:{snapshot,accountRead:{...accountRead,asOf:now-61000},now,trade24h:null}});
 expect(w.find('[data-asset-chart="USDT"] .availability').classes()).toContain('unknown');
 expect(w.text()).not.toContain('897.733');expect(w.text()).not.toContain('8,912.21');w.unmount();
});
