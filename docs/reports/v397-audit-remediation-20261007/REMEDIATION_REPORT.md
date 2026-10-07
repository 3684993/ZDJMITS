# F01/F02/F03/F05/F06/F07/F08 remediation — 2026-10-07

Status: **LOCAL_VERIFY_PASS / RUNTIME_OBSERVATION_PENDING**. This is a continuing remediation run, not long-duration acceptance.

Model verified from this conversation's session metadata: `gpt-6.1-sol`, reasoning `medium`.
Baseline: `f7ffc9a6acd99c5974fcb65554d61440ee2f06e5` from current GitHub main.
Original findings and question answers: `docs/reports/system-audit-20261007/`.
Preserved dirty checkout: `D:\MITS`. Implementation/verified artifacts: `D:\MITS-WORKTREES\v397-audit-remediation-20261007`.

## Implemented defects and evidence

| Finding | Implemented correction | Regression evidence |
|---|---|---|
| F01 | Independent last/mark/bid/ask event watermarks; reject older/future repairs; quote freshness uses oldest required field; older depth seeds cannot overwrite newer depth; socket callbacks require current lane ownership. Bounded field freshness diagnostics. | `BinanceMarketStream.test.ts`: stale last/mark remain stale despite fresh book; older/future seed rejection. Provider test: concurrent missing-field repair preserves newer WS last. Existing continuity simulation now supplies actual ticker/mark facts instead of implicitly refreshing them with book. |
| F02 | ACK-loss exact recovery preserves CANCELED/EXPIRED/REJECTED and executed quantity; unknown/inconsistent remote facts stay uncertain. Exact recovery feeds the shared reducer as EXACT_ORDER. SUBMITTING can converge to proven EXPIRED. | `tpGuardianCrossedTruth.test.ts`: all three terminal statuses with partial executions settle durable tasks without another submit. |
| F03 | Private timeout cannot independently bypass the 60s sustained transport criterion. NET-002 counts distinct actual wire timeouts. Queue congestion has BINANCE-QUEUE-001; unavailable private truth has PRIVATE-DATA-001. No freshness gate is relaxed. | `operationalIncidents.test.ts`: private single timeout, sustained wire burst, optional exclusions, queue classification. |
| F05 | Current account/balance/position reads have reserved admission capacity against other private reconciliation reads. Cold quote repairs only missing facts; book/depth and premium/quote flights are shared; seven-frame hydration uses two candle workers per symbol. Captured route/budget/agent prevent queued attribution moving to a different route. | Budget saturation regression admits account while other private reads remain active. Provider concurrency regression issues one repair for 20 readers and no redundant premium/depth/bookTicker. Raw queue pressure and request phase timestamps available in governance. |
| F06 | BACKGROUND is registered as background. Optional derivatives premium requests use BACKGROUND_AUDIT; a genuinely missing required mark uses explicit QUOTE_MARK_RECOVERY, preserving the required mark contract. | Background/context lane tests; purpose-sensitive incident filtering; existing optional TESTNET derivatives tests. |
| F07 | Least-recently-attempted identity rotation; historical retry deadline is bound to identity; identity changes bypass obsolete backoff. Whole reconciliation GET context has a cancellation deadline (15s startup / 30s normal), including initial private reads. Exit writes do not inherit read cancellation. UNKNOWN claims are released only with valid no-active-risk proof. | Six failed historical identities all attempted across two runs; initial read cancellation releases running guard; identity tombstone tests; read-only context priority/cancellation test proves writes retain EXECUTION source and no inherited signal. |
| F08 | Tracker explicitly returns current recovery transitions. API publishes that list instead of replaying recovered history. | Three activation/recovery cycles each yield exactly one recovery and zero on subsequent empty observations. |

## Local verification

`npm ci --offline --ignore-scripts --no-audit --no-fund` installed independent worktree dependencies.
`npm run verify` returned exit 0 at approximately 18:06 +08:00. Full log: `full-verify.log`.
Release identity, script contracts, S00 T01–T06, all workspace typechecks/builds passed.
Tests: Contracts 2 / Core 58 / Dashboard 123 / Engine 1776; 1959 total, 231 test files.
`git diff --check` passed. No GitHub Actions run was used for acceptance.
`preliminary-engine-tests.log` retains the preliminary failures and their context: one compiled worker needed the build, old fixtures depended on the F01 bug, and the new retry rule needed identity invalidation. The final verify includes their corrected regressions.

## Runtime observation and boundaries

Pre-restart snapshot: `before-restart.json`. At capture, old instance PID 50704 still had real transport timeouts and six occupied REST slots. Current private truth was READY in that sample with roughly 53–55s age; one sample does not prove sustained recovery.
8081/8083/8084 initial PIDs: 12732 / 17468 / 51124. They are outside restart scope.
The new verified checkout will use a junction to the existing `D:\MITS\data` only after local verification. No state/database reset, Settings change, proxy switching, strategy parameter change, or manufactured trade is part of this run.

`collect_stability.py` performs only localhost GET observations, once per minute for 12h, with 8s HTTP read deadlines and three workers. `stability-progress.json` is a checkpoint; `stability-final.json` is written only after the requested duration. Raw samples retain endpoint/request identities and bounded timing ledgers. Recovery/activation event frequency and natural TP cases require durable runtime-log analysis in addition to sampled incidents.

Acceptance requires actual source/artifact/API/instance identity closure, TESTNET-only boundary, zero Production writes, unchanged model service processes, and 6–12h observed data. Record true network failures and fact-unavailable intervals rather than hiding them. Queue timeouts must not masquerade as Binance wire latency; fresh book must not masquerade as fresh last/mark. Natural ACK-loss/terminal TP recovery remains UNKNOWN until it occurs; regression proof is not a live sample.

External proxy/tunnel/exchange reliability is not established by these code fixes. Network timing separates socket acquisition, proxy/TLS, first byte, and response body; it cannot alone distinguish a failed proxy tunnel from remote exchange failure. Bounded dispatch ledgers are not a complete wire census. No finding here claims all future NET-002 incidents are impossible.

F04/F10/F11 strategy/economic optimization is not performed. Progression to that work requires a separate evidence-based stability decision after this observation.
