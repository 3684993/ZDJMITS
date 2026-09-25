/**
 * The single Run -> execution outcome projection (V3.9.6 §7).
 *
 * The Engine owns this answer: a reviewer must be able to read one row per Primary run and see
 * whether the decision reached the exchange, and if not, which layer stopped it and why. The
 * projection is folded from the durable event journal only - it never re-derives a fact from the
 * dashboard, and the dashboard never re-derives it from a status. Each stage of the chain now
 * writes its own event with `brainRunId`, so the fold is a join, not an inference.
 *
 * Two rules the tests pin down:
 * - Nothing is attributed across runs. An event without a run id is resolved through the
 *   intent/order index that the introducing event built, and a disagreement is reported as an
 *   inconsistent fact rather than quietly attached to whichever run is nearby.
 * - Absence is not failure. A PLACE whose execution facts have not been written yet is still
 *   running; only after the deterministic window has passed does the absence become a statement
 *   (`EXECUTION_LINEAGE_UNPROVEN`), because by then every layer would have written something.
 */

export type ExecutionState =
  | 'DECISION_ONLY'
  | 'EXECUTING'
  | 'WAITING_PRICE'
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED';

export type ExecutionBlockStage =
  | 'PRE_AI'
  | 'EVIDENCE'
  | 'EXECUTION_LEASE'
  | 'AI_VERIFY'
  | 'ECONOMICS'
  | 'PORTFOLIO_RISK'
  | 'TRADE_PLAN'
  | 'RESERVATION'
  | 'JIT'
  | 'ORDER'
  | 'SUBMIT'
  | 'EXECUTION_WAIT';

export interface RunExecutionOutcome {
  brainRunId: string;
  symbol: string;
  decision: string | null;
  direction: 'LONG' | 'SHORT' | null;
  decisionAt: number;
  executionState: ExecutionState;
  /** Engine-authored, because "已挂单" must not be a translation the browser invents. */
  executionLabel: string;
  blockStage: ExecutionBlockStage | null;
  blockReasons: string[];
  portfolioRiskAllowed: boolean | null;
  tradePlanId: string | null;
  tradePlanReady: boolean;
  reservationId: string | null;
  intentId: string | null;
  orderId: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  submittedAt: number | null;
  firstFillAt: number | null;
  updatedAt: number;
  /** False when no execution event of any kind carries this run: the chain never spoke about it. */
  lineageProven: boolean;
  inconsistentFacts: string[];
}

export interface LineageEvent {
  id?: string;
  type: string;
  ts: number;
  symbol?: string | null;
  payload?: unknown;
}

export interface RunRow {
  brainRunId: string;
  symbol?: string | null;
  decision?: string | null;
  direction?: string | null;
  decidedAt?: number | null;
}

/** Events the projection reads. Anything not listed here cannot change an execution outcome. */
export const ENTRY_EXECUTION_LINEAGE_EVENT_TYPES = [
  'ENTRY_ECONOMIC_ADMISSION_EVALUATED',
  'PORTFOLIO_RISK_ADMISSION_EVALUATED',
  'ENTRY_DECISION_BLOCKED',
  'CANDIDATE_REJECTED',
  'TRADE_PLAN_PERSISTED',
  'ENTRY_RESERVATION_CREATED',
  'ENTRY_INTENT_CREATED',
  'ENTRY_EXECUTION_WAITING',
  'ENTRY_ORDER_BLOCKED',
  'ENTRY_SUBMIT_ATTEMPTED',
  'ENTRY_SUBMIT_RESPONSE_RECOVERED',
  'ENTRY_ORDER_SUBMISSION_UNKNOWN',
  'ENTRY_ORDER_CREATED',
  'ENTRY_EXECUTION_WAIT_TERMINATED',
  'ORDER_FILL_RECONCILED',
  'ENTRY_FILLED',
] as const;

/** How long after a PLACE the deterministic layers may still be writing facts for that run. */
export const EXECUTION_LINEAGE_GRACE_MS = 5 * 60_000;

