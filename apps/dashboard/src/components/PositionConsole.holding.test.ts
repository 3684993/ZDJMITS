// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Console from '../components/PositionConsole.vue';
import { api } from '../api/client';
import { makeDashboardSnapshot, makePosition } from '../testing/dashboardSnapshotFixture';

vi.mock('../api/client', () => ({ api: { position: vi.fn(), manualPreview: vi.fn(), manualPosition: vi.fn(), cancelLimits: vi.fn(), cancelConditionals: vi.fn() } }));
let store: any;
vi.mock('../stores/system', () => ({ useSystemStore: () => store }));

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const NOW = 1_800_000_000_000;

async function open(position: Record<string, unknown>) {
  const snapshot = makeDashboardSnapshot({ positions: [position] });
  store = { snapshot, positions: [...snapshot.positions], settings: snapshot.settings, refresh: vi.fn() };
  vi.mocked(api.position).mockResolvedValue({
    position: snapshot.positions[0],
    tp: { id: 'tp_1', quantity: position.quantity, price: 62_000, status: 'WORKING' },
    tradeRecord: null, manualIntents: [], audit: [],
  } as never);
  const wrapper = mount(Console, { props: { positionId: String(position.id) }, global: { stubs: { Panel: { template: '<div><slot/><slot name="actions"/></div>' }, StatusBadge: true } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('PositionConsole holding duration', () => {
  it('ages the physical cycle from its proven first fill and labels the provenance', async () => {
    const wrapper = await open(makePosition({
      id: 'pos_btc_long', cycleId: 'cycle_btc_long', symbol: 'BTCUSDT', side: 'LONG',
      openedAt: NOW - 3 * DAY - 5 * HOUR, firstObservedAt: NOW - 3 * DAY - 5 * HOUR,
      entryTimeSource: 'SYSTEM_FILL', lastAddAt: NOW - 2 * HOUR, addCount: 2, lastReviewAt: NOW - 12 * MINUTE,
    }));
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 3天5小时');
    expect(wrapper.find('[data-holding-provenance]').text()).toContain('系统成交回报');
    expect(wrapper.find('[data-holding-provenance]').text()).toContain('补仓与部分平仓不重置该起点');
    expect(wrapper.find('[data-position-cycle-key]').text()).toContain('TESTNET|BINANCE_USDM_TESTNET|BTCUSDT|LONG|cycle_btc_long');
    const moments = wrapper.findAll('[data-cycle-moment]').map((node) => node.text());
    expect(moments.some((line) => line.startsWith('最近补仓') && line.includes('累计补仓 2 次'))).toBe(true);
    expect(moments.some((line) => line.startsWith('最近复核'))).toBe(true);
  });

  it('does not age an unproven entry time as a continuous cycle', async () => {
    const wrapper = await open(makePosition({
      id: 'pos_eth_imported', cycleId: 'cycle_eth_short', symbol: 'ETHUSDT', side: 'SHORT',
      openedAt: NOW - 10 * DAY, firstObservedAt: NOW - 2 * DAY - 7 * HOUR, entryTimeSource: 'IMPORTED_AT_STARTUP',
    }));
    expect(wrapper.find('[data-holding-duration]').text()).toBe('至少 2天7小时（首次观察）');
    expect(wrapper.find('[data-holding-duration]').text()).not.toContain('10天');
  });

  it('reports an unknown duration instead of a bare 0 when no moment is provable', async () => {
    const wrapper = await open(makePosition({
      id: 'pos_sol_unknown', cycleId: 'cycle_sol_long', symbol: 'SOLUSDT', side: 'LONG',
      openedAt: 0, firstObservedAt: null, entryTimeSource: 'UNKNOWN',
    }));
    expect(wrapper.find('[data-holding-duration]').text()).toBe('持有时间未知');
    expect(wrapper.find('[data-cycle-moments]').text()).toBe('');
  });

  it('ticks over on its own clock and stops the clock when the console closes', async () => {
    const wrapper = await open(makePosition({
      id: 'pos_btc_long', cycleId: 'cycle_btc_long', symbol: 'BTCUSDT', side: 'LONG',
      openedAt: NOW - 2 * HOUR - 5 * MINUTE, firstObservedAt: NOW - 2 * HOUR - 5 * MINUTE, entryTimeSource: 'SYSTEM_FILL',
    }));
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 2小时5分');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 2小时6分');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 2小时6分');
  });

  it('keeps explicit manual limit submission available when live preview is unavailable', async () => {
    vi.mocked(api.manualPreview).mockRejectedValue(new Error('MARKET_DATA_UNAVAILABLE'));
    vi.mocked(api.manualPosition).mockResolvedValue({ intent: { id: 'manual_limit_1', status: 'ACCEPTED' } } as never);
    const wrapper = await open(makePosition({
      id: 'pos_btc_long', cycleId: 'cycle_btc_long', symbol: 'BTCUSDT', side: 'LONG', quantity: 0.02,
      openedAt: NOW - HOUR, firstObservedAt: NOW - HOUR, entryTimeSource: 'SYSTEM_FILL',
    }));
    await wrapper.findAll('button').find(node => node.text().includes('限价挂单'))!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('仍可输入明确限价并提交');
    const inputs = wrapper.findAll('.manual-form input');
    await inputs[0]!.setValue('0.01');
    await inputs[1]!.setValue('61500');
    await wrapper.findAll('button').find(node => node.text().includes('确认提交'))!.trigger('click');
    await flushPromises();
    expect(api.manualPosition).toHaveBeenCalledWith('pos_btc_long', expect.objectContaining({action:'PLACE_LIMIT',quantity:0.01,price:61500,confirm:false,idempotencyKey:expect.stringMatching(/^ui_/)}));
  });
});
