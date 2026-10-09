# V3.9.8 Engine P0 runtime recovery receipt — 2026-10-09

## Result

The authorized one-shot TESTNET lifecycle start succeeded. Engine was not restarted again during this observation. This receipt records a continuous ten-minute runtime screen; it does not identify the earlier PID 8524 fail-fast trigger and does not claim a 24-hour stability result.

## Launch and identity

- TESTNET Engine listener: `0.0.0.0:8080`, PID `12432`, parent host PID `11992`.
- Launch time: `2026-10-09 11:58:31 +08`; final ten-minute sample: `2026-10-09 12:08:41 +08`; observed uptime `609827 ms`.
- `/health`: HTTP 200, `READY`, `ready=true`, PID `12432`, version `3.9.8`.
- Runtime identity: instance `abae6740-87e3-4e89-9f90-b396426088a9`, build `3.9.8-b40c717775db32ddf33f`.
- Identity closure 6/6: (1) live Node process/path and PID, (2) formal host receipt PID/launch identity/engine path, (3) persisted runtime identity PID/version/instance, (4) `/health` PID/version/build, (5) diagnostics closeout PID/instance/build, and (6) artifact hash prefix matches the build ID with a recorded source SHA-256.
- `/api/v3/diagnostics/closeout`: same PID, instance and build; TESTNET locked; `productionWrites=0`, `blockedProductionWriteAttempts=0`.
- Database integrity `true` / `HEALTHY`; private account `READY`; market stream `LIVE`; latest reconciliation error `null`.

## Ten-minute observations

Read-only samples at approximately 12:03:51, 12:04:29, 12:05:47, 12:06:39, 12:07:34, 12:08:24 and 12:08:41 +08 showed the same PID/build and a READY health response. Private account, market stream and database remained ready/healthy. Process remained alive; final sampled private memory was approximately 1.23 GiB and handle count 281. No second lifecycle start was issued.

## Models, proxy and startup automation

- Model route inventory: ports 8081=`qwen3.5:9b`, 8083=`qwen/qwen3.8-27b`, 8084=`qwen/qwen3.8-27b`; all `/v1/models` requests returned the expected alias. All three ports remained reachable.
- The required trade proxy was already running before Engine startup (port 20091, prior five-stage TESTNET egress probe passed) and remained reachable during runtime screening. The model processes and proxy were not restarted.
- Scheduled task `ZDJ-MITS-AfterReboot-TESTNET` is registered and currently `Ready`; it is configured for the next reboot. Its startup order places the proxy before Engine. This manual recovery did not manually run the scheduled task.

## TP and trading safety facts

- The latest exchange/account snapshot reports **13** open positions, 13 orders, and zero open Entry orders. The earlier 14-position count was not current at the final snapshot; no conclusion is made about which prior position left scope without a complete cross-store identity chain.
- TP diagnostics: `READY`, 13 required / 13 protected, 0 missing, 0 unverified, 0 unresolved position facts, 0 orphan/duplicate/quantity-mismatch/wrong-side protections, and retry queue 0. Reconciliation still reports drift count 5 and 217 unresolved risk facts: 215 historical Entry UNKNOWN and 2 manual UNKNOWN; TP UNKNOWN is 0.
- Two TESTNET writes were recorded (`/fapi/v1/order`), each coincident with a `TP_PROTECTED` event (UNIUSDC and DOGEUSDT). A later DOGEUSDT protection attempt ended `NOT_ATTEMPTED` while its position fact was unresolved. No third TESTNET write was observed. These are documented as Engine's existing TP Guardian behavior; no manual order, cancel, or modify operation was issued by this recovery.
- A DOGEUSDT `ENTRY_FILLED` event was recorded at 12:00:54 +08, after Engine launch. Persisted last-entry-submission time predates this launch, supporting that it was an already-submitted order, but the full remote order-origin chain was not closed in this receipt. It is not classified as a new submission by this recovery. Latest exchange state has zero open Entry orders and the DOGEUSDT protection is covered by the 13/13 TP snapshot.
- The startup Entry admission latch was enabled by the orchestrator. No new Entry submit event was identified in the runtime event scan; existing exchange orders can still fill after startup and require separate exact-identity review.

## Remaining P0 boundary

PID 8524's exit code `0xC0000409` remains a proven fail-fast termination, but the triggering component/callsite is still `UNKNOWN`; pre-exit Windows virtual-memory pressure is evidence, not proven causation. The current ten-minute live screen proves process recovery and bounded continuous operation only. Longer-duration stability and the old crash trigger remain open investigations. Production writes remained zero throughout the observed window.