const BLOCK_STAGE: Record<string, ExecutionBlockStage> = {
  EIP: 'EVIDENCE',
  EVIDENCE: 'EVIDENCE',
  EXECUTION_LEASE: 'EXECUTION_LEASE',
  POST_AI_EXECUTION_LEASE: 'EXECUTION_LEASE',
  POST_AI_VERIFY: 'AI_VERIFY',
  POST_PRIMARY_EXECUTION_ENVELOPE: 'AI_VERIFY',
  ECONOMIC_ADMISSION: 'ECONOMICS',
  ECONOMICS: 'ECONOMICS',
  PORTFOLIO_RISK_ADMISSION: 'PORTFOLIO_RISK',
  PORTFOLIO_RISK: 'PORTFOLIO_RISK',
  TRADE_PLAN: 'TRADE_PLAN',
  RESERVATION: 'RESERVATION',
  LIVE_RISK_ENVELOPE: 'JIT',
  EXECUTION_PERMISSION: 'JIT',
  ORDER: 'ORDER',
  SET_LEVERAGE: 'ORDER',
  BINANCE_SUBMIT: 'SUBMIT',
  SUBMIT: 'SUBMIT',
  PRE_AI: 'PRE_AI',
  PRE_AI_TRADE_PLAN: 'PRE_AI',
  ENTRY_EXECUTION_WAIT_TERMINATED: 'EXECUTION_WAIT',
};

export const EXECUTION_LABELS: Record<ExecutionState, string> = {
  DECISION_ONLY: '仅决策 · 未进入执行链',
  EXECUTING: '正在执行',
  WAITING_PRICE: '等待价格',
  NOT_SUBMITTED: '未挂单',
  SUBMITTED: '已挂单',
  PARTIALLY_FILLED: '部分成交',
  FILLED: '已成交',
};

const isPlace = (decision: string | null | undefined) => String(decision ?? '').startsWith('PLACE_');
const stageOf = (event: LineageEvent, reason: string): ExecutionBlockStage | null => {
  const raw = String((event.payload as any)?.stage ?? '');
  if (reason.startsWith('JIT_BLOCKED:') || raw === 'JIT') return 'JIT';
  return BLOCK_STAGE[raw] ?? null;
};
const reasonsOf = (payload: any, fallback: string | null): string[] => {
  const list: string[] = Array.isArray(payload?.reasons) ? payload.reasons.map((row: unknown) => String(row)) : [];
  const first = payload?.reason != null ? String(payload.reason) : fallback;
  const all: string[] = first ? [first, ...list.filter((row) => row !== first)] : list;
  return [...new Set(all)].slice(0, 8);
};

interface Mutable {
  symbol: string;
  decision: string | null;
  direction: 'LONG' | 'SHORT' | null;
  decisionAt: number;
  planId: string | null;
  reservationId: string | null;
  intentId: string | null;
  orderId: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  submittedAt: number | null;
  firstFillAt: number | null;
  partialFillAt: number | null;
  waitingSince: number | null;
  portfolioRiskAllowed: boolean | null;
  blockStage: ExecutionBlockStage | null;
  blockReasons: string[];
  lineageProven: boolean;
  inconsistent: string[];
  updatedAt: number;
  submittedIntentId: string | null;
}

/**
 * Fold the durable execution facts for the given runs.
 *
 * `events` must be ordered by time ascending; the fold keeps the furthest forward fact as the
 * state and the most recent refusal as the explanation, and records any contradiction it sees
 * instead of resolving it by assumption.
 *
 * `fallbackRunId` is only for a caller whose event list is already scoped to one run - the durable
 * decision chain, which was keyed by that run when each event was written. Without it an event that
 * names no run and no known identity is dropped, because the alternative is guessing.
 */
