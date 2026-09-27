# V3.9.6 Final Controlled Runtime Acceptance

## State
`READY_FOR_EXPLICIT_LIFECYCLE_AUTHORIZATION`

This runbook is the final deployment/runtime-acceptance phase after `V396_UNKNOWN_PROOF_PREDICATE_FIXED_LOCAL_PASS`.

Current GitHub main at creation time: `5b03230cf865b36c424002291bad2472e887bae9`.
Product fix parent: `4d0d9ad655aae9cef991e3f98ebd8c0690d8c5a7`.

This file itself does **not** authorize lifecycle action. Execute only after the user explicitly authorizes exactly one controlled `stop -> MANUAL_START`.

## Goal
Deploy the final V3.9.6 source from the latest `origin/main`, prove that the new runtime actually loaded it, and perform one read-only runtime acceptance covering R1/R2/R3 plus the UNKNOWN-proof hardening.

Do not perform more source redesign unless runtime evidence proves a real defect.

## Hard boundaries
- TESTNET only.
- Production writes must remain 0 / Production boundary locked.
- No Settings changes.
- No approved risk-threshold changes.
- No Primary prompt/decision-contract changes.
- No forced PLACE/submit/fill and no synthetic exchange activity.
- No automatic restart, watchdog, guardian, service installation, hot reload or autostart.
- No GitHub Actions; record `NOT_RUN_BILLING_LIMIT`.
- Preserve UNKNOWN history and runtime data.
- Preserve the dirty V3.9.5 worktree and its 48 status entries.
- One lifecycle transition only: one stop, then one `MANUAL_START` through `scripts/start-zdj-lan.ps1`.
- If any precondition fails, STOP before lifecycle and report the blocker. Do not repair by changing Settings/data.

## Phase 0 — exact source and artifact closure before stop
1. `fetch --all --prune` and verify clean current worktree.
2. Verify `local HEAD == origin/main`; record exact SHA. Do not assume the creation-time SHA if main has advanced.
3. Re-run/reuse local gates only if the source tree is byte-identical to the fully validated tree. If any product/test/build-input file changed after the validated fix, rerun the required full local gate set before lifecycle.
4. Build the deployable artifact from the exact current main source using the repository-approved build path.
5. Generate a fresh source/build identity manifest for the exact artifact that will be deployed. Do not blindly reuse the earlier `3.9.6-08575...` artifact identity if the rebuilt bytes differ.
6. Record source SHA, source/tree hash, buildId, artifact SHA-256, build timestamp and deploy path.
7. Pin the currently loaded rollback artifact/receipt without modifying or deleting it.

## Phase 1 — read-only pre-stop snapshot
Before stopping anything, capture one bounded timestamped snapshot:
- current PID / instanceId / startReason / buildId / sourceHash / artifactHash where exposed;
- Settings version and risk-profile versions;
- TESTNET / Production-lock state;
- positions and TP coverage with domain/quantity/status consistency;
- Entry UNKNOWN: historical, occupying-risk, proof-valid, active claims, active UNKNOWN claims;
- manual UNKNOWN and TP UNKNOWN separately;
- compatibility mixed counter with its scope label;
- current pending Entry/reservations/orders;
- current BOOK admission readback, including status, evaluatedAt, snapshotHash, generation, versions, side ceilings, all gate units/numbers and first binding;
- current gross used/limit/headroom, without changing it.

The running process may still be the old artifact. Label all pre-stop data as OLD_RUNTIME and do not claim it validates the new source.

### Mandatory pre-stop safety checks
Do not stop if any of the following cannot be established:
- every live position remains protected according to the repository's current protection invariant;
- no lifecycle action would discard an in-flight local-only mutation or unreconciled write intent;
- runtime data directory and rollback artifact identity are known;
- Production boundary remains locked and deployment target is Testnet;
- current Settings version is captured;
- current UNKNOWN/manual/TP facts are captured without deleting or rewriting history.

A manual reduce-only UNKNOWN may remain unresolved; report it by domain. Do not relabel it as Entry exposure.

## Phase 2 — exactly one lifecycle transition
Only after explicit user authorization and all preconditions pass:
1. Stop the current Engine once using the repository-approved manual procedure.
2. Do not run any automatic restart loop.
3. Deploy/use the exact artifact built and hashed in Phase 0.
4. Start exactly once using `scripts/start-zdj-lan.ps1` with start reason `MANUAL_START`.
5. If start fails or health is not READY, stop automation and report. Do not kill/restart repeatedly.

## Phase 3 — loaded-runtime identity proof
After the new process is healthy, record:
- new PID;
- new instanceId;
- startReason = `MANUAL_START`;
- runtime buildId;
- runtime sourceHash;
- runtime artifactHash;
- data directory;
- environment/Testnet/Production-lock state;
- Settings version.

