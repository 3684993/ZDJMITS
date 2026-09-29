import { describe, expect, it } from 'vitest';
import { cycleMoments, holdingDuration, positionCycleKey, type HoldingFacts } from './holdingDuration';

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const NOW = 1_770_000_000_000;

const proven = (overrides: Partial<HoldingFacts> = {}): HoldingFacts => ({
  id: 'pos_1', symbol: 'BTCUSDT', side: 'LONG', cycleId: 'cycle_1',
  openedAt: NOW - 3 * DAY - 5 * HOUR, firstObservedAt: NOW - 3 * DAY - 5 * HOUR,
  entryTimeSource: 'SYSTEM_FILL', ...overrides,
});

describe('holdingDuration', () => {
  it('computes continuous holding from the physical cycle openedAt and drops zero leading units', () => {
    expect(holdingDuration(proven(), NOW)).toMatchObject({
      provenance: 'CONTINUOUS',
      text: '连续持有 3天5小时',
    });
    expect(holdingDuration(proven({ openedAt: NOW - 3 * HOUR - 12 * MINUTE }), NOW).text).toBe('连续持有 3小时12分');
    expect(holdingDuration(proven({ openedAt: NOW - 26 * HOUR }), NOW).text).toBe('连续持有 1天2小时');
    expect(holdingDuration(proven({ openedAt: NOW - 90 * MINUTE }), NOW).text).toBe('连续持有 1小时30分');
    expect(holdingDuration(proven({ openedAt: NOW - 45_000 }), NOW).text).toBe('连续持有 不足 1 分');
  });

  it('says the duration is named after the proven first fill source', () => {
    const result = holdingDuration(proven(), NOW);
    expect(result.detail).toContain('系统成交回报');
    expect(result.detail).toContain('补仓与部分平仓不重置该起点');
  });

  it('does not reset continuous holding when the position was added to', () => {
    const before = holdingDuration(proven(), NOW);
    const afterAdd = holdingDuration(proven({ lastAddAt: NOW - 2 * HOUR, addCount: 3, lastReviewAt: NOW - HOUR }), NOW);
    expect(afterAdd.text).toBe(before.text);
    expect(afterAdd.provenance).toBe('CONTINUOUS');
    // the add is a separate moment, never a new cycle start
    expect(cycleMoments(afterAdd).map((row) => row.key)).toContain('lastAdd');
  });

  it('does not reset continuous holding after a partial close', () => {
    const partial = holdingDuration(proven({ lastAddAt: null, addCount: 0 }), NOW);
    expect(partial.text).toBe('连续持有 3天5小时');
    expect(partial.provenance).toBe('CONTINUOUS');
  });

  it('starts a fresh duration when the cycle returns to zero and re-opens under a new cycle id', () => {
    const reopened = holdingDuration(proven({
      cycleId: 'cycle_2', openedAt: NOW - 2 * HOUR, firstObservedAt: NOW - 2 * HOUR, lastAddAt: null, addCount: 0,
    }), NOW);
    expect(reopened.text).toBe('连续持有 2小时');
    expect(positionCycleKey(reopened, 'TESTNET', 'acct')).not.toBe(positionCycleKey(proven(), 'TESTNET', 'acct'));
  });

  it('reports a lower bound when only the first observation is available', () => {
    const result = holdingDuration(proven({ openedAt: 0, firstObservedAt: NOW - 2 * DAY - 7 * HOUR, entryTimeSource: 'UNKNOWN' }), NOW);
    expect(result.provenance).toBe('FIRST_OBSERVED');
    expect(result.text).toBe('至少 2天7小时（首次观察）');
  });

  it('treats an openedAt without a proven fill source as an observation, not a continuous cycle', () => {
    for (const source of ['IMPORTED_AT_STARTUP', 'UNKNOWN', null, undefined]) {
      const result = holdingDuration(proven({ entryTimeSource: source as string | null }), NOW);
      expect(result.provenance).toBe('FIRST_OBSERVED');
      expect(result.text).toContain('（首次观察）');
      expect(result.detail).toContain('不足以证明首次成交');
    }
  });

  it('reports unknown rather than inventing zero when neither moment is provable', () => {
    for (const broken of [{ openedAt: 0, firstObservedAt: null }, { openedAt: null, firstObservedAt: 0 }, { openedAt: Number.NaN, firstObservedAt: Number.POSITIVE_INFINITY }]) {
      const result = holdingDuration(proven(broken), NOW);
      expect(result.provenance).toBe('UNKNOWN');
      expect(result.text).toBe('持有时间未知');
    }
    expect(holdingDuration(null, NOW)).toMatchObject({ provenance: 'UNKNOWN', text: '持有时间未知' });
  });

  it('clamps a future timestamp at zero instead of rendering a negative duration', () => {
    const result = holdingDuration(proven({ openedAt: NOW + 10 * MINUTE, firstObservedAt: NOW + 10 * MINUTE }), NOW);
    expect(result.text).toBe('连续持有 不足 1 分');
    expect(result.text).not.toContain('-');
    expect(result.provenance).toBe('CONTINUOUS');
  });
});

