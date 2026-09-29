/**
 * P7: the cockpit must answer "how long has this physical cycle been held" from the cycle's own facts.
 *
 * The audit found that a single absolute open timestamp was being presented as if it were proven truth.
 * Continuous holding may only be computed from the physical cycle's `openedAt`, which is the trusted
 * first fill; adding to a position must not reset it and a partial close must not reset it either. When
 * that moment is not provable, the honest answer is "at least X since we first observed it", and when
 * neither moment exists the answer is unknown — never a guessed zero and never a stale row's history.
 */

export type HoldingProvenance = 'CONTINUOUS' | 'FIRST_OBSERVED' | 'UNKNOWN';

export interface HoldingFacts {
  id?: string | null;
  symbol?: string | null;
  side?: string | null;
  cycleId?: string | null;
  physicalCycleKey?: string | null;
  openedAt?: number | null;
  firstObservedAt?: number | null;
  lastAddAt?: number | null;
  addCount?: number | null;
  lastReviewAt?: number | null;
  nextReviewAt?: number | null;
  humanManagedAt?: number | null;
  entryTimeSource?: string | null;
}

export interface HoldingDuration {
  text: string;
  provenance: HoldingProvenance;
  detail: string;
}

export interface CycleMoment {
  key: 'opened' | 'firstObserved' | 'lastAdd' | 'lastReview' | 'humanManaged';
  label: string;
  at: number;
  absolute: string;
  source: string | null;
  text: string;
}

/**
 * Only these entry-time sources are a fill the system or the exchange actually observed; they prove that
 * `openedAt` is the cycle's first fill. `IMPORTED_AT_STARTUP` and `UNKNOWN` merely record when somebody
 * noticed the position, which is exactly the case the 至少…（首次观察） wording exists for.
 */
const PROVEN_FIRST_FILL_SOURCES = new Set([
  'SYSTEM_FILL',
  'BINANCE_TRADE_HISTORY',
  'BINANCE_ORDER_HISTORY',
  'SQLITE_EXECUTION_HISTORY',
  'RECONCILIATION',
]);

const SOURCE_LABELS: Record<string, string> = {
  SYSTEM_FILL: '系统成交回报',
  BINANCE_TRADE_HISTORY: '交易所成交历史',
  BINANCE_ORDER_HISTORY: '交易所订单历史',
  SQLITE_EXECUTION_HISTORY: '本地执行历史',
  RECONCILIATION: '交易所对账',
  IMPORTED_AT_STARTUP: '启动导入（首次观察）',
  UNKNOWN: '来源未知',
};

/** A moment is provable only when it is a real, finite, positive timestamp. */
const moment = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export function entryTimeSourceLabel(source: string | null | undefined): string | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  return SOURCE_LABELS[source] ?? source;
}

const absolute = (at: number) => new Date(at).toLocaleString();

/** Days / hours / minutes, with the zero-valued leading units dropped. Never negative. */
function units(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(clamped / 1_440);
  const hours = Math.floor((clamped % 1_440) / 60);
  const minutes = clamped % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分`);
  return parts.join('') || '不足 1 分';
}

export function holdingDuration(facts: HoldingFacts | null | undefined, now = Date.now()): HoldingDuration {
  const openedAt = moment(facts?.openedAt);
  const firstObservedAt = moment(facts?.firstObservedAt);
  const source = typeof facts?.entryTimeSource === 'string' ? facts.entryTimeSource.trim() : '';
  const proven = PROVEN_FIRST_FILL_SOURCES.has(source);

  if (openedAt !== null && proven) {
    return {
      provenance: 'CONTINUOUS',
      text: `连续持有 ${units(now - openedAt)}`,
      detail: `周期起点为 ${entryTimeSourceLabel(source)}记录的首次成交 ${absolute(openedAt)}；补仓与部分平仓不重置该起点`,
    };
  }

  // The timestamp exists but is not a proven first fill, or there is only the observation moment:
  // the duration becomes a floor, and the label says so.
  const observedAt = firstObservedAt ?? openedAt;
  if (observedAt !== null) {
    return {
      provenance: 'FIRST_OBSERVED',
      text: `至少 ${units(now - observedAt)}（首次观察）`,
      detail: `${openedAt !== null ? `建仓时间 ${absolute(openedAt)} 的来源${entryTimeSourceLabel(source) ?? '未标注'}不足以证明首次成交；` : ''}最早观察 ${absolute(observedAt)}，仅作为下限`,
    };
  }

  return {
    provenance: 'UNKNOWN',
    text: '持有时间未知',
    detail: 'openedAt 与 firstObservedAt 均缺失或非正数，无法计算连续持有',
  };
}

/**
 * The moments an operator must be able to tell apart: the cycle's start, its observation floor, the
 * last add, the last review and the human handoff. Absent moments are omitted rather than shown as 0.
 */
export function cycleMoments(facts: HoldingFacts | null | undefined): CycleMoment[] {
  if (!facts) return [];
  const out: CycleMoment[] = [];
  const push = (key: CycleMoment['key'], label: string, at: unknown, source?: string | null, note?: string | null) => {
    const value = moment(at);
    if (value === null) return;
    const absoluteText = absolute(value);
    const sourceText = source ? `（${source}）` : '';
    const noteText = note ? ` · ${note}` : '';
    out.push({ key, label, at: value, absolute: absoluteText, source: source ?? null, text: `${label}${sourceText} ${absoluteText}${noteText}` });
  };
  const addCount = typeof facts.addCount === 'number' && Number.isFinite(facts.addCount) ? facts.addCount : null;
  push('opened', '首次成交', facts.openedAt, entryTimeSourceLabel(facts.entryTimeSource));
  push('firstObserved', '首次观察', facts.firstObservedAt);
  push('lastAdd', '最近补仓', facts.lastAddAt, null, addCount && addCount > 0 ? `累计补仓 ${addCount} 次` : null);
  push('lastReview', '最近复核', facts.lastReviewAt);
  push('humanManaged', '进入人工处置', facts.humanManagedAt);
  return out;
}

/**
 * Identity for the UI. Keying a row on the symbol alone merges a LONG and a SHORT hedge row, and keying
 * on the symbol+side alone makes a re-opened cycle inherit the previous cycle's rendered state.
 */
export function positionCycleKey(
  facts: HoldingFacts | null | undefined,
  environment?: string | null,
  account?: string | null,
): string {
  const tag = (value: unknown) => {
    const text = String(value ?? '').trim();
    return (text || 'UNKNOWN').toUpperCase();
  };
  const cycle =
    (typeof facts?.cycleId === 'string' && facts.cycleId.trim()) ||
    (typeof facts?.physicalCycleKey === 'string' && facts.physicalCycleKey.trim()) ||
    `NO_CYCLE:${String(facts?.id ?? '').trim() || 'UNKNOWN'}`;
  return [
    tag(environment),
    tag(account),
    tag(facts?.symbol),
    tag(facts?.side),
    cycle,
  ].join('|');
}