export function projectRunExecutionOutcomes(
  events: LineageEvent[],
  runs: RunRow[],
  now = Date.now(),
  fallbackRunId: string | null = null,
): Map<string, RunExecutionOutcome> {
  const rows = new Map<string, Mutable>();
  for (const run of runs) {
    if (!run?.brainRunId) continue;
    rows.set(run.brainRunId, {
      symbol: String(run.symbol ?? ''),
      decision: run.decision == null ? null : String(run.decision),
      direction: run.direction === 'LONG' || run.direction === 'SHORT' ? run.direction : null,
      decisionAt: Number(run.decidedAt ?? now),
      planId: null, reservationId: null, intentId: null, orderId: null,
      clientOrderId: null, exchangeOrderId: null, submittedAt: null,
      firstFillAt: null, partialFillAt: null, waitingSince: null,
      portfolioRiskAllowed: null, blockStage: null, blockReasons: [],
      lineageProven: false, inconsistent: [], updatedAt: Number(run.decidedAt ?? now),
      submittedIntentId: null,
    });
  }
  // Introduced-by index: an event that only names an intent or order is attached to the run that
  // created it, never to whichever run last touched the symbol.
  const intentOwner = new Map<string, string>();
  const orderOwner = new Map<string, string>();
  const note = (index: Map<string, string>, id: unknown, brainRunId: string, what: string) => {
    const key = id == null ? '' : String(id);
    if (!key) return;
    const known = index.get(key);
    if (known && known !== brainRunId) {
      const row = rows.get(brainRunId) ?? rows.get(known);
      if (row) row.inconsistent.push(`${what}:${key} claimed by ${brainRunId} and ${known}`);
      return;
    }
    index.set(key, brainRunId);
  };

  for (const event of events) {
    const payload: any = event.payload ?? {};
    const runIdOf = (): string | null => {
      const direct = payload.brainRunId ?? payload.decisionChainId ?? payload.runId ?? null;
      const intentKey = payload.intentId ?? payload.intent?.id ?? null;
      const orderKey = payload.orderId ?? payload.order?.id ?? null;
      // The introducing event owns the identity: a later event that names the same intent or order
      // belongs to that run even if it signs itself with another one, because the second run never
      // created anything. Silence, not a plausible-looking row, is the alternative to this rule.
      const owner = (intentKey != null ? intentOwner.get(String(intentKey)) : undefined)
        ?? (orderKey != null ? orderOwner.get(String(orderKey)) : undefined) ?? null;
      if (owner != null) {
        if (direct != null && String(direct) !== owner) {
          const row = rows.get(owner);
          if (row) row.inconsistent.push(`${event.type}:brainRunId=${String(direct)} does not own ${String(intentKey ?? orderKey)}`);
          const claimed = direct != null ? rows.get(String(direct)) : undefined;
          if (claimed) claimed.inconsistent.push(`${event.type}:claims ${String(intentKey ?? orderKey)} owned by ${owner}`);
        }
        return owner;
      }
      if (direct != null && rows.has(String(direct))) return String(direct);
      return fallbackRunId != null && rows.has(fallbackRunId) ? fallbackRunId : null;
    };
    const brainRunId = runIdOf();
    if (brainRunId == null) continue;
    const row = rows.get(brainRunId)!;
    row.lineageProven = true;
    row.updatedAt = Math.max(row.updatedAt, Number(event.ts ?? row.updatedAt));
    if (!row.symbol && event.symbol) row.symbol = String(event.symbol);

    switch (event.type) {
      case 'ENTRY_ECONOMIC_ADMISSION_EVALUATED':
        break;
      case 'PORTFOLIO_RISK_ADMISSION_EVALUATED':
        row.portfolioRiskAllowed = payload.allowed === true;
        if (row.portfolioRiskAllowed === false) {
          row.blockStage = 'PORTFOLIO_RISK';
          row.blockReasons = reasonsOf(payload, 'PORTFOLIO_RISK_NOT_ALLOWED');
        }
        break;
      case 'TRADE_PLAN_PERSISTED':
        note(intentOwner, payload.intentId, brainRunId, 'intent');
        row.planId = payload.planId == null ? row.planId : String(payload.planId);
        break;
      case 'ENTRY_RESERVATION_CREATED':
        note(intentOwner, payload.intentId, brainRunId, 'intent');
        row.reservationId = payload.reservationId == null ? row.reservationId : String(payload.reservationId);
        if (row.planId == null && payload.planId != null) row.planId = String(payload.planId);
        break;
      case 'ENTRY_INTENT_CREATED': {
        const intent = payload.intent ?? {};
        const intentId = intent.id ?? payload.intentId;
        note(intentOwner, intentId, brainRunId, 'intent');
        row.intentId = intentId == null ? row.intentId : String(intentId);
        if (row.reservationId == null && intent.reservationId != null) row.reservationId = String(intent.reservationId);
        if (row.planId == null && intent.planId != null) row.planId = String(intent.planId);
        if ((row.direction == null) && intent.side === 'LONG') row.direction = 'LONG';
        if ((row.direction == null) && intent.side === 'SHORT') row.direction = 'SHORT';
        break;
      }
      case 'ENTRY_EXECUTION_WAITING':
        row.waitingSince = Number(event.ts ?? now);
        row.blockStage = null;
        row.blockReasons = [];
        break;
      case 'ENTRY_ORDER_CREATED': {
        const order = payload.order ?? {};
        const orderId = order.id ?? payload.orderId;
        note(orderOwner, orderId, brainRunId, 'order');
        note(intentOwner, order.intentId ?? payload.intentId, brainRunId, 'intent');
        row.orderId = orderId == null ? row.orderId : String(orderId);
        row.clientOrderId = order.clientOrderId == null ? row.clientOrderId : String(order.clientOrderId);
        row.exchangeOrderId = order.exchangeOrderId == null ? row.exchangeOrderId : String(order.exchangeOrderId);
        row.submittedAt = Number(order.submittedAt ?? event.ts ?? now);
        row.submittedIntentId = order.intentId == null ? row.submittedIntentId : String(order.intentId);
        row.waitingSince = null;
        row.blockStage = null;
        row.blockReasons = [];
        if (order.status === 'FILLED' && row.firstFillAt == null) row.firstFillAt = Number(order.submittedAt ?? event.ts ?? now);
        break;
      }
      case 'ENTRY_SUBMIT_ATTEMPTED':
      case 'ENTRY_SUBMIT_RESPONSE_RECOVERED':
        note(orderOwner, payload.orderId, brainRunId, 'order');
        break;
      case 'ORDER_FILL_RECONCILED': {
        note(orderOwner, payload.orderId, brainRunId, 'order');
        const status = String(payload.status ?? '');
        if (status === 'FILLED') row.firstFillAt = row.firstFillAt ?? Number(event.ts ?? now);
        else if (status === 'PARTIALLY_FILLED') row.partialFillAt = row.partialFillAt ?? Number(event.ts ?? now);
        if (payload.exchangeOrderId != null) row.exchangeOrderId = String(payload.exchangeOrderId);
        if (payload.clientOrderId != null) row.clientOrderId = String(payload.clientOrderId);
        break;
      }
      case 'ENTRY_FILLED': {
        const order = payload.order ?? {};
        note(orderOwner, payload.orderId ?? order.id, brainRunId, 'order');
        row.firstFillAt = row.firstFillAt ?? Number(payload.filledAt ?? order.updatedAt ?? event.ts ?? now);
        if (row.orderId == null && (payload.orderId ?? order.id) != null) row.orderId = String(payload.orderId ?? order.id);
        if (row.exchangeOrderId == null && (payload.exchangeOrderId ?? order.exchangeOrderId) != null) row.exchangeOrderId = String(payload.exchangeOrderId ?? order.exchangeOrderId);
        if (row.clientOrderId == null && (payload.clientOrderId ?? order.clientOrderId) != null) row.clientOrderId = String(payload.clientOrderId ?? order.clientOrderId);
        break;
      }
      case 'ENTRY_ORDER_SUBMISSION_UNKNOWN':
      case 'ENTRY_DECISION_BLOCKED':
      case 'ENTRY_ORDER_BLOCKED':
      case 'ENTRY_EXECUTION_WAIT_TERMINATED':
      case 'CANDIDATE_REJECTED': {
        note(orderOwner, payload.orderId, brainRunId, 'order');
        const reason = payload.reason == null ? null : String(payload.reason);
        const stage = stageOf(event, reason ?? '');
        // A rejection the model itself issued is a decision, not a system block: `REJECT_CANDIDATE`
        // and `WAIT_*` carry no stage, and the run's own decision already says what happened.
        if (stage == null) break;
        row.blockStage = stage;
        row.blockReasons = reasonsOf(payload, reason);
        if (stage === 'EXECUTION_WAIT') row.waitingSince = null;
        break;
      }
      default:
        break;
    }
  }

  const outcomes = new Map<string, RunExecutionOutcome>();
  for (const [brainRunId, row] of rows) {
    const unproven = !row.lineageProven && isPlace(row.decision) && now - row.decisionAt > EXECUTION_LINEAGE_GRACE_MS;
    let state: ExecutionState;
    if (row.firstFillAt != null) state = 'FILLED';
    else if (row.partialFillAt != null) state = 'PARTIALLY_FILLED';
    else if (row.orderId != null) state = 'SUBMITTED';
    else if (row.waitingSince != null) state = 'WAITING_PRICE';
    else if (row.blockStage != null) state = 'NOT_SUBMITTED';
    else if (!isPlace(row.decision)) state = 'DECISION_ONLY';
    else if (unproven) state = 'NOT_SUBMITTED';
    else state = 'EXECUTING';
    const blockReasons = state === 'NOT_SUBMITTED'
      ? (row.blockReasons.length ? row.blockReasons : unproven ? ['EXECUTION_LINEAGE_UNPROVEN'] : [])
      : [];
    const label = state === 'NOT_SUBMITTED'
      ? `${EXECUTION_LABELS.NOT_SUBMITTED} · ${row.blockStage ?? '链路未记录'} · ${blockReasons[0] ?? 'UNPROVEN'}`
      : EXECUTION_LABELS[state];
    outcomes.set(brainRunId, {
      brainRunId,
      symbol: row.symbol,
      decision: row.decision,
      direction: row.direction,
      decisionAt: row.decisionAt,
      executionState: state,
      executionLabel: label,
      blockStage: state === 'NOT_SUBMITTED' ? row.blockStage : null,
      blockReasons,
      portfolioRiskAllowed: row.portfolioRiskAllowed,
      tradePlanId: row.planId,
      tradePlanReady: row.planId != null,
      reservationId: row.reservationId,
      intentId: row.intentId,
      orderId: row.orderId,
      clientOrderId: row.clientOrderId,
      exchangeOrderId: row.exchangeOrderId,
      submittedAt: row.submittedAt,
      firstFillAt: row.firstFillAt,
      updatedAt: row.updatedAt,
      lineageProven: row.lineageProven,
      inconsistentFacts: [...new Set(row.inconsistent)].slice(0, 8),
    });
  }
  return outcomes;
}