Acceptance requires the runtime identity to match the exact Phase-0 build manifest. A copied artifact, local build PASS or source checkout alone is not sufficient.

## Phase 4 — R1 / UNKNOWN-proof runtime acceptance
Read only; do not force reconciliation outcomes.

Prove the new scoped readback exists and is internally consistent:
- `entryUnknownHistorical`;
- `entryUnknownOccupyingRisk`;
- `entryUnknownProofValid`;
- `activeEntryClaims`;
- `activeUnknownEntryClaims` if present;
- `manualUnknown`;
- `tpUnknown`;
- compatibility `activeRiskUnresolvedCount` with mixed-scope label.

Verify malformed-proof semantics using code/build identity plus the committed regression evidence; do not inject malformed rows into live data.

For current real persisted rows, confirm:
- valid strict proofs remain proof-valid;
- expired/malformed proof is not allowed to release current Entry risk/claim;
- startup/hydration merge does not resurrect stale absence evidence over newer facts;
- no UNKNOWN history was deleted or rewritten merely for acceptance.

If the known old durable/runtime duplicate populations converge through normal startup rules, record the exact before/after counts and identities. Do not force-write a convergence.

## Phase 5 — R2 authoritative admission readback
Capture one current BOOK result and, if naturally available without forcing a trade, representative CANDIDATE result(s).

Verify:
- BOOK and CANDIDATE scopes are distinct passes;
- `AVAILABLE`, `ZERO`, `UNAVAILABLE`, `NOT_APPLICABLE` remain distinct;
- gate values keep their units (`NOTIONAL_USD`, `MARGIN_USD`, `LOSS_USD`, count/evidence);
- used/limit/headroom/candidateImpact/candidateShortfall are dimensionally correct;
- firstBinding and gate arrays come from the same evaluator pass;
- dashboard/API do not rerank/recalculate another authority;
- current gross over-limit, if still true, is reported as `POLICY_BINDING` with zero new Entry headroom rather than as an observability or UNKNOWN error.

Do not change limits to obtain positive capacity.

## Phase 6 — R3 frozen-choice telemetry acceptance
Only observe natural Primary activity after startup. Do not force a model call or trade.

When naturally emitted, verify:
- PRE_PRIMARY_VISIBLE contains only facts actually visible before Primary;
- candidate IDs remain NOT_APPLICABLE/IDS_NOT_YET_EXISTING pre-Primary;
- POST_PRIMARY_GENERATED contains bounded generated candidate IDs/intervals;
- mapping checks use the full generated legal set even when detail output is bounded;
- refusal telemetry truthfully reports whether an alternative generated legal candidate existed;
- telemetry failure path cannot alter decision/quantity/side/target/horizon, trigger a second Primary call, reserve risk or authorize an order.

If no natural Primary event occurs during the bounded observation window, mark R3 runtime-event evidence `NOT_OBSERVED`, not failed. Source/regression acceptance remains separate from live incidence.

## Phase 7 — place-to-submit/runtime behavior
Do not manufacture orders.

Observe the natural pipeline only. For every naturally occurring PLACE that does not reach submit, require one necessary, independent, quantified hard blocker or an explicit execution-correctness/evidence blocker.

If canonical gross remains above its approved cap, zero Entry capacity is expected and is not a deployment failure.

Production writes must remain 0. Record any Testnet write individually if natural execution produces one.

## Phase 8 — final acceptance artifacts
Commit/push all retained evidence to GitHub `main` under:
`docs/reports/v396-final-runtime-acceptance-20260927/`

At minimum:
- `REPORT.md`;
- `runtime-before.json`;
- `runtime-after.json`;
- `source-build-runtime-identity.json`;
- `unknown-scoped-readback.json`;
- `admission-readback.json`;
- `r3-runtime-observation.json` (or explicit NOT_OBSERVED record);
- protection/TP evidence;
- lifecycle receipt with exact one-stop/one-start sequence;
- final acceptance summary.

All persistent evidence must be in GitHub; do not finish with only local `C:\...` / `D:\...` paths.

## Final response contract
Do not return only a status code. State:
- final status;
- deployed Git SHA;
- buildId/sourceHash/artifactHash;
- old/new PID and instanceId;
- Settings version;
- positions/TP protection result;
- scoped UNKNOWN result;
- current authoritative Entry blocker/capacity;
- Production/Testnet write result;
- whether any R3 natural event was observed;
- GitHub report path and final commit SHA.

Final status must be one of:
- `V396_FINAL_RUNTIME_ACCEPTED`
- `V396_FINAL_RUNTIME_BLOCKED`

If blocked, give the exact blocker and do not attempt another restart without new explicit authorization.
