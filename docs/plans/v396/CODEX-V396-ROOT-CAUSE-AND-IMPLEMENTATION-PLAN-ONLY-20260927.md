# V3.9.6 Root-cause investigation + implementation-plan only handoff

## Objective
This round is **analysis and planning only**. Do not modify product code, settings, risk limits, runtime state, deployment artifacts, or Engine lifecycle.

Start from latest `origin/main` (currently expected around `787dc845...`; fetch and verify before work). The previous round already implemented and locally validated the minimum-sufficient risk-chain simplification. Treat that implementation as current source of truth, but runtime acceptance is still not complete.

Read first:
- `docs/reports/v396-entry-frequency-risk-audit-20260927/REPORT.md`
- `docs/reports/v396-entry-frequency-risk-audit-20260927/PHASE0-CURRENT-RISK-REPLAY.md`
- `docs/reports/v396-entry-frequency-risk-audit-20260927/IMPLEMENTATION-ACCEPTANCE.md`
- `docs/reports/v396-entry-frequency-risk-audit-20260927/local-gate-results.json`

## Mandatory GitHub artifact rule
Every persistent artifact created in this round must be committed and pushed to GitHub `main`.

Required persistent outputs include reports, evidence JSON/CSV/TXT, reusable read-only scripts, diagrams/tables, and the final implementation plan. Do not finish with local-only files or references to `C:\...`, `D:\...`, temp directories, or Codex scratch paths.

Temporary files may exist only while a command is executing and must not be referenced as final evidence.

GitHub Actions remain `NOT_RUN_BILLING_LIMIT`; do not use hosted CI.

## Hard stop boundary
This round must stop after producing the root-cause report and the proposed implementation plan.

Do NOT:
- edit files under `apps/`, `packages/`, runtime settings, or production configuration;
- change any approved risk threshold or governance mode;
- deploy, stop, start, restart, hot reload, or otherwise touch the running Engine;
- write to Binance/Testnet/Production;
- clear UNKNOWN rows, claims, or audit history merely to make projections agree;
- force a trade, manufacture a PLACE/submit/fill, or lower limits to demonstrate throughput;
- touch the preserved dirty `D:\MITS` V3.9.5 worktree or its 48 status entries.

Final state for this round must be exactly: `PLAN_READY_FOR_HUMAN_CONFIRMATION`.

---

# Questions Codex must answer

## P1 — UNKNOWN / P0 / closeout reconciliation conflict
Known observation from Phase 0:
- `closeout.activeRiskUnresolvedCount = 1`
- `p0-entry-integrity.activeUnknownClaims = 0`
- `snapshot.pendingEntries = 0`
- historical UNKNOWN count remains 48, previously 47 verified no-active-risk and one unresolved.

Find the exact root cause.

Required questions:
1. What exact durable row / order / claim / execution domain is the unresolved item?
2. Which storage tables and in-memory projections feed each of the three counters above?
3. Is the disagreement caused by stale projection, different lifecycle definitions, race/non-atomic read, proof expiry, duplicate identity, reconciliation ordering, or a genuine unresolved exchange fact?
4. Is there any real remaining active-risk occupancy? If yes, quantify symbol, side, quantity/notional, owner, source, proof age, and why it cannot yet be cleared. If not, prove why the closeout projection is stale/incorrect without deleting history.
5. Which projection should be authoritative for execution admission, and why?
6. What exact source change would make all projections converge while preserving UNKNOWN fail-closed semantics?

Do not reinterpret UNKNOWN as zero without proof.

## P2 — Why current Entry capacity can still be zero after simplification
Current evidence showed visible gross above approved gross limit by roughly $400 at capture time. The latest implementation intentionally keeps the approved gross limit unchanged.

Determine whether current zero Entry capacity is:
- a correct consequence of approved policy,
- an exposure-accounting defect,
- a stale/read-model discrepancy,
- a grandfathering/new-risk semantics issue,
- or a mixture of these.

Required questions:
1. Recompute current gross from one timestamped, canonical position+pending+claim set.
2. Explain exactly which existing positions/pending claims contribute to gross.
3. Prove whether any exposure is counted twice or omitted.
4. Distinguish "existing account already above limit" from "candidate itself exceeds incremental limit".
5. Determine whether the intended semantics are correctly implemented: existing positions are never forcibly closed by Entry admission, while new risk gets zero headroom until the canonical aggregate returns below limit.
6. If current code already matches that intended semantics, label this **POLICY-BINDING, NOT A BUG**. Do not propose code changes merely to create trades.

## P3 — What becomes the next bottleneck after gross capacity is restored naturally
Do not assume gross is the only future limiter.

