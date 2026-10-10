// @vitest-environment jsdom
import {mount} from '@vue/test-utils';
import {describe,it,expect} from 'vitest';
import FinanceRiskAtlas from './FinanceRiskAtlas.vue';
const now=200000;
const valuation={status:'RECONCILED',usdtMarginEquityUsd:4240.94,usdcMarginEquityUsd:4671.27,combinedStablecoinMarginEquityUsd:8912.21};
const snapshot={ts:now,account:{status:'READY',asOf:now},portfolioIntelligence:{longNotionalUsd:34352.75,shortNotionalUsd:13463.50},
 performanceTracking:{rolling:{local:{completeCycles:34,fundingUnknownCycles:34}}},
 executionTruth:{activeCommissions:{remoteConfirmedEntry:0,remoteConfirmedTakeProfit:28,localUnresolvedUnknown:218}}};
describe('finance risk atlas: source-separated live-only charts',()=>{
 it('renders reconciled equity, gross exposure, exact funding gap and local unknown separately',()=>{
  const w=mount(FinanceRiskAtlas,{props:{snapshot,valuation,now}});
  expect(w.find('[data-finance-atlas-equity] svg').exists()).toBe(true);
  expect(w.find('[data-finance-atlas-equity]').text()).toContain('4,240.94');
  expect(w.find('[data-finance-atlas-equity]').text()).toContain('4,671.27');
  expect(w.find('[data-finance-atlas-exposure]').text()).toContain('34,352.75');
  expect(w.find('[data-finance-atlas-funding]').text()).toContain('34');
  expect(w.find('[data-finance-atlas-orders]').text()).toContain('218');
  expect(w.find('[data-finance-atlas-orders]').text()).toContain('不是交易所活动挂单');
  w.unmount();
 });
 it('marks old snapshots and inconsistent native components unknown rather than drawing misleading proportions',()=>{
  const old={...snapshot,ts:now-61000,account:{...snapshot.account,asOf:now-61000}};
  const w=mount(FinanceRiskAtlas,{props:{snapshot:old,valuation,now}});
  expect(w.find('[data-finance-atlas-equity] svg').exists()).toBe(false);
  expect(w.find('[data-finance-atlas-exposure]').text()).toContain('—');
  expect(w.find('[data-finance-atlas-orders]').text()).toContain('—');
  w.unmount();
  const inconsistent=mount(FinanceRiskAtlas,{props:{snapshot,valuation:{...valuation,combinedStablecoinMarginEquityUsd:9999},now}});
  expect(inconsistent.find('[data-finance-atlas-equity] svg').exists()).toBe(false);
  inconsistent.unmount();
 });
 it('keeps incomplete order/funding facts unknown and never substitutes zeros',()=>{
  const w=mount(FinanceRiskAtlas,{props:{snapshot:{...snapshot,performanceTracking:{rolling:{local:{completeCycles:34,fundingUnknownCycles:35}}},executionTruth:{activeCommissions:{remoteConfirmedTakeProfit:28}}},valuation,now}});
  expect(w.find('[data-finance-atlas-funding]').text()).toContain('—');
  expect(w.find('[data-finance-atlas-orders]').text()).toContain('—');
  w.unmount();
 });
});
