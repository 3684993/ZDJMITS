/**
 * Boot-path check against a copy of the real migrated Testnet store: the rows persisted by the
 * crashed V3.9.6 run carry the exchange sign, so hydration must normalise them before the
 * dashboard projection is ever built.
 */
import { SettingsStore } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/config/settingsStore.js';
import { RuntimeState } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/state/runtimeState.js';

const ROOT = process.argv[2];
const store = new SettingsStore(`${ROOT}/config`, `${ROOT}/data`);
const settings = await store.load();
const loaded = store.loadRuntime();
const stored = (loaded.positions ?? []).map((tuple) => (Array.isArray(tuple) ? tuple[1] : tuple));
const state = new RuntimeState(settings);
state.restore(loaded);
const hydrated = [...state.positions.values()];
const shorts = hydrated.filter((p) => p.side === 'SHORT');
const example = hydrated.find((p) => p.symbol === 'AVAXUSDT');
console.log(
  JSON.stringify(
    {
      positionsPersisted: stored.length,
      persistedNegative: stored.filter((p) => Number(p.notionalUsd) < 0).length,
      positionsHydrated: hydrated.length,
      hydratedNegative: hydrated.filter((p) => Number(p.notionalUsd) < 0).length,
      shortCount: shorts.length,
      everyShortNonNegative: shorts.every((p) => Number(p.notionalUsd) >= 0),
      everyShortKeepsPositiveQuantity: shorts.every((p) => Number(p.quantity) > 0),
      magnitudePreservedForExample: example ? { side: example.side, quantity: example.quantity, notionalUsd: example.notionalUsd } : null,
      persistedExampleMagnitude: (() => {
        const row = stored.find((p) => p.symbol === 'AVAXUSDT');
        return row ? { side: row.side, notionalUsd: row.notionalUsd } : null;
      })(),
    },
    null,
    1,
  ),
);
