# V3.9.8 Entry Sizing Quality Review — Round 1
Status: RESEARCH_ONLY / NO_STRATEGY_CHANGE / NO_RUNTIME_DEPLOYMENT
Read baseline: main cf7007a5c6d722a4c86354f3405c7565be3a8236 (2026-10-08).

## Authority and scope
Read CHATGPT_V398_ENTRY_QUALITY_OPTIMIZATION_START.md, CURRENT_MAINTENANCE_HANDOFF.md, TRADE_ENTRY_EXIT_QUALITY_REVIEW.md, V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md, P0_FACT_LAYER_IMPLEMENTATION.md, quantityHorizonCandidates.ts, v397FrozenSizing.ts and entryLineage.ts.
User's **newer and overriding instruction**: NO ADD-ONS / NO AVERAGING / NO AUTOMATIC POSITION INCREASE after origin-entry authorization. Preserve historical add lots as immutable evidence. Partial fills of a single authorized quantity and exact-idempotent recovery are not automatically new add authorizations. TP price changes may be studied with existing ownership and TP protection.
Primary remains sole Entry authority; risk sizing must be in frozen candidate generation or previously authorized deterministic executable quantity bounds, not an after-PLACE subjective veto. TESTNET-only, Production writes 0 target, no lifecycle/exchange/storage/Settings changes. F04/F10/F11 and Reactivity remain separately paused.

## Main and evidence state
main is 3 commits ahead of b65883d5e6435071acacd81e57d1921fc35a3574: 64fdf695 (topic prompt), 42334c4 (P0 changes), cf7007a5 (P0 evidence closeout); no behind commits. Latest main P0 source change is NOT DEPLOYED. P0 report documents first full verify S00 inventory mismatch, followed by corrected S00 / full typecheck / build / tests PASS 237 files / 2047 tests, final targeted 82 tests plus Engine typecheck/build PASS. This is not a successful new complete hosted Actions run. Commit status endpoint returned no statuses; commit workflow run endpoint returned no PR-triggered runs, insufficient to claim all GitHub Actions passed. Latest P0 host evidence: Engine 8080 not listening at 20:07 +08, no restart; current live status not proven. Older stable Reactivity FAIL and 6.14s stall UNKNOWN. Frozen P0 closed cohort 165, canonical net eligible 0, funding UNKNOWN 165, full lot lineage EXACT 33 / UNCERTAIN 132; frozen data not fresh current TESTNET account state.

## Sizing source findings (verified)
- `v397FrozenSizing.ts`: `minimumQuantityForTarget` raises quantity to satisfy exchange/business notional, at least 100 quote initial margin, leverage between 10 and 20, and conditional target-profit economics; upper bound derived from available margin × leverage. The solver can select a larger quantity to satisfy an absolute profit floor. This reveals a potentially countervailing incentive against shrinking sizes; quantify before design.
- `quantityHorizonCandidates.ts`: builds frozen executable candidate sets with up to four quantity ladder rungs and horizon/target candidates, uses `minimumQuantityForTarget`; exposes risk facts including capitalAtRiskUsd, grossNotionalAfterUsd, longNotionalAfterUsd, shortNotionalAfterUsd and clusterNotionalAfterUsd. These fields' *admission authority* and precise upstream calculation still need full caller examination. Do not assert live veto from type names.
- `entryLineage.ts`: exact per-lot intent→order→fills→TradePlan→completed PRIMARY run projection; checks timestamps, quantities, TP version, model/context identity. Distinguishes physical position cycle from plan cycle, no origin-run or final VWAP backfill. Critical for point-in-time replay.
- Historical 25 AVAX and 5 ETH adds do not by themselves prove their current approval path; need exact order/intent/run/ownership chronology and current live behavior.

## Case investigation status
ETHUSDT LONG: user-observed first fill 2026-10-05 14:57:18; five adds; about -261.65 USDT / -65.76% at observation. AVAXUSDT SHORT: first fill 2026-09-20 00:10:45; 25 adds; observed peak loss about -1000 USDT and later -298.59. Both numbers are historical user observations, not a fresh exchange PnL read. Position original/add quantities, notional, price point-in-time and peak loss intervals have NOT been replayed in round 1; no counterfactual numerics asserted.

## Candidate policies and initial evaluation
1. Uniform haircut: control baseline; shrinks all opportunity and tail risk indiscriminately, no control of aggregate correlated exposure.
2. Linear location scaling: interpretable, but percentile high/low alone confuses strong breakout with exhausted trend.
3. Nonlinear / spline / sigmoid location scaling: preferred research *soft* location-response candidate conditioned on trend and regime, but not a hard protection against correlated systemic stress.
4. Volatility targeting: scales common currency risk; sensitive to stale/too-short vol window, regime jumps and gap tails.
5. Stress-loss budgeting: scenario adverse-move × inventory notional + execution costs, calibrated by side/time/regime; scenario not an exchange stop-loss guarantee.
6. Cycle cumulative budget: one frozen origin authorization budget and lot-level ledger; with new NO-ADD policy subsequent separate add authorizations are invalid regardless of remaining budget; budget still informs risk reviews/counterfactual legacy replay.
7. Portfolio directional/correlation budget: limit marginal same-side/correlated crypto-beta stress exposure, separated by USDT/USDC and source/FX proof. Use conservative stress scenarios when correlation estimate unreliable.
8. Hybrid: recommend researching `min` of independent executable risk envelopes (funds/exchange, cycle stress, portfolio marginal stress, correlated factor stress), with soft location/regime adjustment to *budget* or base opportunity proposal. Do not blindly multiply correlated discounts.

## Proposed definitions (experimental; no calibrated parameters)
- `HigherTimeframeLocationScore`: as-of closed weekly price percentile/range and robust EMA/ATR extensions with 26w/52w coverage and anchor identity, paired with 1D/4H trend strength/slope/regime.
- `DirectionalExtremityRisk`: long upper-tail or short lower-tail location × exhaustion/regime uncertainty; positive-trend breakout is not automatically bearish.
- `CycleRiskBudget`: cumulative incremental downside scenario obligation of one physical cycle; new instruction forbids automatic separate adds.
- `PortfolioDirectionalRiskBudget`: cap *marginal portfolio scenario loss* from candidate against current open positions and same macro factor; include gross/net and hedge basis risks separately.
- `StressMovePct`: historical side-adverse tail by horizon/regime with coverage and uncertainty, not merely ATR or formal CVaR when history insufficient.

## Missing facts / blockers
Need current TESTNET read-only snapshot, TradeRecord and lot/order/fill/PRIMARY/allocation/owner/TP chain, exact post-PLACE authority, fresh 1w/1d/4h/1h/15m closed bars for each historical decision cutoff, financing and quote-asset ledgers, portfolio inventory at each prior origin and add timestamp. Mark source freshness and missing coverage; avoid keys/tokens. Neither GitHub code nor frozen local evidence establishes current Engine execution state. No live exchange/SQLite accessed in this round. No active strategy change or comparative PnL result yet.

## Required validation
Bounded lossless snapshot and hashes; first-fill lot accounting and quantity conservation; identical policy replay across chronological purged walk-forward, block bootstrap, regime grouping; no lookahead, no future VWAP/quantity, open losers retained/right censored. Compare net/funding-qualified results separately from noncanonical MAE/stress; report CVaR, worst tails, maximum portfolio drawdown, size opportunity cost, quote/margin, stress, manual intervention, directional skew and data coverage. Unproven funding stays UNKNOWN. No quantitative optimum until evidence satisfies coverage gates.
