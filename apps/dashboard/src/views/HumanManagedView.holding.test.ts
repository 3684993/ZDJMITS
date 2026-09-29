// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HumanManaged from './HumanManagedView.vue';
import { api } from '../api/client';
import { makeDashboardSnapshot, makePosition } from '../testing/dashboardSnapshotFixture';

vi.mock('../api/client', () => ({ api: { humanManaged: vi.fn(), acknowledgeHumanManaged: vi.fn() } }));
let store: any;
vi.mock('../stores/system', () => ({ useSystemStore: () => store }));

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const position = makePosition({
  id: 'pos_btc_long', cycleId: 'cycle_btc_long', symbol: 'BTCUSDT', side: 'LONG',
  openedAt: NOW - 3 * DAY - 5 * HOUR, firstObservedAt: NOW - 3 * DAY - 5 * HOUR,
  entryTimeSource: 'SYSTEM_FILL', lastAddAt: NOW - 2 * HOUR, addCount: 2, lastReviewAt: NOW - 20 * MINUTE,
  managementStatus: 'HUMAN_MANAGED', humanManagedAt: NOW - 6 * HOUR,
});
const reopened = makePosition({
  id: 'pos_btc_reopened', cycleId: 'cycle_btc_reopened', symbol: 'BTCUSDT', side: 'LONG',
  quantity: 0.2, openedAt: NOW - 40 * MINUTE, firstObservedAt: NOW - 40 * MINUTE,
  entryTimeSource: 'SQLITE_EXECUTION_HISTORY', managementStatus: 'HUMAN_MANAGED', humanManagedAt: NOW - 30 * MINUTE,
  lastAddAt: null, addCount: 0, lastReviewAt: null,
});

// The hand-off row carries its own openedAt and hand-off time but none of the cycle identity: the page
// must read the cycle facts from the snapshot position of the same id, not start a clock at hand-off.
const row = (p: any) => ({
  positionId: p.id, symbol: p.symbol, side: p.side, qty: p.quantity, entry: p.entryPrice, mark: p.markPrice,
  unrealizedPnl: p.unrealizedPnl, unrealizedPnlPercent: p.unrealizedPnlPercent, notional: 30_000, margin: 3_000,
  leverage: 10, openedAt: NOW - 6 * HOUR, humanManagedSince: p.humanManagedAt, tpStatus: p.tpStatus, tpPrice: 62_000,
  distanceToTpPct: 1.6, tpSource: 'BINANCE_OPEN_ORDER', fundingImpact: -3, fundingAttributionStatus: 'EXACT',
  severity: 'HIGH', severityScore: 42, portfolioExposureContributionPct: 18.4, equityNotionalPct: 152.3,
  underlyingExposureContributionPct: 21.9,
});

async function open(items: any[], positions: any[]) {
  const snapshot = makeDashboardSnapshot({ positions });
  store = { snapshot, positions: [...snapshot.positions], settings: snapshot.settings, refresh: vi.fn() };
  vi.mocked(api.humanManaged).mockResolvedValue({
    asOf: NOW, items,
    summary: { count: items.length, notionalUsd: 30_000, unrealizedPnl: 500, equityUsd: 19_685.67, caps: {}, newEntryBlockedByCaps: false },
    policy: {}, riskSnapshot: {},
  } as never);
  const wrapper = mount(HumanManaged, { global: { stubs: { Panel: { template: '<div><slot/></div>' }, PositionConsole: true, EmptyState: true } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('HumanManagedView holding duration', () => {
  it('shows the physical cycle duration and the moments that support it', async () => {
    const wrapper = await open([row(position)], [position]);
    const card = wrapper.findAll('.management-card')[0];
    expect(card.find('[data-holding-duration]').text()).toBe('连续持有 3天5小时');
    expect(card.find('[data-holding-provenance]').text()).toContain('系统成交回报');
    // the hand-off time is its own moment, never the start of the clock
    expect(card.text()).toContain('进入人工处置');
    expect(card.findAll('[data-cycle-moment]').map((node) => node.text()).some((line) => line.startsWith('最近补仓') && line.includes('累计补仓 2 次'))).toBe(true);
    expect(card.findAll('[data-cycle-moment]').map((node) => node.text()).some((line) => line.startsWith('最近复核'))).toBe(true);
    expect(card.find('[data-position-cycle-key]').text()).toContain('TESTNET|BINANCE_USDM_TESTNET|BTCUSDT|LONG|cycle_btc_long');
    expect(card.text()).toContain('系统成交回报');
  });

  it('never lets a re-opened cycle inherit the previous row state', async () => {
    const wrapper = await open([row(position), row(reopened)], [position, reopened]);
    const cards = wrapper.findAll('.management-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].find('[data-holding-duration]').text()).toBe('连续持有 3天5小时');
    expect(cards[1].find('[data-holding-duration]').text()).toBe('连续持有 40分');
    expect(cards[1].find('[data-position-cycle-key]').text()).toContain('cycle_btc_reopened');
    expect(cards[1].findAll('[data-cycle-moment]').map((node) => node.text()).some((line) => line.includes('最近补仓'))).toBe(false);
  });

  it('labels an unproven entry time as a lower bound and a missing one as unknown', async () => {
    const imported = makePosition({ id: 'pos_imported', cycleId: 'cycle_imported', symbol: 'ETHUSDT', side: 'SHORT', openedAt: 0, firstObservedAt: NOW - 2 * DAY - 7 * HOUR, entryTimeSource: 'IMPORTED_AT_STARTUP', humanManagedAt: NOW - HOUR });
    const noFacts = makePosition({ id: 'pos_no_facts', cycleId: 'cycle_no_facts', symbol: 'SOLUSDT', side: 'LONG', openedAt: 0, firstObservedAt: null, entryTimeSource: 'UNKNOWN', humanManagedAt: NOW - HOUR });
    const wrapper = await open([row(imported), row(noFacts)], [imported, noFacts]);
    const cards = wrapper.findAll('.management-card');
    expect(cards[0].find('[data-holding-duration]').text()).toBe('至少 2天7小时（首次观察）');
    expect(cards[1].find('[data-holding-duration]').text()).toBe('持有时间未知');
    expect(cards[1].find('[data-holding-duration]').text()).not.toContain('0天');
  });

  it('ticks the duration over without waiting for the next human-managed reload', async () => {
    const wrapper = await open([row(reopened)], [reopened]);
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 40分');
    await vi.advanceTimersByTimeAsync(90_000);
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 41分');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(wrapper.find('[data-holding-duration]').text()).toBe('连续持有 41分');
  });
});
