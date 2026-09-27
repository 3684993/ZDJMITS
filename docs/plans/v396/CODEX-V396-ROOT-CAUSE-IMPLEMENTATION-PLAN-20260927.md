# V3.9.6 Root-Cause Fix and Readback Plan — Human Review Required

**State:** `PLAN_READY_FOR_HUMAN_CONFIRMATION`
**This document is a plan only. Nothing below was implemented, built, deployed, or run against the Engine.**
**Plan basis:** `docs/reports/v396-root-cause-plan-review-20260927/REPORT.md` and its timestamped evidence.
**Base commit audited:** `40d13d3f999d9cb0b2e8a11975df892dd899adf5` (`origin/main` at investigation start).

## Objective and scope

Make the operator's Entry-risk explanation numerically complete and separate Entry exposure from manual/TP UNKNOWN execution state, while retaining one portfolio risk authority and all current hard-risk behavior. No work item may increase Entry throughput by widening a limit, clearing an UNKNOWN, resizing the model's immutable quantity, bypassing JIT admission, or inventing an order.

The current report found no proven P1/P2 admission bug and no live P3 false-zero. Gross capacity is correctly zero while the measured canonical position book exceeds its approved cap. The likely implementation is therefore narrow and observational; if tests show a current failing invariant, pause and update the plan for human review before changing execution behavior.

## A. Mandatory correctness fixes

The investigation did **not** establish a mandatory risk-policy or order-path correctness fix. Preserve current behavior. These two narrow semantic protections are mandatory if the readback work is implemented:

1. **Keep UNKNOWN populations separate.** Add named per-domain facts for `entryUnknownHistorical`, `entryUnknownOccupyingRisk`, `entryUnknownProofValid`, `manualUnknown`, `tpUnknown`, and `activeEntryClaims`. Retain current broad closeout aggregate only as an explicitly named compatibility field if a consumer depends on it. Do not clear/alter any UNKNOWN row, order identity, proof, reservation, claim latch, or manual/TP execution behavior.
2. **Keep the existing gate the only authority.** API and dashboard work must pass through the installed `PortfolioRiskAdmission` result. They may format/expose its returned facts; they must not recalculate limits, stress, candidate impact, used exposure, or first-cause ranking.

No required storage migration or settings change is identified.

## B. Observability fixes

### B1. Domain-specific UNKNOWN reconciliation output

**Expected product files:**

- `apps/engine/src/services/reconciliationService.ts` — retain existing strict occupancy predicate and compute separately named Entry/manual/TP categories from the same reconciled in-memory state and one `now` value.
- `apps/engine/src/api/router.ts` — expose these new facts through the existing read-only closeout/diagnostic response without adding a write route.
- `apps/engine/src/config/settingsStore.ts` — only if the readback needs to expose manual claims alongside existing Entry claim stats; read both existing tables with SELECTs. Do not change schemas or `saveEntryExecution`/`saveManualExecution` behavior.
- `apps/engine/src/services/reconciliationUnknownRisk.test.ts`, `apps/engine/src/services/reconciliationCoverageContract.test.ts`, `apps/engine/src/services/executionLifecycle.integration.test.ts` — assert separate counts and preservation of the reduce-only manual UNKNOWN while 47 proven Entry UNKNOWN records do not occupy Entry risk.

**Acceptance invariant:** for an input with 47 UNKNOWN Entry orders carrying currently valid matching proofs, zero Entry active claims, one UNKNOWN manual `reduceOnly` exit, and zero UNKNOWN TP rows: `entryUnknownHistorical=47`, `entryUnknownOccupyingRisk=0`, `manualUnknown=1`, `tpUnknown=0`, and `activeEntryClaims=0`. The Entry capacity projection remains zero pending Entries, while the separate manual-execution UNKNOWN remains visible and unresolved. Add hostile cases for expired/mismatched proof and for late exchange risk so they remain fail-closed.

### B2. One numeric book-level and candidate-level risk readback

**Expected product files:**

