/** Expand a finite number's decimal representation without changing its value. */
export function plainDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Decimal value must be finite');
  const { coefficient, scale } = decimalParts(value);
  return renderDecimal(coefficient, scale);
}

/** Multiply exchange step size by integer units without binary floating-point multiplication. */
export function decimalFromUnits(units: number, step: number): string {
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new RangeError('Order units must be a non-negative safe integer');
  }
  assertPositiveFinite(step, 'Order step');
  const { coefficient, scale } = decimalParts(step);
  return renderDecimal(BigInt(units) * coefficient, scale);
}

export function quantityFromUnits(units: number, step: number): number {
  const quantity = Number(decimalFromUnits(units, step));
  if (!Number.isFinite(quantity)) throw new RangeError('Order quantity exceeds the finite number range');
  return quantity;
}

/**
 * Canonicalize an already authorized price or quantity on its exchange grid.
 * Only machine-rounding residue is tolerated; this never rounds an off-grid order.
 */
export function formatOrderDecimal(value: number, step: number): string {
  assertPositiveFinite(value, 'Order value');
  assertPositiveFinite(step, 'Order step');
  const units = Math.round(value / step);
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new RangeError('Order value does not resolve to positive safe integer units');
  }
  const decimal = decimalFromUnits(units, step);
  const canonical = Number(decimal);
  if (!Number.isFinite(canonical)) throw new RangeError('Order value exceeds the finite number range');
  const difference = Math.abs(value - canonical);
  // Exact equality also handles subnormal steps whose quarter underflows to zero.
  if (difference !== 0 && (
    difference > 4 * Number.EPSILON * Math.abs(value)
    || difference >= step / 4
  )) {
    throw new RangeError('Order value is not aligned with the exchange step');
  }
  return decimal;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
}

function decimalParts(value: number): { coefficient: bigint; scale: number } {
  const [significand, exponentText] = String(value).toLowerCase().split('e');
  const exponent = Number(exponentText ?? '0');
  const negative = significand.startsWith('-');
  const [whole, fraction = ''] = (negative ? significand.slice(1) : significand).split('.');
  const coefficient = BigInt(whole + fraction) * (negative ? -1n : 1n);
  return { coefficient, scale: fraction.length - exponent };
}

function renderDecimal(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  const sign = negative ? '-' : '';
  if (scale <= 0) return sign + digits + '0'.repeat(-scale);
  const padded = digits.padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return sign + whole + (fraction ? `.${fraction}` : '');
}
