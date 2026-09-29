// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Positions from './PositionsView.vue';
import { makeDashboardSnapshot, makePosition } from '../testing/dashboardSnapshotFixture';

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const NOW = 1_800_000_000_000;

let store: any;
vi.mock('../stores/system', () => ({ useSystemStore: () => store }));

// The rows are the contract's own positions: every cycle field the page reads was parsed by
// DashboardSnapshotSchema first, so a renamed field fails here instead of rendering undefined.
const positions = () => [
  makePosition({
    id: 'pos_btc_long', cycleId: 'cycle_btc_long', symbol: 'BTCUSDT', side: 'LONG',
    openedAt: NOW - 3 * DAY - 5 * HOUR, firstObservedAt: NOW - 3 * DAY - 5 * HOUR,
    entryTimeSource: 'SYSTEM_FILL', lastAddAt: NOW - 2 * HOUR, addCount: 2, lastReviewAt: NOW - 30 * MINUTE,
  }),
  makePosition({
    id: 'pos_btc_short', cycleId: 'cycle_btc_short', symbol: 'BTCUSDT', side: 'SHORT',
    quantity: 1, entryPrice: 60_500, markPrice: 60_000, unrealizedPnl: 250, unrealizedPnlPercent: 4,
    openedAt: NOW - 4 * HOUR - 10 * MINUTE, firstObservedAt: NOW - 4 * HOUR - 10 * MINUTE,
    entryTimeSource: 'BINANCE_TRADE_HISTORY', tpStatus: 'MISSING', tpOrderId: null, tpCoverageSource: 'NONE',
  }),
  makePosition({
    id: 'pos_eth_imported', cycleId: 'cycle_eth_short', symbol: 'ETHUSDT', side: 'SHORT',
    quantity: 4, entryPrice: 3_000, markPrice: 2_980, unrealizedPnl: 80, unrealizedPnlPercent: 1.2,
    openedAt: 0, firstObservedAt: NOW - 2 * DAY - 7 * HOUR, entryTimeSource: 'IMPORTED_AT_STARTUP',
  }),
  makePosition({
    id: 'pos_sol_unknown', cycleId: 'cycle_sol_long', symbol: 'SOLUSDT', side: 'LONG',
    quantity: 12, entryPrice: 140, markPrice: 141, unrealizedPnl: 12, unrealizedPnlPercent: 0.7,
    openedAt: 0, firstObservedAt: null, entryTimeSource: 'UNKNOWN',
  }),
];

function open(overrides: Record<string, unknown> = {}) {
  const snapshot = makeDashboardSnapshot({ positions: positions(), ...overrides });
  store = { snapshot, positions: [...snapshot.positions], settings: snapshot.settings, repairTp: vi.fn() };
  return mount(Positions, { global: { stubs: { Panel: { template: '<div><slot/><slot name="actions"/></div>' }, StatusBadge: true, PositionConsole: true, EmptyState: true } } });
}

function mediaMatches(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mediaMatches(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PositionsView holding duration', () => {
  it('shows each cycle its own duration and provenance instead of one bare open timestamp', () => {
    const wrapper = open();
    const durations = wrapper.findAll('[data-holding-duration]').map((node) => node.text());
    expect(durations).toEqual([
      '连续持有 3天5小时',
      '连续持有 4小时10分',
      '至少 2天7小时（首次观察）',
      '持有时间未知',
    ]);
    const rows = wrapper.findAll('tr[data-position-id]');
    expect(rows).toHaveLength(4);
    expect(rows[0].find('[data-holding-provenance]').text()).toContain('系统成交回报');
    expect(rows[2].find('[data-holding-provenance]').text()).toContain('最早观察');
    expect(rows[3].find('[data-holding-provenance]').text()).toContain('无法计算连续持有');
  });

  it('lists the supporting moments beside the duration: opened source, last add and last review', () => {
    const first = open().findAll('tr[data-position-id]')[0];
    const moments = first.findAll('[data-cycle-moment]').map((node) => node.text());
    expect(moments.some((line) => line.startsWith('首次成交（系统成交回报）'))).toBe(true);
    expect(moments.some((line) => line.startsWith('首次观察'))).toBe(true);
    expect(moments.some((line) => line.startsWith('最近补仓') && line.includes('累计补仓 2 次'))).toBe(true);
    expect(moments.some((line) => line.startsWith('最近复核'))).toBe(true);
    // a cycle that never went to a human never shows a hand-off moment
    expect(moments.some((line) => line.includes('进入人工处置'))).toBe(false);
    expect(open().findAll('tr[data-position-id]')[3].findAll('[data-cycle-moment]')).toHaveLength(0);
  });

  it('keeps LONG and SHORT rows on the same symbol separate and ticks over without a refresh', async () => {
    const wrapper = open();
    const rows = wrapper.findAll('tr[data-position-id]');
    expect(rows[0].text()).toContain('连续持有 3天5小时');
    expect(rows[1].text()).toContain('连续持有 4小时10分');
    expect(rows.map((row) => row.attributes('data-position-id'))).toEqual(['pos_btc_long', 'pos_btc_short', 'pos_eth_imported', 'pos_sol_unknown']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wrapper.findAll('tr[data-position-id]')[1].find('[data-holding-duration]').text()).toBe('连续持有 4小时11分');
    // the add does not move the start: the added cycle keeps ageing from its first fill, not from the add
    expect(wrapper.findAll('tr[data-position-id]')[0].find('[data-holding-duration]').text()).toBe('连续持有 3天5小时1分');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(wrapper.findAll('tr[data-position-id]')[1].find('[data-holding-duration]').text()).toBe('连续持有 4小时11分');
  });

  it('repeats the duration and its moments on the mobile card', async () => {
    mediaMatches(true);
    const wrapper = open();
    await flushPromises();
    const cards = wrapper.findAll('.position-card');
    expect(cards).toHaveLength(4);
    expect(cards[0].find('[data-holding-duration]').text()).toBe('连续持有 3天5小时');
    const moments = cards[2].findAll('[data-cycle-moment]').map((node) => node.text());
    expect(moments.some((line) => line.startsWith('首次观察'))).toBe(true);
    expect(cards[2].find('[data-cycle-moments]').text()).toContain('最早观察');
    expect(cards[3].find('[data-holding-duration]').text()).toBe('持有时间未知');
  });

  it('gives a re-opened cycle a fresh row identity rather than the closed cycle history', () => {
    const reopened = positions();
    reopened[0] = makePosition({ ...reopened[0], cycleId: 'cycle_btc_long_v2', openedAt: NOW - 3 * HOUR, firstObservedAt: NOW - 3 * HOUR });
    const wrapper = open({ positions: reopened });
    expect(wrapper.findAll('[data-holding-duration]')[0].text()).toBe('连续持有 3小时');
  });
});
