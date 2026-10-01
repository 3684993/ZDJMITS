# V3.9.7 Current Instance Full Implementation Result

Date: 2026-10-01 (Asia/Shanghai)
Target: `3684993/ZDJMITS` `main`, current TESTNET instance at `D:\MITS`
Implementation basis: `docs/reports/v397-current-instance-differential-optimization-20260930/IMPLEMENTATION_PLAN.md`

## Release status

- Source implementation commit pushed to `main`: `6691f34a18c194bc0e1fc4eb0d342c92fcb2c86b` (`Implement v397 current-instance economics`).
- The clean `D:\MITS` checkout was fast-forwarded from `14a0aa3e5b41ba3f639dcc4f4ef699fed52f8f68` to the implementation commit. No reset, rebase, force push, or Production write was used.
- TESTNET was stopped once, backed up, built locally, and started once with `MANUAL_START`. Do not infer an automatic retry authorization from this record.
- Build identity loaded by PID `18280`: `3.9.6-7ff5216ea54a69481cda`, artifact SHA-256 `7ff5216ea54a69481cdafa680691d629e064d07d47016ccde54826d85d86f835`, source SHA-256 `783d10ba892d8111a66e4c8b4d9a1fb2f2b28aa22f21f5ef7172229c4992739d`.
- Identity closure: `IDENTITY_CLOSED`, all six checks true (remote/local HEAD; committed source/runtime sourceHash; dist/runtime artifactHash; artifact-derived buildId; runtime API/instance file; source tree clean).
- **Natural runtime acceptance is partial.** After about 22 minutes of bootstrap and historical order verification, `/health` reached `READY`, reconciliation ran, and the scheduler became `RUNNING`. Identity closure is complete, but unresolved historical risk and TP coverage are still degraded, and no natural post-build Entry or completed Exit was observed.

## Implemented

- Added the versioned `V397-ENTRY-ECONOMIC-MANDATE-1` contract and TESTNET mandate builder. It binds Settings version/hash, fresh closed `1d`/`4h`/`15m` direction facts, side, sizing, quantity step/tick, margin, notional, leverage, fees, slippage, funding/FX uncertainty, minimum net profit, TP, horizon, and one-hour reachability status.
- Separated per-quote minimum initial margin, optional business minimum order notional, and exchange filters. Legacy `entryMarginUsd=200` and `baseMarginUsd=200` remain capital planning inputs and are not mapped to a new business floor. Unconfigured TESTNET minimum initial margin fails closed.
- Made executable sizing start at the lowest legal size satisfying the configured business/exchange floors, then bound it by actual funds and verified leverage. Added JIT fact/mandate identity checks and no silent re-scaling.
- Removed Scout from the awaited Primary path; Scout work is asynchronous and correlated to its packet. Primary no longer receives Scout output as direction/size authority. TESTNET funds-only Primary context excludes portfolio/capacity/human/unknown-risk observations from side and quantity choice.
- Added exact quantity/side/price readback through intent, adapter request and response projections. Raw transport wire bytes are not retained and remain explicitly unavailable.
- Added mandate persistence to `tq_entry_mandates`, extended the episode horizon/path observations through 4h, exposed mandate and adapter parity through `/observability/entry`, and carried the mandate into position review / AI Exit SHADOW evidence and Dashboard position details. TP protection status remains distinct from TP economic quality.
- Added Settings controls for quote-specific floors, null-safe legacy Settings display, and 4h observation horizon migration. Existing observation modes remain observations; they do not directly rewrite quantity or side.

## Settings and schema

- Settings store migration 13 was present in the live database after startup. Settings row version: `228`.
- Live `entry.minimumInitialMarginByQuote`: `{USDT:null, USDC:null}`.
- Live `entry.minimumOrderNotionalByQuote`: `{USDT:null, USDC:null}`.
- Legacy `portfolio.entryMarginUsd`: `200` unchanged. This was not substituted for the new minimum.
- Trading-quality database migration 2 was recorded and `tq_entry_mandates` exists.
- A pre-migration backup was made while Engine was stopped for `zdj-settings.sqlite` and `v396-ownership.sqlite`; independent SQLite integrity checks returned `ok`. The settings DB backup has 70,012 runtime events and schema migration 11, confirming it predates the live migration. The backup is retained in the implementation worktree under `work/v397-preflight-20261001/`.
- Read-only durable schema roundtrip before startup: `DURABLE_SCHEMA_ROUNDTRIP_OK`; checked 35 positions, 1,807 entry orders, 1,866 entry intents, 1,016 TP orders, 42 manual orders, 579 trade records, 5,000 execution fills, plus the trade-record table. All rows parsed with zero schema issues. `exchangeWrites=0`.

