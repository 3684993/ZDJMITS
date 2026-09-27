# V3.9.6 Root-Cause Fix and Readback Plan — Revised for Human Confirmation

**State:** `PLAN_READY_FOR_HUMAN_CONFIRMATION`
**This is a plan only. Product implementation, Settings changes, limit changes, deployment, lifecycle actions, and exchange writes are not authorized by this document.**
**Review basis:** `docs/plans/v396/CODEX-V396-ROOT-CAUSE-IMPLEMENTATION-PLAN-REVIEW-20260927.md` and `docs/reports/v396-root-cause-plan-review-20260927/REPORT.md`.
**Base source reviewed:** `origin/main` at `8cc1dc8d3cf5449a8cc16ad97b3d3989dadf4081`.

## Objective

After a separate human confirmation, implement only the read-only observability work in this plan: scoped UNKNOWN reconciliation (R1), a single authoritative numeric admission readback (R2), and frozen-choice conversion telemetry (R3). Preserve the existing admission policy and fail-closed behavior. Do not add a risk approval layer or use telemetry to change an execution decision.

The accepted root-cause review found that the P1 count mismatch is a domain/scope difference; P2 zero capacity is `POLICY-BINDING, NOT A BUG`; P4 lacks a complete numeric runtime readback; and P6 duplicate labels are not independent hard vetoes under the reviewed settings. P3 did not reproduce a live frozen-choice conversion loss. See the committed report and replay evidence for time and source limitations.

## Confirmed decisions C1–C4

These decisions are accepted inputs to this revised plan and are not reopened as questions:

- **C1 — compatibility aggregate:** retain `activeRiskUnresolvedCount` temporarily for backward compatibility only. Mark it explicitly as a mixed-scope compatibility field and deprecated for new consumers. New consumers must use scoped fields. Before eventual removal, inventory and migrate every consumer.
- **C2 — manual UNKNOWN:** a reduce-only manual exit UNKNOWN remains unresolved in manual execution/position reconciliation, but does not alone veto unrelated NEW Entry. A same-domain identity/position conflict or another independent execution-risk fact may still block under its own existing rule. Do not weaken position, TP, ownership, or manual reconciliation.
- **C3 — frozen choice:** no prompt/contract change, candidate substitution, retry, clamp, resize, or other behavior change. Add R3 observability only, so a later authorized runtime window can measure whether frozen model selection loses conversions.
- **C4 — policy unchanged:** no approved risk threshold, governance mode, leverage rule, economics threshold, Entry Safety mode, Production/Testnet boundary, or Settings value changes.

## A. Mandatory correctness invariants

The review established no mandatory risk-policy or order-path behavior fix. Keep current behavior and enforce these invariants while implementing observability:

1. Keep one installed `PortfolioRiskAdmission` as the sole risk authority. API and dashboard code may serialize/format its returned facts but may not independently recalculate exposure, capacity, stress, candidate impact, gate ordering, or first cause.
2. Preserve `UNKNOWN` records and audit history. Never coerce UNKNOWN to zero, clear a row to reconcile counters, release an Entry claim without current matching proof, or omit a qualifying unresolved pending order.
3. Keep manual reduce-only UNKNOWN separate from Entry occupancy while preserving its unresolved state in its own domain. Do not change position/TP/ownership/reduce-only execution semantics.
4. Telemetry must be observational. It cannot modify an immutable plan, authorize or mutate quantity/side/target/horizon, reserve capacity, bypass JIT admission, trigger a second model call, or create/place/submit an order.

No Settings or database schema migration is planned. If implementation discovers a need for a persistent schema change or execution-path behavior change, stop and obtain a revised human-approved plan first.

## B. Implementation scope

### B1 / R1 — scoped UNKNOWN reconciliation contract

Add an additive, read-only reconciliation response with these exact fields and semantics:

