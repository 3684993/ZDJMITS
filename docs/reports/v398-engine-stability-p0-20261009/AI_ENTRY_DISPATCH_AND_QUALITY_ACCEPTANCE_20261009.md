# V3.9.8 AI Entry dispatch and quality acceptance

## Live result after merged build — 2026-10-09 12:59 +08

- PID 22988 / instance `322685fa-bd92-4f3b-9257-fd15a2ffdc68` / build `3.9.8-97aa98c71e15a39ef7b6` exposes `analysis.mode=ANALYSIS_ONLY`, scheduler `RUNNING`, and fresh analysis heartbeats. The startup latch remains a no-write boundary; `canDispatch` stays locked. The API now publishes `WAITING_CANDIDATE` and supply suppression instead of silently suppressing the whole analysis tick.
- No Entry order or intent was produced. Current `POOL_SUPPLY_SHORTAGE` has target 20, qualified supply 7, ready supply fluctuating from 0 to 6 in adjacent reads, and an eligibility count of 7. At 12:59:14 the Primary model was ONLINE/idle, `WAITING_CANDIDATE`, with zero active calls and zero completed Primary runs. This is an actual candidate-supply gate; no candidate or order was manufactured to force analysis.
- One real Primary analysis attempt was recorded for DOGEUSDC and ended `UNKNOWN` / `AI_PROTOCOL_FAILURE`; runtime `aiHealth.topError=AI_HTTP_400`, `failed=1`, `timeout=0`, `schemaInvalid=0`. A read-only query of the durable `ai_runs_archive` row and matching `AI_RUN_FAILED` event proved the exact server rejection: `exceed_context_size_error`, `n_prompt_tokens=38567`, while the model server had `n_ctx=32768`. Thus this was an oversized Primary request, not an unreachable model route. Port 8084 `/v1/models` returned HTTP 200 for the configured model, which proves route availability only, not successful inference. No prompt or raw AI payload was added to GitHub.
- The newly proven context overflow has **not** been repaired in this running build. Do not guess or increase model context settings: that would change the running model's memory/runtime configuration. A source-level context-budget repair needs an offline contract preserving the complete frozen candidate, risk/TP facts, Primary-only decision authority, direction independence, no same-direction independent add, and exact quantity/price authorization, followed by tests and a separately authorized cutover if required. The natural quality acceptance remains `INSUFFICIENT`: one failed attempt, zero successful natural Primary decision chains, no PLACE/WAIT outcome sample from the restarted instance, and well below the planned 50 mature-chain threshold. Those quality invariants are covered by offline tests only; do not treat `READY`, model HTTP health, or analysis heartbeat as quality acceptance.
- TESTNET order submission remains locked while the latch is set. No Production writes, manual orders, forced candidates, Settings edits or SQLite reset were performed. Existing 13 positions remained TP-protected after the cutover; see closeout snapshots and report. Re-evaluate inference only from natural supply and preserve all fail-closed transaction/identity protections.

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
