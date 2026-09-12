# V3.9.2 independent reverse audit

Baseline: `gpt56-optimize-v392-20260912`, `21cd8118f890951e89a9789cf5a6a075589b6300`.
Compared 30 commits from `4cf9f95` through `21cd811`; source and regression tests were authoritative.

## Gate decision

Overall: **FAIL for unattended Testnet runtime acceptance**. The minimal fixes below can be committed. The offline replacement-builder is safe to use for a separately reviewed cleanup. It never installs its output or prunes backups. No trading Engine lifecycle action, exchange request, live SQLite connection, live database cleanup, or live backup deletion was performed in this audit.

The source database was observed through file metadata only: 10,435,203,072 bytes, with a 19,796,632-byte WAL. Therefore a main-file-only backup is insufficient. The new builder copies and validates the DB/WAL file identities, replays WAL only in its own working directory, and hashes protected facts before/after retention and compaction. Source DB/WAL/SHM preservation is covered by an isolated WAL-only committed-fact test. Unsupported/hot rollback journals and malformed WAL headers are refused. Insufficient space, concurrent source changes and existing output paths are refused. The explicit replacement step must still verify the source hashes and handle original sidecars offline; this audit does not implement or execute that step.

## Deterministic defects fixed

1. Offline maintenance previously deleted the original DB before VACUUM. It now copies first, checks integrity/foreign keys, compares protected table row hashes/counts, and publishes a verified replacement without overwriting an existing output. Dry-run opens only a disposable copy.
2. Maintenance deleted arbitrary non-whitelisted audit events after seven days and all events after 90 days. It now deletes only explicitly identified telemetry, retaining changed lifecycle transitions and unknown future audit types. The unsafe hourly trigger installer is disabled; runtime initialization removes that legacy trigger.
3. Telemetry early-return bypassed reconciliation entry/manual execution persistence. Journal filtering is now inside SettingsStore; runtime business hooks still run. AI completion archival and compact chain references survive telemetry filtering. AI health reads compact SQL statuses rather than depending on removed completion events.
4. Runtime retention is actually scheduled in indexed 100-row batches, one policy per five-second tick. AI raw retention is 14 days, terminal summaries 90 days, snapshots seven days, non-execution chains 14 days, finished external research seven days. Orphan AI runtime entities are evicted. Decision-chain projections cap each event at 16 KiB and keep the latest 256 events; full journal facts are retained separately.
5. Both Trade Record Sync paths previously copied the entire DB for every sync. They now reuse one verified baseline, coalesce concurrent creation and reject new baseline generation above 512 MiB. Backup pruning requires a named verified baseline and an explicit offline/replacement-verification declaration; it retains exactly that baseline, never selects it by recency alone.
6. Position detail GET uses cached candles only. Manual preview GET uses a fresh cached quote or fails closed, with no REST fallback or preview audit write. Budget diagnostics now show actual route scopes instead of a default unused budget.
7. Budget admission now accounts for active weight over observed weight; exposes queued weight; blocks background requests on unexplained observed usage; gates Primary dispatch, final Entry guard and the actual Entry wire dispatch; supports HTTP-date Retry-After and body ban deadlines; writes ban state through flushed temporary-file replacement. Direct REST identity no longer changes with irrelevant WS proxy settings. Absolute cross-origin Binance URLs are refused. Ban IP parsing rejects fragments of the word “banned”.
8. Pool ready supply includes ready residents outside the cohort. Pool residents have explicit retention ownership and release membership when that owner disappears.
9. WAIT expiry no longer triggers Primary solely because a timer expired. The expired price condition is ignored until a material 15m change; 1m/5m noise remains excluded. Existing direction, risk, reservation, final execution, exactly-once, freshness, reconciliation and TP checks remain in place.
10. Quality scorecard no longer converts SQL NULL returns to zero or treats 50 PLACE decisions as proof of natural filled samples. Quality acceptance remains `INSUFFICIENT_SAMPLE` until Fill linkage and mature outcomes are proven. No thresholds were reduced.

## Residual blockers and time horizons

| Horizon | Remaining risk / evidence |
| --- | --- |
| 2 hours | Shared egress or changed proxy exit can still contribute weight outside this process. Route configuration hashes are not verified public-IP identity. Weight anomaly is now fail-closed for new Entry, but this is not proof that 418 cannot recur. |
| 6 hours | Busy-hour growth is not bounded by time retention alone. Recent rows are intentionally retained, so cleanup may not substantially shrink this same-day 10GB file. No production-size cleanup was run. |
| 24 hours | `decision_episodes`, non-AI historical runtime entities and retained lossless audit facts do not yet have an aggregate byte budget or a verified archival policy. SQLite free pages are reusable, but no absolute database-size bound is proven. |
| 7 days | Writer backlog, WAL readers, retention throughput and long-run memory/reconnect behavior require bounded isolated endurance tests and later explicitly authorized Testnet observation. Passing unit tests does not prove their long-run rates. |

SQLite recurrence gate: **NOT CLOSED**. Do not claim the database cannot reach 10GB again.
Binance recurrence gate: **PARTIAL**. No hard limit was increased; no live exchange validation was performed.
Market/WS and AI efficiency: static regression checks pass; runtime endurance is not certified.
Entry safety: existing safety suites plus pressure-at-dispatch tests pass; Production writes remain prohibited.
Dashboard: ordinary page/position reads are exchange-free. Explicit diagnostics/cleanup action endpoints are outside this claim.

## Verification

`npm run verify`: contracts/core/engine/dashboard typechecks and builds, 71 Engine test files, 382 Engine tests, 46 core tests, 15 dashboard tests, and 14 isolated maintenance tests. All must pass on the final committed tree.

The maintenance fault suite covers dry-run, valid WAL replay, malformed WAL, source/output alias, existing output, disk exhaustion, delete failure, VACUUM failure, simulated Windows publication lock, corrupted replacement facts, abrupt exit, baseline preservation and missing quality outcomes.

Official references checked for budget assumptions: [Binance USD-M SDK income endpoint weight](https://github.com/binance/binance-connector-python/blob/master/clients/derivatives_trading_usds_futures/src/binance_sdk_derivatives_trading_usds_futures/rest_api/rest_api.py), [Binance Retry-After semantics](https://developers.binance.com/en/docs/products/spot/rest-api). These do not establish this installation's actual public egress IP.
