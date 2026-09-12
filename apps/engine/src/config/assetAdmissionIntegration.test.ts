import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyAsset } from '@zdj/core';
import { SettingsStore } from './settingsStore.js';

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(value => rm(value, { recursive: true, force: true }))); });

describe('isolated contracts build admission integration', () => {
  it('uses the isolated contracts/core build for SQLite reload and LKG admission', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-isolated-admission-')); paths.push(dataDir);
    const store = new SettingsStore(path.resolve(process.cwd(), '../../config'), dataDir), initial = await store.load(), now = 1_000_000;
    const approval = { symbol: 'SOLUSDT', reason: 'TEST', reviewedAt: now, validUntil: now + 10, graceUntil: now + 20, lkgSourceFailed: false, quoteVolumeUsd24h: 30_000_000, medianDailyQuoteVolumeUsd30d: 30_000_000, tradeCount24h: 30_000, openInterestUsd: 6_000_000, listingAgeDays: 200, liquidityComposite: .5 };
    await store.save({ ...initial, selection: { ...initial.selection, assetDirectory: { ...initial.selection.assetDirectory, version: 'V3.9.1-isolated', methodVersion: 'V3.9.1-LIQUIDITY-30D-V4', reviewedAt: now, nextReviewAt: now + 10, evidenceHash: 'isolated-evidence', approvedLiquid: ['SOL'], excluded: [], approvals: { SOL: approval }, lkgAssets: [] } } });
    const reopened = new SettingsStore(path.resolve(process.cwd(), '../../config'), dataDir);
    try {
      const reloaded = await reopened.load();
      expect(classifyAsset('SOLUSDT', reloaded, now + 1).classification).toBe('APPROVED_LIQUID');
      const lkg = structuredClone(reloaded); (lkg.selection.assetDirectory.approvals.SOL as any).lkgSourceFailed = true;
      expect(classifyAsset('SOLUSDT', lkg, now + 15).classification).toBe('APPROVED_LIQUID');
      expect(classifyAsset('SOLUSDT', lkg, now + 21).reason).toBe('ASSET_APPROVAL_EXPIRED');
    } finally { reopened.close(); store.close(); }
  });
});
