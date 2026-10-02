import { afterEach, describe, expect, it } from 'vitest';
import { OrderPrecisionError } from '../adapters/binance/orderPrecision.js';
import { V396ExitRuntime } from './v396ExitRuntime.js';
import { ONE_WAY_CAPABILITIES } from './v396ExitTestHarness.js';

const runtimes: V396ExitRuntime[] = [];
afterEach(() => { while (runtimes.length) runtimes.pop()!.close(); });
async function prepared() {
  const identity = { environment: 'TESTNET', account: 'binance-primary' };
  const runtime = new V396ExitRuntime(':memory:', () => identity, async () => ONE_WAY_CAPABILITIES);
  runtimes.push(runtime);
  const now = Date.now(), subject = { symbol: 'BTCUSDT', side: 'LONG' as const, cycleId: 'precision-cycle', openedAt: now - 60_000 };
  const result = await runtime.prepareManual({
    requestKey: 'precision-close', subject, quantityUnits: 10, limitPrice: 100, now,
    positionVersion: 1, settingsVersion: 1, riskGeneration: 1,
    availableReduceUnits: 10, remainingUnits: 10, minNotional: 5, tickSize: .1, stepSize: 1,
    proof: { kind: 'ONE_WAY_REDUCE_ONLY', checkedAt: now, positionSide: 'LONG' },
  });
  expect(result.accepted).toBe(true);
  const clientOrderId = result.clientOrderId!;
  expect(runtime.transitionByClientOrderId(clientOrderId, 'SUBMITTING', Date.now(), 'MANUAL_SUBMIT_SENT')).toBeTruthy();
  return { runtime, identity, clientOrderId, subject };
}
const error = () => new OrderPrecisionError('BTCUSDT', 'price', 'OFF_GRID');

describe('typed local exit precision evidence', () => {
  it('settles only the current unsent identity and releases its quantity claim', async () => {
    const x = await prepared();
    expect(x.runtime.abortExitPrecisionNotSent(x.clientOrderId, error(), 'manual-proof')?.state).toBe('REJECTED');
    expect(x.runtime.claimFor(x.clientOrderId)?.status).toBe('RELEASED');
    expect(x.runtime.task(x.clientOrderId)?.reasons).toContain('LOCAL_NOT_SENT:manual-proof');
  });

  it.each(['message', 'flag', 'foreign-symbol', 'foreign-account', 'production', 'missing-proof'] as const)(
    'does not settle a claim using %s evidence', async kind => {
      const x = await prepared();
      let proof: unknown = error();
      if (kind === 'message') proof = new Error(error().message);
      if (kind === 'flag') proof = { ...error(), wireAttempted: false };
      if (kind === 'foreign-symbol') proof = new OrderPrecisionError('ETHUSDT', 'price', 'OFF_GRID');
      if (kind === 'foreign-account') x.identity.account = 'different-account';
      if (kind === 'production') x.identity.environment = 'PRODUCTION';
      expect(x.runtime.abortExitPrecisionNotSent(x.clientOrderId, proof, kind === 'missing-proof' ? '' : 'proof')).toBeNull();
      expect(x.runtime.task(x.clientOrderId)?.state).toBe('SUBMITTING');
      expect(x.runtime.claimFor(x.clientOrderId)?.status).toBe('ACTIVE');
    },
  );

  it('keeps a previously uncertain submission unknown despite a later precision error', async () => {
    const x = await prepared();
    x.runtime.markSubmitUncertain(x.clientOrderId);
    expect(x.runtime.abortExitPrecisionNotSent(x.clientOrderId, error(), 'different-attempt')).toBeNull();
    expect(x.runtime.task(x.clientOrderId)?.state).toBe('UNKNOWN');
    expect(x.runtime.claimFor(x.clientOrderId)?.status).toBe('ACTIVE');
  });

  it('cannot overwrite acknowledged exchange evidence even if the task is later uncertain', async () => {
    const x = await prepared();
    x.runtime.observe({ eventId: 'accepted', clientOrderId: x.clientOrderId, state: 'WORKING', filledUnits: 0, positionVersion: 1 });
    expect(x.runtime.abortExitPrecisionNotSent(x.clientOrderId, error(), 'wrong-proof')).toBeNull();
    x.runtime.markSubmitUncertain(x.clientOrderId);
    expect(x.runtime.abortExitPrecisionNotSent(x.clientOrderId, error(), 'late-proof')).toBeNull();
    expect(x.runtime.claimFor(x.clientOrderId)?.status).toBe('ACTIVE');
  });
});
