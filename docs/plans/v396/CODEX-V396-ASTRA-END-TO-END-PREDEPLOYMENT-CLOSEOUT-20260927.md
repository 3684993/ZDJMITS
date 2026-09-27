# V3.9.6 Astra end-to-end pre-deployment closeout

## Purpose
Use GPT-6 Astra as a single high-capability review/repair pass over the current V3.9.6 `main` after R1/R2/R3 local implementation. This round is intended to replace further piecemeal review cycles with one comprehensive pre-deployment closeout.

Expected starting `origin/main`: `4b623e5508fbc2a24101449dadf20acaec3811e4`. Fetch and verify; if `main` has advanced, use the latest fast-forward state and record the exact SHA.

## Model
Run with GPT-6 Astra, preferably `xhigh` reasoning; use `max` only if quota permits. Do not delegate architectural conclusions to a lower-capability model in this round.

## Hard boundaries
This round may inspect and, only when evidence proves a defect, minimally repair the R1/R2/R3 observability implementation and its tests. It must NOT:

- change approved gross/direction/cluster/human/stress/capital/economic thresholds;
- change Settings values or governance modes;
- change leverage policy, Entry Safety, Testnet/Production boundary, or `aiExitAuthority`;
- change the Primary prompt, Primary input/decision contract, model-visible candidate IDs, or frozen-choice execution semantics;
- auto-resize/clamp quantity, switch side, alter target/horizon, retry a second model call, or manufacture PLACE/submit/fill;
- add a second risk authority, approval service, or dashboard-side risk calculation;
- clear/modify UNKNOWN history merely to make counters agree;
- deploy, stop/start/restart/hot reload the Engine;
- use GitHub Actions.

The preserved dirty V3.9.5 worktree remains untouched.

All retained artifacts must be committed and pushed to GitHub `main`; no final evidence may exist only in a local path.

## Inputs to review first
Read the complete chain before changing code:

- `docs/reports/v396-entry-frequency-risk-audit-20260927/REPORT.md`
- `docs/reports/v396-root-cause-plan-review-20260927/REPORT.md`
- `docs/plans/v396/CODEX-V396-ROOT-CAUSE-IMPLEMENTATION-PLAN-20260927.md`
- `docs/plans/v396/CODEX-V396-R3-HUMAN-DECISION-20260927.md`
- `docs/reports/v396-r1-r2-r3-implementation-20260927/REPORT.md`
- `docs/reports/v396-r3-human-decision-20260927/REPORT.md`
- current source diff from the last validated minimum-risk-chain source through current `main`.

## Phase 1 — comprehensive source review before edits
Audit the complete R1/R2/R3 implementation end-to-end, not file-by-file in isolation.

### R1 invariants
Prove that:
- Entry historical UNKNOWN, Entry risk-occupying UNKNOWN, proof-valid Entry UNKNOWN, active Entry claims, manual UNKNOWN, TP UNKNOWN, and mixed compatibility aggregate are different facts with truthful names;
- the one shared `evaluatedAt` is used wherever a single in-memory reconciliation snapshot claims consistency;
- cross-store claim reads are labelled truthfully rather than presented as atomic;
- manual reduce-only UNKNOWN does not become unrelated new-Entry gross exposure by presentation/adapter accident;
- expired/mismatched/incomplete no-active-risk proof stays fail-closed;
- no existing UNKNOWN history or reconciliation behavior was weakened.

### R2 invariants
Trace one BOOK result and representative CANDIDATE results from the installed `PortfolioRiskAdmission` evaluator through capacity reader, pipeline verdict, projection/API, and dashboard.

Prove that:
- all gate facts shown for a decision originate from the same evaluator pass;
- `AVAILABLE`, valid `ZERO`, `UNAVAILABLE`, and `NOT_APPLICABLE` cannot collapse into each other;
- `NOTIONAL_USD`, `MARGIN_USD`, `LOSS_USD`, count, and evidence units are never mixed;
- candidate impact/shortfall arithmetic is dimensionally correct;
- book and candidate scopes are never merged as if one pass;
- fallback paths never synthesize empty gates around a populated refusal;
- dashboard only formats returned facts and never reranks/recalculates authority;
- the five-second/memoized readback remains observational while final `admit()` stays JIT.

