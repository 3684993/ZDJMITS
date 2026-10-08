# Codex — TradeRecord / Current Position / TP / Qwen Entry-Exit Quality Review

> ANALYSIS-ONLY task. Do not implement strategy changes in this run.
> Do not interrupt the currently active Engine reactivity remediation. Execute this task only after that run is complete and latest main is fetched.
> Branch carrying this request: `chatgpt/trade-entry-exit-quality-review-20261008`.
> Baseline when request was prepared: `69486283bcaeb50a2d65b846ce4fd20b1109105a`.

## Goal

Perform a factual postmortem of:
1. the two user-manual closes below;
2. all currently open positions and their TP state;
3. recent closed TradeRecords and linked AI decisions;
4. whether holding periods and TP placement are systematically too long/far;
5. how the active Qwen PRIMARY model (user refers to **Qwen3.8 27B**; verify the exact active resource/model identity rather than assuming the label) should receive better decision context and feedback for higher Entry and Exit quality.

The only implementation output in this run is a **detailed optimization implementation plan document**. Do not change Settings, strategy parameters, model configuration, TP policy, Entry policy, or place/cancel/modify orders.

## User-observed cases that must be reconstructed exactly

### AAVEUSDT
- LONG
- opened: 2026-10-08 11:01:07
- manually closed: 2026-10-08 17:07:03
- entry average: 175.79
- exit average: 172.79
- quantity: 11.4
- displayed PnL: -$35.39
- displayed close provenance: SYSTEM_MANUAL / “系统人工操作”

### ETHFIUSDC
- LONG
- opened: 2026-10-08 09:43:54
- manually closed: 2026-10-08 17:06:17
- entry average: 0.7285578247867989
- exit average: 0.7240821741056598
- quantity: 3611.6000000000004
- displayed PnL: -$16.59
- displayed close provenance: CONFLICT / “来源冲突”

Both were manually closed by the user. Explain why the provenance presentation differs.

Current code semantics to verify against runtime facts:
- `tradeCloseProvenance()` collects roles from the durable order-provenance registry and compatibility matches against `manualOrders` / `tpOrders`;
- exactly one MANUAL role -> SYSTEM_MANUAL;
- more than one role -> CONFLICT;
- therefore do not “fix” ETHFI merely by relabeling it. Prove which exact identities/roles produced the conflict.

## Part 1 — exact provenance reconstruction

For AAVEUSDT and ETHFIUSDC, collect and correlate read-only evidence:
- TradeRecord raw record + projected row;
- `exitOrderIds`;
- `linkedFillIds`;
- all linked `executionFills`;
- exchange orderId/clientOrderId;
- `manualOrders`;
- `tpOrders`;
- order provenance registry rows and `resolve()` proof;
- runtime events around the close;
- user-data WS/exchange-audit origin where retained;
- cycleId / positionId / intentId / orderId linkage;
- whether a working TP existed/canceled/filled/unknown near the manual close.

Produce an identity table per close:
`fill -> exchange/client id -> registry role -> manual match -> TP match -> final closeProvenance`.

For ETHFIUSDC, identify the exact extra role(s) causing `CONFLICT`. Distinguish:
- real dual-role identity conflict;
- stale TP row falsely matching the manual close;
- registry/durable manual duplication;
- same exchange identity associated with two local objects;
- historical repair artifact;
- read-model aggregation bug.

Do not infer manual provenance from taker/maker flags or time proximity.

If this is a code/data-projection defect, describe the minimal safe correction and required regression tests in the final plan, but do not implement it in this analysis task.

## Part 2 — current open-position TP review

Take a fresh read-only snapshot of every currently open TESTNET position and its protection.

For each position produce:
- symbol / side / quote asset;
- openedAt and current holding duration;
- entry average price;
- mark/current executable price;
- quantity, leverage, margin/notional;
- unrealized PnL and return on margin where factually available;
- current TP order identity/status/price/qty;
- TP distance from entry (% and absolute);
- remaining TP distance from current price;
- estimated gross TP PnL;
- fees already paid + expected exit fee;
- funding paid/accrued/unknown;
- **net TP payoff after known costs**;
- current MAE/MFE since entry;
- time to MFE and time spent below/above entry;
- 1m/5m/15m volatility/ATR or equivalent robust range measure;
- TP distance normalized by realized volatility;
- whether TP is statistically plausible within the intended holding horizon;
- whether the position has exceeded the Entry model's implied/explicit horizon;
- TP provenance/coverage health and any UNKNOWN/unverified periods.

Do not use a single static percentage as the conclusion. Evaluate whether TP distance is aligned with:
- volatility/regime;
- expected holding horizon;
- spread/slippage/fees/funding;
- leverage and margin;
- recent MFE distribution;
- liquidity/executable price.

Flag positions where TP is so far that expected time-to-hit is inconsistent with the intended trade horizon.

## Part 3 — recent TradeRecord retrospective

Use a meaningful recent sample, preferably at least the recent rolling week and all canonical closed cycles available without expensive/unbounded scans.

For each eligible cycle link:
- Entry model run / normalized Primary decision;
- candidate/ranking evidence available at Entry;
- entry time/price;
- fill delay/slippage;
- TP selected at or after entry;
- MFE/MAE path after entry;
- time to MFE;
- holding duration;
- exit type: TP / system exit / manual / exchange / conflict / unknown;
- gross PnL;
- fees;
- funding;
- formal/canonical net PnL if eligible;
- manual intervention reason if evidence exists.

