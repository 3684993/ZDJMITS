# V3.9.6 high-frequency Entry root-cause implementation plan

Related report: [`REPORT.md`](../reports/v396-high-frequency-entry-root-cause-20260928/REPORT.md)

## Objective

Make every scheduler decision observable and attributable; correct the false `DISPATCH_STALLED` state; preserve authoritative risk admission; repair the recurring ownership outbox persistence error; then prove the final code version with local gates, one authorized manual lifecycle if code changes, and a continuous 120-minute read-only runtime window.

An explicit state such as `WAITING_EXECUTION_CAPACITY`, `WAITING_CANDIDATE`, `DATA_BLOCKED`, `AI_BUSY` or `COOLDOWN` is a progressing outcome when it has a live heartbeat, exact cause and next evaluation. No step may create an AI run or order just to make the system look active. If an authoritative risk fact remains UNKNOWN, the Entry gate stays closed and the report says so.

## Scope and release boundaries

- Canonical checkout and delivery branch: `D:\MITS`, `main` only.
- No changes to production execution, leverage/risk thresholds, Settings, UNKNOWN semantics, human acknowledgement policy, order sizing, exchange identity or existing TP protection.
- No fake proof, row deletion, claim release, forced Primary/PLACE/order, exchange write, or autostart/watchdog/service.
- User-authorized lifecycle ceiling: at most one controlled `stop → MANUAL_START`, only if product code changes require loading the built artifact. No retry or second restart.
- No GitHub Actions; record `NOT_RUN_BILLING_LIMIT`.
- Stop on a failed required gate; do not push a failed release.

## Work sequence

### Progress recorded 2026-09-28

- Report was captured before source edits; `root-cause.md` now records the confirmed stage-by-stage chain and the later read where the two user-specified UNKNOWN orders received fresh five-source proofs.
- Scheduler liveness/suppression telemetry, dashboard capacity labeling, and outbox event-type namespaces are implemented with regression coverage.
- Focused checks and full local verification passed: 176 test files / 1,497 tests, typecheck and production build; S00 T01–T06 passed with 141 derived entrypoints and zero blockers; S08 storage coverage and backup self-test passed; monitor script syntax and `git diff --check` passed.
- Current admission remains `UNAVAILABLE`; this implementation preserves the three other expired pending-risk lineages and explicit gross/human notional shortfalls. No risk threshold or Settings changed.
- The source/report/plan checkpoint was pushed as `4ed6c4d8b769a5759446759bc772e7de9f5be307`; at that checkpoint `HEAD == origin/main` and the working tree was clean.
- The one authorized `stop → MANUAL_START` was performed. The launcher created PID 25520 and the process log records `HTTP_LISTENING`, but the combined `/health` and closeout probe did not complete within 45 seconds. No retry or second lifecycle action was made, as required by `AGENTS.md`. Runtime identity closure, post-load TP coverage and the full 120-minute monitor remain `INCOMPLETE`; manual health intervention is required before acceptance can resume.
- Still open: complete runtime health/identity evidence, the continuous 120-minute window, final evidence commit/push and final `HEAD == origin/main` proof. Hosted CI status is `NOT_RUN_BILLING_LIMIT`.

### 1. Correct scheduler liveness and suppression reporting

Files expected: `apps/engine/src/services/entryCoordinator.ts`, `apps/engine/src/runtime/appRuntime.ts`, dashboard projection/view and focused tests.

- Give each scheduler cycle a monotonically increasing instance-local cycle number and attach the runtime `instanceId`.
- Treat scheduler liveness as heartbeat/tick freshness. `DISPATCH_STALLED` is allowed only when the most recent expected tick/heartbeat is more than 60 seconds old while the runtime claims the scheduler should be running.
- Keep Primary dispatch age as a separate metric named `距最近 Primary dispatch`; show current-instance scope and historical timestamps separately.
- Record every suppression decision with `evaluatedAt`, `instanceId`, `schedulerCycle`, eligible/candidate count, capacity status, authoritative blocker, `dispatchSuppressed=true`, `suppressionReason` and `nextEvaluationAt`.
- Map a fresh scheduler plus a risk blocker to `RUNNING · WAITING_EXECUTION_CAPACITY`; map a stale heartbeat to `STALLED`. Do not call a healthy loop stalled because no Primary ran.
- Ensure repeated suppression keeps producing bounded liveness evidence at least every 60 seconds; avoid unbounded per-tick log volume.
- Add regression cases for never-dispatched current instances, fresh/stale ticks, suppressed capacity with candidates, true empty supply, and next-evaluation reporting.

### 2. Verify and present capacity at the correct layer

Files expected: existing portfolio capacity projection and dashboard view/tests only if current source fails the requirement.

