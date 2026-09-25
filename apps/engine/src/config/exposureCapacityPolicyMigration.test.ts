import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from './settingsStore.js';

/**
 * §C3: switching this Testnet deployment to margin-driven capacity is an explicit settings write, not
 * a side effect of upgrading. These cases pin that a document which never chose a mode still enforces
 * every ratio it always enforced, and that loading an operator's choice cannot move a ratio.
 */
const defaults = () => JSON.parse(readFileSync(path.resolve(process.cwd(), '../../config/settings.default.json'), 'utf8'));
const stores: SettingsStore[] = [];
const paths: string[] = [];

async function opened(payload: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zdj-exposure-policy-'));
  paths.push(dir);
  const store = new SettingsStore(path.resolve('../../config'), dir);
  stores.push(store);
  await store.load();
  (store as any).db.prepare('INSERT OR REPLACE INTO settings(id,version,payload,updated_at) VALUES(1,?,?,?)').run(Number(payload.settingsVersion ?? 1), JSON.stringify(payload), Date.now());
  return { store, loaded: await store.load() };
}

afterEach(() => {
  while (stores.length) stores.pop()!.close();
  void Promise.all(paths.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

it('enforces every notional ratio for a document that never chose a mode', async () => {
  const legacy = defaults();
  delete (legacy.riskGovernance as any).exposureCapacityPolicy;
  const { loaded } = await opened(legacy);
  expect(loaded.riskGovernance.exposureCapacityPolicy).toEqual({ gross: 'ENFORCE', direction: 'ENFORCE', cluster: 'ENFORCE' });
});

it('keeps an operator margin-driven choice across a restart without touching a single ratio', async () => {
  const stored = defaults();
  stored.riskGovernance.maxGrossExposurePct = 1;
  stored.riskGovernance.maxDirectionExposurePct = 0.8;
  stored.riskGovernance.exposureCapacityPolicy = { gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE' };
  const { loaded } = await opened(stored);
  expect(loaded.riskGovernance.exposureCapacityPolicy).toEqual({ gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE' });
  // The ceilings stay where the operator left them; only the veto moved.
  expect(loaded.riskGovernance.maxGrossExposurePct).toBe(1);
  expect(loaded.riskGovernance.maxDirectionExposurePct).toBe(0.8);
});

it('refuses an out-of-vocabulary mode instead of defaulting it open', async () => {
  const invalid = defaults();
  invalid.riskGovernance.exposureCapacityPolicy = { gross: 'MARGIN_DRIVEN', direction: 'ENFORCE', cluster: 'ENFORCE' };
  await expect(opened(invalid)).rejects.toThrow();
});
