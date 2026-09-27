# V3.9.6 UNKNOWN proof predicate hardening — root-cause impact analysis and implementation plan only

## Purpose
Astra predeployment closeout identified one blocking execution-safety defect in the existing UNKNOWN no-active-risk proof predicate. This round is **analysis + impact assessment + implementation planning only**. Do not modify product code, Settings, risk thresholds, database rows, runtime state, deployment artifacts, or Engine lifecycle.

Start from latest `origin/main`. Read first:
- `docs/reports/v396-astra-predeployment-closeout-20260927/REPORT.md`
- `docs/reports/v396-astra-predeployment-closeout-20260927/unknown-proof-negative-control.json`
- `docs/reports/v396-astra-predeployment-closeout-20260927/source-review.md`
- `apps/engine/src/services/entryRiskOccupancy.ts`

## Confirmed blocker
Current `hasVerifiedNoActiveRisk()` can accept malformed evidence because it uses coercive numeric checks and does not fully validate proof completeness/time ordering. Synthetic negative controls already prove at least these false accepts:
- `checkedAt = null`;
- `sources = []`;
- `checkedAt` in the future / later than `validUntil`.

When falsely accepted, the same predicate can make an UNKNOWN Entry stop occupying risk and can release its durable claim. This is execution behavior, not telemetry. Do not dismiss it because the normal test suite is green.

## Questions Astra/Codex must answer before any implementation

### P1 — exact proof contract
Trace every producer, renewer, hydrator and consumer of `activeRiskEvidence` / `VERIFIED_NO_ACTIVE_RISK`.

Determine the exact proof contract required to justify releasing UNKNOWN Entry risk. At minimum evaluate:
- strict runtime types for `checkedAt` and `validUntil` (no `Number(null)` / string coercion surprises);
- finite positive timestamps;
- ordering `checkedAt <= now < validUntil` and `checkedAt < validUntil`;
- maximum/allowed TTL relationship to the existing UNKNOWN evidence tiers;
- required evidence source quorum for proving: no exact exchange order, no open order identity, no user-trade identity, no all-order identity, and no attributable position / position proven to another cycle;
- exact identity tombstone match;
- `activeRiskExposure === false` semantics;
- whether all proof producers currently emit the same complete source set or whether there are legitimate alternate proof classes that require an explicit typed contract rather than one hard-coded list.

Do not invent a stricter source set until all current proof writers are traced.

### P2 — current persisted-data blast radius
Using **read-only** access only, inspect the currently selected authoritative local data source and classify all persisted Entry UNKNOWN / terminal-UNKNOWN evidence under:
1. current predicate result;
2. proposed strict predicate result.

For every row whose classification would change, record sanitized identity/domain, current proof fields, why current code accepts it, why strict code would reject it, proof age/TTL, and whether it currently contributes to Entry risk or claim release.

If the running Engine and the analyzed SQLite/source checkout are not cryptographically linked, say so explicitly. Do not claim runtime population facts that cannot be proven.

Do not alter, repair, delete, renew, or release any row during this analysis.

### P3 — source-of-truth design
Propose exactly one shared validation function/typed contract used by all risk-release consumers. Avoid divergent rules between:
- `hasVerifiedNoActiveRisk()`;
- `entryOrderOccupiesRisk()`;
- `entryClaimReleasedByExchangeFacts()`;
- `durableEntryClaimActive()`;
- reconciliation R1 proof-valid counters;
- historical no-risk eligibility / remote-audit deferral;
- hydration and renewal paths.

The design must make malformed/incomplete proof fail closed while keeping the original UNKNOWN history intact.

Decide whether validation belongs only at consumption, also at proof creation/renewal, and/or at hydration boundaries. A malformed persisted historical row must never become trusted merely because it was loaded successfully.

### P4 — behavior-transition semantics
Because hardening the predicate can change actual risk occupancy and durable claim state, specify the safe transition behavior:
- what happens to a currently released claim whose stored proof becomes invalid under the stricter validator;
- whether it must become active/fail-closed immediately until re-verification;
- whether any background reconciliation may renew a valid proof naturally;
- whether any write migration is required (prefer none if safe);
- how to avoid rewriting UNKNOWN history or fabricating exchange facts;
- how startup/hydration behaves if malformed evidence is found.

No solution may silently preserve a false release just to avoid a behavior change.

### P5 — regression matrix
The implementation plan must include tests for at least:
- fully valid proof;
- expired proof;
- identity mismatch;
- `checkedAt=null`;
- missing `checkedAt`;
- string timestamp;
- NaN/Infinity/non-finite values where representable;
- negative/zero timestamps;
- `validUntil <= checkedAt`;
- future `checkedAt`;
- empty sources;
- partial source quorum;
- duplicate sources;
- valid alternate position-evidence class if one exists;
- malformed hydrated persisted payload;
- proof renewal after a fail-closed row;
- occupancy + durable claim + reconciliation counters all agreeing on the same validator;
- 47 known proof-valid historical Entry UNKNOWN rows (or the current verified population) remaining valid only if they truly satisfy the finalized contract.

### P6 — deployment/rollback implications
Define the exact post-implementation local gates and later runtime acceptance needed before deployment. Include how to observe whether stricter validation temporarily increases Entry UNKNOWN occupancy or durable active claims. This planning round does not authorize lifecycle actions.

## Required outputs in GitHub
Commit and push all persistent analysis to `main` under:
`docs/reports/v396-unknown-proof-predicate-plan-20260927/`

At minimum:
- `REPORT.md` — root cause, producer/consumer map, current-data impact, recommended solution;
- `current-proof-impact.json` — sanitized read-only classification comparison;
- `SOURCE-MAP.md` or equivalent;
- any reusable read-only audit script;
- the proposed implementation plan at `docs/plans/v396/CODEX-V396-UNKNOWN-PROOF-PREDICATE-IMPLEMENTATION-PLAN-20260927.md`.

All retained artifacts must be in GitHub. Do not finish with local-only `C:\...` or `D:\...` references.

## Hard boundaries
Do NOT in this round:
- modify `apps/` or `packages/` product code;
- change Settings/limits/modes;
- change UNKNOWN rows, claims, proofs, audit history or SQLite schema;
- deploy or stop/start/restart the Engine;
- write to exchange/Testnet/Production;
- use GitHub Actions;
- touch the preserved dirty V3.9.5 worktree.

## Final response contract
Do **not** reply with only a status label.

The final chat response must include, in concise form:
1. status: `PLAN_READY_FOR_HUMAN_CONFIRMATION` or `PLAN_BLOCKED_NEEDS_HUMAN_DECISION`;
2. the confirmed root cause in 2–5 bullets;
3. current persisted-data blast radius (how many rows would change, or why that is unprovable);
4. recommended fix design;
5. exact GitHub report path, implementation-plan path, and final commit SHA;
6. any human decision still required.

Stop after the plan. Do not implement product code yet.
