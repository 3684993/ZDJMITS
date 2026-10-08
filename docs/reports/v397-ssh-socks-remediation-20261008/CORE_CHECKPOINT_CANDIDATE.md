# Engine reactivity candidate — core-only high-frequency checkpoint

Baseline: `cfeeaffc537fdf93f7e036683c6dfbaa7a2214af`

Branch: `chatgpt/reactivity-core-checkpoint-20261008`

## Why this candidate exists

The latest live remediation profile attributes about **43.28%** of inclusive CPU samples to
`persistRuntime`; synchronous Trading Quality capture has already fallen to about **10.74%**,
yet maximum event-loop delay remains about **6.14 seconds**.

The current 1-second event-coalesced checkpoint calls `state.serialize()` and then
`persistRuntime()`. That path walks all retained entities, JSON-encodes them and scans the
runtime-entity key index even when almost nothing changed.

## Change

- `RuntimeState.serializeCheckpointCore()` omits collections already stored behind
  `runtime_state._entityLists` + `runtime_entities`.
- `SettingsStore.persistRuntimeCore()` updates only the small core and preserves the previous
  entity manifest verbatim.
- Only the ordinary 1-second checkpoint uses this path.
- Existing full synchronous checkpoints remain for submission/TP/manual safety events,
  reservation transactions, startup migration and clean shutdown.

No strategy, Entry, TP, proxy, TTL, Production, UNKNOWN or identity rule changes.

## Verification before deployment

```powershell
npm --workspace @zdj/engine test -- src/state/runtimeState.test.ts src/config/settingsStore.test.ts
npm run verify
```

Then deploy once and compare a new CPU/event-loop profile. Acceptance for this iteration:
`persistRuntime` inclusive CPU materially drops, no multi-second checkpoint stall, and
PRIVATE / EXECUTION / REQUIRED_MARKET lanes remain free of queue timeout with fresh facts.

If full persistence remains dominant after this first structural cut, the next iteration should
replace the remaining synchronous full checkpoints/reservation transaction with entity-specific
incremental persistence, not resume Trading Quality micro-tuning.
