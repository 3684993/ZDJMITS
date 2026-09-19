/**
 * GitHub's shared windows runner serves 2 cores while ~112 test files run concurrently, so the heavy
 * EngineRuntime-harness tests intermittently cross vitest's 5s default there. Locally the same tests
 * finish well under a second, so only CI gets the wider budget; assertions, retries and parallelism
 * stay untouched. Kept free of vitest imports so both the config and a unit test can use it.
 */
export const engineTestTimeoutMs = (ci: unknown) => (String(ci ?? '') === 'true' ? 20_000 : 5_000);