- `apps/engine/src/services/admissionCapacityReader.ts` — extend the existing typed view/summary to carry `riskGeneration`, `snapshotHash`, `profileVersion`, completeness/coverage status, quote asset/leverage provenance where candidate-specific, `gates`, evidence blockers, size-independent refusals, and `firstBinding` as returned by the installed ledger. Preserve `AVAILABLE`, `UNAVAILABLE`, and `NOT_APPLICABLE` distinctions.
- `apps/engine/src/services/pipelineVerdict.ts` — book-level fallback must carry the actual gate facts and blocker lists rather than synthesizing an empty array around a refusal. Keep existing precedence and single first cause; do not run another ranking pass.
- `apps/engine/src/runtime/appRuntime.ts`, `apps/engine/src/api/projections.ts`, and the existing read-only route in `apps/engine/src/api/router.ts` — serialize one evaluated-at snapshot including included pending Entry identities/status/proof validity/dedupe lineage, versions, gate facts, side ceilings, and first binding. Use existing response surfaces if possible; any new API response is additive and read-only.
- `apps/dashboard/src/views/OverviewView.vue` and `apps/dashboard/src/views/OverviewView.capacity.test.ts` — render the returned authoritative first binding and exact unit/used/limit/headroom/shortfall. Render unavailable distinctly; do not calculate or infer capacity in the browser.
- `apps/engine/src/services/placeToSubmitCapacityTruth.test.ts`, `apps/engine/src/services/pipelineVerdict.test.ts`, and `apps/engine/src/services/grossRiskCapacityVisibility.test.ts` — cover book-level no-candidate zero capacity with populated gates; candidate-specific incremental impact; both direction ceilings; proof-valid and proof-expired UNKNOWN; and unavailable admission. Keep the 5-second capacity memo observational only; `admit()` continues to recompute JIT facts.

**Proposed gate item contract:** `{name, unit, used, limit, headroom, shortfall, candidateImpact, clusterKey}`. USD values must carry `NOTIONAL_USD`, `MARGIN_USD`, or `LOSS_USD` units; count/evidence refusals must state `SIZE_INDEPENDENT` or `EVIDENCE` and must not manufacture a dollar shortfall. For each gate, `headroom=max(0,limit-used)`; candidate shortfall is `max(0,used+candidateImpact-limit)`. The first binding and all accompanying gate facts must come from the same evaluator pass and timestamp.

No SQLite schema change or new risk-approval layer is expected. If consumers require durable readback history, first return it in the current read-only API; persistence requires a separate human-approved migration design.

## C. Policy questions requiring human approval

The implementation must not silently decide these policy questions:

1. Should `activeRiskUnresolvedCount` remain as a compatibility aggregate, or should it be deprecated after consumers migrate to scoped Entry/manual/TP counts? Recommended: preserve temporarily, explicitly label its mixed scope, and remove only after consumer inventory.
2. Should any UNKNOWN manual execution block all unrelated new Entry? Current recommendation: **no** for a reduce-only close command with no same-identity conflict; keep it visible and fail-closed within its own execution/position reconciliation. Any wider veto changes the admission policy and needs explicit approval.
3. Should the model be given a precomputed allowed candidate list/IDs so it can select a legal smaller quantity when its current request falls outside the legal envelope? Current plan does not change frozen quantity semantics or silently clamp. If desired, approve a separate prompt/contract design with explicit candidate authorization and measured conversion-loss evidence.
4. Confirm no thresholds, governance mode, Settings, or trade-size behavior are to change in this scope. Recommended: confirm they remain unchanged.

No item in Section C is authorized by approval of this document alone unless the human explicitly confirms that item.

## D. Items requiring no code change

- P2 over-limit behavior: preserve existing positions and protection; zero new Entry headroom until current canonical exposure falls under the approved limit through ordinary activity.
- Gross accounting: count positions plus currently occupying pending Entry/reservation exposure once; an order replaces its linked reservation; unproven UNKNOWN remains included.
- Existing strict no-risk proof requirements: matching identity, `activeRiskExposure=false`, `VERIFIED_NO_ACTIVE_RISK`, and unexpired proof at the evaluator timestamp. Preserve historical UNKNOWN rows and audit history.
- Existing directional, mapped cluster, quote-margin, verified leverage, capital-at-risk, stress-loss, private-account, legal exchange filters, JIT snapshot, reservation, and idempotency conditions.
- Current source duplicate suppression when human notional or unmapped cluster limits are equal to/wider than gross; ACK-age telemetry; diagnostic-only snapshot summary labels; SHADOW historical reachability behavior. Keep concrete evidence blockers and the mechanical `$1`/`0.15%` profit floor.
- Do not auto-clamp a model quantity, switch sides, broaden horizon/target, make up facts, synthesize PLACE/submit/fill events, or alter exchange filters.

