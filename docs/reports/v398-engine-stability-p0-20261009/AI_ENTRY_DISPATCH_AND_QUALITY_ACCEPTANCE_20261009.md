# V3.9.8 AI Entry dispatch and quality acceptance

Captured 2026-10-09 on the live TESTNET Engine; this is a runtime observation and implementation report, not a claim of quality calibration.

## Why Primary analysis was absent

- The live Engine process environment contains `ZDJ_ENTRY_ADMISSION_DISABLED=1` (read without exposing other environment values).
- The existing startup coordinator sets this latch before spawning the Engine. Before this repair, runtime analysis dispatch and write authority shared `canDispatch()`. The latch made it false, so scheduled ticks could not reach `EntryCoordinator.processPool()` and Primary calls remained zero.
- Live `/api/v3/observability/entry` for instance `abae6740-87e3-4e89-9f90-b396426088a9`, PID 12432, showed 0 completed/running Primary runs and zero PLACE/WAIT/protocol-failure counts. This is `AI_ANALYSIS_BLOCKED` for the currently loaded binary, not a model-route failure; configured model routes and local ports 8081/8083/8084 were available.

## Offline change under verification

- `canAnalyze()` is a distinct no-write gate. With the startup latch it requires TESTNET, TESTNET execution configuration, fresh private facts, storage admission, RUNNING runtime, AUTO_RUNNING governance, and AUTO Entry safety. `canDispatch()` remains false while the latch is set.
- Startup-latch analysis uses the existing analysis-only terminal path, which persists an observation and SYSTEM WAIT without an Entry intent, reservation, or order. `submitExactlyOnce()` retains an explicit latch refusal. No Settings or SQLite data were changed; no trade was manufactured.
- READ_ONLY armed intents continue to respect the model-spend readiness gate; read-only research dispatch remains supported. Targeted regression suite: 70/70 tests passed. Final full verification passed: 210/210 test files and 1901/1901 tests.

## Quality evidence and limits

- At 12:44 +08, the live read model showed 13 positions, 13 `PROTECTED`, 13 TP coverage sources `BINANCE_OPEN_ORDER`, and 0 missing local TP identities. These were engine-reported facts; no protective order was written or changed.
- The current Engine build predates the no-write analysis change and its observation window has 0 natural Primary outcomes. Frozen candidate, Primary-only authority, direction independence, no separate add, and authorized quantity/price boundaries are exercised by repository tests, not accepted from this runtime.
- Natural quality calibration is `INSUFFICIENT`: zero observed natural PLACE chains in this instance, below the plan's 50 mature-chain bar. 24-hour stability is also pending. No simulated or forced order is counted.
- Runtime adoption of the analysis-only repair requires a guarded cutover and must preserve current positions/TP evidence. No cutover is included in this receipt.
