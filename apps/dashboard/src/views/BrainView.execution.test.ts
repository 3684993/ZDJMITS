// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Brain from './BrainView.vue';
import { brainRun, brainRuns } from '../api/client';

vi.mock('../stores/system', () => ({ useSystemStore: () => ({ snapshot: { aiResources: [] } }) }));
vi.mock('../api/client', () => ({ brainRun: vi.fn(), brainRuns: vi.fn() }));

const submitted = {
  brainRunId: 'run-1', symbol: '4USDT', decision: 'PLACE_LONG', direction: 'LONG', decisionAt: 1,
  executionState: 'SUBMITTED', executionLabel: '已挂单', blockStage: null, blockReasons: [],
  portfolioRiskAllowed: true, tradePlanId: 'plan_1', tradePlanReady: true, reservationId: 'res_1',
  intentId: 'intent_1', orderId: 'entry_intent_1', clientOrderId: 'ML_intent_1', exchangeOrderId: '9001',
  submittedAt: 1_770_000_000_000, firstFillAt: null, updatedAt: 1_770_000_000_000, lineageProven: true, inconsistentFacts: [],
};
const refused = {...submitted, brainRunId: 'run-2', orderId: null, clientOrderId: null, exchangeOrderId: null, submittedAt: null,
  executionState: 'NOT_SUBMITTED', executionLabel: '未挂单 · JIT · JIT_BLOCKED:QUOTE_STALE', blockStage: 'JIT', blockReasons: ['JIT_BLOCKED:QUOTE_STALE']};
const scoutExecution = null;

const rows = [
  {id: 'run-1', startedAt: Date.now(), symbol: '4USDT', role: 'PRIMARY_BRAIN', model: 'local', status: 'COMPLETED', decision: 'PLACE_LONG', direction: 'LONG', execution: submitted},
  {id: 'run-2', startedAt: Date.now(), symbol: 'ETHUSDT', role: 'PRIMARY_BRAIN', model: 'local', status: 'COMPLETED', decision: 'PLACE_SHORT', direction: 'SHORT', execution: refused},
  {id: 'run-3', startedAt: Date.now(), symbol: '4USDT', role: 'SCOUT', model: 'local', status: 'COMPLETED', decision: null, direction: null, execution: scoutExecution},
];

const detail = {
  run: {id: 'run-1', symbol: '4USDT', role: 'PRIMARY_BRAIN', model: 'local', timing: {totalMs: 120}},
  summary: {status: 'COMPLETED', decision: 'PLACE_LONG', direction: 'LONG', finalStage: 'ORDER_WORKING', reason: null},
  execution: submitted, timeline: [], historicalCompactFacts: [], eip: {}, scoutInput: {}, primaryInput: {}, rawModelOutput: {}, normalizedDecision: {}, temporalMemory: {}, rawAudit: {},
};

async function open() {
  vi.mocked(brainRuns).mockResolvedValue({items: rows, total: 3} as never);
  vi.mocked(brainRun).mockResolvedValue(detail as never);
  const host = document.createElement('div');
  document.body.append(host);
  const wrapper = mount(Brain, {attachTo: host, global: {stubs: {Panel: {template: '<div><slot/><slot name="footer"/></div>'}, StatusBadge: true}}});
  await flushPromises();
  return {wrapper, host};
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

const cells = (row: any) => row.findAll('td').map((cell: any) => cell.text());

it('every primary run row states whether an order exists, in the Engine\'s own words', async () => {
  const {wrapper} = await open();
  const header = wrapper.find('thead').text();
  expect(header).toContain('执行结果');
  const body = wrapper.findAll('tbody tr');
  expect(body).toHaveLength(3);
  expect(body[0].text()).toContain('已挂单');
  expect(body[1].text()).toContain('未挂单：行情事实不可执行');
  expect(body[1].text()).not.toContain('JIT_BLOCKED:QUOTE_STALE');
  expect(body[1].text()).not.toContain('已挂单');
  expect(body[1].findAll('td').filter((cell: any) => cell.text() === '已挂单')).toHaveLength(0);
});

it('the table keeps the same number of columns for a scout row as for a primary row', async () => {
  const {wrapper} = await open();
  const columns = wrapper.findAll('thead th').length;
  const body = wrapper.findAll('tbody tr');
  const spanned = (row: any) => row.findAll('td').reduce((total: number, cell: any) => total + Number(cell.attributes('colspan') ?? 1), 0);
  expect(spanned(body[0])).toBe(columns);
  expect(spanned(body[1])).toBe(columns);
  expect(spanned(body[2]), 'a scout row must not shift the columns it does share').toBe(columns);
  expect(body[2].text()).toContain('该次 9B Run');
});

it('the detail drawer expands the outcome into the full id chain with its timestamps', async () => {
  const {wrapper} = await open();
  const trigger = wrapper.findAll('button').find((node: any) => node.text().includes('查看决策'))!;
  await trigger.trigger('click');
  await flushPromises();
  const drawer = wrapper.find('.audit-drawer').text();
  expect(drawer).toContain('执行结果 / 不执行主因');
  expect(drawer).toContain('已挂单');
  expect(drawer).toContain('plan_1');
  expect(drawer).toContain('res_1');
  expect(drawer).toContain('intent_1');
  expect(drawer).toContain('entry_intent_1');
  expect(drawer).toContain('ML_intent_1');
  expect(drawer).toContain('9001');
  expect(cells(wrapper.findAll('tbody tr')[0]).join('|')).toContain('已挂单');
});
