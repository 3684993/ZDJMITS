# V3.9.8 Entry Sizing & Risk Budget Plan
Status: DESIGN_ONLY / NOT AUTHORIZED FOR LIVE STRATEGY OR ORDER CHANGE
Baseline: cf7007a5c6d722a4c86354f3405c7565be3a8236

## Objective
Keep Primary as Entry authority. Prevent excessive initial quantity/notional under higher-timeframe direction-extremity, volatility and correlated portfolio exposure. New user instruction: **prohibit all separate add-ons / averaging**; do not permit auto risk-increasing orders after initial authorization. Study TP reprice separately and respect HUMAN_MANAGED authority.

## Phase 0 — read-only source and fact contract
Confirm main and CI with workflow runs (commit-status endpoint alone insufficient). Map all callers around allocation, candidate envelope, frozen trade plan, Primary PLACE, pre-submit reservation, exchange order, execution fill, owner/TP, and any legacy/add-on flows. Audit minimum-initial-margin and absolute minimum-profit floors: smaller risk-adjusted quantity may fall below the currently hard economic floor; DO NOT silently escalate size above risk bound to clear profit target. Collect TESTNET read-only snapshots with bounded scripts, redacted outputs, content SHA256, source times, exact quote assets, safe no-write proof, preserving SQLite. Commit all approved nonsecret scripts/evidence to repository.

## Phase 1 — immutable point-in-time exposure reconstruction
For every open/closed physical cycle: origin and each historical add, order/intent/PRIMARY run/time/plan-version/fill-stage, quantity, execution price, leverage, source price, fees/funding coverage, TP/owner change, open inventory and gross/net/asset/factor exposure *as of each decision*. Use completed weekly candles only, no current unfinished weekly bar leakage. All exchange and private snapshots carry asOf, observedAt, freshness/coverage. Protect canonical vs noncanonical eligibility.

## Phase 2 — rule/parameter-free research design
Eight arms: baseline original, uniform haircut, linear location, nonlinear regime-aware location, vol targeted, stress-loss constrained, cycle budget, directional portfolio budget, hybrid. Treat all historical adds under no-add policy counterfactual as quantity 0 for separate add authorizations, while distinguishing same-origin partial fills/retries. Research two alternative hybrids: min of independent stress/capital/factor upper bounds with soft risk-pref adjustment vs multiplicative approach with carefully checked dependence/double counting. Build stress scenarios by adverse side, horizon and regime; use conservative missing-data bounds, don't label estimated stress as certain maximum.

## Phase 3 — constrained executable candidate design (requires new authorization)
Compute risk-adjusted feasible quantity envelope BEFORE candidate set freezing / PRIMARY decision. Do not re-introduce Direction/Cluster/Historical/Stress subjective post-PLACE veto. Physical/exchange/funds, scope/idempotency and private data remain fail-closed. If risk bound is smaller than min legal/strategy admissible quantity, mark no feasible executable quantity with explicit structured explanation; do not inflate to meet absolute TP profit. No new after-fill order authority. Preserve TP identity and human ownership.

## Phase 4 — tests and scientific gates
Property tests for size monotonicity under additional exposure/stress, no cash/asset mixing, exact step/tick and margin floors, identical as-of inputs produce identical output, UNKNOWN conservatism, order idempotency, no extra adds, owner handoff, TP reprice no quantity increase. Purged chronological out-of-sample with block bootstrap and separate extreme-market windows; compare downside-tail reduction AND opportunity loss, winning-trade contraction, capital turnover, time-under-water and unclosed inventory. Underpowered/uncertain cohorts remain nonconclusive; canonical net-funding eligibility gated by exact proof. Shadow first, no order writes. Any rollout needs separate TESTNET deployment authorization and independent Reactivity gate.

## Milestones
M0 document & code audit → M1 bounded snapshot and lot-level exact coverage table → M2 PIT replay with missing-data accounting → M3 pre-registered policy comparison and holdout → M4 authority-safe candidate design review → M5 optional shadow/prospective experiment after explicit approval. First-round unresolved: no fresh TESTNET live positions, no fully traced allocation caller chain, no quantitative policy outcome.

## Immutable scope
No strategy/Settings/Engine lifecycle/SQLite/order modifications in current phase. No production writes; no secrets in repo; F04/F10/F11 and 6.14s Reactivity analysis remain paused. Keep all nonsecret files and logs under versioned evidence paths in main or reviewed branch, never only local ephemeral files.
