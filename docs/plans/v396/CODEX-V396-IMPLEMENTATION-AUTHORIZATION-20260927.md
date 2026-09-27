# V3.9.6 Implementation Authorization — R1/R2/R3 Only

**State:** `IMPLEMENTATION_AUTHORIZED_LOCAL_ONLY`

This authorization approves implementation on current `main` only for the revised plan:

`docs/plans/v396/CODEX-V396-ROOT-CAUSE-IMPLEMENTATION-PLAN-20260927.md`

Approved scope:

1. **R1 / B1 — scoped UNKNOWN reconciliation contract**
   - additive, read-only scoped counters/metadata only;
   - preserve all UNKNOWN history and fail-closed occupancy semantics;
   - keep `activeRiskUnresolvedCount` only as clearly labeled mixed-scope compatibility output.

2. **R2 / B2 — single authoritative numeric admission readback**
   - expose one existing `PortfolioRiskAdmission` evaluator result end-to-end;
   - API/dashboard may serialize or format only;
   - no second ledger, second ranking pass, second authority, or client-side recalculation.

3. **R3 / B3 — frozen-choice conversion telemetry only**
   - record offered legal candidates/intervals, selected candidate/quantity, in-set result, alternative-existed flag, refusal class, and evaluated snapshot identity;
   - telemetry must never resize quantity, switch side/target/horizon, retry a model, reserve capacity, authorize, submit, or place an order.

Hard constraints:

- Start from latest clean `origin/main`; no long-lived branch required.
- No Settings changes, no risk-threshold changes, no governance-mode changes, no economics-threshold changes, no leverage-rule changes, no Testnet/Production boundary changes.
- No schema migration unless implementation proves it is unavoidable; if so, STOP and return to human review before making it.
- Preserve current P2 behavior: if canonical gross remains above the approved gross limit, new Entry capacity stays zero. Do not change limits to create throughput.
- Preserve manual reduce-only UNKNOWN in its own unresolved execution domain; it must not be relabeled as Entry occupancy.
- Preserve position/TP/ownership/reconciliation, JIT, idempotency, reservation, UNKNOWN proof, market/private freshness, exchange filters, verified leverage/margin/stress and Production lock semantics.
- All persistent outputs must be committed and pushed to GitHub `main`: source changes, tests, reports, JSON/CSV/TXT evidence, reusable scripts, exact gate results, source/artifact manifests, and final conclusion.
- No final evidence may exist only under `C:\`, `D:\`, temp paths, or Codex scratch directories.
- GitHub Actions remain `NOT_RUN_BILLING_LIMIT`; all tests/typecheck/verify/formal build are local.
- Do not touch the preserved dirty V3.9.5 worktree or its 48 status entries.

Required local validation before push:

- focused R1 reconciliation/UNKNOWN hostile tests;
- focused R2 admission/readback/pipeline/projection/dashboard tests;
- focused R3 telemetry non-interference tests;
- workspace typecheck;
- dependency/script verification where applicable;
- complete workspace tests and formal builds;
- repository `npm run verify` if available/resource-permitting;
- S00/read-only replay evidence;
- `git diff --check`;
- exact changed-file inventory.

Stop boundary:

After implementation, local gates, evidence commit, and push to `main`, STOP.

This authorization does **not** authorize:

- Engine stop/start/restart/manual start;
- deployment/runtime acceptance;
- exchange writes for validation;
- forced PLACE/submit/fill;
- any Settings/risk-policy change;
- rollback lifecycle.

Final implementation state must be one of:

- `V396_R1_R2_R3_IMPLEMENTED_LOCAL_PASS`
- `IMPLEMENTATION_BLOCKED_NEEDS_HUMAN_REVIEW`

A later runtime acceptance requires a separate explicit lifecycle authorization.
