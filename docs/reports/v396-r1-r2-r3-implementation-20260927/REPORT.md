# V3.9.6 R1–R3 implementation report

Status: `IMPLEMENTATION_BLOCKED_NEEDS_HUMAN_REVIEW`

Base: `origin/main` commit `b8396402dd0dd7a4b05dea11feb4384329020fb6` at implementation start. Work was performed on the clean `main` checkout after fetching all remotes; the original dirty v395 worktree was not accessed or changed.

## Scope and decision

This pass implements the authorized R1 scoped UNKNOWN reconciliation and R2 single authoritative numeric admission readback. For R3 it adds frozen-choice conversion telemetry that observes the quantity interval visible to Primary and the system-generated candidate set created after Primary returns. It truthfully records `candidateIdsPresentedToPrimary: []` and `offerTiming: POST_PRIMARY_VALIDATION`. Therefore R3 is only partially satisfied: no legal candidate IDs were presented to Primary. The authorized plan simultaneously requires frozen-choice telemetry only/no prompt or decision-contract changes and telemetry about offered IDs. In this architecture, candidate IDs do not exist until after Primary validation, so the two requirements cannot both be met without changing the prompt/contract or falsifying telemetry. No such change was made. Human review must resolve this boundary before this work can be declared fully implemented.

## R1 — scoped UNKNOWN reconciliation

Reconciliation now publishes distinct counts for historical Entry UNKNOWN, Entry UNKNOWN currently occupying risk, Entry UNKNOWN with currently valid no-active-risk proof, active Entry execution claims and UNKNOWN claims, Manual UNKNOWN, and TP UNKNOWN. Manual and TP details are bounded and identity-scoped. The Entry claim summary is read from the durable store as an additional read-only fact. One evaluation timestamp is used for the reconciled in-memory UNKNOWN predicates; the response labels cross-store consistency `BEST_EFFORT_CROSS_STORE`.

The legacy `activeRiskUnresolvedCount` remains for compatibility and retains the prior conservative aggregate formula: Entry UNKNOWN occupying risk + Manual UNKNOWN + TP UNKNOWN. It is explicitly labeled `ENTRY_MANUAL_TP_MIXED_COMPAT` and deprecated for new consumers. No UNKNOWN row is suppressed or removed from risk accounting, and no admission behavior or proof predicate was relaxed.

## R2 — authoritative numeric admission readback

The readback is carried from the same portfolio-risk evaluator pass used by admission. It includes scope, evaluation time, snapshot hash, profile/settings and authority versions, fact coverage, pending-risk lineage, quote/leverage facts where applicable, gate unit/limit/used/headroom/shortfall, candidate impact/shortfall, and the first binding decision. Book visibility and candidate-denial diagnostics preserve this readback through the API/UI; the dashboard renders these values without re-evaluating risk. Candidate admission remains just-in-time and is still evaluated at its existing gate. Missing or incomplete evidence remains fail-closed.

No Settings values, approved limits, governance mode, economic thresholds, leverage rules, strategy, or Testnet/Production boundaries were changed. No migration was added.

## R3 — frozen-choice conversion telemetry

A bounded, sanitized, best-effort telemetry event records the quantity interval visible to Primary, the generated candidate-set identity and alternatives, the selected choice, and whether the selection maps exactly into the frozen set. It has no return path into prompts, candidate generation, admission, verdicts, retries, reservations, routing, or order submission. Telemetry failures are swallowed. No order is manufactured and no execution policy is changed.

The candidate IDs are generated after Primary responds. They therefore cannot truthfully be reported as IDs offered to Primary in this implementation. Full R3 completion needs a human decision on whether to authorize a prompt/contract change that exposes the frozen IDs or to revise the telemetry requirement to measure post-response candidate conversion only.

## Validation

- Focused Engine tests: 104 passed.
- Focused Dashboard capacity tests: 15 passed.
- Full Engine test suite: 174 files, 1,422 tests passed.
- `npm run typecheck`: passed.
- `npm run verify`: passed (dependency/script verification, typecheck, workspace build, full workspace tests).
- `npm run build`: passed; see formal build log.
- S00/read-only replay: helper completed in SQLite read-only/query-only mode against a pre-existing isolated fixture; see limitations below.
- `git diff --check`: recorded separately after report generation.

The S00 fixture is a 2026-09-23 isolated test snapshot with zero positions, pending entries, UNKNOWN rows, and zero limits. This is only a parser/read-only regression check and supports no runtime or economic conclusion. The previously committed [2026-09-27 authoritative risk replay](docs/reports/v396-root-cause-plan-review-20260927/current-authoritative-risk-replay.json) remains the architecture/root-cause baseline. The read-only replay used the already committed helper `scripts/audit-v396-root-cause-plan.mjs`; no 72-hour global research was repeated. Runtime acceptance was not run.

## Operational boundaries

No deployment, lifecycle action, exchange write, order-generation attempt, GitHub Actions run, or runtime acceptance was performed. `DEPLOYMENT_NOT_AUTHORIZED`; runtime acceptance is `NOT_RUN_EXTERNAL`; GitHub Actions are `NOT_RUN_BILLING_LIMIT`. The original v395 worktree and its 48 uncommitted files remain untouched.

## Required human follow-up

Resolve the R3 boundary between “frozen-choice conversion telemetry only” and “candidate IDs offered to Primary.” Until that decision is made, the final gate remains `IMPLEMENTATION_BLOCKED_NEEDS_HUMAN_REVIEW`, despite passing local verification and completion of R1/R2 plus observational R3 instrumentation.
