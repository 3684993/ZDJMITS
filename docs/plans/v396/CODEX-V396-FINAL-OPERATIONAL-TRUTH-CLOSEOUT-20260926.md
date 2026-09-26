# CODEX V3.9.6 — Final Operational Truth Closeout

Date: 2026-09-26
Branch: `codex/v396-final-convergence-20260922`
Baseline before this runbook: `2df658b4ded099fa5ed7838abcf25376ed9d7bef`
Target final marker: `V396_FINAL_OPERATIONAL_TRUTH_CLOSED`

## 0. Mission and operating boundary

This is the final convergence round. Work directly on the current branch, solve the problems below, add/adjust tests, run every acceptance gate locally, formal-build, then perform one controlled local lifecycle and online Testnet validation.

Do not stop at diagnosis and do not return another existence-only report. If implementation details, tests, types, build, migration, runtime readback, or nearby defects tied to these root causes are encountered, solve them in this same round unless doing so would require changing a frozen product/risk policy.

GitHub Actions / hosted CI is **not an acceptance path** in this round because the account currently cannot start hosted jobs. Record it as `NOT_RUN_BILLING_LIMIT`. Do not reduce local gates because hosted CI is unavailable.

PR #9 must not be modified, commented on, rebased, or used as a work target.

## 1. Problem A — authoritative risk-admission primary state is incomplete

G1–G4 acceptance proved the upstream pipeline can be healthy while every new Entry cycle is rejected by deterministic risk admission, yet the cockpit's authoritative primary code can still be `NONE`.

Current legitimate live blockers include `HUMAN_POTENTIAL_NOTIONAL_LIMIT` and stress limits such as `STRESS_LIMIT:MAX_GROSS/CLUSTER`. Those blockers are not bugs and must remain enforced.

Required outcome:
- Engine truth must expose one current authoritative primary stage/code/action when deterministic risk admission is the first reason Entry cannot proceed.
- A risk-admission rejection must not be rendered as primary `NONE` merely because market/candidate/model infrastructure is healthy.
- The state must self-clear when that rejection no longer exists; no stale historical blocker may remain primary.
- Dashboard must consume Engine truth rather than create an independent primary-priority algorithm.
- Secondary diagnostics may coexist, but they must never become a second competing primary reason.

Choose the cleanest implementation compatible with the existing pipeline contracts; do not add another parallel authority model.

## 2. Problem B — margin-tier authority coverage is incomplete for routable candidates

Live evidence still contains `MARGIN_TIER_SYMBOL_UNPROVEN:ZROUSDT` and `MARGIN_TIER_SYMBOL_UNPROVEN:1000BONKUSDC`.

Determine whether this is caused by collector coverage, refresh/freshness, routable-universe synchronization, symbol normalization, authority compilation, or genuinely unavailable exchange facts, and close the software defect if one exists.

Required truth semantics:
- Never infer a margin tier, maintenance tier, or leverage from symbol suffix, a global leverage setting, a neighboring symbol, or a fabricated default.
- A candidate known to lack required authoritative tier facts must be rejected/isolated deterministically before an expensive model call when feasible.
- One unproven symbol must not globally suppress healthy candidates.
- If Binance Testnet genuinely cannot supply authoritative facts for a symbol, explicit symbol-local quarantine/fail-closed with the exact reason is an acceptable final state; do not falsely mark it verified merely to obtain a green result.
- If the problem is missing coverage for a fact Binance does provide, repair the collection/coverage path and prove it with tests/readback.

## 3. Problem C — TP protection truth conflicts with `NO_LIVE_POSITION`

Current readback reports 8 positions/items as `TP MISSING`, while submission is blocked by `REDUCTION_PROOF_NO_LIVE_POSITION`.

Investigate the underlying authoritative position/reconciliation facts and remove any false or ambiguous status presentation.

The final model must distinguish at least these realities without conflating them:
1. A proven live position exists and required TP/protection is genuinely missing.
2. Authoritative exchange facts prove no live position exists, so a reduce-only TP must not be submitted and the item must not be presented as an unprotected live position.
3. Position existence/ownership is unresolved, so the system must remain fail-closed and visibly unresolved rather than claiming `PROTECTED` or proven absence.

Do not create a reduce-only order without a proven live position. Do not fabricate protection. Do not delete audit history merely to clean the cockpit. Reconcile stale local state safely if that is the root cause.

The XRP manual-order UNKNOWN mentioned in the prior report is evidence to inspect, not a mandate to force-resolve UNKNOWN. Preserve the existing conservative UNKNOWN semantics.

## 4. Problem D — semantic no-op startup changes `settingsVersion`

The last round observed a 917-leaf settings comparison with no semantic change other than `settingsVersion`, which advanced on startup (`217 -> 218`) through an existing idempotent/empty-diff write path.

Verify the root cause. If startup produces no semantic settings mutation, it must not create a new settings version merely because the process restarted.

Required outcome:
- A true semantic no-op does not increment `settingsVersion` and does not create false mutation lineage.
- A real migration/default/backfill that changes settings must still version and audit normally.
- Preserve CAS, governance acknowledgement, JIT/version binding, and settings audit safety.
- Add regression coverage proving repeated no-op startup/readback is stable while real changes still advance the version.

