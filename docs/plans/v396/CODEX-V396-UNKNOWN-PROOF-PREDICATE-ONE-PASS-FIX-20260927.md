# V3.9.6 UNKNOWN proof predicate — one-pass root-cause + code fix + local closeout

## Supersedes
This document supersedes `docs/plans/v396/CODEX-V396-UNKNOWN-PROOF-PREDICATE-PLAN-ONLY-20260927.md` for execution. Do **not** stop after analysis or after writing an implementation plan. This round must analyze, implement, test, and commit the complete source fix in one pass.

## Model and goal
Use GPT-6 Astra, preferably `xhigh` reasoning. Start from latest clean `origin/main` and stay on `main`.

The confirmed blocker is the execution-facing `UNKNOWN` no-active-risk proof predicate. Astra already proved that malformed proof can be accepted and can release both real risk occupancy and the durable Entry claim. This is no longer a planning-only question.

The goal of this round is to completely close this defect in source code and local verification, without another human-plan roundtrip.

## Existing evidence to trust
Read first:
- `docs/reports/v396-astra-predeployment-closeout-20260927/REPORT.md`
- `docs/reports/v396-astra-predeployment-closeout-20260927/unknown-proof-negative-control.json`
- `docs/reports/v396-astra-predeployment-closeout-20260927/source-review.md`
- `apps/engine/src/services/entryRiskOccupancy.ts`

Known false accepts include at least:
- `checkedAt = null`;
- empty/missing proof sources;
- a future / internally inconsistent `checkedAt` and `validUntil` interval.

Current source can therefore produce `hasVerifiedNoActiveRisk=true`, `entryOrderOccupiesRisk=false`, and `durableEntryClaimActive=false` for malformed evidence. Treat this as a confirmed execution-safety defect.

## Mandatory one-pass workflow

### Phase 1 — source trace, then immediately implement
Trace all producers, renewers, hydrators and consumers of `activeRiskEvidence` / `VERIFIED_NO_ACTIVE_RISK` only as much as needed to define the correct contract. Do not stop after the trace.

At minimum inspect:
- proof creation and renewal/reconciliation paths;
- `hasVerifiedNoActiveRisk()`;
- `entryOrderOccupiesRisk()`;
- `entryClaimReleasedByExchangeFacts()`;
- `durableEntryClaimActive()`;
- `historicalNoRiskEligible()` / remote-audit deferral;
- R1 proof-valid counters/readback;
- SettingsStore hydration/loading of persisted Entry execution rows;
- any schema/type declarations for the evidence object;
- tests that create or mock no-active-risk evidence.

Determine all legitimate proof classes from the current writers. Do not invent an arbitrary source quorum that would reject a legitimate current producer. But after that source trace, **implement the strict contract in this same round**.

### Phase 2 — implement one canonical strict validator
Create or refactor to one shared source-of-truth validator for no-active-risk evidence. All execution/risk-release consumers must use it rather than divergent local checks.

The final contract must, as applicable to the actual producer design, enforce at least:
- evidence is an object with the expected status;
- `activeRiskExposure === false` where that is part of the release contract;
- timestamps are actual finite numeric values of the correct runtime type; do not accept `null`, empty string, numeric string, NaN, Infinity, or coercion artifacts merely because `Number(...)` succeeds;
- positive/valid timestamps;
- coherent time ordering: `checkedAt <= now < validUntil` and `checkedAt < validUntil`;
- any producer-supported maximum TTL / tier relationship needed to prevent impossible proof lifetime;
- exact identity tombstone match;
- a complete, explicitly validated source/proof class sufficient to establish no exact order, no open-order identity, no attributable trade/order state, and no attributable position, using the legitimate source combinations actually emitted by current producers;
- malformed, partial, unknown, unsupported or future-dated evidence fails closed.

If current writers support more than one valid proof class, encode those classes explicitly in a typed/centralized contract instead of weakening validation to a generic non-empty sources check.

### Phase 3 — harden producer + renewal + hydration consumption
Do not fix only the display layer.

Ensure:
1. every producer/renewer emits evidence satisfying the canonical validator;
2. consumers never trust malformed persisted evidence just because JSON hydration succeeded;
3. old malformed persisted evidence remains historical but is treated as invalid/fail-closed until normal reconciliation produces a fresh valid proof;
4. no data migration is used merely to rewrite history into compliance unless source analysis proves a migration is strictly required; prefer no migration;
5. no UNKNOWN row/history is deleted, coerced to terminal, or silently rewritten to `no risk`;
6. a previously released durable claim with an invalid proof is considered active/fail-closed again if that is what the canonical occupancy semantics require;
7. normal reconciliation can naturally renew a valid proof once real exchange facts prove absence again.

A stricter predicate changing occupancy/claim behavior is **expected and authorized** for this confirmed bug. Do not stop merely because behavior becomes more conservative.

