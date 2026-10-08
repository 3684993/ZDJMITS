# Codex — Private Reconciliation Fan-out Remediation

Authoritative main at task creation: `8943f23a53034c0b6f086aee864e8831e1749b59`.

Read first:
- `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
- `docs/reports/v397-ssh-socks-remediation-20261008/REACTIVITY_DEPLOYMENT_ACCEPTANCE.md`

This task is the next narrow Engine reactivity step. Do not reopen SSH/SOCKS, TQ history isolation, broad audit, strategy tuning, F04/F10/F11, or long passive observation.

## Fresh evidence to preserve

Post-history-isolation acceptance still failed:
- main idle improved 45.1207% -> 63.7026%;
- event-loop max improved 6417.285ms -> 5255.463ms but remains multi-second;
- p95 improved 44.761ms -> 36.405ms;
- PRIVATE / EXECUTION / REQUIRED_MARKET queue timeouts = 0 / 0 / 7;
- private stayed READY 25/25;
- required market facts did not stay fresh;
- TP had in-window missing/unverified observations and only recovered later;
- Production writes = 0.

Fresh CPU evidence attributes the remaining hot path to:
- private-result reconciliation/event fan-out ~17.16% inclusive;
- `runtimeWriteBuffer.apply` ~6.88% inside it;
- synchronous `saveEntryExecution`, `saveManualExecution`, `entryExecutionClaimStats`, plus event/TQ listeners.

Important code fact:
`RuntimeWriteBuffer.apply()` currently executes `write()` synchronously on success. It is not an asynchronous buffer on the normal path.

Important appRuntime fact:
on every `RECONCILIATION_COMPLETED`, the generic event listener walks all entry orders and schedules
`saveEntryExecution`, then walks all manual orders and schedules `saveManualExecution`. Because
`RuntimeWriteBuffer.apply` is synchronous on success, these writes execute in the same EventEmitter turn.

Important SettingsStore fact:
`entryExecutionClaimStats()` reads the entire `entry_execution_tasks` table and JSON-parses every payload synchronously.

## Objective

Remove recurring O(all historical execution rows) work from the private reconciliation completion turn without weakening any authority-critical durability.

Do not optimize by extending freshness TTLs, dropping events, deleting history, reducing risk proof, or making UNKNOWN optimistic.

## Phase 1 — instrument the whole chain first

Before structural changes, add bounded timing that can attribute one reconciliation cycle across:
- remote private read completion -> local reconciliation application;
- reconciliation mutation body;
- claim-stats calculation;
- each EventBus listener group triggered by `RECONCILIATION_COMPLETED`;
- runtime event persistence;
- entry execution persistence fan-out;
- manual execution persistence fan-out;
- TQ synchronous capture;
- total `EventBus.publish('RECONCILIATION_COMPLETED')` wall time;
- total reconciliation wall time.

Instrumentation must be cheap, bounded and disabled/aggregated enough not to create a new hotspot.
Expose max/p95/count and slow-sample identity/reason where practical.

Do not infer a 5.255s stall from CPU samples alone. Correlate actual wall-clock phases.

## Phase 2 — structural remediation in the same run if timing confirms the known fan-out

### A. Stop all-row execution-journal rewrites on RECONCILIATION_COMPLETED

Do not iterate every entry/manual execution row just because reconciliation completed.

Persist only identities whose durable execution record actually changed during that reconciliation cycle.

Preferred direction:
- explicitly collect changed entry/manual order identities during reconciliation, or derive a precise changed set from before/after identity/revision;
- publish that bounded changed identity set with the reconciliation completion result;
- persist only those identities;
- unchanged rows must cause zero execution-journal SQL work.

Do not rely only on SQL `UPDATE ... WHERE payload<>?` after already paying JSON stringify + SELECT/UPDATE for every row.

Preserve:
- current claim/idempotency semantics;
- UNKNOWN fail-closed occupancy;
- exact clientOrderId/exchangeOrderId identity;
- reservation proof validity;
- terminal recovery and released identity immutability.

### B. Remove full claim-stat scan from the hot reconciliation turn

`entryExecutionClaimStats()` must not read+JSON-parse the complete durable execution history every reconciliation cycle.

Use one of:
- incrementally maintained counters/revisions updated by claim/save transitions;
- a cached derived snapshot with explicit invalidation/revision;
- a bounded async/reporting refresh for non-authority display fields.

Authority-critical decisions must still read exact durable facts when required; do not replace a submission claim with stale cached telemetry.

### C. Make RuntimeWriteBuffer semantics explicit

Do not globally make all current `apply()` calls asynchronous without classifying them.

Split semantics:
- authority-critical/safety durable writes stay synchronous;
- derived telemetry/report/history writes may use an ordered bounded deferred writer;
- deferred writes must have sequence/revision identity, bounded backlog, health telemetry and safe shutdown flush;
- no reordering may allow an older derived state to overwrite a newer one.

If the measured reconciliation fan-out is removed without needing a generic deferred writer, prefer the smaller change.

## Verification

Development:
- targeted tests around reconciliation changed-set persistence;
- unchanged reconciliation produces zero entry/manual execution-journal writes;
- one changed entry writes exactly that identity;
- one changed manual row writes exactly that identity;
- UNKNOWN/terminal/proof changes still persist;
- claim stats remain exact for authority-relevant cases;
- crash/restart recovery remains correct;
- event order and critical synchronous submission journals unchanged.

Then exactly one full `npm run verify`.

Long command output must go to log files and be committed to GitHub.

## Deployment

If verification passes:
- update main normally;
- restart only 8080;
- leave SSH/SOCKS and 8081/8083/8084 unchanged;
- preserve Settings and all strategy parameters;
- no DB reset/history deletion;
- Production writes remain 0.

## Acceptance

Fresh post-READY 5–10 minute window only.

Capture:
- event-loop max/p95;
- REQUIRED_MARKET queue timeout identities;
- private freshness;
- required market freshness;
- TP protection snapshots;
- reconciliation phase timing;
- event fan-out timing;
- execution-journal write counts per reconciliation;
- claim-stat wall time;
- CPU profile;
- RSS/heap/host commit separately.

Compare against current baseline:
- loop max 5255.463ms;
- p95 36.405ms;
- REQUIRED_MARKET timeout identities 7 / 6.008min;
- private READY 25/25;
- main idle 63.7026%.

PASS requires no recurring multi-second application stall attributable to reconciliation/event fan-out, critical market lane materially healthy, private fresh, TP protected/reconciled, and Production writes 0.

If this specific change removes the measured fan-out but a different path becomes dominant, stop and report the new measured path. Do not start a broad third branch of remediation in the same run without new evidence.

## Artifacts

Commit all timing logs, profiles, summaries and source evidence under:
`docs/reports/v397-ssh-socks-remediation-20261008/`

Update `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` with:
- exact commit;
- before/after phase timings;
- write-count reduction;
- runtime acceptance verdict;
- remaining measured blocker if any.
