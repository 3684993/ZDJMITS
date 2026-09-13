import { expect, it, vi } from 'vitest';
import { RequestBudget } from './requestBudget.js';

it('keeps reconciliation available during observed-weight anomaly while public hydration remains gated', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const budget = new RequestBudget(3, 2, 100, {
      softPublicWeight: 1000,
      softBackgroundWeight: 1800,
      hardWeight: 2200,
    });
    budget.observe(200, '1200', undefined, {
      source: 'PRIVATE_STATE',
      endpoint: '/fapi/v2/account',
    });
    expect(budget.health()).toMatchObject({
      status: 'PRESSURED',
      observedWeightAnomaly: true,
      usedWeight1m: 1200,
    });

    const reconciliation = vi.fn(async () => {});
    await budget.run(1, 5, reconciliation, {
      source: 'RECONCILIATION',
      endpoint: '/fapi/v1/openOrders',
      purpose: 'BOOTSTRAP_RECONCILIATION',
    });
    expect(reconciliation).toHaveBeenCalledOnce();

    const publicHydration = vi.fn(async () => {});
    const pending = budget.run(2, 1, publicHydration, {
      source: 'MARKET_DATA',
      endpoint: '/fapi/v1/klines',
      purpose: 'BOOTSTRAP_HYDRATION',
    });
    const rejected = expect(pending).rejects.toThrow('BINANCE_REQUEST_QUEUE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5100);
    await rejected;
    expect(publicHydration).not.toHaveBeenCalled();
    expect(budget.health().decisions.queueTimeout).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
