# J-MITS V3.9.7 — CODEX FULL COMPLETION RUN

> Execution mode: continuous implementation until acceptance-ready.
> Repository: `3684993/ZDJMITS`
> Working branch at handoff: `codex/main-maintenance-20261007`
> Branch head observed before this protocol: `d92fb231def9f9bfcca1ef98c29ec7c9ee29cd58`
> Upstream `main` observed before this protocol: `5784154367838266e630ceb0b2bcca9c30f82853`
> Date: 2026-10-07 (+08:00)

## 0. Mandatory startup

Read, in this order:

1. `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
2. `docs/prompts/CODEX_MAINTENANCE_CONTINUATION.md`
3. this file

Then inspect the actual checkout, remote refs, recent commits, working tree, package scripts and current tests. Current code and local evidence override stale prose.

## 1. Continuous-completion mandate

This run is different from earlier staged maintenance.

**Do not stop after each small improvement and do not ask the user for intermediate approval.**

Continue autonomously through all remaining maintenance priorities that can be safely implemented from the repository and local machine. You may create multiple coherent local commits as checkpoints, but those commits are internal progress markers, not stopping points.

Only stop for the user when one of these is true:

- all implementable scope below is complete, verified and acceptance-ready; or
- a genuine hard blocker requires user-only information/action and no safe repository/local workaround exists.

If one item is blocked, continue every other independent item first. Do not use a minor blocker as a reason to stop the whole run.

Do not emit "phase 1 done, tell me to continue" behavior. The expected output is **one consolidated final report after completion**.

## 2. Design freedom, with improvement obligation

You may disagree with previous ChatGPT/Codex implementation choices.

If you disagree:
- prove the weakness with code/test/runtime evidence;
- propose a materially safer, simpler, more correct or more maintainable alternative;
- implement the alternative where feasible;
- add regression coverage;
- continue the run.

Critique without a better implemented replacement is not acceptable.

## 3. Hard runtime / safety constraints

These remain non-negotiable:

- TESTNET-only.
- Production writes must remain 0.
- No Production-write path may be enabled.
- TESTNET/environment isolation stays fail-closed.
- Never restore `expectedStaticEgressIp`, checkip authorization, NET-003/NET-004 static egress authority, or any static IP authorization gate.
- Exact `clientOrderId` identity/idempotency remains authoritative.
- Unresolved submit UNKNOWN must never duplicate-submit.
- Exchange filters/precision/legality and real available capital remain fail-closed.
- Private account/order truth may not be invented.
- Do not delete/reset/recreate SQLite, TradeRecord or trading history to solve problems.
- Preserve reconciliation per-run budgets.
- Preserve storage/I/O convergence, log bounds, WAL safeguards and existing `0xC0000409` mitigations.
- Do not return to repeated VPN experiments or speculative V8 flag changes.

### Service rule

Logical services:
- 8080: Engine + Dashboard
- 8081: Scout
- 8083: HARNESS_ADVISOR / REVIEW_BRAIN
- 8084: ZDJ_PRIMARY_BRAIN / PRIMARY_BRAIN

**During implementation do not stop/restart/reload 8081, 8083 or 8084.**

At the very end, after code and local verification are complete, the user authorizes a **single final restart of 8080 only** so the maintained Engine + Dashboard loads the final code.

Do not restart 8083/8084 under this instruction. Their prior hard rule remains in force.

Do not use restart as a way to hide a crash or clear bad state.

## 4. Finish the remaining maintenance scope

Use evidence to determine exact changes, but do not leave known relevant defects half-completed.

### A. Exact order / UNKNOWN architecture

The first Codex batch already added explicit `-2013/-2011` ABSENT reuse across callers for 15 seconds and kept uncertain failures uncached.

Now complete the architecture audit:
- inspect every exact-order lookup caller;
- ensure same clientOrderId work is single-flight/deduplicated/bounded across Entry, reconciliation, review/action boundaries and restart recovery;
- prefer User Data WS where it has authoritative same-identity state;
- exact REST remains recovery/fallback;
- explicit remote ABSENT may be briefly reused only when exchange semantics make that result definitive;
- timeout/queue/transport/unknown errors are never converted into ABSENT;
- UNKNOWN stays risk-bearing and never resubmits;
- prove WS-vs-REST race handling and restart identity safety.

Prefer one coherent shared mechanism over duplicated per-caller retry rules when that improves correctness.

### B. Binance normal-latency compatibility / NET-002

Complete the end-to-end behavior, not only incident wording:
- isolated one/two REST timeout facts stay telemetry;
- sustained critical failure is required for NET-002;
- dedupe one physical failure across transport/queue views;
- `/fapi/v1/time` jitter alone is not NET-002;
- advisory/context endpoints do not become Entry-hard blockers;
- fresh WS market truth prevents optional REST market fallback timeout from becoming a global outage;
- request-budget pressure remains distinct from transport failure;
- private truth remains fail-closed only after real allowed freshness is exhausted;
- operator alerts recover/clear correctly and do not spam duplicates.

Add/strengthen tests around the actual gating path, not just presentation.

### C. MARKET-DATA-001 truth

Audit market stream/cache/readiness/pipeline together.

Required end state:
- required quote/book/kline WS/cache freshness and continuity drive executable market readiness;
- optional REST context timeout cannot pause Entry if required live facts are fresh;
- targeted recovery of a real gap remains allowed;
- genuinely stale/missing required facts fail closed;
- candidate-local staleness does not become a false global outage when other executable candidates remain healthy;
- persistent real global data loss produces MARKET-DATA-001;
- brief transient state does not spam the operator.

Do not solve only by suppressing the banner while leaving the gate wrong.

### D. Manual explicit LIMIT

Verify and finish the full Dashboard -> API -> engine -> exchange path:
- user-entered legal LIMIT remains usable without a fresh preview quote;
- preview quote is advisory UX;
- exchange legality, filters, precision, available funds/margin, environment and real risk facts remain fail-closed;
- stale preview must not erase/disable a valid explicit user price;
- regression tests cover both usable explicit LIMIT and real hard rejection facts.

### E. Settings UI standardization

Finish all relevant Settings tabs so behavior is conventional and consistent.

For scalar settings:
- explicit dirty state;
- Save;
- Cancel/revert;
- no ambiguous resource-level save collision.

For managed resources:
- list;
- select;
- add;
- edit;
- dirty/unsaved indication;
- Save;
- Cancel;
- Test where meaningful;
- Activate where meaningful;
- Delete where safe.

Audit for invalid Vue markup, nested/ambiguous action areas, switching selection with unsaved edits, accidental destructive behavior and unclear save boundaries.

Do not leave one tab using a different interaction model without a concrete reason.

### F. True multi-resource proxy CRUD

Finish persistence + API + UI + hot-apply coherently:
- adding proxy creates a distinct resource and never overwrites existing resources;
- independent name/type/url/enabled state;
- selected resource save and test operate on that selected resource;
- Save does not activate;
- one active proxy is explicitly selected;
- active switch hot-applies through existing safe architecture;
- inactive resources may be deleted;
- active/last-required safety protection is explicit;
- cancel restores the saved resource state;
- resource list remains durable across reload/restart.

Cover with persistence/API/UI tests as appropriate.

### G. Review / Research useful GPU utilization

Finish useful non-authoritative work routing where evidence shows idle capacity is currently wasted.

Allowed workload examples:
- pending Entry review;
- position/exit review;
- trade-quality postmortem;
- candidate evidence compression;
- anomaly/execution-quality review;
- bounded external/shared-event research.

Required:
- PRIMARY_BRAIN remains sole final Entry decision authority;
- Review/Research cannot become a hidden veto;
- no Review/Research failure blocks a valid Primary Entry except where a deterministic physical execution fact independently blocks;
- asynchronous queues are bounded;
- extra analysis cannot starve/delay live trading;
- UI/runtime metrics should make actual useful workload visible enough to verify utilization.

Do not generate meaningless calls just to show GPU activity.

### H. Preserve native crash / storage protections

While touching schedulers/workers/storage:
- keep reconciliation remote-audit run budgets;
- keep heavy no-risk proof bounded;
- deferred work remains risk-bearing;
- no unsafe release because a budget expired;
- preserve foreground/native fail-fast evidence capture;
- preserve bounded logs and storage protections.

If you find a regression in these protections while completing other work, fix it in the same run.

## 5. Local verification gate before integration

Do not integrate/restart until all changed areas are locally green.

Discover the exact repository commands, then run at minimum:

- targeted regression tests for each changed subsystem;
- complete Engine test suite;
- complete Dashboard test suite if practical, otherwise all Dashboard tests affected plus its broader suite available in the repo;
- workspace typecheck;
- production build;
- `git diff --check`;
- any repository-native verification/release-identity scripts that are normally part of V3.9.x verification and can run locally safely.

Tests must be run against the final code, not only intermediate commits.

If a stale test conflicts with intentional correct runtime semantics, repair the stale test with evidence; do not weaken production safety to satisfy it.

## 6. Integration into main

When the maintenance branch is fully verified:

1. fetch the current remote refs again;
2. confirm whether `origin/main` moved since the run began;
3. if main is unchanged/ancestor, integrate the completed branch to `main` using a safe fast-forward where possible;
4. if main moved, reconcile it carefully, re-run affected verification, then integrate;
5. do not force-push over unrelated newer main work;
6. push final `main`;
7. update both maintenance handoff documents to the final actual main SHA and completed state.

GitHub Actions are not the verification loop. Do not wait for Actions before continuing to runtime verification.

## 7. Final 8080 restart and runtime acceptance preparation

Only after final main is integrated and local verification is green:

- use the repository's existing safe launcher/restart mechanism for **8080 only**;
- do not touch 8081/8083/8084;
- preserve all current databases/history;
- do not clear state;
- do not reload 8083/8084 models.

After 8080 restarts, perform a bounded post-restart smoke/readiness check using existing project diagnostics/endpoints/logs.

Verify at least:
- 8080 Engine/Dashboard is up;
- runtime reports the expected final build/commit identity where available;
- environment is TESTNET;
- Production writes remain 0;
- execution boundary is still locked to TESTNET;
- Settings resources load;
- active proxy/resource configuration loads without destructive migration;
- market/user-data components initialize without an immediate structural error;
- no immediate repeated NET-002/MARKET-DATA-001 false alarm caused solely by optional REST latency;
- no duplicate submit is performed as part of verification;
- no database/history reset occurred.

Do not manufacture live trades for acceptance. Prefer read-only/status evidence.

If 8080 fails to start, diagnose and repair it, re-run affected tests and restart 8080 again as needed. This is still part of the same continuous run; do not stop after the first startup defect.

## 8. Definition of "complete"

Do not declare completion merely because tests pass.

Completion means:
- all evidence-supported remaining priorities above have been audited;
- concrete defects found have been implemented or explicitly proven already correct;
- no known in-scope correctness defect is intentionally deferred merely for convenience;
- local final verification is green;
- completed code is integrated into `main`;
- final handoff docs reflect reality;
- 8080 has been restarted onto the final code;
- bounded post-restart readiness checks pass;
- 8081/8083/8084 were not restarted;
- Production-write capability remains disabled and actual Production writes remain 0.

Then stop and wait for the user's manual acceptance.

## 9. Final response format

Return one concise final report only after the run is complete. Include:

- final main commit SHA;
- major fixes/improvements actually implemented;
- local verification commands/results;
- integration result;
- 8080 restart result and PID/build identity if available;
- post-restart readiness/smoke evidence;
- explicit statement that 8081/8083/8084 were not restarted;
- explicit statement that Production writes remain 0 / no Production path was enabled;
- remaining issue only if it is a genuine external/user-only blocker.

Do not end with "shall I continue?". End with: **等待用户验收。**
