import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EngineRuntime } from './appRuntime.js';
import { EntryIntentSchema, type EntryOrder } from '@zdj/contracts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('V3.9.3 frozen Entry authorization restart persistence', () => {
  it('preserves AI side, quantityUnits, acceptable range and pre-AI envelope through SQLite and Engine restart', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-v393-frozen-entry-'));
    tempDirs.push(dataDir);
    const configDir = path.resolve(process.cwd(), '../../config');
    const now = Date.now();

    const executionEnvelope = {
      version: 'V3.9.3_PRE_AI_EXECUTION_ENVELOPE' as const,
      symbol: 'BTCUSDT',
      underlying: 'BTC',
      quoteAsset: 'USDT',
      createdAt: now,
      expiresAt: now + 300_000,
      notice: 'EXECUTION FACTS ARE NOT MARKET SIGNALS.' as const,
      account: {
        status: 'READY',
        equityUsd: 10_000,
        availableMarginUsd: 9_000,
        reservedMarginUsd: 500,
        executionLeaseMarginUsd: 100,
        freeMarginUsd: 8_400,
      },
      positionCapacity: {
        used: 2,
        max: 20,
        slotAvailable: true,
        sameUnderlyingOccupied: false,
      },
      leverage: 20,
      exchange: {
        tickSize: 0.1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 5,
      },
      makerReachableBand: { min: 99_900, max: 100_100 },
      recentTradedPrices: [
        { price: 100_000, lastSeenAt: now },
        { price: 99_995, lastSeenAt: now - 500 },
      ],
      fees: {
        makerFeeBps: 2,
        takerFeeBps: 5,
        roundTripCostBps: 4,
        safetyMarginBps: 2,
      },
      LONG: {
        executable: true,
        maxMarginUsd: 500,
        maxNotionalUsd: 10_000,
        maxQuantityUnits: 100_000,
        riskHeadroom: {
          factVersion: 'risk-v1',
          remaining: { portfolio: 1 },
          blockers: [],
          reason: 'READY',
        },
      },
      SHORT: {
        executable: true,
        maxMarginUsd: 450,
        maxNotionalUsd: 9_000,
        maxQuantityUnits: 90_000,
        riskHeadroom: {
          factVersion: 'risk-v1',
          remaining: { portfolio: 1 },
          blockers: [],
          reason: 'READY',
        },
      },
      leaseRequiredMarginUsd: 100,
    };

    const intent = EntryIntentSchema.parse({
      id: 'intent-frozen-short',
      symbol: 'BTCUSDT',
      side: 'SHORT',
      confidence: 0.73,
      idealPrice: 100_000,
      acceptablePriceRange: { min: 99_980, max: 100_020 },
      horizonMinutes: 3,
      leverage: 20,
      createdAt: now,
      absoluteExpiresAt: now + 3_600_000,
      aiAuthorizationExpiresAt: now + 180_000,
      configuredOrderTtlExpiresAt: now + 3_600_000,
      packetId: 'packet-frozen',
      brainRunId: 'brain-frozen',
      quantityUnits: 250,
      executionEnvelope,
      reservationId: null,
      decisionChainId: 'brain-frozen',
      protectionMode: 'REQUIRED',
      snapshotId: 'snapshot-frozen',
      structuredInvalidationId: null,
      profitTakePlan: null,
    });

    const order = {
      id: 'order-frozen-short',
      exchangeOrderId: null,
      clientOrderId: 'zdj-frozen-short',
      symbol: 'BTCUSDT',
      side: 'SHORT',
      quantity: 0.25,
      price: 100_005,
      filledQuantity: 0,
      leverage: 20,
      status: 'UNKNOWN',
      createdAt: now,
      updatedAt: now,
      absoluteExpiresAt: now + 3_600_000,
      repriceCount: 0,
      intentId: intent.id,
      reachability: 0.9,
    } as EntryOrder;

    const first = await EngineRuntime.createTestHarness({ configDir, dataDir });
    first.state.entryIntents.set(intent.id, intent);
    first.state.entryOrders.set(order.id, order);
    first.settingsStore.saveEntryExecution({ intent, order });
    first.stop();

    const second = await EngineRuntime.createTestHarness({ configDir, dataDir });
    const restoredRaw = second.state.entryIntents.get(intent.id);
    expect(restoredRaw).toBeDefined();

    const restored = EntryIntentSchema.parse(restoredRaw);
    expect(restored.side).toBe('SHORT');
    expect(restored.quantityUnits).toBe(250);
    expect(restored.acceptablePriceRange).toEqual({ min: 99_980, max: 100_020 });
    expect(restored.aiAuthorizationExpiresAt).toBe(intent.aiAuthorizationExpiresAt);
    expect(restored.executionEnvelope).toEqual(executionEnvelope);

    const restoredOrder = second.state.entryOrders.get(order.id);
    expect(restoredOrder).toMatchObject({
      intentId: intent.id,
      clientOrderId: 'zdj-frozen-short',
      side: 'SHORT',
      quantity: 0.25,
      price: 100_005,
    });

    second.stop();
  });
});