describe('cycleMoments', () => {
  it('lists the distinct cycle moments and omits the ones that never happened', () => {
    const moments = cycleMoments(proven({ lastAddAt: NOW - 2 * HOUR, addCount: 2, lastReviewAt: NOW - 9 * MINUTE }));
    const keys = moments.map((row) => row.key);
    expect(keys).toEqual(['opened', 'firstObserved', 'lastAdd', 'lastReview']);
    expect(moments[0].text).toContain('首次成交（系统成交回报）');
    expect(moments[2].text).toContain('最近补仓');
    expect(moments[2].text).toContain('累计补仓 2 次');
    expect(moments[3].text).toContain('最近复核');
    expect(cycleMoments(proven({ lastAddAt: null, lastReviewAt: null, humanManagedAt: null })).map((row) => row.key)).toEqual(['opened', 'firstObserved']);
    expect(cycleMoments(null)).toEqual([]);
  });

  it('labels the human handoff moment separately from the cycle start', () => {
    const moments = cycleMoments(proven({ managementStatus: 'HUMAN_MANAGED' as never, humanManagedAt: NOW - HOUR }));
    expect(moments.some((row) => row.key === 'humanManaged' && row.text.includes('进入人工处置'))).toBe(true);
  });
});

describe('positionCycleKey', () => {
  const environment = 'testnet', account = 'BINANCE_USDM_TESTNET';

  it('keeps LONG and SHORT rows apart on the same symbol', () => {
    const long = positionCycleKey(proven(), environment, account);
    const short = positionCycleKey(proven({ side: 'SHORT', cycleId: 'cycle_3' }), environment, account);
    expect(long).toContain('|LONG|');
    expect(short).toContain('|SHORT|');
    expect(long).not.toBe(short);
  });

  it('never reuses the previous row identity when a cycle re-opens on the same symbol and side', () => {
    const first = positionCycleKey(proven(), environment, account);
    const second = positionCycleKey(proven({ cycleId: 'cycle_2', openedAt: NOW - HOUR }), environment, account);
    expect(second).not.toBe(first);
  });

  it('carries environment and account so two accounts on one symbol stay separate', () => {
    expect(positionCycleKey(proven(), 'PRODUCTION', account)).not.toBe(positionCycleKey(proven(), environment, account));
    expect(positionCycleKey(proven(), environment, 'OTHER_ACCOUNT')).not.toBe(positionCycleKey(proven(), environment, account));
  });

  it('falls back to the physical cycle key and then to an explicit no-cycle marker', () => {
    expect(positionCycleKey(proven({ cycleId: null, physicalCycleKey: 'physical_9' }), environment, account)).toContain('physical_9');
    const marker = positionCycleKey(proven({ cycleId: null, physicalCycleKey: null }), environment, account);
    expect(marker).toContain('NO_CYCLE:pos_1');
    expect(positionCycleKey(null, null, null)).toBe('UNKNOWN|UNKNOWN|UNKNOWN|UNKNOWN|NO_CYCLE:UNKNOWN');
  });
});