### R3 invariants
Review PRE_PRIMARY_VISIBLE and POST_PRIMARY_GENERATED telemetry as two different timestamps/scopes.

Prove that:
- pre-Primary telemetry contains only facts actually visible before the model call (quantity/envelope/fact identity), never invented candidate IDs;
- candidate IDs are explicitly post-Primary generated;
- mapping checks use the complete generated legal set even if detailed output is bounded/truncated;
- `alternativeGeneratedCandidates` means alternatives in that same generated legal set and is not confused with candidates presented to Primary;
- telemetry sink failure cannot change the plan/result, trigger retry/model call, mutate quantity/side/target/horizon, reserve capacity, or authorize an order;
- telemetry data is bounded and sanitized.

### Cross-cutting review
Look for hidden regressions introduced by the R1/R2/R3 patch, including stale verdict carryover, event payload incompatibility, API shape mismatch, null/undefined coercion, timestamp inconsistency, wrong status mapping, memory/event growth, duplicated risk ranking, and tests that prove only mocked behavior but not the actual adapter chain.

Do not assume current code is correct merely because existing tests pass.

## Phase 2 — minimal corrective implementation if and only if needed
If Phase 1 finds a source-proven defect inside the approved R1/R2/R3 observability scope, fix it directly and add the smallest regression tests that prove the invariant.

If a finding would require any policy change, Primary prompt/contract change, database migration, threshold change, execution behavior change, or lifecycle action, DO NOT implement it. Record it separately as `HUMAN_DECISION_REQUIRED` with exact source evidence and proposed options.

Do not refactor unrelated code for style.

## Phase 3 — mandatory complete local verification
Because the final R3 clarification previously ran only targeted tests, this Astra round must re-establish a full clean local gate on the exact final source tree.

Run and retain exact commands/exit codes for at least:

1. all R1/R2/R3 focused Engine tests;
2. affected dashboard tests;
3. complete Engine test suite;
4. complete core/dashboard/contracts workspace tests according to repository policy;
5. workspace typecheck;
6. `verify:deps` and `verify:scripts`;
7. full repository `npm run verify`;
8. formal workspace build;
9. S00 T01–T06 / static isolation checks;
10. storage coverage;
11. `git diff --check` / equivalent final committed-tree cleanliness check.

Do not use GitHub Actions; record `NOT_RUN_BILLING_LIMIT`.

A stale offline fixture may prove parser/read-only safety only. Do not use it as runtime/economic evidence.

## Phase 4 — read-only runtime/pre-deployment assessment
Without restarting the current Engine, read only the available runtime identity and diagnostics.

Explicitly distinguish:
- CURRENT SOURCE/BUILD candidate on `main`;
- CURRENT RUNNING PROCESS, which may still be an older artifact;
- facts observable from the currently running process;
- facts that cannot be validated until deployment.

Do not claim R1/R2/R3 runtime behavior is accepted until the new artifact is actually deployed in a separately authorized phase.

Prepare exact preconditions for one future controlled `stop -> MANUAL_START` acceptance, including source/artifact hashes, previous PID/instance, TESTNET/write lock, Settings version, TP/protection coverage, UNKNOWN scoped facts, and rollback artifact identity. Do not execute the lifecycle action in this round.

## Required GitHub deliverables
Commit/push all retained evidence under a new directory such as:

`docs/reports/v396-astra-predeployment-closeout-20260927/`

At minimum:
- `REPORT.md`
- `gate-results.json`
- `source-review.md` or equivalent machine-readable/source-map evidence
- exact changed-file summary if Astra made corrective edits
- local test/build/verify results
- source/build identity manifest
- runtime-vs-source identity assessment
- proposed later runtime-acceptance checklist

All persistent artifacts must be in GitHub. Do not finish with only local `C:\...` or `D:\...` paths.

## Final status
Exactly one:

- `V396_ASTRA_PREDEPLOYMENT_CLOSED` — no unresolved source defect remains in R1/R2/R3, full local gates are green, and runtime deployment is the only remaining acceptance step;
- `V396_ASTRA_PREDEPLOYMENT_BLOCKED` — give the exact blocker, source evidence, and why it cannot be fixed within the approved scope.

Do not deploy or perform lifecycle actions in either case.