## Verification

- `npm run verify`: exit 0. Typecheck and build succeeded; all 186 Engine test files / 1,649 tests passed; all Dashboard tests passed (21 files / 110 tests), plus contracts/core suites.
- `node scripts/v396-s00-static-check.mjs`: PASS, S00 T01–T06, no blockers, network `NOT_USED`, exchange writes `0`, Engine lifecycle `NOT_USED`.
- `node scripts/v396-durable-schema-roundtrip.mjs D:/MITS/data`: PASS before startup.
- `node scripts/v396-g1-g4-identity-closure.mjs D:/MITS http://127.0.0.1:8080/api/v3 main`: `IDENTITY_CLOSED`, 6/6.
- Git diff whitespace check passed. Hosted CI / GitHub Actions were not run.

## Natural TESTNET readback

- Startup reason was `MANUAL_START`; market stream connected with 208 subscriptions and no reported gaps in the readback. Private account status was `READY`.
- Runtime boundary readback after natural TP maintenance: environment `TESTNET`, execution mode `TESTNET_ENABLED`, `lockedToTestnet=true`, `productionWrites=0`, `blockedProductionWriteAttempts=0`, `testnetWrites=4`; last path `/fapi/v1/order`.
- Final health readback: `/health=READY`, market stream `LIVE`, private account `READY`, scheduler `RUNNING`; first reconciliation completed with 38 exchange positions and 35 exchange orders. Reconciliation remains `DEGRADED` with 161 active-risk unresolved, 173 historical Entry unknowns, and one manual unknown; these remain fail-closed.
- TP protection readback after the retry: status `READY`, 38 positions required and 38 protected, zero missing/unverified, zero retry queue. Three natural runtime events confirmed `TP_PROTECTED`. One initial replacement was refused because cancellation could not be verified (`TP_REPLACEMENT_CANCEL_UNVERIFIED`); later deterministic retry obtained exchange confirmation. Current target economics were separately reported, including `TP_LOW_NET_TARGET_KEPT` with expected net profit about `$0.019` against the `$1` floor; protection does not imply economic quality.
- Exit recovery read back eight existing remote exit orders as `EXCHANGE_FACT_WORKING`. This is order-state convergence, not evidence of a completed natural Exit/fill or post-exit review.
- No post-build `PRIMARY_DECISION_NORMALIZED` or `ENTRY_SUBMIT_ATTEMPTED` runtime event was present at the final query. The rolling 30-minute conversion window contained older pre-start fills, so those are not counted as post-build natural Entries. No natural Entry/fill is claimed.
- At final readback the pool was `WAITING_CANDIDATE` and the scheduler `RUNNING`. With both new minimum margin quote fields null, a product-defined per-quote minimum is still needed before natural Entry validation can be completed. No Entry sample was manufactured and legacy `200` was not used to force activity.

## Remaining UNKNOWN / incomplete evidence

1. Continued scheduler heartbeat and natural run beyond this readback: `UNKNOWN` (this was a bounded observation, not a long-run soak).
2. Natural post-build Entry → fill → TP protection/economic result → Review/Exit chain: `UNKNOWN` (TP protection reached 38/38, but no new Entry or completed Exit was observed in the bounded capture).
3. Per-quote minimum initial margin and any optional business notional: not supplied/configured; no safe value can be inferred from legacy `200` or exchange minimums.
4. Raw adapter wire bytes / full exchange response payload: unavailable in historical and current retained telemetry; exact structured request/response identity is implemented, raw bytes remain `UNKNOWN`.
5. Timestamped funding coverage and USDC/USD conversion coverage for any specific future mandate: remain fact-dependent; absent coverage remains `UNPROVEN`.
6. External hosted CI: `NOT_RUN`.
