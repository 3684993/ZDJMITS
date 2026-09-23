// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Overview from './OverviewView.vue';
import { api } from '../api/client';

vi.mock('../stores/system', () => ({ useSystemStore: () => ({ snapshot: null, settings: null, refresh: vi.fn() }) }));
vi.mock('../api/client', () => ({ api: { pipeline: vi.fn(), accountAssets: vi.fn() } }));

// Values taken from the live capital evaluation shape: the page must render these, not re-derive them.
const blocked = {
  asOf: 1,
  pipelineState: 'RUNNING',
  noEntryReason: 'WAITING_EXECUTION_CAPACITY',
  eligibility: { status: 'READY', count: 6 },
  runtimeControl: { mode: 'RUNNING', reasonText: '运行中', capital: { executableCandidateCount: 0, usdtAvailable: 1200, usdcAvailable: 0, usdtExecutableUnderlyings: 0, usdcExecutableUnderlyings: 0, routedCandidates: [], noUsdtMargin: 0, noUsdcContract: 0 } },
  entryPermission: { status: 'BLOCKED', executionMode: 'READ_ONLY', autoExecutionMode: 'AUTO_RUNNING' },
  analysis: { mode: 'ANALYSIS_ONLY', text: 'ANALYSIS_ONLY：仅分析，交易写锁定；CAPACITY_BLOCKED', reason: 'CAPACITY_BLOCKED', capitalExecutableCount: 0, lastAttemptAt: null, lastSuccessAt: null, silenceMs: 40000 },
  primaryBrain: { status: 'READY', resource: { nextStep: '等待新的候选事实，避免重复推理', idleReason: 'WAITING_CANDIDATE' } },
  capacityVisibility: {
    slots: { used: 27, max: 50, positions: 27, inFlight: 0, reserved: 0 },
    gross: { notionalUsd: 10494.3129, limitUsd: 10504.7287, remainingUsd: 10.4158, usedPct: 0.9990079 },
    direction: {
      LONG: { notionalUsd: 4402.5226, limitUsd: 5252.3643, remainingUsd: 849.8418 },
      SHORT: { notionalUsd: 6091.7903, limitUsd: 5252.3643, remainingUsd: 0 },
    },
    firstBlocker: 'GROSS',
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
  const wrapper = await open(blocked);
  const text = wrapper.text();
  expect(text).toContain('27 / 50');
  expect(text).toContain('$10,494.31');
  expect(text).toContain('$10,504.73');
  expect(text).toContain('$10.42');
  expect(text).toContain('$849.84');
  expect(text).toContain('$6,091.79');
  expect(text).toContain('GROSS');
  expect(text).toMatch(/99\.9%/);
});

it('reports the capacity blocker as the first explanation while eligible candidates exist', async () => {
  const wrapper = await open(blocked);
  const headline = wrapper.find('[data-caps-first-explanation]').text();
  expect(headline).toContain('CAPACITY_BLOCKED');
  expect(headline).toContain('$10,494.31 / $10,504.73');
  expect(headline).not.toContain('WAITING_CANDIDATE');
  expect(headline).not.toContain('等待新');
});

it('renders the projected numbers it is given instead of recomputing them', async () => {
  const mutated = structuredClone(blocked);
  mutated.capacityVisibility.gross.remainingUsd = 4321.5;
  mutated.capacityVisibility.gross.usedPct = 0.1234;
  mutated.capacityVisibility.firstBlocker = 'DIRECTION_LONG';
  const wrapper = await open(mutated);
  const text = wrapper.text();
  expect(text).toContain('$4,321.50');
  expect(text).toContain('12.3%');
  expect(text).toContain('DIRECTION_LONG');
});

it('falls back to the supply explanation when there is genuinely no candidate', async () => {
  const empty = structuredClone(blocked);
  empty.eligibility.count = 0;
  empty.runtimeControl.capital.executableCandidateCount = 0;
  empty.capacityVisibility.firstBlocker = 'NONE';
  empty.capacityVisibility.gross = { notionalUsd: 0, limitUsd: 10504.7287, remainingUsd: 10504.7287, usedPct: 0 };
  empty.capacityVisibility.direction = {
    LONG: { notionalUsd: 0, limitUsd: 5252.3643, remainingUsd: 5252.3643 },
    SHORT: { notionalUsd: 0, limitUsd: 5252.3643, remainingUsd: 5252.3643 },
  };
  empty.analysis.reason = 'NO_SUPPLY';
  empty.analysis.text = 'ANALYSIS_ONLY：仅分析，交易写锁定；NO_SUPPLY';
  const wrapper = await open(empty);
  const headline = wrapper.find('[data-caps-first-explanation]').text();
  expect(headline).not.toContain('CAPACITY_BLOCKED');
  expect(headline).toContain('NO_SUPPLY');
});