| Field | Definition |
|---|---|
| `evaluatedAt` | One reconciliation evaluation timestamp in epoch milliseconds; use the same `now` for all time-sensitive proof predicates and age calculations in that result. |
| `entryUnknownHistorical` | Count Entry order records classified historical UNKNOWN by the existing source predicate, including terminal orders whose exchange terminal status remains UNKNOWN. This is history count, not active exposure. |
| `entryUnknownOccupyingRisk` | Count Entry orders that pass the existing `entryOrderOccupiesRisk(order, evaluatedAt)` predicate. Do not derive this from status alone or claim counts. |
| `entryUnknownProofValid` | Count historical Entry UNKNOWN rows whose `hasVerifiedNoActiveRisk(order, evaluatedAt)` proof is valid, identity-tombstone matched, and unexpired at `evaluatedAt`. This count never rewrites the historical row. |
| `activeEntryClaims` | Count active durable Entry claims from `entry_execution_tasks` at the read time, with `status=UNKNOWN` separately exposed as `activeUnknownEntryClaims` if present. This is execution-scope ownership, not a replacement for Entry-order occupancy. |
| `manualUnknown` | Count manual execution/order records whose current status is UNKNOWN in the manual execution domain. Preserve `reduceOnly`, identity and position linkage in bounded detail where needed; this is not an Entry pending count. |
| `tpUnknown` | Count TP order records with UNKNOWN status in the TP domain. Do not infer a TP fill, absence, or coverage from this count. |
| `activeRiskUnresolvedCount` | Compatibility-only aggregate retaining its existing mixed scope: Entry UNKNOWN occupying risk + manual UNKNOWN + TP UNKNOWN. Include `scopeLabel: "ENTRY_MANUAL_TP_MIXED_COMPAT"` and a deprecation note that new consumers must use the scoped fields. Do not present it as Entry occupancy. |
| `snapshotConsistency` | Identify the source snapshot/read consistency. Capture each in-memory collection once and use one `evaluatedAt`. If durable claim storage cannot be read atomically with in-memory reconciliation, state `BEST_EFFORT_CROSS_STORE` and include its read timestamp; do not imply a transactional cross-store snapshot. |

**Expected files:**

- `apps/engine/src/services/reconciliationService.ts`: compute and retain these scoped facts from one captured state view and the shared `evaluatedAt`. Keep current occupancy/proof predicates and the compatibility formula.
- `apps/engine/src/config/settingsStore.ts`: expose the existing durable Entry claim count through a read-only query only if required to name `activeEntryClaims`; do not change its schema or save/release behavior. If the store read has a later timestamp than reconciliation, expose the timestamp/consistency label.
- `apps/engine/src/api/router.ts`: add the fields to the existing read-only reconciliation/closeout response. No write route.
- Tests: `apps/engine/src/services/reconciliationUnknownRisk.test.ts`, `reconciliationCoverageContract.test.ts`, `reconciliationService.test.ts`, and `executionLifecycle.integration.test.ts`.

**Acceptance cases:**

- The accepted replay shape yields `entryUnknownHistorical=47`, `entryUnknownOccupyingRisk=0`, `entryUnknownProofValid=47`, `activeEntryClaims=0`, `manualUnknown=1`, `tpUnknown=0`, and compatibility aggregate `1`, while preserving the manual reduce-only UNKNOWN row.
- Expired proof, mismatched identity tombstone, attributed position, late exchange order/fill, or incomplete remote facts keep the Entry row risk-bearing under the existing predicate.
- Counts and compatibility label are returned together with `evaluatedAt` and truthful snapshot consistency. No test deletes/rewrites UNKNOWN history to make fields agree.
- A consumer inventory records all current uses of `activeRiskUnresolvedCount`; new consumers use scoped fields. Removal of the compatibility aggregate is not part of this scope.

### B2 / R2 — single authoritative numeric admission readback

Make the existing admission evaluator result available end-to-end for both book and candidate scopes. Each response represents one evaluator pass. Every surface showing the same decision must carry the same timestamp, risk generation, snapshot hash, profile/authority versions, gates, ceiling, and first binding from that pass. A book result and candidate result may be separate passes/scopes; they must not be merged or presented as if they were one calculation.

**Required additive response fields:**

- `evaluatedAt` and `scope: "BOOK" | "CANDIDATE"`;
- `riskGeneration`, `snapshotHash`, settings version, profile version, and portfolio risk authority versions/content identity;
- for candidate scope: candidate symbol, side, quote asset, leverage and provenance/fact status;
- completeness/coverage and relevant owner/account/private-fact freshness provenance;
- included pending Entry/reservation lineages with identity, source, status, remaining quantity/notional, reservation/order dedupe link, and whether an UNKNOWN no-risk proof is valid at this `evaluatedAt`;
- every gate item with `name`, `unit`, `used`, `limit`, `headroom`, `candidateImpact`, and `candidateShortfall`; include cluster identity where relevant;
- `maxNewRiskNotionalUsdBySide` and the existing ceiling values;
- the authoritative `firstBinding` result and its exact unit/numbers/detail;
- explicit status distinguishing `AVAILABLE` with positive capacity, valid `ZERO` capacity, and `UNAVAILABLE`/failed admission. `NOT_APPLICABLE` may remain for analysis-only mode, clearly distinguished from available capacity.

