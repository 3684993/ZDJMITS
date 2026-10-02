import { describe, expect, it } from 'vitest';
import { decimalFromUnits, formatOrderDecimal, plainDecimal, quantityFromUnits } from './orderDecimals.js';

describe('decimalFromUnits', () => {
  it.each([
    [107, 0.0001, '0.0107'],
    [3, 0.1, '0.3'],
    [107, 0.005, '0.535'],
    [3, 0.25, '0.75'],
    [123, 1e-8, '0.00000123'],
    [2, 2.5e-8, '0.00000005'],
    [3, 1e21, '3000000000000000000000'],
    [0, 0.005, '0'],
    [Number.MAX_SAFE_INTEGER, 0.0001, '900719925474.0991'],
  ])('multiplies %s integer units by step %s as %s', (units, step, expected) => {
    expect(decimalFromUnits(units, step)).toBe(expected);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid units %s', (units) => {
    expect(() => decimalFromUnits(units, 0.0001)).toThrow(RangeError);
  });

  it.each([0, -0.1, NaN, Infinity, -Infinity])('rejects invalid step %s', (step) => {
    expect(() => decimalFromUnits(1, step)).toThrow(RangeError);
  });
});

describe('quantityFromUnits', () => {
  it('removes the native BTC multiplication residue before persisting a numeric quantity', () => {
    expect(107 * 0.0001).toBe(0.010700000000000001);
    expect(quantityFromUnits(107, 0.0001)).toBe(0.0107);
  });

  it('rejects products that overflow the numeric representation', () => {
    expect(() => quantityFromUnits(10, 1e308)).toThrow(RangeError);
  });
});

describe('plainDecimal', () => {
  it.each([
    [1e-8, '0.00000001'],
    [-2.5e-8, '-0.000000025'],
    [1e21, '1000000000000000000000'],
    [-1.23e21, '-1230000000000000000000'],
    [0.010700000000000001, '0.010700000000000001'],
    [0, '0'],
    [-0, '0'],
  ])('expands %s to %s without rounding', (value, expected) => {
    expect(plainDecimal(value)).toBe(expected);
  });

  it('supports the smallest positive number without scientific notation', () => {
    expect(plainDecimal(Number.MIN_VALUE)).toBe(`0.${'0'.repeat(323)}5`);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite value %s', (value) => {
    expect(() => plainDecimal(value)).toThrow(RangeError);
  });
});

describe('formatOrderDecimal', () => {
  it.each([
    [107 * 0.0001, 0.0001, '0.0107'],
    [83623.5, 0.1, '83623.5'],
    [83623.50000000001, 0.1, '83623.5'],
    [0.1 + 0.2, 0.1, '0.3'],
    [0.75, 0.25, '0.75'],
    [0.535, 0.005, '0.535'],
    [123 * 1e-8, 1e-8, '0.00000123'],
    [2.5e-8, 2.5e-8, '0.000000025'],
    [1e21, 1e21, '1000000000000000000000'],
  ])('formats grid value %s with step %s as %s', (value, step, expected) => {
    expect(formatOrderDecimal(value, step)).toBe(expected);
  });

  it.each([
    [0.01075, 0.0001],
    [0.0107000000000001, 0.0001],
    [83623.51, 0.1],
    [0.76, 0.25],
    [1.01e-8, 1e-8],
    [2 ** 50 + 0.25, 1],
  ])('rejects off-grid %s for step %s instead of changing the order', (value, step) => {
    expect(() => formatOrderDecimal(value, step)).toThrow(/not aligned/);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid order value %s', (value) => {
    expect(() => formatOrderDecimal(value, 0.1)).toThrow(RangeError);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid order step %s', (step) => {
    expect(() => formatOrderDecimal(1, step)).toThrow(RangeError);
  });

  it('rejects quantities that cannot be resolved to safe integer units', () => {
    expect(() => formatOrderDecimal(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow(/safe integer/);
    expect(() => formatOrderDecimal(1e308, 1e-8)).toThrow(/safe integer/);
    expect(() => formatOrderDecimal(0.1, 1)).toThrow(/safe integer/);
  });

  it('accepts exact subnormal grid values when a fractional step would underflow', () => {
    expect(formatOrderDecimal(Number.MIN_VALUE, Number.MIN_VALUE)).toBe(`0.${'0'.repeat(323)}5`);
  });
});
