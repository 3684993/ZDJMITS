// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The same file the Engine validates against, read from the repo root rather than re-typed here.
const defaults = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../config/settings.default.json'), 'utf8'));
import Settings from './SettingsView.vue';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: { settings: vi.fn(), connections: vi.fn(), resources: vi.fn(), governanceSettings: vi.fn(), saveSettings: vi.fn() },
  saveExchangeCredentials: vi.fn(),
  testPrivateCredentials: vi.fn(),
}));

const stored = (gross: number, direction: number) => ({
  ...defaults,
  riskGovernance: { ...defaults.riskGovernance, maxGrossExposurePct: gross, maxDirectionExposurePct: direction },
  settingsVersion: 190,
});

const saveButton=(wrapper:any)=>wrapper.findAll('button').find(node=>node.text().includes('保存设置'))!;
function inputFor(wrapper: any, label: string) {
  const row = wrapper.findAll('label').find((node: any) => node.text().includes(label));
  return row?.find('input');
}

async function opened(payload: any) {
  vi.mocked(api.settings).mockResolvedValue(payload);
  const wrapper = mount(Settings, { global: { stubs: { Panel: { template: '<div><slot/></div>' } } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.connections).mockResolvedValue({ credentials: { configured: false } } as never);
  vi.mocked(api.resources).mockResolvedValue({ items: [], settingsVersion: 190 } as never);
  vi.mocked(api.governanceSettings).mockResolvedValue({ fields: [], settingsVersion: 190 } as never);
  vi.mocked(api.saveSettings).mockImplementation(async (body: any) => body);
});

it('edits the two existing exposure caps in percent and persists the exact ratio', async () => {
  const wrapper = await opened(stored(1, 0.5));
  const gross = inputFor(wrapper, '组合总名义敞口上限（占权益 %）');
  const direction = inputFor(wrapper, '单方向名义敞口上限（占权益 %）');
  expect(gross?.exists()).toBe(true);
  expect(direction?.exists()).toBe(true);
  // Backend 1 is 100% of equity, backend .5 is 50%.
  expect(Number(gross!.element.value)).toBe(100);
  expect(Number(direction!.element.value)).toBe(50);
  await gross!.setValue('150');
  await saveButton(wrapper).trigger('click');
  await flushPromises();
  const saved = vi.mocked(api.saveSettings).mock.calls.at(-1)?.[0] as any;
  expect(saved.riskGovernance.maxGrossExposurePct).toBe(1.5);
  expect(saved.riskGovernance.maxDirectionExposurePct).toBe(0.5);
  // Read-back through the same field: no 100x or 10000x drift.
  expect(Number(inputFor(wrapper, '组合总名义敞口上限（占权益 %）')!.element.value)).toBe(150);
});

it('never writes a 100x-inflated cap when the operator types the percent form of the default', async () => {
  const wrapper = await opened(stored(1, 0.5));
  await inputFor(wrapper, '单方向名义敞口上限（占权益 %）')!.setValue('100');
  await saveButton(wrapper).trigger('click');
  await flushPromises();
  const saved = vi.mocked(api.saveSettings).mock.calls.at(-1)?.[0] as any;
  expect(saved.riskGovernance.maxDirectionExposurePct).toBe(1);
  expect(saved.riskGovernance.maxDirectionExposurePct).toBeLessThanOrEqual(20);
});

it('states that the cap limits new Entry risk only and is independent of the position slots', async () => {
  const wrapper = await opened(stored(1, 0.5));
  const text = wrapper.text();
  expect(text).toContain('只限制新增 Entry 风险');
  expect(text).toContain('不强平已有仓位');
  expect(text).toContain('不撤已有 TP/保护');
  expect(text).toContain('两条独立限制');
  expect(text).toContain('CAPACITY_BLOCKED');
});

it('leaves the trading parameter profile untouched when only an exposure cap is edited', async () => {
  const wrapper = await opened({ ...stored(1, 0.5), tradeEconomics: { ...defaults.tradeEconomics, parameterProfile: 'CONSERVATIVE' } });
  await inputFor(wrapper, '组合总名义敞口上限（占权益 %）')!.setValue('120');
  await flushPromises();
  const profile = wrapper.findAll('select').find(node => node.findAll('option').some(option => option.text().includes('保守')));
  expect(profile?.element.value).toBe('CONSERVATIVE');
});
