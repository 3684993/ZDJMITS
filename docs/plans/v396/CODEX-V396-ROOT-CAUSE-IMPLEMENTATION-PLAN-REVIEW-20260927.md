# V3.9.6 Root-Cause Implementation Plan Review

**Review state:** `PLAN_REVISION_REQUIRED_BEFORE_IMPLEMENTATION`

This review approves the root-cause classification but does **not** authorize product implementation, settings changes, deployment, lifecycle actions, or exchange writes yet.

Basis:
- `docs/reports/v396-root-cause-plan-review-20260927/REPORT.md`
- `docs/plans/v396/CODEX-V396-ROOT-CAUSE-IMPLEMENTATION-PLAN-20260927.md`
- current `main`

## Findings accepted

1. **P1 accepted:** the apparent UNKNOWN/P0/closeout conflict is a scope mismatch, not proof of an unresolved Entry exposure. The one unresolved item at replay time is a separate manual reduce-only XRPUSDT exit UNKNOWN. Preserve it; do not clear or reinterpret it as Entry risk.
2. **P2 accepted:** current zero Entry headroom is `POLICY-BINDING, NOT A BUG` while canonical gross remains above the approved gross ceiling. Do not alter the approved limit merely to produce orders.
3. **P4 accepted:** the operator/runtime readback is insufficient because the installed admission evaluator contains richer numeric gate facts than the book/pipeline/dashboard surfaces expose. One authoritative readback should carry the evaluator result end-to-end; no second risk authority may be created.
4. **P6 accepted:** under the current profile, human notional, all-unmapped cluster and ACK age are not independent duplicate hard vetoes. Preserve independently tighter future limits and all concrete evidence/fail-closed gates.

## Section C decisions

### C1 — compatibility aggregate
**Approved with constraint.** Keep `activeRiskUnresolvedCount` temporarily only for backward compatibility, but explicitly label it as mixed-scope / compatibility-only. New consumers must use scoped fields. Add a consumer inventory before any later removal.

### C2 — manual UNKNOWN vs unrelated Entry
**Approved.** A reduce-only manual exit UNKNOWN must remain unresolved within manual execution/position reconciliation, but must not by itself become a global veto for unrelated NEW Entry unless a same-domain identity/position conflict or other independent execution-risk fact exists. Do not weaken position/TP/ownership reconciliation.

### C3 — precomputed allowed candidate list / frozen model quantity
**Not approved for behavior change in this round.** The report did not reproduce a live current conversion loss from frozen model quantity. Do not change prompt/contract or auto-resize behavior yet.

Instead add **observability only** so a later runtime window can prove whether this is a real throughput bottleneck:
- record the offered candidate IDs / legal quantity intervals presented to Primary;
- record the model-selected candidate/quantity;
- when the choice is rejected, record whether one or more alternative offered legal candidates existed at the same evaluated snapshot;
- record the rejection class without auto-clamping, silently resizing, changing side, or retrying another model choice.

This telemetry must be bounded, sanitized and read-only with respect to execution authority.

### C4 — thresholds/settings/modes
**Approved unchanged.** No risk threshold, governance mode, leverage rule, economics threshold, Entry Safety mode, Production/Testnet boundary, or Settings value is authorized to change in this scope.

## Required plan revisions before implementation

Update `docs/plans/v396/CODEX-V396-ROOT-CAUSE-IMPLEMENTATION-PLAN-20260927.md` and stop again at `PLAN_READY_FOR_HUMAN_CONFIRMATION`.

The revised plan must include these three items:

### R1 — scoped reconciliation contract
Define exact additive response fields and semantics for at least:
- `entryUnknownHistorical`
- `entryUnknownOccupyingRisk`
- `entryUnknownProofValid`
- `activeEntryClaims`
- `manualUnknown`
- `tpUnknown`
- compatibility `activeRiskUnresolvedCount` with an explicit mixed-scope label/deprecation note

All values must be derived from one evaluated-at reconciliation snapshot where possible. No history deletion, no UNKNOWN coercion to zero.

### R2 — single authoritative numeric admission readback
The plan must guarantee that book-level and candidate-level surfaces carry the **same evaluator-pass** facts:
- evaluatedAt
- scope BOOK/CANDIDATE
- risk generation / snapshot hash
- settings/profile/authority versions
- candidate symbol/side/quote asset/leverage provenance when applicable
- included pending/reservation identity lineage and proof-validity state
- all gate items with unit, used, limit, headroom, candidateImpact, candidate shortfall
- side ceilings
- first binding cause
- AVAILABLE / ZERO / UNAVAILABLE distinction

Dashboard/API may format only; they must not recalculate, rerank or synthesize another authority.

### R3 — frozen-choice conversion telemetry only
Add a non-authoritative observability item for Primary selection:
- offered legal candidate IDs/count and legal quantity intervals;
- selected candidate ID/quantity;
- whether selected value was inside the offered set;
- if rejected, whether alternative offered legal candidates existed;
- reason class and evaluatedAt/snapshot identity.

Acceptance tests must prove this telemetry cannot mutate the plan, resize quantity, switch side, trigger another model call, or authorize an order.

## Validation boundary for the later implementation round

After this plan revision is approved, the implementation round may modify product code only for B1/B2 plus R3 observability. It must not change Entry admission policy or approved limits.

All tests/typecheck/verify/formal build remain local; GitHub Actions remain `NOT_RUN_BILLING_LIMIT`.

All persistent reports, evidence JSON/CSV/TXT, reusable scripts, test/gate outputs, source/artifact manifests and final conclusions must be committed and pushed to GitHub `main`. No local-only final evidence paths are acceptable.

Deployment/runtime acceptance remains a separate explicit authorization after local implementation gates pass. No stop/start/restart is authorized by this review.

## Required next status

Codex should update the implementation plan only, commit/push it to GitHub `main`, and finish with exactly:

`PLAN_READY_FOR_HUMAN_CONFIRMATION`

Do not implement product code yet.
