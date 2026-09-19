import { defineConfig } from 'vitest/config';
import { engineTestTimeoutMs } from './src/config/testTimeoutBudget';

const testTimeout = engineTestTimeoutMs(process.env.CI);
// Proves in the CI log which budget the run actually resolved, so a later timeout failure cannot be
// misread as "the config never applied".
console.log(`VITEST_TEST_TIMEOUT=${testTimeout} CI=${process.env.CI ?? ''}`);

export default defineConfig({ test: { testTimeout } });