/**
 * The conversion funnel over one observation window (§8).
 *
 * Every stage is counted from the event that *creates* that stage, never from the last status a
 * symbol happens to carry, so "TradePlan ready 0" cannot be inferred from "no positions". Stages are
 * counted per distinct `brainRunId` because one run may create at most one plan, reservation,
 * intent, order and fill; a duplicate would mean the chain ran twice, which must surface as a
 * separate defect rather than being averaged away here.
 */
export interface EntryConversionWindow {
  since: number;
  until: number;
  primaryCompleted: number;
  place: number;
  riskAllowed: number;
  economicAdmissionPassed: number;
  tradePlanReady: number;
  reservationCreated: number;
  intentCreated: number;
  submitAttempted: number;
  orderSubmitted: number;
  entryFilled: number;
  waitingPrice: number;
  blocked: Array<{ stage: ExecutionBlockStage | 'UNKNOWN'; reason: string; count: number }>;
  ratios: { placeToTradePlan: number | null; tradePlanToSubmit: number | null; placeToSubmit: number | null; submitToFill: number | null };
  topDropStage: string | null;
  topDropReason: string | null;
  topDropCount: number;
  /** Alert-only: the chain is converting nothing for a reason that is not money or a full book. */
  degraded: boolean;
  degradedReason: string | null;
}

