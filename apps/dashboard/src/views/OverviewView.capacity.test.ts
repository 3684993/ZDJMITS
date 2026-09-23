// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Overview from './OverviewView.vue';
import { api } from '../api/client';

vi.mock('../stores/system', () => ({ useSystemStore: () => ({ snapshot: null, settings: null, refresh: vi.fn() }) }));
vi.mock('../api/client', () => ({ api: { pipeline: vi.fn(), accountAssets: vi.fn() } }));

// Values taken from the live capital evaluation shape: the page must render these, not re-derive them.
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

const grossExhausted = {
  ...base,
  capacityVisibility: {
    slots: { used: 27, max: 50, positions: 27, inFlight: 0, reserved: 0 },
    gross: { notionalUsd: 10494.3129, limitUsd: 10504.7287, remainingUsd: 0, usedPct: 0.9990079 },
    direction: {
      LONG: { notionalUsd: 4402.5226, limitUsd: 5252.3643, remainingUsd: 0 },
      SHORT: { notionalUsd: 6091.7903, limitUsd: 5252.3643, remainingUsd: 0 },
    },
    firstBlocker: 'GROSS',
    blockingDimensions: ['GROSS', 'DIRECTION_LONG', 'DIRECTION_SHORT'],
    exhaustedReason: 'GROSS',
    exhaustedForNewRisk: true,
    evaluatedAt: 1,
  },
};

// The live 2026-09-23 17:24 shape: one side full, the other still has room, candidates executable.
const oneSideFull = {
  ...base,
  eligibility: { status: 'READY', count: 1 },
  runtimeControl: { ...base.runtimeControl, capital: { ...base.runtimeControl.capital, executableCandidateCount: 1 } },
  analysis: { ...base.analysis, reason: 'NO_RUNNABLE_CANDIDATE', text: 'ANALYSIS_ONLY：仅分析，交易写锁定；NO_RUNNABLE_CANDIDATE', capitalExecutableCount: 1 },
  capacityVisibility: {
    slots: { used: 14, max: 50, positions: 14, inFlight: 0, reserved: 0 },
    gross: { notionalUsd: 9757.18, limitUsd: 10465.88, remainingUsd: 708.7, usedPct: 0.93228 },
    direction: {
      LONG: { notionalUsd: 3683.39, limitUsd: 5232.94, remainingUsd: 708.7 },
      SHORT: { notionalUsd: 6073.79, limitUsd: 5232.94, remainingUsd: 0 },
    },
    firstBlocker: 'DIRECTION_SHORT',
    blockingDimensions: ['DIRECTION_SHORT'],
    exhaustedReason: null,
    exhaustedForNewRisk: false,
    evaluatedAt: 1,
  },
};

async function open(payload: any) {
  vi.mocked(api.pipeline).mockResolvedValue(payload);
  vi.mocked(api.accountAssets).mockResolvedValue({ assets: [] } as never);
  const wrapper = mount(Overview, { global: { stubs: { Panel: { template: '<div><slot/></slot></div>' }, StatusBadge: true } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());

it('separates position slots from gross and direction exposure using the Engine projection verbatim', async () => {
  const text = (await open(grossExhausted)).text();
  expect(text).toContain('27 / 50');
  expect(text).toContain('$10,494.31');
  expect(text).toContain('$10,504.73');
  expect(text).toContain('$6,091.79');
  expect(text).toContain('GROSS');
  expect(text).toMatch(/99\.9%/);
  expect(text).toContain('已用尽 · GROSS');
});

it('reports the capacity blocker as the first explanation while eligible candidates exist but no risk headroom does', async () => {
  const headline = (await open(grossExhausted)).find('[data-caps-first-explanation]').text();
  expect(headline).toContain('CAPACITY_BLOCKED');
  expect(headline).toContain('$10,494.31 / $10,504.73');
  expect(headline).not.toContain('WAITING_CANDIDATE');
  expect(headline).not.toContain('等待新');
  expect(headline).not.toContain('暂无可派发候选');
});

it('does not claim exhausted capacity when only one side is full and a candidate is still executable', async () => {
  const wrapper = await open(oneSideFull);
  const text = wrapper.text();
  const headline = wrapper.find('[data-caps-first-explanation]').text();
  expect(headline).not.toContain('CAPACITY_BLOCKED');
  expect(headline).not.toContain('已用尽');
  // The saturated dimension is still reported as a fact, next to the room the other side has.
  expect(text).toContain('DIRECTION_SHORT');
  expect(text).toContain('仍有空间');
  expect(text).toContain('$708.70');
});

it('renders the projected numbers and verdict it is given instead of recomputing them', async () => {
  const mutated = structuredClone(oneSideFull);
  mutated.capacityVisibility.gross.remainingUsd = 4321.5;
  mutated.capacityVisibility.gross.usedPct = 0.1234;
  mutated.capacityVisibility.firstBlocker = 'DIRECTION_LONG';
  mutated.capacityVisibility.exhaustedForNewRisk = true;
  mutated.capacityVisibility.exhaustedReason = 'BOTH_DIRECTIONS';
  const text = (await open(mutated)).text();
  expect(text).toContain('$4,321.50');
  expect(text).toContain('12.3%');
  expect(text).toContain('DIRECTION_LONG');
  expect(text).toContain('已用尽 · BOTH_DIRECTIONS');
});

it('falls back to the supply explanation when there is genuinely no candidate', async () => {
  const empty = structuredClone(oneSideFull);
  empty.eligibility.count = 0;
  empty.runtimeControl.capital.executableCandidateCount = 0;
  empty.capacityVisibility = {
    ...empty.capacityVisibility,
    gross: { notionalUsd: 0, limitUsd: 10504.7287, remainingUsd: 10504.7287, usedPct: 0 },
    direction: {
      LONG: { notionalUsd: 0, limitUsd: 5252.3643, remainingUsd: 5252.3643 },
      SHORT: { notionalUsd: 0, limitUsd: 5252.3643, remainingUsd: 5252.3643 },
    },
    firstBlocker: 'NONE',
    blockingDimensions: [],
    exhaustedReason: null,
    exhaustedForNewRisk: false,
  };
  empty.analysis.reason = 'NO_SUPPLY';
  empty.analysis.text = 'ANALYSIS_ONLY：仅分析，交易写锁定；NO_SUPPLY';
  const headline = (await open(empty)).find('[data-caps-first-explanation]').text();
  expect(headline).not.toContain('CAPACITY_BLOCKED');
  expect(headline).not.toContain('已用尽');
  expect(headline).toContain('NO_SUPPLY');
});
