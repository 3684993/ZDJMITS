// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Brain from './BrainView.vue';
import { brainRun, brainRuns } from '../api/client';

vi.mock('../stores/system', () => ({ useSystemStore: () => ({ snapshot: { aiResources: [] } }) }));
vi.mock('../api/client', () => ({ brainRun: vi.fn(), brainRuns: vi.fn() }));

const run = { id: 'run-1', run: { id: 'run-1', symbol: '4USDT', role: 'PRIMARY_BRAIN', model: 'local', timing: { totalMs: 120 } }, summary: { status: 'COMPLETED', decision: 'PLACE_LONG', direction: 'LONG', finalStage: 'PLAN', reason: 'EXCHANGE_WRITE_LOCKED' } };
const longDetail = { ...run, timeline: [], historicalCompactFacts: [], eip: { big: 'x'.repeat(2000) }, scoutInput: {}, primaryInput: {}, rawModelOutput: {}, normalizedDecision: {}, temporalMemory: {}, rawAudit: {} };

const rowTrigger = (wrapper: any) => wrapper.findAll('button').find(node => node.text().includes('查看决策'))!;

async function open() {
  vi.mocked(brainRuns).mockResolvedValue({ items: [{ id: 'run-1', startedAt: Date.now(), symbol: '4USDT', role: 'PRIMARY_BRAIN', model: 'local', status: 'COMPLETED' }], total: 1 } as never);
  vi.mocked(brainRun).mockResolvedValue(longDetail as never);
  const host = document.createElement('div');
  document.body.append(host);
  const outside = document.createElement('button');
  outside.className = 'outside-anchor';
  host.append(outside);
  const wrapper = mount(Brain, { attachTo: host, global: { stubs: { Panel: { template: '<div><slot/><slot name="footer"/></div>' }, StatusBadge: true } } });
  await flushPromises();
  await rowTrigger(wrapper).trigger('click');
  await flushPromises();
  return { wrapper, host, outside };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

const drawer = (wrapper: any) => wrapper.find('.audit-drawer');

it('puts a close control at the top of the detail, before any audit content', async () => {
  const { wrapper } = await open();
  expect(drawer(wrapper).exists()).toBe(true);
  const head = drawer(wrapper).find('.audit-drawer-head');
  expect(head.exists()).toBe(true);
  expect(head.text()).toContain('关闭');
  // The head is the first child of the scrolling container and sticks while the body scrolls.
  expect(drawer(wrapper).element.firstElementChild?.className).toContain('audit-drawer-head');
  expect(head.element.getAttribute('style')).toContain('position: sticky');
  expect(head.element.getAttribute('style')).toContain('top: 0');
  head.find('button').trigger('click');
  await flushPromises();
  expect(drawer(wrapper).exists()).toBe(false);
});

it('closes on Escape and keeps the bottom close as well', async () => {
  const { wrapper } = await open();
  const buttons = drawer(wrapper).findAll('button').filter(node => node.text().trim() === '关闭');
  expect(buttons.length).toBeGreaterThanOrEqual(2);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  expect(drawer(wrapper).exists()).toBe(false);
});

it('closes when focus leaves the detail for the surrounding app UI', async () => {
  const { wrapper, outside } = await open();
  drawer(wrapper).element.dispatchEvent(new FocusEvent('focusout', { relatedTarget: outside, bubbles: true }));
  await flushPromises();
  expect(drawer(wrapper).exists()).toBe(false);
});

it('keeps the detail open for focus moves inside it, text selection and a null focus target', async () => {
  const { wrapper } = await open();
  const inside = drawer(wrapper).findAll('button');
  drawer(wrapper).element.dispatchEvent(new FocusEvent('focusout', { relatedTarget: inside.at(-1)!.element, bubbles: true }));
  drawer(wrapper).element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await flushPromises();
  expect(drawer(wrapper).exists()).toBe(true);
});

it('never lets a late detail response reopen a closed drawer', async () => {
  vi.mocked(brainRuns).mockResolvedValue({ items: [{ id: 'run-1', startedAt: Date.now(), symbol: '4USDT', role: 'PRIMARY_BRAIN', model: 'local', status: 'COMPLETED' }], total: 1 } as never);
  let resolve!: (value: unknown) => void;
  vi.mocked(brainRun).mockReturnValue(new Promise(r => { resolve = r; }) as never);
  const host = document.createElement('div');
  document.body.append(host);
  const wrapper = mount(Brain, { attachTo: host, global: { stubs: { Panel: { template: '<div><slot/></div>' }, StatusBadge: true } } });
  await flushPromises();
  await rowTrigger(wrapper).trigger('click');
  await flushPromises();
  expect(drawer(wrapper).text()).toContain('加载中');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  expect(drawer(wrapper).exists()).toBe(false);
  resolve(longDetail);
  await flushPromises();
  expect(drawer(wrapper).exists()).toBe(false);
});

it('returns focus to the row that opened the detail', async () => {
  const { wrapper, host } = await open();
  const trigger = host.querySelector('button.button.secondary') as HTMLElement;
  trigger.focus();
  drawer(wrapper).find('.audit-drawer-head').find('button').trigger('click');
  await flushPromises();
  expect(document.activeElement).toBe(trigger);
});