For a numeric gate, preserve the source evaluator's unit and values. Where derived for serialization only, `headroom=max(0,limit-used)` and candidate shortfall is `max(0,used+candidateImpact-limit)`. Do not translate `LOSS_USD` or `MARGIN_USD` into notional room in the UI. Size-independent and evidence refusals retain their category and do not receive a fabricated dollar shortfall.

**Expected files:**

- `apps/engine/src/services/admissionCapacityReader.ts`: widen the typed book view to preserve evaluator-returned version, gate, coverage and lineage facts; retain UNAVAILABLE vs valid ZERO.
- `apps/engine/src/services/pipelineVerdict.ts`: carry the exact book-level gate facts and refusal category through its fallback; do not synthesize empty gates/reasons for a populated book refusal or rerank a second cause.
- `apps/engine/src/runtime/appRuntime.ts`, `apps/engine/src/api/projections.ts`, and existing read-only API route(s) in `apps/engine/src/api/router.ts`: serialize the same pass and add fields without a write API.
- `apps/dashboard/src/views/OverviewView.vue`: format the returned facts only. No client-side admission formula, first-cause ranking, or synthesized capacity.
- Tests: `apps/engine/src/services/placeToSubmitCapacityTruth.test.ts`, `pipelineVerdict.test.ts`, `grossRiskCapacityVisibility.test.ts`, relevant projection/API tests, and `apps/dashboard/src/views/OverviewView.capacity.test.ts`.

**Acceptance cases:** book zero due to gross over-limit includes used/limit/zero headroom/shortfall and versions; candidate denial includes candidate impact and candidate shortfall; side ceilings remain separately represented; pending UNKNOWN participates only when the existing proof predicate says it occupies risk; unavailable authority stays distinct from a valid zero; every adapter/dashboard field matches the originating evaluator pass. Keep the five-second memo informational; final `admit()` continues to re-evaluate current facts for JIT authorization.

No second ledger, secondary approval, persisted risk authority, or SQLite schema migration is permitted.

### B3 / R3 — frozen-choice conversion telemetry only

Add bounded, sanitized diagnostics around the existing Primary offered-choice and selection evaluation. This is not an admission input and must not change the candidate/plan result.

**Required telemetry fields:**

- `evaluatedAt` and candidate-set `snapshotHash`/fact identity;
- offered legal candidate IDs and count, plus the offered legal quantity-unit interval(s) (and side/horizon identity needed to interpret the set);
- selected candidate ID and model-selected quantity;
- whether the selected ID/quantity was inside the offered set;
- if rejected, whether one or more other executable legal candidates existed in that same offered set/snapshot;
- a bounded rejection class/code from the existing refusal result.

Do not record prompts, raw model output, account secrets, or unbounded payloads. The event/storage path must be diagnostic-only and cannot feed `PipelineVerdict`, `PortfolioRiskAdmission`, routing, execution readiness, or later automatic retry.

**Expected files, confirmed during implementation against the current tree:**

- `apps/engine/src/services/entryCoordinator.ts` and/or `apps/engine/src/services/tradePlanService.ts`: emit the telemetry from the existing immutable candidate-set and selection/refusal objects without changing them.
- Use an existing bounded diagnostic event/projection path; only add a schema/type field if necessary. Do not persist an unbounded new history table in this scope.
- Tests: `apps/engine/src/services/j3TradePlanHostile.test.ts` plus a focused telemetry contract test at the actual event producer.

**Acceptance tests must prove:** valid telemetry accurately states offered and selected facts; out-of-set selection reports alternatives only from that same evaluated set; changing telemetry sinks does not alter plan bytes or result; quantity, side, target and horizon are unchanged; no second model call/retry occurs; no reservation or order is authorized/created by telemetry; all hard risk/JIT gates still run as before.

## C. Confirmed policy decisions applied by the plan

This section records approved constraints, not open questions:

- Keep the mixed-scope `activeRiskUnresolvedCount` only as the clearly labeled compatibility/deprecated field described by C1/R1; inventory consumers before any future removal.
- A manual reduce-only UNKNOWN alone does not globally block unrelated Entry, per C2; same-identity/position conflict and independent existing safety facts remain binding.
- C3/R3 is observability only. Frozen selection stays immutable; no alternative selection, model retry, or silent resize.
- C4 leaves every approved limit, Settings value, mode, leverage and economics rule unchanged.
- No deployment, lifecycle, exchange write, or production action is included.

## D. Behavior requiring no change

