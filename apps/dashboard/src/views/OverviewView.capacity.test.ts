// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Overview from './OverviewView.vue';
import { api } from '../api/client';

vi.mock('../stores/system', () => ({ useSystemStore: () => ({ snapshot: null, settings: null, refresh: vi.fn() }) }));
vi.mock('../api/client', () => ({ api: { pipeline: vi.fn(), accountAssets: vi.fn() } }));

/**
 * §D: the cockpit answers four different questions, and the page renders the Engine's own answers.
 * The fixtures are the projected shapes, not numbers this file computes.
 */
const base = {
  asOf: 1,
  pipelineState: 'RUNNING',
  noEntryReason: 'ENTRY_BLOCKED',
  eligibility: { status: 'READY', count: 6 },
  runtimeControl: { mode: 'RUNNING', reasonText: '运行中', capital: { executableCandidateCount: 0, usdtAvailable: 1200, usdcAvailable: 0, usdtExecutableUnderlyings: 0, usdcExecutableUnderlyings: 0, routedCandidates: [], noUsdtMargin: 0, noUsdcContract: 0 } },
  entryPermission: { status: 'BLOCKED', executionMode: 'READ_ONLY', autoExecutionMode: 'AUTO_RUNNING' },
  analysis: { mode: 'ANALYSIS_ONLY', text: 'ANALYSIS_ONLY：仅分析，交易写锁定；CAPACITY_BLOCKED', reason: 'CAPACITY_BLOCKED', capitalExecutableCount: 0, lastAttemptAt: null, lastSuccessAt: null, silenceMs: 40000 },
  primaryBrain: { status: 'READY', resource: { nextStep: '暂无可派发候选；继续供给与订单维护', idleReason: 'WAITING_CANDIDATE' } },
};