- Label route/funding and pre-risk candidate estimates `PRE-RISK / NOT EXECUTABLE`.
- Show authoritative final Entry capacity as `0 / UNAVAILABLE` whenever BOOK admission is unavailable, with the binding fact listed.
- Reuse one timestamped admission verdict per projection; do not convert exceptions or UNKNOWN facts to zero headroom that looks executable.

### 3. Close current pending-risk evidence through normal reconciliation

- Recheck the two specified order identities and the four currently binding pending facts against durable order/intent/reservation/claim lineage and recent reconciliation events.
- Let the existing scheduled reconciliation renew exchange proof. Do not run a manual exchange write or alter runtime state to clear a row.
- Record whether each blocker remains UNKNOWN or obtains fresh validated no-active-risk proof. Only existing authoritative reconciliation may change occupancy.
- Keep admission closed for facts that are missing, inconclusive or expired.

### 4. Repair the ownership outbox duplicate-id failure

- Trace `OwnershipJournal.expire()` and the `v396_outbox.id` primary key to the repeated `UNIQUE constraint failed` event.
- Make expiry/outbox recording idempotent for the same durable task version; preserve new versions and the existing owner/CAS rules.
- Add tests for repeated expiry/pump of the same task, subsequent task version, and error containment. Confirm TP/exit paths remain independent of journal failures.
- Do not delete or rewrite the live ownership database as part of implementation.

### 5. Run local verification on the final source

Run in this order and record timestamp, command and result in `gate-results.json`:

1. Focused scheduler, diagnostics/dashboard, pending-risk and ownership-journal tests.
2. Full Engine tests; core, dashboard and contracts.
3. Workspace typecheck and formal build.
4. `verify:deps`, `verify:scripts`, `npm run verify`.
5. S00 static gate, storage coverage and `git diff --check`.

No hosted CI. If any gate fails, keep the report and plan, fix the issue and rerun every affected gate before lifecycle or push.

### 6. Load the final artifact once and establish identity

- Capture pre-action process/runtime identity and current position/TP protection.
- If product source changed, perform at most one authorized `scripts/stop-zdj-lan.ps1` followed by `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`. Reuse an already-loaded final artifact if there is no product change.
- A failed health probe is reported; do not kill/restart or loop.
- Wait using read-only probes until READY, then require `IDENTITY_CLOSED` 6/6 against the expected source/artifact/build. Reconfirm TESTNET lock, zero Production writes and TP coverage before monitoring.

### 7. Run the final 120-minute observation

Start only after final artifact READY and identity closure. A code edit followed by another load resets the window to zero.

Create and use a reusable read-only sampler; sample once per minute for 120 continuous minutes. Persist bounded JSONL and summary with:

- runtime PID, instance/build/source identity, uptime, health and production/Testnet write counters;
- scheduler cycle, heartbeat/tick time, maximum heartbeat gap, last Primary dispatch/success age, state, structured suppression reason and next evaluation;
- supply/pool/candidate counts, Primary/PLACE/admission/plan/reservation/intent/submit/order/fill conversions;
- BOOK status, binding blockers, pending risk and reconciliation proof status;
- positions, protected/missing TP and unresolved protection;
- each continuous five-minute no-dispatch interval with its reason and duration.

At the end, require 120 minutes of continuous samples, no unexplained no-dispatch interval, no false `DISPATCH_STALLED`, no Production write, all live blockers attributable, and intact TP protection. Primary=0 is acceptable if the suppression is proven and liveness stays healthy. Any missing sample, real scheduler stall or code restart invalidates the window and requires a new complete window.

### 8. Persist evidence to GitHub `main`

Deliver under `docs/reports/v396-high-frequency-entry-root-cause-20260928/`:

- `REPORT.md` (already created first)
- `root-cause.md`
- `monitor-120m.jsonl` and `monitor-summary.json`
- `scheduler-before.json` and `scheduler-after.json`
- `pending-risk-analysis.json`
- `gate-results.json`, `runtime-identity.json`, `changed-files.tsv`
- reusable monitoring script

The implementation plan remains at `docs/plans/v396-high-frequency-entry-root-cause-implementation-20260928.md`. Keep the original evidence in the repository; do not make local-only paths the only record.

Before push, require a clean final tree and prove `main` is behind-only versus `origin/main`. Push ordinary fast-forward history only, fetch again, and verify `HEAD == origin/main`. Hosted CI remains `NOT_RUN_BILLING_LIMIT`.

## Acceptance result vocabulary

- `PASS`: all required source, local gates, identity and 120-minute runtime criteria have evidence.
- `FAIL`: a required criterion has contradictory evidence or a real stall/unsafe boundary violation.
- `INCOMPLETE`: evidence or the full observation window is missing; do not call it accepted.
- `UNKNOWN`: authoritative order/risk fact remains unproven; preserve the gate and show its next reconciliation evaluation.

Do not mark this plan complete based only on local tests or a READY status. The full runtime window and final GitHub ref equality are required for closure.