- P2 over-limit semantics: do not forcibly close existing positions; new Entry headroom remains zero while current canonical gross is above the unchanged approved cap.
- Count current Entry positions plus qualifying pending Entry/reservation risk once; an order replaces its linked reservation; preserve unproven UNKNOWN as risk-bearing.
- Preserve matching identity-bound, unexpired no-active-risk proof semantics, durable claim release latch, reservation/idempotency, final JIT admission, verified leverage/margin/stress, market/private freshness, exchange legal filters, ownership, and TP protection.
- Preserve human-notional and unmapped-cluster duplicate suppression when equal to/wider than gross; ACK-age diagnostics; summary-wrapper handling while concrete blockers stay fail-closed; SHADOW statistical economics. The mechanical `$1` / `0.15%` floor remains.
- No threshold widening, policy change, Settings write, invented facts, forced candidate/order/fill, quantity clamp, side switch, target/horizon rewrite, or exchange-filter change.

## Implementation sequence after the next human confirmation

1. Fetch all remotes and start from current `main`. Fast-forward only if the worktree is clean and behind. Do not create a new long-lived branch. Stop if new source changes invalidate this plan's file/test map.
2. Record a read-only baseline and source identity: commit, settings/profile versions, position/pending/proof summary, TP/protection coverage, and observable PID/instance/build identity. No lifecycle or exchange write for collection.
3. Implement R1/B1 scoped reconciliation and tests first. Verify C1/C2 invariants and truthful cross-store consistency labeling.
4. Implement R2/B2 numeric readback through the existing evaluator pass; test book and candidate pass identity, API shape, projection and dashboard formatting. No second authority.
5. Implement R3 telemetry only. Verify the selection/plan output and authorization are byte/behavior unchanged under telemetry capture, rejection, or sink failure.
6. Run all validation locally: focused UNKNOWN/lifecycle, admission/readback, pipeline/projection/dashboard and frozen-choice telemetry tests; `npm run typecheck`; `npm run verify:scripts`; `npm run verify:deps` where affected; complete workspace `npm test` and `npm run build`; and repository `npm run verify` if available/resource-permitting. Record exact commands, exit codes and retained logs. GitHub Actions stay `NOT_RUN_BILLING_LIMIT`.
7. Run the committed S00 replay helper on an explicitly selected offline snapshot. Validate it remains read-only; compare output serialization to the source evaluator; mark unobserved exchange/runtime facts `NOT_RUN_EXTERNAL` rather than inferring them.
8. Review `git diff --check`, clean/status, exact changed file list, tests and evidence. Commit and push only the human-approved implementation and its complete repository evidence to GitHub `main`; fetch again and verify remote `main` contains the pushed commit by fast-forward ancestry. Do not squash, rebase, or force push.
9. Stop after local implementation gates unless separate explicit deployment/lifecycle authorization arrives. A successful local build is not runtime acceptance.

## Runtime acceptance and rollback boundary

No stop/start/restart is authorized by this plan. If a later human explicitly authorizes runtime acceptance for a built change, one controlled stop followed by one `MANUAL_START` is required to prove the new artifact is loaded. Before that authorization is exercised, verify exact `origin/main == local HEAD`, clean worktree, complete local gates, source-to-artifact SHA manifest, old PID/instance/artifact identity, TESTNET/write-lock state, unchanged Settings version, position and TP/protection invariants, and all Entry/manual/TP UNKNOWN facts. If an unresolved fact could be harmed by stopping, stop and report it for human decision.

After the separately authorized transition, record the new PID/instance/source/artifact identity; confirm Settings version unchanged, protected positions/TP coverage intact, UNKNOWN history retained, and no unintended Entry submit. Obtain one timestamped read-only admission readback and verify evaluator/gate arithmetic and hashes. A failed health probe requires reporting/manual intervention; never kill or automatically restart.

Rollback also needs separate explicit lifecycle authorization. Pin the previous validated artifact hash/manifest before deployment. If acceptance fails, restore only that pinned artifact under the authorized manual sequence; preserve runtime data, Settings and UNKNOWN history. Commit the failure/readback/rollback evidence. Do not attempt an unapproved Settings or data migration rollback.

## Persistent repository evidence requirement

This plan revision itself must be committed and pushed to GitHub `main`; after implementation is later confirmed and authorized, **all persistent reports, evidence JSON/CSV/TXT, reusable scripts, tests and gate results, source/artifact manifests, and final conclusions must also be written into the repository and committed/pushed to GitHub `main`**. No required artifact may remain only in a local checkout, temporary directory, or `C:\...`/`D:\...` path. The final implementation report must link committed repository artifacts and state exact commit identities. GitHub Actions remain `NOT_RUN_BILLING_LIMIT`.

## Required stop state

The C1–C4 decisions and R1–R3 plan requirements are now incorporated. This revision is still awaiting human confirmation before any implementation. Stop at `PLAN_READY_FOR_HUMAN_CONFIRMATION`.