Analyze distributions, not only anecdotes:
- win rate;
- median/mean holding duration;
- profitable vs losing holding-duration distribution;
- TP-hit rate;
- manual-close rate;
- manual-close PnL;
- MFE captured vs MFE given back;
- MAE before eventual winners;
- TP distance vs realized volatility;
- time-to-TP;
- trades whose MFE would have supported a nearer TP;
- trades that never achieved enough MFE to cover fees;
- quote asset breakdown USDT vs USDC;
- symbol/regime breakdown where sample size permits.

Do not include noncanonical or provenance-conflicted records in formal model-quality metrics without a separate uncertainty bucket.

## Part 4 — Entry quality review for the Qwen PRIMARY model

Verify the actual active PRIMARY model/resource identity first. The user refers to it as Qwen3.8 27B.

For each recent Entry, compare the model's decision context and output with the subsequent path.

Determine whether poor outcomes are caused primarily by:
- entering too late after a move;
- weak trend/regime alignment;
- poor volatility/liquidity selection;
- insufficient reward-to-cost;
- overly optimistic expected move/horizon;
- direction error;
- insufficient distinction between mean-reversion vs momentum setup;
- failure to account for already-crowded portfolio/quote asset exposure;
- stale/incomplete market facts;
- model decision quality vs execution/TP management quality.

Derive post-entry labels that can feed future reasoning, such as:
- MFE_5M / MFE_15M / MFE_1H;
- MAE_5M / MAE_15M / MAE_1H;
- TIME_TO_MFE;
- TP_REACHABLE_WITHIN_HORIZON;
- FEE_COVERAGE_REACHED;
- ENTRY_LATE;
- DIRECTION_WRONG_EARLY;
- GOOD_ENTRY_BAD_EXIT;
- BAD_ENTRY;
- MANUAL_RESCUE;
- PROFIT_GIVEBACK;
- HOLD_TOO_LONG.

Do not automatically turn these labels into hard vetoes. Recommend how they should enter model context/training-memory/evidence without duplicating deterministic risk gates.

## Part 5 — Exit/TP quality review

Test the user's hypothesis that TP is often too far and positions are held too long.

Counterfactual analysis must be cost-aware and fact-based. Compare actual results against candidate exit policies such as:
- volatility-normalized TP;
- regime-aware TP;
- horizon-aware TP;
- time-decaying TP target;
- break-even / profit-protection after sufficient MFE;
- trailing only after statistically justified MFE;
- maximum-hold review / model re-evaluation;
- staged exit if supported by exchange and system architecture;
- dynamic TP tightening when expected remaining edge decays.

Do **not** recommend a fixed TP percentage until the historical distribution supports it.

For every candidate policy estimate:
- additional TP hit rate;
- expected net PnL after fees/funding;
- downside / premature-exit cost;
- average holding duration;
- capital turnover;
- manual intervention reduction;
- robustness across symbols/regimes;
- risk of overfitting.

Separate:
- Entry-quality failure;
- Exit-quality failure;
- execution-quality failure;
- provenance/data-quality failure.

## Part 6 — how to improve the model without corrupting authority boundaries

The plan must preserve:
- Primary remains the Entry authority;
- deterministic physical/exchange/risk facts remain hard constraints;
- REVIEW_BRAIN must not become a second Entry veto;
- UNKNOWN/no-proof stays fail-closed;
- no model is allowed to invent private/exchange facts.

Recommend a feedback architecture where recent proven outcomes are summarized into compact evidence for the Qwen PRIMARY model, for example:
- regime-specific outcome summaries;
- entry-quality lessons from canonical records;
- realized MFE/MAE/horizon labels;
- TP/holding efficiency;
- recent symbol-specific failure modes;
- portfolio/quote-asset utilization context.

Avoid dumping raw history into every prompt. Define bounded, recency-aware, statistically qualified summaries.

Also review whether a separate Exit review call is warranted after a position has aged past its intended horizon or edge has decayed, while preserving deterministic TP/position safety rules.

## Required output files

Commit all analysis-only artifacts to GitHub. At minimum produce:

1. `docs/reports/v397-trade-entry-exit-quality-review-20261008/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md`
   - factual findings and evidence;
   - exact AAVE/ETHFI provenance reconstruction;
   - current open-position TP table;
   - recent TradeRecord statistics;
   - Entry vs Exit failure decomposition;
   - limitations/sample-size warnings.

2. `docs/plans/V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md`
   - prioritized implementation plan only;
   - no implementation in this run.

The implementation plan must contain:
- P0 data/provenance corrections required before learning from records;
- P1 observability/metrics required;
- P2 Entry-model context/feedback improvements;
- P3 TP/Exit policy architecture improvements;
- P4 experiment design / shadow evaluation;
- rollout gates;
- regression tests;
- acceptance metrics;
- rollback conditions;
- explicit items not to change.

## Safety / lifecycle constraints

Analysis only:
- no order placement;
- no order cancellation;
- no TP modification;
- no Settings changes;
- no strategy parameter changes;
- no model-resource changes;
- no service restart;
- no database reset/deletion;
- no Production writes;
- TESTNET read-only facts only.

Do not interrupt the active Engine reactivity remediation. If runtime is currently being restarted by another Codex task, wait until that run reports completion before taking the analysis snapshot; do not compete for process lifecycle.

All long command output goes to log files and GitHub. Do not ask the user to paste long console output.
