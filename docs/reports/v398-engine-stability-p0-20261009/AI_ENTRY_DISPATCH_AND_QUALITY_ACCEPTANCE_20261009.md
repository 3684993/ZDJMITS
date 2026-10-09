# V3.9.8 AI Entry dispatch and quality acceptance

## Latest runtime evidence — 2026-10-09 13:05 +08

- The current instance has 8 natural Primary run records: 7 failures and 1 completed ENAUSDT `PLACE_SHORT`. All 7 failures contain the same server error `exceed_context_size_error`; actual prompt sizes ranged 38,220–38,768 tokens against `n_ctx=32,768`. The model's failure is now proven as request-size overflow, not network unavailability.
- The successful natural output still has no intent, order, submit, or fill. Runtime Entry observation is 1 `PLACE_SHORT`, 7 `AI_PROTOCOL_FAILURE`, 0 running. TESTNET remains locked to analysis-only; `/diagnostics/closeout` reports `productionWrites=0`.
- At this check, analysis heartbeat was fresh, scheduler `RUNNING`, status `WAITING_CANDIDATE`; the pool had ready supply 9 of target 20. The prior 13:03 circuit-open snapshot had recovered by this check, but repeated context-size errors and one quarantine remain in the current instance's AI history. No circuit reset, Settings edit, or forced inference was performed.
- The context overflow is still uncorrected in the deployed source. Natural Entry quality acceptance remains `INSUFFICIENT`: no intent/order/fill outcome exists, and the planned 50 mature-chain bar has not been approached. No further Engine or model restart was performed.

## Follow-up runtime evidence — 2026-10-09 13:03 +08

- Read-only SQLite evidence for this Engine instance at 13:03 contained 7 Primary runs: six failed with the same `exceed_context_size_error` (prompt token counts 38,307–38,768 against `n_ctx=32,768`) and one completed naturally for ENAUSDT with `PLACE_SHORT`. This confirms that the no-write analysis path can reach the model and receive a decision when the request fits; it also proves repeatable context overflow for other candidates.
- The completed `PLACE_SHORT` observation has no intent ID/time, zero order IDs, no submit time, and no fills. The analysis-only latch prevented the decision from creating an intent/order. Runtime entry counts are `PLACE_SHORT=1`, `AI_PROTOCOL_FAILURE=6`; Production writes remain 0.
- At 13:03 +08, scheduler heartbeat remained fresh and `analysis.mode=ANALYSIS_ONLY`; dispatch was in `COOLDOWN` and the Primary resource reported `AI_PRIMARY_CIRCUIT_OPEN`. Candidate pool remained below target. Do not manually reset the circuit or force another call; repair the request-size problem offline before any further controlled cutover.
- The source-level context overflow is **not fixed in the running build**. Avoid increasing model context or making prompt-pruning changes without preserving the full decision/risk/TP contract and running the planned offline tests. No additional Engine/model restart is authorized by this closeout.

## Live result after merged build — 2026-10-09 12:59 +08

- PID 22988 / instance `322685fa-bd92-4f3b-9257-fd15a2ffdc68` / build `3.9.8-97aa98c71e15a39ef7b6` exposes `analysis.mode=ANALYSIS_ONLY`, scheduler `RUNNING`, and fresh analysis heartbeats. The startup latch remains a no-write boundary; `canDispatch` stays locked. The API now publishes `WAITING_CANDIDATE` and supply suppression instead of silently suppressing the whole analysis tick.
- No Entry order or intent was produced. Current `POOL_SUPPLY_SHORTAGE` has target 20, qualified supply 7, ready supply fluctuating from 0 to 6 in adjacent reads, and an eligibility count of 7. At 12:59:14 the Primary model was ONLINE/idle, `WAITING_CANDIDATE`, with zero active calls and zero completed Primary runs. This is an actual candidate-supply gate; no candidate or order was manufactured to force analysis.
- At that 12:59 sample, one real Primary analysis attempt was recorded for DOGEUSDC and ended `UNKNOWN` / `AI_PROTOCOL_FAILURE`; runtime `aiHealth.topError=AI_HTTP_400`. A read-only query of the durable run row and matching `AI_RUN_FAILED` event proved the exact server rejection: `exceed_context_size_error`, `n_prompt_tokens=38567`, while the model server had `n_ctx=32768`. Thus this was an oversized Primary request, not an unreachable model route. Port 8084 `/v1/models` returned HTTP 200 for the configured model, which proves route availability only, not successful inference. No prompt or raw AI payload was added to GitHub.
- The newly proven context overflow has **not** been repaired in this running build. Do not guess or increase model context settings: that would change the running model's memory/runtime configuration. A source-level context-budget repair needs an offline contract preserving the complete frozen candidate, risk/TP facts, Primary-only decision authority, direction independence, no same-direction independent add, and exact quantity/price authorization, followed by tests and a separately authorized cutover if required. At 12:59, no successful natural Primary decision had completed. Current follow-up quality remains `INSUFFICIENT`: one natural `PLACE_SHORT` decision but no intent/order/fill chain, six protocol failures, and well below the planned 50 mature-chain threshold. Those quality invariants are covered by offline tests only; do not treat `READY`, model HTTP health, or analysis heartbeat as quality acceptance.
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
