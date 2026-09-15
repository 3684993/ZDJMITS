import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineRuntime } from './appRuntime.js';
import type { TradeAuditSnapshot } from '../types.js';

let runtime: EngineRuntime | null = null;
let dataDir = '';
let previousBackupDir: string | undefined;

afterEach(async () => {
  runtime?.stop();
  runtime = null;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = '';
  if (previousBackupDir === undefined) delete process.env.ZDJ_TRADE_SYNC_BACKUP_DIR;
  else process.env.ZDJ_TRADE_SYNC_BACKUP_DIR = previousBackupDir;
  previousBackupDir = undefined;
});

describe('automatic TradeRecord sync window', () => {
  it('reads the full 24 hours before startup and caps the final read at startup plus 24 hours', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-auto-trade-sync-'));
    previousBackupDir = process.env.ZDJ_TRADE_SYNC_BACKUP_DIR;
    process.env.ZDJ_TRADE_SYNC_BACKUP_DIR = path.join(dataDir, 'backups');
    runtime = await EngineRuntime.createTestHarness({
      configDir: path.resolve(process.cwd(), '../../config'),
      dataDir: path.join(dataDir, 'runtime'),
    });
    runtime.state.settings.connections.exchange.environment = 'TESTNET';
    (runtime as any).trade = { hasCredentials: () => true };
    const windows: Array<{ startTime: number; endTime: number }> = [];
    vi.spyOn(runtime, 'auditRecentTrades').mockImplementation(async (_hours, _max, startTime, endTime) => {
      const window = { startTime: Number(startTime), endTime: Number(endTime) };
      windows.push(window);
      return {
        source: 'BINANCE_TESTNET_PRIVATE',
        fetchedAt: Date.now(),
        window,
        fills: [],
        income: [],
        orders: [],
        positions: [],
        openOrders: [],
      } satisfies TradeAuditSnapshot;
    });

    const startAt = Date.now();
    (runtime as any).startTradeRecordAutoSync(startAt);
    await (runtime as any).tradeRecordAutoSyncFlight;

    // The first audit always covers the complete 24 hours before startup. If
    // Date.now() advances after startAt, auditTradeRecordWindow may legitimately
    // add a tiny trailing chunk from startAt to the later clock value. Do not
    // let that real-time millisecond boundary leak into the independent final
    // window scenario below.
    expect(windows[0]).toEqual({
      startTime: startAt - 24 * 60 * 60_000,
      endTime: startAt,
    });
    expect(windows.at(-1)?.endTime).toBeGreaterThanOrEqual(startAt);
    expect(runtime.tradeRecordAutoSyncStatus()).toMatchObject({ status: 'ACTIVE', windowStart: startAt - 24 * 60 * 60_000 });
    expect(runtime.settingsStore.listTradeSyncHistory(1)[0]).toMatchObject({ source: 'RUNTIME_AUTO', status: 'APPLIED' });

    windows.length = 0;
    const finalStartAt = Date.now() - 24 * 60 * 60_000 - 1_000;
    (runtime as any).tradeRecordAutoSyncStartedAt = finalStartAt;
    (runtime as any).tradeRecordAutoSyncLastEndAt = null;
    Object.assign((runtime as any).tradeRecordAutoSync, {
      startedAt: finalStartAt,
      windowStart: finalStartAt - 24 * 60 * 60_000,
      windowEnd: finalStartAt + 24 * 60 * 60_000,
    });
    await (runtime as any).performTradeRecordAutoSync();
    expect(windows).toEqual([
      {
        startTime: finalStartAt - 24 * 60 * 60_000,
        endTime: finalStartAt,
      },
      {
        startTime: finalStartAt,
        endTime: finalStartAt + 24 * 60 * 60_000,
      },
    ]);
    expect(runtime.tradeRecordAutoSyncStatus()).toMatchObject({ status: 'COMPLETE', windowEnd: finalStartAt + 24 * 60 * 60_000 });
  });
});