/** Stage names whose blocker is an intended gate: capital, capacity, or the frozen profit floor. */
const INTENDED_GATE = /MARGIN|EQUITY|EXPOSURE|NOTIONAL|CAPACITY|SLOT|POSITION|HUMAN_MANAGED|MIN_PROFIT_FLOOR|NO_PROFITABLE|NO_LEGAL_QUANTITY/i;

/** The funnel also counts the model's own terminal decisions, which the run fold does not need. */
export const ENTRY_CONVERSION_EVENT_TYPES = [...ENTRY_EXECUTION_LINEAGE_EVENT_TYPES, 'PRIMARY_DECISION_NORMALIZED'] as const;

export function entryConversionWindow(
  events: LineageEvent[],
  input: { since: number; until: number },
): EntryConversionWindow {
  const byRun = new Map<string, Set<string>>();
  const add = (stage: string, runId: string) => {
    if (!runId) return;
    if (!byRun.has(stage)) byRun.set(stage, new Set());
    byRun.get(stage)!.add(runId);
  };
  const counts = new Map<string, { stage: ExecutionBlockStage | 'UNKNOWN'; reason: string; count: number }>();
  const primaryRuns = new Set<string>();
  const placeRuns = new Set<string>();

  for (const event of events) {
    const payload: any = event.payload ?? {};
    const runId = String(payload.brainRunId ?? payload.decisionChainId ?? payload.runId ?? '');
    switch (event.type) {
      case 'PRIMARY_DECISION_NORMALIZED':
        if (!runId) break;
        primaryRuns.add(runId);
        if (isPlace(payload.normalizedDecision ?? payload.decision)) placeRuns.add(runId);
        break;
      case 'ENTRY_ECONOMIC_ADMISSION_EVALUATED':
        if (payload.passed === true) add('economicAdmissionPassed', runId);
        break;
      case 'PORTFOLIO_RISK_ADMISSION_EVALUATED':
        if (payload.allowed === true && payload.analysisOnly !== true) add('riskAllowed', runId);
        break;
      case 'TRADE_PLAN_PERSISTED':
        add('tradePlanReady', runId);
        break;
      case 'ENTRY_RESERVATION_CREATED':
        add('reservationCreated', runId);
        break;
      case 'ENTRY_INTENT_CREATED':
        add('intentCreated', runId);
        break;
      case 'ENTRY_EXECUTION_WAITING':
        add('waitingPrice', runId);
        break;
      case 'ENTRY_SUBMIT_ATTEMPTED':
        add('submitAttempted', runId);
        break;
      case 'ENTRY_ORDER_CREATED':
        add('orderSubmitted', runId);
        break;
      case 'ENTRY_FILLED':
        add('entryFilled', runId);
        break;
      case 'ENTRY_DECISION_BLOCKED':
      case 'ENTRY_ORDER_BLOCKED':
      case 'ENTRY_EXECUTION_WAIT_TERMINATED': {
        const reason = payload.reason == null
          ? (Array.isArray(payload.reasons) ? String(payload.reasons[0] ?? 'UNSPECIFIED') : 'UNSPECIFIED')
          : String(payload.reason);
        const stage = stageOf(event, reason) ?? 'UNKNOWN';
        const key = `${stage}|${reason}`;
        const known = counts.get(key);
        counts.set(key, {stage, reason, count: (known?.count ?? 0) + 1});
        break;
      }
      default:
        break;
    }
  }

  const stage = (name: string) => byRun.get(name)?.size ?? 0;
  const blocked = [...counts.values()].sort((a, b) => b.count - a.count || String(a.stage).localeCompare(String(b.stage)));
  const top = blocked[0] ?? null;
  const ratio = (numerator: number, denominator: number) => (denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : null);
  const place = placeRuns.size, orderSubmitted = stage('orderSubmitted');
  const totalBlocked = blocked.reduce((sum, row) => sum + row.count, 0);
  const dominantIsIntendedGate = top == null || INTENDED_GATE.test(top.reason) || top.stage === 'PRE_AI';
  const degraded = place >= 5 && orderSubmitted === 0 && top != null && !dominantIsIntendedGate && top.count >= Math.max(1, Math.ceil(totalBlocked / 2));
  return {
    since: input.since,
    until: input.until,
    primaryCompleted: primaryRuns.size,
    place,
    riskAllowed: stage('riskAllowed'),
    economicAdmissionPassed: stage('economicAdmissionPassed'),
    tradePlanReady: stage('tradePlanReady'),
    reservationCreated: stage('reservationCreated'),
    intentCreated: stage('intentCreated'),
    submitAttempted: stage('submitAttempted'),
    orderSubmitted,
    entryFilled: stage('entryFilled'),
    waitingPrice: stage('waitingPrice'),
    blocked,
    ratios: {
      placeToTradePlan: ratio(stage('tradePlanReady'), place),
      tradePlanToSubmit: ratio(orderSubmitted, stage('tradePlanReady')),
      placeToSubmit: ratio(orderSubmitted, place),
      submitToFill: ratio(stage('entryFilled'), orderSubmitted),
    },
    topDropStage: top?.stage ?? null,
    topDropReason: top?.reason ?? null,
    topDropCount: top?.count ?? 0,
    degraded,
    degradedReason: degraded ? `ENTRY_CONVERSION_DEGRADED:${top!.stage}:${top!.reason}` : null,
  };
}

/**
 * Both cockpit windows from a single event read. `readEvents` is given the earliest timestamp the
 * report covers, so the caller decides how far the journal is scanned and this stays pure.
 */
export function entryConversionReport(readEvents: (since: number) => LineageEvent[], now = Date.now()) {
  const oneHourEvents = readEvents(now - 60 * 60_000);
  return {
    generatedAt: now,
    thirtyMinutes: entryConversionWindow(oneHourEvents.filter((event) => Number(event.ts) >= now - 30 * 60_000), {since: now - 30 * 60_000, until: now}),
    oneHour: entryConversionWindow(oneHourEvents, {since: now - 60 * 60_000, until: now}),
  };
}
