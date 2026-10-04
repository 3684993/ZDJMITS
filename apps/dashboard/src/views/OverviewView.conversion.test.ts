// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Overview from './OverviewView.vue';
import { api } from '../api/client';

vi.mock('../stores/system', () => ({ useSystemStore: () => ({ snapshot: null, settings: null, refresh: vi.fn() }) }));
vi.mock('../api/client', () => ({ api: { pipeline: vi.fn(), accountAssets: vi.fn() } }));

/** The shape the live account produced on 2026-09-25: every PLACE died at the trade plan. */
const windowOf = (over: Record<string, unknown> = {}) => ({
  since: 1, until: 2,
  primaryCompleted: 26, place: 26, riskAllowed: 26, economicAdmissionPassed: 26,
  tradePlanReady: 0, reservationCreated: 0, intentCreated: 0, submitAttempted: 0, orderSubmitted: 0, entryFilled: 0, waitingPrice: 0,
  blocked: [{ stage: 'TRADE_PLAN', reason: 'HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY', count: 26 }],
  ratios: { placeToTradePlan: 0, tradePlanToSubmit: null, placeToSubmit: 0, submitToFill: null },
  topDropStage: 'TRADE_PLAN', topDropReason: 'HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY', topDropCount: 26,
  degraded: false, degradedReason: null, ...over,
});

const pipeline = (entryConversion: unknown, over: Record<string, unknown> = {}) => ({
  asOf: 1, pipelineState: 'RUNNING', noEntryReason: null,
  eligibility: { status: 'READY', count: 6 },
  runtimeControl: { mode: 'RUNNING', reasonText: '运行中', capital: { executableCandidateCount: 6, routedCandidates: [] }, entrySafetyMode: 'AUTO' },
  entryPermission: { status: 'ALLOWED', executionMode: 'TESTNET_ENABLED', autoExecutionMode: 'AUTO_RUNNING' },
  executionReadiness: { status: 'EXECUTION_READY', ready: true, mode: 'EXECUTION_READY', blockers: [], firstBlocker: null, blockersText: '' },
  portfolioRiskProfile: { status: 'READY', configured: true, version: 'v396r40', missingFields: [], blockers: [] },
  entryActivity: { primaryCount30m: 26, placeCount30m: 26, rejectCount30m: 0, submitCount30m: 0, fillCount30m: 0 },
  entryConversion, ...over,
});

async function open(payload: any) {
  vi.mocked(api.pipeline).mockResolvedValue(payload);
  vi.mocked(api.accountAssets).mockResolvedValue({ assets: [] } as never);
  const wrapper = mount(Overview, { global: { stubs: { Panel: { template: '<div><slot/></slot></div>' }, StatusBadge: { props: ['value'], template: '<span>{{ value }}</span>' } } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());

it('renders the whole conversion chain from the Engine projection, in order, without counting anything itself', async () => {
  const wrapper = await open(pipeline({thirtyMinutes: windowOf(), oneHour: windowOf({place: 52, primaryCompleted: 52})}));
  const funnel = wrapper.find('[data-entry-conversion]').text();
  const order = ['Primary 完成', 'PLACE', '组合风险准入（TESTNET 可不适用）', 'TradePlan 就绪', 'Reservation 建立', 'Intent 建立', '订单已提交', '建仓成交'];
  for (const label of order) expect(funnel.indexOf(label), `${label} must be present`).toBeGreaterThan(-1);
  expect(order.every((label, index, all) => index === 0 || funnel.indexOf(label) > funnel.indexOf(all[index - 1])), 'the stages must read top-down as the chain runs').toBe(true);
  expect(funnel).toContain('TradePlan 就绪0');
  expect(funnel).toContain('订单已提交0');
  expect(wrapper.find('[data-conversion-drop]').text()).toContain('TRADE_PLAN');
  expect(wrapper.find('[data-conversion-drop]').text()).toContain('HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY');
  expect(wrapper.text()).toContain('0%');
  expect(wrapper.find('[data-conversion-degraded]').exists(), 'a window the Engine did not flag must not be flagged here').toBe(false);
});

it('switching the window asks the Engine for the other one instead of recomputing locally', async () => {
  const wrapper = await open(pipeline({
    thirtyMinutes: windowOf({place: 26, blocked: [], topDropStage: null, topDropReason: null, topDropCount: 0}),
    oneHour: windowOf({place: 61, topDropCount: 35}),
  }));
  expect(wrapper.find('[data-entry-conversion]').text()).toContain('PLACE26');
  await wrapper.findAll('button').find((button) => button.text() === '1 小时')!.trigger('click');
  await flushPromises();
  expect(wrapper.find('[data-entry-conversion]').text()).toContain('PLACE61');
  expect(wrapper.find('[data-conversion-drop]').text()).toContain('35 次');
});

it('a degraded funnel is an alarm line, never a claim that execution was paused', async () => {
  const wrapper = await open(pipeline({
    thirtyMinutes: windowOf({degraded: true, degradedReason: 'ENTRY_CONVERSION_DEGRADED:TRADE_PLAN:PLAN_SIDE_NOT_EXECUTABLE:LONG'}),
    oneHour: windowOf({}),
  }));
  const alert = wrapper.find('[data-conversion-degraded]').text();
  expect(alert).toContain('ENTRY_CONVERSION_DEGRADED');
  expect(alert).toContain('不会自动暂停');
  // The permission line still reads AUTO/ready in the same breath: nothing here changes the lock.
  expect(wrapper.text()).toContain('Testnet 自动流程已启用');
});

it('readiness and an order on the exchange stay different sentences', async () => {
  const wrapper = await open(pipeline({thirtyMinutes: windowOf(), oneHour: windowOf({})}));
  const text = wrapper.text();
  expect(text).toContain('EXECUTION_READY');
  expect(text).toContain('订单已提交0');
  expect(text).toContain('执行就绪只说明有权进入链路');
});

it('an older Engine that publishes no projection says so instead of showing zeros', async () => {
  const wrapper = await open(pipeline(null));
  expect(wrapper.text()).toContain('Engine 尚未提供转化投影');
  expect(wrapper.find('[data-entry-conversion]').exists()).toBe(false);
});