### Phase 4 — current persisted-data impact, read-only
Using read-only access only, classify the currently accessible persisted Entry UNKNOWN / terminal-UNKNOWN rows under:
- old predicate;
- new strict predicate.

Record how many rows change classification and why. Do not modify live/runtime data to make the result pass.

If current source/data/runtime identity cannot be cryptographically linked, state that limitation, but do not use it as a reason to avoid fixing source.

### Phase 5 — mandatory regression matrix
Add focused tests covering at least:
- fully valid proof;
- expired proof;
- identity mismatch;
- `checkedAt=null`;
- missing `checkedAt`;
- numeric string timestamp;
- NaN/Infinity/non-finite where representable;
- negative/zero timestamp;
- `validUntil <= checkedAt`;
- future `checkedAt`;
- empty sources;
- missing sources;
- partial source quorum;
- duplicate sources;
- unknown/unsupported source;
- every legitimate alternate proof class discovered from real producers;
- malformed hydrated persisted evidence;
- proof renewal after fail-closed evidence;
- occupancy, durable claim, R1 counters and historical eligibility agreeing on the same validator;
- the previous Astra negative-control cases now all passing;
- current known proof-valid historical UNKNOWN population remaining valid only if it actually satisfies the final contract.

Include an explicit regression proving `Number(null)`, numeric strings, or similar coercion cannot grant proof validity.

### Phase 6 — full local closeout on final tree
On the exact final committed source tree, run and retain:
- all focused UNKNOWN proof/occupancy/reconciliation tests;
- R1/R2/R3 targeted tests affected by the shared predicate;
- complete Engine tests;
- core/dashboard/contracts tests per repository policy;
- workspace typecheck;
- `verify:deps`;
- `verify:scripts`;
- full `npm run verify`;
- formal workspace build;
- S00 T01–T06/static isolation;
- storage coverage;
- the UNKNOWN negative-control script against the final formal build;
- `git diff --check` / committed-tree cleanliness.

Do not use GitHub Actions; record `NOT_RUN_BILLING_LIMIT`.

## Allowed scope
This round is explicitly authorized to modify product source and execution-facing UNKNOWN proof behavior necessary to fix this defect, including the shared validator, legitimate proof producers/renewers, hydration/consumption checks, reconciliation/readback consistency, and regression tests.

Do not create a second risk authority or unrelated refactor.

## Still prohibited
Do NOT:
- change approved gross/direction/cluster/human/stress/capital/economic thresholds;
- change Settings values, governance mode, leverage policy, Entry Safety, Production/Testnet boundary, or `aiExitAuthority`;
- change Primary prompt/input/decision contract;
- auto-resize/clamp quantity, switch side, alter target/horizon, retry the model, or manufacture orders/fills;
- delete UNKNOWN history or fabricate remote/exchange facts;
- deploy, stop/start/restart/hot reload the running Engine;
- write to exchange/Testnet/Production;
- use GitHub Actions;
- touch the preserved dirty V3.9.5 worktree.

If fixing this confirmed predicate exposes another source defect in the same proof/occupancy/claim chain, fix it in this same round when it can be corrected without violating the prohibitions above. Do not defer a directly related correctness defect merely to save scope.

Only stop as blocked if the remaining defect genuinely requires one of the explicitly prohibited changes (for example a Settings/risk-policy decision, Primary contract change, destructive DB migration, or live lifecycle action). A normal execution-behavior correction caused by strict fail-closed proof validation is NOT a reason to stop.

## GitHub artifact rule
Every persistent artifact must be committed and pushed to GitHub `main`. No final evidence may remain only in `C:\...`, `D:\...`, temp, or Codex scratch paths.

Use a repository directory such as:
`docs/reports/v396-unknown-proof-predicate-fix-20260927/`

At minimum retain:
- `REPORT.md`;
- source/producer/consumer map;
- before/after persisted-data impact JSON;
- negative-control before/after result;
- changed-file/source-diff summary;
- focused and full gate results;
- final source/build identity manifest;
- any reusable read-only audit script.

## Final response contract
Do **not** return only a status label.

The final chat response must include:
1. final status;
2. exact root cause(s) fixed;
3. exact files/logic changed;
4. old-vs-new persisted-data impact count;
5. negative-control result;
6. focused/full local gate results;
7. final GitHub commit SHA and report paths;
8. deployment/runtime acceptance status;
9. any remaining blocker, if one truly remains.

Preferred success status:
`V396_UNKNOWN_PROOF_PREDICATE_FIXED_LOCAL_PASS`

Blocked status is allowed only for a genuine prohibited-boundary dependency:
`V396_UNKNOWN_PROOF_PREDICATE_FIX_BLOCKED`

This round ends only after the source fix and local closeout are committed/pushed, or after documenting a genuine prohibited-boundary blocker. Do not stop at an implementation plan.