Do not hard-code the observed version numbers.

## 5. Explicit non-bugs / frozen decisions

Do **not** solve the round by weakening any of the following:
- negative human notional headroom or `HUMAN_POTENTIAL_NOTIONAL_LIMIT`;
- `STRESS_LIMIT:*`, PortfolioRisk, gross/direction/cluster safety, slot caps, liquidation/maintenance facts;
- overdue human handoff acknowledgement (do not auto-ack);
- `takeProfit.minNetProfitUsd=1`;
- `minNetProfitRoiPct=0.15`;
- `aiExitLossLimitUsd`;
- reachability/economic thresholds;
- JIT/freshness/fail-closed rules;
- durable UNKNOWN semantics or UNKNOWN -> 0 shortcuts;
- `aiExitAuthority=SHADOW`;
- Testnet-only write boundary;
- Production lock / Production writes = 0.

Do not force PLACE/Submit/Fill, alter prices, loosen thresholds, fabricate market facts, or add model calls only to manufacture acceptance evidence.

Existing open positions and TP/protection must remain protected throughout the round.

## 6. Tests and acceptance gates — local only

Add focused red-to-green regression tests for every behavior changed in Problems A-D, including negative/fail-closed cases. Then run the relevant neighboring tests and the full repository gates used in the previous round.

At minimum record command + exit code + counts/results for:
- targeted tests for A-D;
- `packages/core` full tests;
- Engine full tests;
- Dashboard full tests;
- contracts tests (if still zero files, record exactly that; do not claim coverage);
- workspace typecheck;
- `verify:deps`;
- `verify:scripts`;
- S00 T01-T06 / entry review;
- storage coverage verification;
- `git diff --check`;
- formal production build.

If legitimate new scripts/files alter a repository manifest/gate, update it using the repository's existing deterministic mechanism and preserve the gate's policy. Do not bypass the gate.

GitHub Actions: `NOT_RUN_BILLING_LIMIT` only. Do not trigger or wait on hosted CI.

## 7. Final lifecycle authorization

This final round grants exactly **one** new controlled lifecycle after all source changes are committed and all local tests/gates/formal build are green:

1. `scripts/stop-zdj-lan.ps1`
2. prove the old PID is gone and port 8080 is released
3. `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`

Maximum: one stop + one MANUAL_START. No second restart, pure retry, hot reload, watcher, watchdog, service, supervisor, or autostart.

If the one start fails, preserve the evidence and report the failure rather than cycling restarts.

## 8. Post-start identity closure

Prove all of the following refer to the same delivered state:
- remote branch HEAD;
- local HEAD;
- source/commit provenance used by the formal build;
- artifact/build hash and buildId;
- running instance identity/source hash;
- restartCount/startReason/PID.

The working tree must be clean at handoff, and product source must not silently change after the formal build used for deployment.

## 9. Online Testnet acceptance

Use natural traffic/readback only. Do not force a trade.

Prove, as applicable:
- When deterministic risk admission is the first current blocker, the authoritative primary state names the risk-admission stage/reason rather than `NONE`, and it self-clears when conditions change.
- Secondary diagnostics remain subordinate to the single primary state.
- Margin-tier-unproven symbols are either authoritatively covered or explicitly symbol-local fail-closed/quarantined; healthy candidates are not globally suppressed and known-unproven candidates do not waste model calls.
- TP/protection presentation agrees with authoritative live-position truth; proven no-position is not falsely shown as an unprotected live position, unresolved remains unresolved, and no unsafe reduce-only submit occurs.
- A pure restart/no-op startup does not advance `settingsVersion`; if the version changes, show the actual audited semantic diff that justified it.
- Production writes = 0 and blocked Production write attempts remain 0.
- Testnet remains locked to Testnet; Entry Safety remains AUTO unless an existing legitimate fail-safe changes it.
- `aiExitAuthority=SHADOW` remains unchanged.
- Existing risk/economic settings remain unchanged except an explicitly necessary, audited schema migration that does not loosen policy.

No natural reservation/submit/fill is required for PASS when a legitimate risk gate currently forbids new Entry. Correctly exposing that hard gate is valid evidence.

## 10. Final report and handoff

Write the final report to:
`docs/reports/v396-final-operational-truth-closeout-20260926.md`

Include:
- commits and changed files;
- root cause and final behavior for A-D;
- targeted and full local gate evidence;
- hosted CI = `NOT_RUN_BILLING_LIMIT`;
- settings before/after semantic diff;
- lifecycle count and identity closure;
- online Testnet readback;
- Production/Testnet write counters;
- remaining legitimate blockers, explicitly separated from defects;
- any item that could not be naturally exercised, clearly labeled unobserved rather than passed.

Push the branch by normal fast-forward only. Keep PR #9 untouched.

Final marker may be emitted only when the implementation, local gates, formal build, identity closure, and truthful online acceptance above are satisfied:

`V396_FINAL_OPERATIONAL_TRUTH_CLOSED`

If one item cannot close without weakening a frozen policy, do not weaken it. Return the single factual blocker and the evidence instead.