Using current `main` source plus read-only replay/simulation, identify the next likely conversion losses if gross headroom becomes positive without changing any threshold.

Audit the current, not historical, behavior for:
- legal quantity interval / minQty / stepSize / minNotional;
- AI quantity envelope and frozen quantity;
- trade-plan economics and `minNetProfitUsd=1` / ROI floor;
- horizon/target feasibility;
- market-quality/JIT freshness;
- reservation/intent/idempotency;
- pending/UNKNOWN occupancy;
- margin/leverage/stress incremental capacity;
- candidate-specific cluster/direction limits.

Required output:
- an ordered table of likely post-gross blockers;
- whether each is execution correctness, independent risk authority, strategy/economic selection, or diagnostic only;
- exact boundary/critical-value formula where measurable;
- whether any current-code false-zero or whole-candidate rejection still exists when a smaller legal quantity should pass.

Do not use old 72h failures as proof that the current code still has the same defect; reproduce current behavior or mark `UNOBSERVED/INSUFFICIENT_EVIDENCE`.

## P4 — Runtime observability and authoritative replay gap
Phase 0 showed a nonempty refusal/zero capacity while published `riskAdmissionGates` / `riskAdmissionReasons` were empty in the old running build.

Determine what observability is minimally necessary so that, after deployment, one can answer from a single timestamped readback:
- what the authoritative blocker is;
- exact used/limit/headroom/shortfall in the correct unit;
- candidate incremental cost;
- which fact/version/owner/settings/risk authority versions were evaluated;
- whether UNKNOWN/pending occupancy participated;
- why capacity was zero or positive.

The solution must be observability only, not a new approval layer and not a second risk authority.

## P5 — Runtime/source identity closure plan
Current `main` implementation passed local gates but has not yet been deployed. Define the exact acceptance sequence required later to prove:
`origin/main == local HEAD == sourceHash == artifactHash-derived build == running instance`.

The plan must say whether one controlled `stop -> MANUAL_START` is required after implementation, and what must be checked before and after it. Do not perform it this round.

## P6 — Risk-chain complexity regression check
Verify source-level current `main` does not still contain another hard veto that duplicates the same fact under a different name.

Specifically inspect whether any of the following still act as independent execution vetoes when they should be diagnostic/derived under the current configuration:
- human notional equal to or wider than gross;
- all-unmapped cluster equal to or wider than gross;
- ACK age;
- snapshot-incomplete summary wrappers;
- SHADOW economics;
- dashboard/readiness labels.

If a gate is genuinely independent in another configuration, preserve the distinction and explain the condition under which it becomes independently binding.

---

# Required deliverables

## 1. Root-cause report
Create and push:
`docs/reports/v396-root-cause-plan-review-20260927/REPORT.md`

The report must contain for P1–P6:
- observed fact;
- exact code/storage path;
- root cause;
- evidence;
- confidence/limitations;
- whether it is `BUG`, `POLICY-BINDING`, `OBSERVABILITY-GAP`, `DATA/RECONCILIATION`, or `NOT_REPRODUCED`;
- proposed solution options;
- recommended option and why;
- risks if changed;
- risks if left unchanged.

All supporting evidence must be committed under:
`docs/reports/v396-root-cause-plan-review-20260927/`

Reusable read-only helper scripts, if needed, must be committed under `scripts/` with conservative S00 classification. No local-only helper is acceptable as final evidence.

## 2. Human-review implementation plan
After the report is complete, create and push:
`docs/plans/v396/CODEX-V396-ROOT-CAUSE-IMPLEMENTATION-PLAN-20260927.md`

The implementation plan must be executable but **not executed**. It must include:
- exact product files expected to change;
- exact tests to add/update;
- migration/storage impact, if any;
- whether any settings/schema/API contract changes are needed;
- whether deployment/restart is required;
- local test/typecheck/verify/formal-build sequence;
- runtime acceptance sequence;
- rollback strategy;
- invariants that must not change;
- GitHub artifacts/evidence that must be produced during implementation;
- explicit human decisions required before implementation.

Separate the plan into:
A. mandatory correctness fixes;
B. observability fixes;
C. policy questions requiring human approval;
D. items that need no code change.

Do not hide a policy decision inside a code-fix section.

## 3. Final response
After pushing all artifacts, stop and report only:
- root-cause report commit SHA;
- implementation-plan commit SHA;
- concise P1–P6 conclusion table;
- the exact line: `PLAN_READY_FOR_HUMAN_CONFIRMATION`.

No implementation, deployment, settings write, lifecycle action, exchange write, or GitHub Actions run is authorized in this round.
