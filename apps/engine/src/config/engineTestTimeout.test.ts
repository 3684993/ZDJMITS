import { describe, expect, it } from 'vitest';
import { engineTestTimeoutMs } from './testTimeoutBudget.js';

describe('CI-only vitest timeout budget', () => {
  it('keeps the 5s default locally and widens it only under CI', () => {
    expect(engineTestTimeoutMs(undefined)).toBe(5_000);
    expect(engineTestTimeoutMs('')).toBe(5_000);
    expect(engineTestTimeoutMs('false')).toBe(5_000);
    expect(engineTestTimeoutMs('true')).toBe(20_000);
    expect(engineTestTimeoutMs(true)).toBe(20_000);
  });
});
