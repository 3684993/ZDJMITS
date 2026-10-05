import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineRuntime } from './appRuntime.js';
import type { TradeAuditSnapshot } from '../types.js';

let runtime: EngineRuntime | null = null;
let dataDir = '';
let previousBackupDir: string | undefined;
let dateSpy: ReturnType<typeof vi.spyOn> | null = null;

afterEach(async () => {
  dateSpy?.mockRestore();
  dateSpy = null;
  runtime?.stop();
  runtime = null;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = '';
  if (previousBackupDir === undefined) delete process.env.ZDJ_TRADE_SYNC_BACKUP_DIR;
  else process.env.ZDJ_TRADE_SYNC_BACKUP_DIR = previousBackupDir;
  previousBackupDir = undefined;
});

describe('automatic TradeRecord rolling sync window', () => {
  it('backfills the last seven days one day per pass, then stays incremental', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-auto-trade-sync-'));
    previousBackupDir = process.env.ZDJ_TRADE_SYNC_BACKUP_DIR;
    process.env.ZDJ_TRADE_SYNC_BACKUP_DIR = path.join(dataDir, 'backups');
    runtime = await EngineRuntime.createTestHarness({
      configDir: path.resolve(process.cwd(), '../../config'),
      dataDir: path.join(dataDir, 'runtime'),
    });
    runtime.state.settings.connections.exchange.environment = 'TESTNET';
    runtime.state.settings.performanceTracking = {enabled:true,baselineWalletByQuote:{USDT:5000,USDC:5000},rollingDays:7};
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

    const day = 24 * 60 * 60_000, startAt = 1_800_000_000_000;
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startAt);
    (runtime as any).startTradeRecordAutoSync(startAt);
    await (runtime as any).tradeRecordAutoSyncFlight;

    expect(windows).toEqual([{startTime:startAt-7*day,endTime:startAt-6*day}]);
    expect(runtime.tradeRecordAutoSyncStatus()).toMatchObject({
      status:'BACKFILLING',rollingDays:7,windowStart:startAt-7*day,windowEnd:startAt,
      lastWindow:{startTime:startAt-7*day,endTime:startAt-6*day},
    });
    expect(runtime.settingsStore.listTradeSyncHistory(1)[0]).toMatchObject({ source: 'RUNTIME_AUTO', status: 'APPLIED' });

    windows.length = 0;
    (runtime as any).tradeRecordAutoSyncLastEndAt = startAt - 2 * 60_000;
    await (runtime as any).performTradeRecordAutoSync();
    expect(windows).toEqual([{startTime:startAt-7*60_000,endTime:startAt}]);
    expect(runtime.tradeRecordAutoSyncStatus()).toMatchObject({
      status:'ACTIVE',rollingDays:7,lastWindow:{startTime:startAt-7*60_000,endTime:startAt},
    });
  }, 60_000);
});
