// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Overview from './OverviewView.vue';
import { api } from '../api/client';
import { makeDashboardSnapshot } from '../testing/dashboardSnapshotFixture';

let store: any;
vi.mock('../stores/system', () => ({ useSystemStore: () => store }));
vi.mock('../api/client', () => ({ api: { pipeline: vi.fn(), accountAssets: vi.fn() } }));

const CHECK_KEYS = ['exchangeIngestion', 'orderTerminalParity', 'exitClaimConvergence', 'takeProfitCoverage', 'positionCoverage', 'fillCycleConservation', 'fundingCoverage', 'reviewAuthority'];

async function openWith(snapshot: any) {
  store = { snapshot, settings: snapshot.settings, positions: [], refresh: vi.fn() };
  vi.mocked(api.pipeline).mockResolvedValue({ asOf: 1 } as never);
  vi.mocked(api.accountAssets).mockResolvedValue({ assets: [] } as never);
  const wrapper = mount(Overview, {
    global: {
      stubs: {
        Panel: { props: ['title', 'subtitle'], template: '<div><h2 v-if="title">{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p><slot/></div>' },
        StatusBadge: { props: ['value'], template: '<span>[{{ value }}]</span>' },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const open = (overrides: Record<string, unknown> = {}) => openWith(makeDashboardSnapshot(overrides));

beforeEach(() => vi.clearAllMocks());

describe('active order classification', () => {
  it('splits active commissions by what proves them and never sums them into one figure', async () => {
    const kpi = (await open()).find('[data-active-commissions]');
    const rows = kpi.findAll('[data-commission]');
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.attributes('data-commission'))).toEqual([
      'remoteConfirmedEntry', 'remoteConfirmedTakeProfit', 'manual', 'localUnresolvedUnknown',
    ]);
    expect(rows[0].text()).toContain('交易所确认 · 建仓委托');
    expect(rows[0].text()).toContain('1');
    expect(rows[1].text()).toContain('交易所确认 · 止盈委托');
    expect(rows[2].text()).toContain('人工委托');
    expect(kpi.text()).toContain('按证明来源分列（不相加）');
    // 1 + 2 + 0 + 4 was the old single number; the page must not present it again.
    expect(kpi.text()).not.toContain('7');
  });

  it('says the local unresolved count is an accounting exposure, not a live exchange order', async () => {
    const unresolved = (await open()).find('[data-commission="localUnresolvedUnknown"]');
    expect(unresolved.text()).toContain('本地未决 UNKNOWN');
    expect(unresolved.text()).toContain('4');
    expect(unresolved.text()).toContain('账面敞口');
    expect(unresolved.text()).toContain('交易所并未确认其存活');
    expect(unresolved.find('strong').classes()).toContain('negative');
  });

  it('falls back to the two legacy numbers labelled as unclassified when executionTruth is absent', async () => {
    const kpi = (await open({ executionTruth: undefined })).find('[data-active-commissions]');
    expect(kpi.text()).toContain('活动委托 · 分类不可用');
    expect(kpi.find('[data-commissions-unavailable]').exists()).toBe(true);
    expect(kpi.find('[data-commission="legacyEntry"]').text()).toContain('建仓委托（旧口径，未区分证明来源）');
    expect(kpi.find('[data-commission="legacyEntry"]').text()).toContain('1');
    expect(kpi.find('[data-commission="legacyTp"]').text()).toContain('2');
    expect(kpi.text()).toContain('无法区分交易所确认与本地未决');
    expect(kpi.findAll('[data-commission]')).toHaveLength(2);
  });
});

describe('health decomposition', () => {
  it('renders the eight execution-truth checks as separate verdicts with their own detail', async () => {
    const wrapper = await open();
    const cards = wrapper.findAll('[data-truth-check]');
    expect(cards).toHaveLength(8);
    expect(cards.map((card) => card.attributes('data-truth-check'))).toEqual(CHECK_KEYS);
    const byKey = new Map(cards.map((card) => [card.attributes('data-truth-check'), card.text()]));
    expect(byKey.get('exchangeIngestion')).toContain('交易所数据摄取');
    expect(byKey.get('exchangeIngestion')).toContain('[HEALTHY]');
    expect(byKey.get('exchangeIngestion')).toContain('健康');
    expect(byKey.get('exitClaimConvergence')).toContain('[DEGRADED]');
    expect(byKey.get('exitClaimConvergence')).toContain('降级');
    expect(byKey.get('exitClaimConvergence')).toContain('未收敛任务 3');
    expect(byKey.get('exitClaimConvergence')).toContain('最久未轮询 15 分');
    expect(byKey.get('takeProfitCoverage')).toContain('已保护 2');
    expect(byKey.get('positionCoverage')).toContain('交易所持仓 2');
    expect(byKey.get('fundingCoverage')).toContain('[PARTIAL]');
    expect(byKey.get('fundingCoverage')).toContain('部分覆盖');
    expect(byKey.get('reviewAuthority')).toContain('[DISABLED]');
    expect(byKey.get('reviewAuthority')).toContain('未启用');
    expect(byKey.get('orderTerminalParity')).toContain('当前订单终态不一致 0');
  });

  it('renders a degraded check without touching any other check verdict', async () => {
    const degraded = makeDashboardSnapshot();
    degraded.executionTruth = {
      ...degraded.executionTruth!,
      positionCoverage: { status: 'UNKNOWN', local: 2, remote: 0, detail: 'RECONCILIATION_NOT_REPORTED' },
    };
    const cards = (await openWith(degraded)).findAll('[data-truth-check]');
    expect(cards[4].text()).toContain('[UNKNOWN]');
    expect(cards[4].text()).toContain('未知');
    expect(cards[4].text()).not.toContain('健康');
    // the aggregate impression the audit complained about is never derived from the neighbours
    expect(cards[3].text()).toContain('HEALTHY');
  });

  it('adds the decomposition beside the cockpit surfaces that were already there', async () => {
    const wrapper = await open();
    expect(wrapper.find('[data-execution-truth]').exists()).toBe(true);
    expect(wrapper.text()).toContain('执行真相 · 八项独立检查');
    expect(wrapper.text()).toContain('每一项只回答自己的问题');
    // nothing the cockpit already presented is replaced by the new section
    expect(wrapper.text()).toContain('最近 1 小时交易事实');
    expect(wrapper.text()).toContain('新建仓执行权限');
    expect(wrapper.text()).toContain('实时执行链');
  });

  it('states the exit convergence queue numbers instead of a settled label', async () => {
    const queue = (await open()).find('[data-exit-convergence]');
    expect(queue.find('[data-convergence="openTasks"] dt').text()).toBe('排队中的退出任务');
    expect(queue.find('[data-convergence="openTasks"] dd').text()).toBe('3');
    expect(queue.find('[data-convergence="oldestUnpolledAgeMs"] dd').text()).toBe('15 分');
    expect(queue.find('[data-convergence="terminalUnreleasedClaims"] dd').text()).toBe('1');
    expect(queue.find('[data-convergence="maxServiceIntervalMs"] dd').text()).toBe('5 分');
  });

  it('reports an unprojected truth and queue as unknown rather than healthy', async () => {
    const wrapper = await open({ executionTruth: undefined, exitConvergence: undefined });
    const cards = wrapper.findAll('[data-truth-check]');
    expect(cards).toHaveLength(8);
    for (const card of cards) {
      expect(card.text()).toContain('[UNKNOWN]');
      expect(card.text()).toContain('未知');
      expect(card.text()).toContain('EXECUTION_TRUTH_NOT_PROJECTED');
      expect(card.text()).not.toContain('健康');
    }
    expect(wrapper.find('[data-truth-unavailable]').text()).toContain('本实例 Engine 未投影执行真相');
    expect(wrapper.find('[data-exit-convergence-unavailable]').text()).toContain('EXIT_CONVERGENCE_NOT_PROJECTED');
    expect(wrapper.find('[data-exit-convergence-unavailable]').text()).toContain('未知不等于已收敛');
  });

  it('says a closed exit runtime is unavailable instead of an empty healthy queue', async () => {
    const wrapper = await open({ exitConvergence: { available: false, reason: 'EXIT_RUNTIME_NOT_ATTACHED' } });
    const text = wrapper.find('[data-exit-convergence]').text();
    expect(text).toContain('EXIT_RUNTIME_NOT_ATTACHED');
    expect(text).toContain('退出收敛队列未投影');
    expect(wrapper.findAll('[data-convergence]')).toHaveLength(0);
  });

  it('breaks the last hour of exchange fills down by provenance', async () => {
    const wrapper = await open();
    const rows = wrapper.findAll('[data-fill-provenance-row]');
    expect(rows.map((row) => row.attributes('data-fill-provenance-row'))).toEqual(['SYSTEM_ORDER_LINK', 'UNPROVEN', 'EXTERNAL_AUDIT']);
    expect(rows[0].text()).toContain('2 笔');
    expect(wrapper.find('[data-fill-provenance]').exists()).toBe(true);
  });

  it('names a missing provenance breakdown instead of showing nothing', async () => {
    const wrapper = await open({ exchangeFillFacts: { fillsByProvenanceLast1h: undefined } });
    expect(wrapper.find('[data-fill-provenance]').exists()).toBe(false);
    expect(wrapper.find('[data-fill-provenance-unavailable]').text()).toContain('未投影按证明来源分列的成交事实');
  });
});