// The live 2026-09-25 09:40 shape: the 100%-of-equity gross ratio is spent while the wallet holds
// $8,834.44 of genuinely available margin, and every route is denied by that ratio.
const marginDrivenBook = {
  ...base,
  capacityVisibility: {
    funding: {
      quoteAssets: [
        { quoteAsset: 'USDT', availableBalanceUsd: 3861.560262, walletBalanceUsd: 5473.133262, reservedMarginUsd: 0, executionLeaseMarginUsd: 0, executableMarginUsd: 3861.560262, factsComplete: true, reasons: [] },
        { quoteAsset: 'USDC', availableBalanceUsd: 4972.875697, walletBalanceUsd: 4981.175512, reservedMarginUsd: 0, executionLeaseMarginUsd: 0, executableMarginUsd: 4972.875697, factsComplete: true, reasons: [] },
      ],
      totalExecutableMarginUsd: 8834.435959, proven: true,
      excludedAssets: [{asset: 'BTC', usdValue: 850.23, reason: 'NOT_IN_ENTRY_FUNDING_UNIVERSE'}], accountEquityUsd: 19_685.67,
    },
    exposure: {
      gross: { notionalUsd: 10494.3129, limitUsd: 10504.7287, remainingUsd: 0, usedPct: 0.9990079, mode: 'OBSERVE', enforced: false },
      LONG: { notionalUsd: 4402.5226, limitUsd: 10504.7287, remainingUsd: 6102.2061, usedPct: 0.4191, mode: 'OBSERVE', enforced: false },
      SHORT: { notionalUsd: 6091.7903, limitUsd: 10504.7287, remainingUsd: 4412.9384, usedPct: 0.5799, mode: 'OBSERVE', enforced: false },
    },
    limits: { slots: { used: 17, max: 50, positions: 17, inFlight: 0, reserved: 0 }, policy: { gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE' } },
    sideStatus: {code: 'BOTH_SIDES_EXECUTABLE', text: 'LONG 与 SHORT 均可新增'},
    entryCapacity: {
      LONG: { executableNotionalUsd: 3680.06, quoteAsset: 'USDT', symbol: 'LINKUSDT', firstBindingConstraint: 'CLUSTER', executableRoutes: 4,
        candidates: [{symbol: 'LINKUSDT', side: 'LONG', executable: true, firstBindingConstraint: 'CLUSTER', funding: {executableNotionalUsd: 3980}, finalNotionalBeforeRoundingUsd: 3680.06, minimumLegalNotionalUsd: 5}] },
      SHORT: { executableNotionalUsd: 3680.06, quoteAsset: 'USDC', symbol: 'SUIUSDC', firstBindingConstraint: 'CLUSTER', executableRoutes: 3,
        candidates: [{symbol: 'SUIUSDC', side: 'SHORT', executable: false, firstBindingConstraint: 'SIDE_PLAN_ABSENT', funding: {executableNotionalUsd: 3980}, finalNotionalBeforeRoundingUsd: 0, minimumLegalNotionalUsd: 5,
          plan: {present: true, admission: 'REJECT_EXPOSURE_LIMIT', capacityRoom: {source: 'SHORT_EXPOSURE', ceilingUsd: 5248.68, usedUsd: 7438.39, roomUsd: 0}}}] },
    },
    firstBlocker: 'NONE', blockingDimensions: [], exhaustedReason: null, exhaustedForNewRisk: false, evaluatedAt: 1,
  },
};

// The enforced default: the spent ratio really does deny new risk, and it is the named first cause.
const grossExhausted = {
  ...structuredClone(marginDrivenBook),
  capacityVisibility: {
    ...structuredClone(marginDrivenBook.capacityVisibility) as any,
    exposure: {
      ...structuredClone(marginDrivenBook.capacityVisibility).exposure,
      gross: { ...structuredClone(marginDrivenBook.capacityVisibility).exposure.gross, mode: 'ENFORCE', enforced: true },
    },
    limits: { slots: { used: 27, max: 50, positions: 27, inFlight: 0, reserved: 0 }, policy: { gross: 'ENFORCE', direction: 'ENFORCE', cluster: 'ENFORCE' } },
    entryCapacity: {
      LONG: { executableNotionalUsd: 0, quoteAsset: null, symbol: null, firstBindingConstraint: 'GROSS_ENFORCED', executableRoutes: 0 },
      SHORT: { executableNotionalUsd: 0, quoteAsset: null, symbol: null, firstBindingConstraint: 'GROSS_ENFORCED', executableRoutes: 0 },
    },
    firstBlocker: 'GROSS', blockingDimensions: ['GROSS'], exhaustedReason: 'GROSS', exhaustedForNewRisk: true,
  },
};

async function open(payload: any, accountAssets: any = {assets: []}) {
  vi.mocked(api.pipeline).mockResolvedValue(payload);
  vi.mocked(api.accountAssets).mockResolvedValue(accountAssets as never);
  const wrapper = mount(Overview, { global: { stubs: { Panel: { template: '<div><slot/></slot></div>' }, StatusBadge: { props: ['value'], template: '<span>{{ value }}</span>' } } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());

it('keeps money, notional, policy and final entry capacity in four separate blocks', async () => {
  const wrapper = await open(marginDrivenBook);
  const funding = wrapper.find('[data-capital-block="funding"]').text();
  const exposure = wrapper.find('[data-capital-block="exposure"]').text();
  const limits = wrapper.find('[data-capital-block="limits"]').text();
  const entry = wrapper.find('[data-capital-block="entry"]').text();
  // Block 1 is money the account can actually commit.
  expect(funding).toContain('USDT：可用 $3,861.56 − 预留 $0.00 − 租约 $0.00 = 可执行保证金 $3,861.56');
  expect(funding).toContain('USDC：可用 $4,972.88');
  expect(funding).toContain('Total Entry Trading Capital $8,834.44');
  // BTC is a real account asset and is named as excluded from Entry funding, not silently dropped.
  expect(funding).toContain('不参与新建仓资金：BTC');
  // Block 2 is a notional fact and says so; it must not be presented as a balance to spend.
  expect(exposure).toContain('Gross $10,494.31 / 上限 $10,504.73');
  expect(exposure).toContain('组合名义敞口（事实，不等于可用资金）');
  expect(exposure).not.toContain('新增风险额度');
  // Block 3 carries the enforcement mode next to the caps and the slots.
  expect(limits).toContain('Gross=OBSERVE');
  expect(limits).toContain('Cluster=ENFORCE');
  expect(limits).toContain('槽位 17 / 50');
  // Block 4 is the only place that answers "how much new Entry risk fits".
  expect(entry).toContain('LONG 可执行新增名义 $3,680.06 via LINKUSDT/USDT · 首因 CLUSTER');
  expect(entry).toContain('SHORT 可执行新增名义 $3,680.06 via SUIUSDC/USDC · 首因 CLUSTER');
  expect(entry).toContain('仍有空间');
  // One side open, the other refused: the page states which is which, and never "no capacity".
  expect(entry).toContain('LONG 与 SHORT 均可新增');
  // §D3: each side expands into the per-candidate decomposition the Engine produced.
  const traces = wrapper.findAll('[data-capacity-trace]');
  expect(traces).toHaveLength(2);
  expect(traces[0].text()).toContain('LONG 逐候选容量（1 个可路由候选）');
  expect(traces[0].text()).toContain('资金容量 $3,980.00');
  expect(traces[0].text()).toContain('交易所最小合法名义 $5.00');
  expect(traces[1].text()).toContain('首因 SIDE_PLAN_ABSENT');
  // §D3/§B3: a refused side reads as the ceiling, the used number and the room the Engine named.
  expect(traces[1].text()).toContain('计划 REJECT_EXPOSURE_LIMIT');
  expect(traces[1].text()).toContain('容量上限 $5,248.68');
  expect(traces[1].text()).toContain('已用 $7,438.39');
  expect(traces[1].text()).toContain('剩余 $0.00');
  expect(traces[1].text()).toContain('SHORT_EXPOSURE');
  // A side with no plan facts never gets an invented room line.
  expect(traces[0].text()).not.toContain('容量上限');
});

it('does not report a spent observed ratio as an exhausted book when the margin and risk facts allow more', async () => {
  const text = (await open(marginDrivenBook)).text();
  expect(text).not.toContain('已用尽');
  expect(text).toContain('首个饱和硬维度 NONE');
});

it('labels account assets and Entry funding eligibility as two different columns', async () => {
  const wrapper = await open(marginDrivenBook, {assets: [
    {asset: 'BTC', walletBalance: 0.01, availableBalance: 0.01, usdValue: 850.23, marginEligible: true},
    {asset: 'USDT', walletBalance: 5473.13, availableBalance: 3861.56, usdValue: 5473.13, marginEligible: true},
    {asset: 'USDC', walletBalance: 4981.18, availableBalance: 4972.88, usdValue: 4981.18, marginEligible: true},
  ]});
  const rows = wrapper.findAll('[data-entry-funding-eligible]');
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.text())).toEqual(['NO', 'YES', 'YES']);
  expect(wrapper.text()).toContain('可用于新建仓（Entry）');
  expect(wrapper.text()).toContain('交易所保证金资产');
});

it('names the enforced ratio as the first cause instead of dressing its remainder as money', async () => {
  const wrapper = await open(grossExhausted);
  const headline = wrapper.find('[data-caps-first-explanation]').text();
  expect(headline).toContain('CAPACITY_BLOCKED');
  expect(headline).toContain('GROSS');
  expect(headline).toContain('首因 GROSS_ENFORCED');
  expect(headline).not.toContain('$10,494.31 / $10,504.73');
  expect(headline).not.toContain('WAITING_CANDIDATE');
  expect(headline).not.toContain('暂无可派发候选');
  expect(wrapper.find('[data-capital-block="entry"]').text()).toContain('新增风险额度已用尽 · GROSS');
});

it('renders a single saturated side as a fact beside the room the other side still has', async () => {
  const oneSide = structuredClone(marginDrivenBook);
  const view = oneSide.capacityVisibility as any;
  view.exposure.LONG = { notionalUsd: 4402.5226, limitUsd: 5232.94, remainingUsd: 830.42, usedPct: 0.8413, mode: 'ENFORCE', enforced: true };
  view.exposure.SHORT = { notionalUsd: 6073.79, limitUsd: 5232.94, remainingUsd: 0, usedPct: 1.1607, mode: 'ENFORCE', enforced: true };
  view.limits.policy = { gross: 'ENFORCE', direction: 'ENFORCE', cluster: 'ENFORCE' };
  view.firstBlocker = 'DIRECTION_SHORT';
  view.blockingDimensions = ['DIRECTION_SHORT'];
  view.entryCapacity.SHORT = { executableNotionalUsd: 0, quoteAsset: null, symbol: null, firstBindingConstraint: 'DIRECTION_ENFORCED', executableRoutes: 0, candidates: [] };
  view.sideStatus = {code: 'LONG_ONLY_EXECUTABLE', text: 'LONG executable / SHORT blocked'};
  const wrapper = await open(oneSide);
  const text = wrapper.text();
  expect(wrapper.find('[data-caps-first-explanation]').text()).not.toContain('已用尽');
  expect(text).toContain('首个饱和硬维度 DIRECTION_SHORT');
  // The saturated side is shown as its own notional fact, next to the side that still has room.
  expect(text).toContain('SHORT $6,073.79 / $5,232.94');
  expect(text).toContain('LONG $4,402.52 / $5,232.94');
  expect(text).toContain('SHORT 可执行新增名义 $0.00 · 首因 DIRECTION_ENFORCED');
  expect(text).toContain('仍有空间');
  expect(text).toContain('LONG executable / SHORT blocked');
  expect(text).not.toContain('无容量');
});

it('renders the projected numbers and verdict it is given instead of recomputing them', async () => {
  const mutated = structuredClone(marginDrivenBook);
  (mutated.capacityVisibility as any).exposure.LONG.notionalUsd = 4321.5;
  (mutated.capacityVisibility as any).exposure.gross.usedPct = 0.1234;
  (mutated.capacityVisibility as any).firstBlocker = 'DIRECTION_LONG';
  (mutated.capacityVisibility as any).exhaustedForNewRisk = true;
  (mutated.capacityVisibility as any).exhaustedReason = 'BOTH_DIRECTIONS';
  const text = (await open(mutated)).text();
  expect(text).toContain('$4,321.50');
  expect(text).toContain('12.3%');
  expect(text).toContain('DIRECTION_LONG');
  expect(text).toContain('已用尽 · BOTH_DIRECTIONS');
});

it('says a missing funding fact is missing, rather than inventing executable margin', async () => {
  const unfunded = structuredClone(marginDrivenBook);
  (unfunded.capacityVisibility as any).funding = { quoteAssets: [{ quoteAsset: 'USDT', availableBalanceUsd: 0, walletBalanceUsd: null, reservedMarginUsd: 0, executionLeaseMarginUsd: 0, executableMarginUsd: 0, factsComplete: false, reasons: ['AVAILABLE_BALANCE_UNPROVEN'] }], executableMarginUsd: 0, proven: false };
  const funding = (await open(unfunded)).find('[data-capital-block="funding"]').text();
  expect(funding).toContain('资金事实不完整');
});

it('falls back to the supply explanation when there is genuinely no candidate', async () => {
  const empty = structuredClone(marginDrivenBook);
  empty.eligibility.count = 0;
  empty.runtimeControl.capital.executableCandidateCount = 0;
  (empty.capacityVisibility as any).exposure = {
    gross: { notionalUsd: 0, limitUsd: 10504.7287, remainingUsd: 10504.7287, usedPct: 0, mode: 'ENFORCE', enforced: true },
    LONG: { notionalUsd: 0, limitUsd: 5252.3643, remainingUsd: 5252.3643, usedPct: 0, mode: 'ENFORCE', enforced: true },
    SHORT: { notionalUsd: 0, limitUsd: 5252.3643, remainingUsd: 5252.3643, usedPct: 0, mode: 'ENFORCE', enforced: true },
  };
  (empty.capacityVisibility as any).firstBlocker = 'NONE';
  (empty.capacityVisibility as any).blockingDimensions = [];
  (empty.capacityVisibility as any).exhaustedReason = null;
  (empty.capacityVisibility as any).exhaustedForNewRisk = false;
  (empty.capacityVisibility as any).entryCapacity = {
    LONG: { executableNotionalUsd: 0, quoteAsset: null, symbol: null, firstBindingConstraint: 'NO_CAPITAL_ROUTE', executableRoutes: 0 },
    SHORT: { executableNotionalUsd: 0, quoteAsset: null, symbol: null, firstBindingConstraint: 'NO_CAPITAL_ROUTE', executableRoutes: 0 },
  };
  empty.analysis.reason = 'NO_SUPPLY';
  empty.analysis.text = 'ANALYSIS_ONLY：仅分析，交易写锁定；NO_SUPPLY';
  const headline = (await open(empty)).find('[data-caps-first-explanation]').text();
  expect(headline).not.toContain('CAPACITY_BLOCKED');
  expect(headline).not.toContain('已用尽');
  expect(headline).toContain('NO_SUPPLY');
});

// The live 2026-09-23 shape: READ_ONLY with an armed AUTO_RUNNING intent and no approved risk profile.
const factsBlocked = {
  ...base,
  executionReadiness: {
    intent: true, ready: false, mode: 'EXECUTION_BLOCKED', modelSpendPermitted: false,
    blockers: ['EXECUTION_WRITE_LOCKED', 'PRIVATE_DATA_UNAVAILABLE', 'RISK_PROFILE_UNCONFIGURED'],
    firstBlocker: 'EXECUTION_WRITE_LOCKED', profileStatus: 'PROFILE_NOT_CONFIGURED',
    executableCandidateCount: 10, lastReadyAt: null,
    text: '执行事实未齐：EXECUTION_WRITE_LOCKED · PRIVATE_DATA_UNAVAILABLE · RISK_PROFILE_UNCONFIGURED；已停止调用模型，避免产生无法执行的决策',
  },
  portfolioRiskProfile: { status: 'PROFILE_NOT_CONFIGURED', configured: false, version: 'v396r38', values: { configured: false }, missingFields: ['maxCapitalAtRiskUsd', 'correlationVersion'], blockers: ['RISK_PROFILE_UNCONFIGURED'] },
};

it('shows the pre-model readiness verdict and its first blocker instead of a silent wait', async () => {
  const row = (await open(factsBlocked)).find('[data-execution-readiness]').text();
  expect(row).toContain('EXECUTION_BLOCKED');
  expect(row).toContain('EXECUTION_WRITE_LOCKED');
  expect(row).toContain('已停止调用模型');
});

it('labels an unapproved risk profile PROFILE_NOT_CONFIGURED and never a generic READY', async () => {
  const row = (await open(factsBlocked)).find('[data-risk-profile]').text();
  expect(row).toContain('PROFILE_NOT_CONFIGURED');
  expect(row).toContain('maxCapitalAtRiskUsd');
  expect(row).not.toContain('READY');
});

it('reports NOT_EVALUATED rather than inventing a ready state when the Engine projection is absent', async () => {
  const wrapper = await open(base);
  expect(wrapper.find('[data-execution-readiness]').text()).toContain('NOT_EVALUATED');
  expect(wrapper.find('[data-risk-profile]').text()).toContain('NOT_EVALUATED');
});

it('shows the profile as configured once the readback says so, with its version', async () => {
  const ready = structuredClone(factsBlocked);
  ready.executionReadiness = { ...ready.executionReadiness, ready: true, mode: 'EXECUTION_READY', firstBlocker: null, blockers: [], lastReadyAt: 1 };
  ready.portfolioRiskProfile = { ...ready.portfolioRiskProfile, status: 'READY', configured: true, missingFields: [], blockers: [] };
  const wrapper = await open(ready);
  expect(wrapper.find('[data-execution-readiness]').text()).toContain('EXECUTION_READY');
  const profile = wrapper.find('[data-risk-profile]').text();
  expect(profile).toContain('READY');
  expect(profile).toContain('v396r38');
  expect(profile).not.toContain('PROFILE_NOT_CONFIGURED');
});