## Implementation sequence after human confirmation

1. **Start on current `main`:** fetch all remotes; fast-forward local `main` only if clean and behind; verify remote/local base and clean status. Do not create a long-lived implementation branch. Stop if concurrent main changes invalidate the inspected source map.
2. **Record baseline:** commit-independent evidence with commit SHA, settings version/profile version, current read-only position/pending/proof summary, existing positions/TP coverage, and current Engine PID/instance/build identity as observable. Do not call an exchange write or lifecycle action for this snapshot.
3. **Implement B1 first:** add scoped counters and focused hostile tests; do not alter the entry occupancy predicate.
4. **Implement B2:** extend the single admission readback end-to-end. Preserve source-returned timestamps/versions/gates and demonstrate no second authority in the dashboard. Update API schema/types if present; fields must be additive and read-only.
5. **Local verification:**
   - install/use only the repository-pinned dependencies already available; no runtime data directory.
   - run focused Engine tests for reconciliation UNKNOWN/lifecycle, `placeToSubmitCapacityTruth`, `pipelineVerdict`, `grossRiskCapacityVisibility`, and candidate quantity/horizon feasibility.
   - run `npm run typecheck`.
   - run `npm run verify:scripts` and `npm run verify:deps` if required by the changed workspaces.
   - run complete `npm test` and `npm run build` for all workspaces, then `npm run verify` (which includes these repository checks) if workspace resources permit. Record exit codes and logs; do not use hosted CI/GitHub Actions.
   - run the committed S00 replay helper against an explicitly selected offline snapshot, check SQLite read-only safety, compare the serialized gate arithmetic to the source result, and record `NOT_RUN_EXTERNAL` for unobserved exchange facts.
6. **Review/commit/push:** inspect `git diff --check`, status, exact product diff and evidence; commit implementation plus tests/readback evidence to `main`; fetch again; verify ancestry/fast-forward-only state; push only after the human-approved implementation scope and all required checks pass. Store reports, JSON/CSV evidence, scripts, build identity manifest, and results in-repository.
7. **Runtime acceptance is a separate human-authorized phase:** local build success does not establish loaded runtime identity. If the accepted code requires a new deployed artifact, one controlled stop followed by one `MANUAL_START` is required to prove the new process loaded it. This plan itself does not authorize that lifecycle action. Obtain explicit approval for that exact stop/start before any attempt.

## Later runtime acceptance and rollback

Before the separately authorized transition: verify fetched `origin/main == local HEAD`, clean worktree, full local gate results, artifact SHA-256 and build manifest tied to the commit, old PID/instance and old artifact hash, TESTNET/write-lock state, current Settings version, every current position's TP/protection invariant, and all active/UNKNOWN Entry/manual/TP facts. If an unresolved fact could be harmed by stopping, do not proceed; report it for human action.

After approval and one controlled stop/manual start via the repository's approved start script, record new PID, instance, source hash and artifact hash; verify the instance reports the exact built identity. Confirm Settings version is unchanged, protected positions/TP coverage remain intact, UNKNOWN history is preserved, no unintended Entry submit occurred, and one timestamped read-only API response contains numerically consistent authoritative gates. A failed health check is reported for manual intervention; no automatic kill or restart.

Rollback requires separate human lifecycle authorization. Pin the prior validated artifact hash and deployment manifest before the forward transition. If acceptance fails, stop only with explicit authorization, restore the pinned artifact, and manually start once if explicitly authorized. Preserve runtime data and UNKNOWN history; do not reverse Settings/data migrations because none are in scope. Capture the failed identity/readback and rollback result in committed evidence.

## Required implementation-phase repository evidence

Commit/push all retained reports, source diff summary, scoped P1 test result, numeric P4 readback JSON/CSV, reproducible S00 replay script/output, typecheck/test/verify/build exit codes, source-to-artifact SHA manifest, and final runtime acceptance/rollback conclusion. No required evidence may remain only in a local or temporary directory. GitHub Actions remain `NOT_RUN_BILLING_LIMIT` unless the human later changes that constraint.

## Human decisions needed to leave PLAN_READY

Confirm the four Section C decisions, approve the exact B1/B2 scope, and separately authorize any later Engine stop/start if runtime acceptance is requested. Until those confirmations, implementation, Settings changes, deployment, and lifecycle actions remain out of scope.
