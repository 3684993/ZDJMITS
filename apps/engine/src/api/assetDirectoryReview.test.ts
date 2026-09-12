import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { createApiRouter } from './router.js';
let server: any, runtime: EngineRuntime, dataDir = '';
afterEach(async () => { if (server) await new Promise<void>(resolve => server.close(resolve)); runtime?.stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); server = null; dataDir = ''; });
describe('asset directory review API', () => {
  it('keeps default preview read-only and only explicitly applies through governance CAS', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-asset-review-api-'));
    runtime = await EngineRuntime.createTestHarness({ configDir: path.resolve(process.cwd(), '../../config'), dataDir });
    const before = runtime.state.settings.settingsVersion, review: any = { version: 'r', evidenceHash: 'raw', approvedLiquid: [], evidence: [] }, directory: any = { approvedLiquid: [], lkgAssets: [], evidenceHash: 'raw' };
    const preview = vi.fn(async () => ({ status: 'PREVIEW', review, directory, settingsVersion: before })), apply = vi.fn(async () => ({ status: 'PUBLISHED', review, directory, settings: { settingsVersion: before + 1 } }));
    runtime.assetGovernance = { preview, tick: apply } as any;
    const app = express(); app.use(express.json()); app.use('/api/v3', createApiRouter(runtime)); server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v3/universe/asset-directory/review`;
    const previewResponse = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(previewResponse.status).toBe(200); expect(preview).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled(); expect((await previewResponse.json()).applied).toBe(false); expect(runtime.state.settings.settingsVersion).toBe(before);
    const applyResponse = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"apply":true}' });
    expect(applyResponse.status).toBe(200); expect(apply).toHaveBeenCalledWith(true, 'MANUAL'); expect((await applyResponse.json()).applied).toBe(true);
  });
});
