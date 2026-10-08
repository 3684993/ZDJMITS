# Codex — Close Previous Reactivity Work, Then Run Trade / Position / TP / Qwen Quality Review

Authoritative main at task start: `a5e21b28fad5d371b42c7a701df63e12e0f1cb7e`.

Read first:
- `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
- `docs/reports/v397-ssh-socks-remediation-20261008/private-reconciliation-fanout/PRIVATE_RECONCILIATION_FANOUT_ACCEPTANCE.md`

This task has **two sequential phases**. Phase A is a short closeout only. Phase B is an analysis-only trade-quality review.

Do not interleave them.

---

## Phase A — close the previous private-reconciliation/reactivity round

The previous fan-out remediation is complete.

Facts already established:
- main deployed/accepted candidate path and report committed;
- latest main at handoff: `a5e21b28fad5d371b42c7a701df63e12e0f1cb7e`;
- GitHub Actions V3.9.x Verify for `a5e21b28fad5d371b42c7a701df63e12e0f1cb7e` completed SUCCESS;
- entry journal calls per cycle: 2622 -> 1–4;
- manual journal calls: 141 -> 4;
- claim stats: 457–523ms -> 0.12–6.92ms;
- completion publish: 1460–1885ms -> 520–638ms;
- private READY 25/25;
- TP no issue snapshots and final 19/19;
- Production writes 0;
- runtime acceptance still FAIL because:
  - loop max ~6140ms;
  - p95 ~35.55ms;
  - REQUIRED_MARKET critical timeout identities 4;
  - market facts not continuously fresh;
  - exact 6.14s spike caller remains unproven.

The fan-out hotspot itself is considered closed. Do not redo it.

Before Phase B:
1. fetch/pull latest main and confirm local head matches remote main;
2. verify the fan-out report and all referenced artifacts are present;
3. confirm no uncommitted fan-out work remains in the active worktree;
4. update `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` so the latest section explicitly states:
   - fan-out remediation COMPLETE;
   - runtime stability still FAIL;
   - exact remaining long-stall caller UNKNOWN;
   - reactivity remediation is PAUSED pending a separately scoped follow-up;
   - the next active task is the analysis-only trade/TP/Qwen review below;
5. do not run another full verify merely for this documentation closeout;
6. do not restart any service for Phase A.

If the canonical checkout is dirty from unrelated user work, preserve it and do not clean/reset it.

---

## Phase B — analysis-only TradeRecord / Current Position / TP / Qwen Entry-Exit Quality Review

This phase is **read-only analysis**. Do not implement strategy changes in this run.

### Goal

Perform a factual postmortem of:
1. the two user-manual closes below;
2. all currently open positions and their TP state;
3. recent closed TradeRecords and linked AI decisions;
4. whether holding periods and TP placement are systematically too long/far;
5. how the active Qwen PRIMARY model should receive better decision context and feedback for higher Entry and Exit quality.

The only implementation output in this run is a **detailed optimization implementation plan document**.

Do not change Settings, strategy parameters, model configuration, TP policy, Entry policy, or place/cancel/modify orders.

### User-observed cases that must be reconstructed exactly

#### AAVEUSDT
- LONG
- opened: 2026-10-08 11:01:07
- manually closed: 2026-10-08 17:07:03
- entry average: 175.79
- exit average: 172.79
- quantity: 11.4
- displayed PnL: -$35.39
- displayed close provenance: SYSTEM_MANUAL / “系统人工操作”

#### ETHFIUSDC
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
- do not “fix” ETHFI merely by relabeling it. Prove which exact identities/roles produced the conflict.

### Part 1 — exact provenance reconstruction

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

### Part 2 — current open-position TP review

Take a fresh **read-only** snapshot of every currently open TESTNET position and its protection.

Because Engine reactivity is not yet fully healthy:
- only use private/market facts whose freshness is proven at the time of capture;
- mark stale/unavailable fields explicitly as UNKNOWN rather than interpolating;
- do not restart services just to obtain the snapshot;
- if a market fact is stale, preserve that limitation in the report.

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
- net TP payoff after known costs;
- current MAE/MFE since entry;
- time to MFE and time spent below/above entry;
- 1m/5m/15m volatility/ATR or equivalent robust range measure;
- TP distance normalized by realized volatility;
- whether TP is statistically plausible within the intended holding horizon;
- whether the position has exceeded the Entry model's implied/explicit horizon;
- TP provenance/coverage health and any UNKNOWN/unverified periods.

Do not use a single static percentage as the conclusion.

Evaluate TP distance against:
- volatility/regime;
- expected holding horizon;
- spread/slippage/fees/funding;
- leverage and margin;
- recent MFE distribution;
- liquidity/executable price.

Flag positions where TP is so far that expected time-to-hit is inconsistent with the intended trade horizon.

### Part 3 — recent TradeRecord retrospective

Use a meaningful recent sample, preferably the recent rolling week and all canonical closed cycles available without expensive/unbounded scans.

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

### Part 4 — Entry quality review for the Qwen PRIMARY model

Verify the actual active PRIMARY model/resource identity first.

The user refers to it as **Qwen3.8 27B**. Do not assume this label is exact; report the real configured runtime identity.

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

Derive post-entry labels such as:
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

Do not automatically turn these labels into hard vetoes.

Recommend how they should enter model context/training-memory/evidence without duplicating deterministic risk gates.

### Part 5 — Exit/TP quality review

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

Do not recommend a fixed TP percentage until the historical distribution supports it.

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

### Part 6 — improve the model without corrupting authority boundaries

Preserve:
- Primary remains the Entry authority;
- deterministic physical/exchange/risk facts remain hard constraints;
- REVIEW_BRAIN must not become a second Entry veto;
- UNKNOWN/no-proof stays fail-closed;
- no model invents private/exchange facts.

Recommend a bounded feedback architecture where proven outcomes are summarized into compact evidence for the Qwen PRIMARY model, for example:
- regime-specific outcome summaries;
- entry-quality lessons from canonical records;
- realized MFE/MAE/horizon labels;
- TP/holding efficiency;
- recent symbol-specific failure modes;
- portfolio/quote-asset utilization context.

Avoid dumping raw history into every prompt.

Define:
- bounded sample size;
- recency policy;
- minimum sample confidence;
- uncertainty bucket;
- symbol/regime grouping;
- when evidence should be omitted for insufficient support.

Also review whether a separate Exit review call is warranted after a position ages past its intended horizon or edge decays, while preserving deterministic TP/position safety rules.

---

## Required output files

Commit all analysis-only artifacts to GitHub.

At minimum produce:

1. `docs/reports/v397-trade-entry-exit-quality-review-20261008/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md`
   - factual findings and evidence;
   - exact AAVE/ETHFI provenance reconstruction;
   - current open-position TP table;
   - recent TradeRecord statistics;
   - Entry vs Exit failure decomposition;
   - limitations/sample-size/freshness warnings.

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

---

## Safety / lifecycle constraints

Phase B is analysis only:
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

F04/F10/F11 remain paused.

Do not attempt to “fix” the remaining 6.14s stall during this task.

All long command output must go to log files and be committed to GitHub. Never ask the user to paste long console output.
