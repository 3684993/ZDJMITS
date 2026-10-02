import { formatOrderDecimal, plainDecimal } from '@zdj/core';

export type OrderPrecisionRules = { stepSize: number; tickSize: number };
export type OrderPrecisionRulesReader = (symbol: string) => OrderPrecisionRules | undefined;

/** Only this local error proves that the order write was never dispatched. */
export class OrderPrecisionError extends Error {
  readonly wireAttempted = false;
  readonly code = 'ORDER_DECIMAL_INVALID';
  constructor(readonly symbol: string, readonly field: string, readonly detail: string) {
    super(`ORDER_DECIMAL_INVALID:${symbol}:${field}:${detail}`);
    this.name = 'OrderPrecisionError';
  }
}

/** Canonicalize before signing. No REST lookup, sizing decision, or arbitrary rounding here. */
export function orderDecimalParameters(
  params: Record<string, string | number | boolean>,
  readRules?: OrderPrecisionRulesReader,
): Record<string, string | number | boolean> {
  const symbol = String(params.symbol ?? '');
  const rules = readRules?.(symbol);
  if (readRules && !rules) throw new OrderPrecisionError(symbol, 'filters', 'UNAVAILABLE');
  const result = { ...params };
  for (const [field, step] of [['quantity', rules?.stepSize], ['price', rules?.tickSize]] as const) {
    if (!(field in params)) continue;
    const value = params[field];
    try {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('POSITIVE_FINITE_NUMBER_REQUIRED');
      // Adapters without a market context (e.g. isolated tests) can expand exponents, but must
      // never guess an exchange step or silently trim potentially intentional precision.
      result[field] = rules ? formatOrderDecimal(value, step!) : plainDecimal(value);
    } catch (error) {
      throw new OrderPrecisionError(symbol, field, error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}
