# V3.9.6 Entry frequency and minimum-sufficient risk-chain audit

Status: **READY_FOR_REVIEW — evidence-bounded analysis; NOT runtime ACCEPTED.**
Product implementation: **NOT_STARTED**. This report is the analysis-first deliverable. Historical numeric facts and complete upstream opportunity denominators are not recoverable from the retained evidence; this is not a claim that every requested historical gate has been quantitatively closed.

## 1. Preservation, identity and boundaries

- Original directory `D:\MITS`, branch `v395-economics-human-managed-20260919`, HEAD `65e390e2a2aa1ca39bc3bfb3458f709f921a2a0c`: 48 status entries preserved. See `dirty-worktree-inventory.txt`. One entry is an untracked nested checkout/directory; 48 is Git status entry count, not a recursive count of its contents. No switch, cleanup, restore, stash or commit there.
- Fresh managed worktree: `C:\Users\5700x\.codex\worktrees\v396-entry-frequency-risk-audit\MITS`. Branch `codex/v396-entry-frequency-risk-audit-20260927`, initial HEAD and freshly fetched origin/main both `667177f7106cf00a657e86c5818b0cfc9e702aff`. Initial status empty before evidence creation.
- Followed `docs/plans/v396/CODEX-V396-ENTRY-FREQUENCY-RISK-AUDIT-WORKTREE-SAFE-20260927.md` from fetched main. No subagents used. The requested model/effort is a session property not changed by this audit; model identity is not asserted from an unverifiable runtime setting.
- Observed Engine PID 18644, instance `e0919ffb-a97e-4eb6-b4bb-09818a489150`, build `3.9.6-fa4fbc8660ef12849644`; executable `D:\MITS-worktrees\v396-final-convergence-20260922\apps\engine\dist\main.js`, data `D:\MITS\data`. That checkout HEAD is `8788f9a5a8ddb45ea6f585b51cf3cdd53b866923`; comparison to audit base changes only two plan documents. Checkout HEAD does not cryptographically prove loaded build provenance. Instance receipt sourceHash `ad4754a44c2a8b6747f7bac39027032e865dfee156bc096a01c2559cb834a237`, artifactHash `fa4fbc8660ef12849644402e2928ce127406fda654898f79bb8b3d1306aa3e61`.
- Live reads: SQLite URI `mode=ro`, query_only; process/instance receipt; local published `/api/v3/snapshot` and `/api/v3/diagnostics/closeout`; existing JSONL. No runtime constructor imported, no exchange request initiated, no Engine lifecycle action, no Settings write, no deployment. Existing Engine/TP activity continued independently. Production writes initiated by audit = 0. PR #9 untouched.

## 2. Window, joins and limitations

Frozen audit window: **2026-09-24 00:17:25.021 UTC → 2026-09-27 00:17:25.021 UTC**, equivalently **09-24 08:17:25 → 09-27 08:17:25 Asia/Shanghai**. Last-24h and last-12h subwindows share this end. Current-fact readback at `1790468391727` is later than the historical cutoff and is explicitly separate.

Sources: `ai_runs_archive`, durable `decision_chains`, `runtime_events`, `runtime_entities`, 19 runtime JSONL files, ownership SQLite, local snapshots. JSONL invalid-line count was zero. The event key is `(type, timestamp, brainRunId)` across sources; stages count unique Primary run IDs, not repeated log messages. Admission excludes analysisOnly observations and takes the latest evaluation per run. Full results and lineage are in `quantified-chain.json` and `cohort-lineage.json`; per-file coverage is in `log-coverage.json`. Extraction reads are not a single atomic transaction across databases and HTTP; timestamps must not be mixed into a fictitious single historical snapshot.

SQLite runtime_events alone is insufficient: earliest retained event in this window is `1790449721249`. JSONL has gaps/rotated segments (notably 09-25 night), and several payloads are deliberately truncated. Durable decision chains recover many missing terminal events, including all 91 recent PLACE vetoes. They do not recover every POOL/ELIGIBLE opportunity transition or every numeric pre-veto snapshot. Therefore POOL/ELIGIBLE historical conversion, historical time-weighted availability, and an exact 72h whole-universe funnel remain **INSUFFICIENT_EVIDENCE**. Do not divide repeated supply heartbeat counts into Scout counts.

Critically, **0/1,286 execution admission records contain the newer `gates` numeric array**. The historical versions saved reasons, gross, capital and drawdown but not all candidate-side limits/headrooms. Today's limits cannot be retroactively substituted across historical Settings versions. Per-event `used/limit/headroom/shortfall` for the entire historical chain remains UNKNOWN where not recorded. Missing events are never treated as proof of zero execution.

## 3. Stage conversion and primary drops

| Stage | 72h | 24h | 12h | Meaning / drop accounting |
|---|---:|---:|---:|---|
| POOL | UNKNOWN | UNKNOWN | UNKNOWN | No complete historical unique opportunity denominator; current display 24, potential supply 13 |
| ELIGIBLE | UNKNOWN | UNKNOWN | UNKNOWN | Current eligible 13; not 13 historical opportunities |
| SCOUT | 1,635 | 641 | 92 | Archived Scout runs, not necessarily one-to-one with Primary |
| PRIMARY | 1,632 | 639 | 92 | Archived starts; 72h completed 1,580, failed 40, unfinished 12 |
| PLACE | 1,572 | 619 | 91 | 72h LONG 1,032 / SHORT 540; NO_DIRECTION_EDGE 8 |
| RISK_ADMISSION evaluated | 1,286 | 577 | 91 | Execution candidates; additional analysisOnly record excluded |
| RISK_ADMISSION allowed | 314 | 0 | 0 | 972 / 577 / 91 denied |
| TRADE_PLAN persisted | 37 | 0 observed | 0 observed | Includes 1 system WAIT; 36 entry plans |
| RESERVATION | 36 | 0 observed | 0 observed | Unique Primary IDs with reservation events |
| INTENT | 29 | 0 observed | 0 observed | Joined events; current entity store has 28 corresponding window creations |
| SUBMIT attempted | 17 | 0 observed | 0 observed | Unique Primary IDs; JSONL has 18 attempts including retry |
| ORDER created | 16 | 0 observed | 0 observed | Distinct run IDs with accepted order event; not all local order objects |
| FILL | 11 ENTRY_FILLED | 0 observed | 0 observed | 13 runs have fill-attribution/reconcile events; current entity store has 12 FILLED orders. Different event/fact semantics, not interchangeable |

Conditional observed conversion: PLACE / completed = 1,572/1,580 = **99.49%**; admission allowed / evaluated = 314/1,286 = **24.42%**; entry plans / allowed = 36/314 = **11.46%**; submit / PLACE = 17/1,572 = **1.08%**. These are recorded cohort ratios, not a proof of exhaustive whole-universe throughput. Recent 12h has **91/91 PLACE admission refusals** and no downstream submit evidence; one unfinished Primary cannot be assigned a terminal outcome.

Main downstream losses, preserving stage semantics:

- Before admission: 215 `AI_QUANTITY_BELOW_MIN_NOTIONAL`, 37 `AI_QUANTITY_EXCEEDS_ENVELOPE`. These 252 are execution legality/envelope failures, not a lack of market direction. Of 40 failed model outputs, 32 hit output token limit, 4 misread book imbalance, 4 failed range schemas. Fourteen data-error events include 11 quote stale, 2 book stale, 1 missing key fact; stages can overlap and are not added into a false exclusive total.
- Admission: 972 denied, reason families and overlaps below. Coverage of historical numerical gate arrays is 0%; exact per-event counterfactual sizing cannot be invented.
- Trade plan: 278 recorded `TRADE_PLAN` refusals: 261 `PLAN_SIDE_NOT_EXECUTABLE` with `NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY` and `MIN_NET_PROFIT_USD=1`; additional horizon and plan failures are in the lineage. This must not be hidden behind the wrapper label. Historical diagnostics even report attained values slightly above 1 in many such refusals; precision/target-domain semantics need the contemporaneous candidate inputs, not simply changing the comparison epsilon. Current `quantityHorizonCandidates.ts` already contains later SHADOW/selection fixes, so these old 261 failures are not proof that the same defect still exists at main.
- Reservation → intent: 7 JIT order-block events: 6 market quality, 1 gross risk. Nine execution waiting runs and five wait terminations (`MARKET_QUALITY_NOT_ADMITTED`) show legitimate timing/admission boundaries; no forced maker order is justified.
- One submission-unknown event must remain uncertain. Current reconciliation reports 48 historical UNKNOWN, 47 verified no active risk, **1 active unresolved**. This audit did not release its claim or reinterpret UNKNOWN as zero.

## 4. Gate hit rate, overlap and marginal contribution

Denominator below is the **1,286 evaluated execution admissions**, not all candidates. Hit rate means a gate appears in the complete returned reason set, not that it independently caused the entire loss. Sole-hit counts remove all other recorded reasons; they are an upper-level counterfactual only and do not prove later JIT would pass.

| Gate/family | Hits | Hit rate | Sole recorded reason | Classification |
|---|---:|---:|---:|---|
| MAX_GROSS_NOTIONAL | 852 | 66.25% | 0 | INDEPENDENT_RISK_AUTHORITY candidate; one authoritative aggregate ceiling |
| MAX_CLUSTER_NOTIONAL | 852 | 66.25% | 0 | DUPLICATE/DERIVED for this all-unmapped, equal-limit configuration |
| HUMAN_POTENTIAL_NOTIONAL_LIMIT | 832 | 64.70% | 0 | DUPLICATE/DERIVED of position exposure under same cap; pending differs |
| HUMAN_ACK_OVERDUE | 560 | 43.55% | 0 | STALE/WRONG-SCOPE for global NEW Entry veto; governance timing is not account safety |
| MARGIN_TIER_SYMBOL_UNPROVEN | 267 | 20.76% | 66 summed symbol-specific sole hits | EXECUTION_CORRECTNESS: candidate bracket coverage |
| PENDING_RISK_UNVERIFIED | 257 | 19.98% | 0 | EXECUTION_CORRECTNESS; keep real uncertain occupancy |
| SNAPSHOT_INCOMPLETE | 271 | 21.07% | 0 | DUPLICATE/DERIVED summary of missing row facts |
| MAX_DIRECTION_NOTIONAL | 71 | 5.52% | 0 | Potential independent directional concentration ceiling; not a market signal |
| MAX_STRESS_LOSS | 66 | 5.13% | 0 | Current scenarios reduce to derived gross coefficient; assess independent scenario function |
| MIN_MARGIN_BUFFER | 18 | 1.40% | 0 | Real funding concept, but current calculation may double-charge used margin |
| PRIVATE_ACCOUNT_NOT_FRESH | 13 | 1.01% | 0 | EXECUTION_CORRECTNESS; current freshness cannot fix a historical lapse |
| MAX_CAPITAL_AT_RISK / MAX_DRAWDOWN / ACK slots | 0 recorded | 0% recorded | 0 | No observed admission hit, not proof of permanent irrelevance |

Full symbol-specific and other evidence families are preserved in JSON. Last 24h: gross/cluster/human notional each 577/577; ACK 560/577. Last 12h: all four each 91/91; **68/91 (74.73%)** have exactly those four labels, and 23 also have incomplete facts (19 pending-unknown, 5 private/account problems, with overlap). Four labels are 364 hits on 91 denials, not 364 denied orders. Each gate's observed leave-one-out marginal contribution in this 12h set is **zero** because the other three remain. Gross and cluster sets have identical 852 hits in 72h; this is supporting evidence of redundancy, not by itself a causal proof for arbitrary future correlation maps.

## 5. Formula and current numeric matrix

Let N=abs(quantity×mark), G=sum deduplicated positions and pending N, L/S directional sums, C_k=sum N in correlation bucket k, M=sum N/leverage. Exact source: `portfolioRiskSnapshot.ts:189-259`, `portfolioStress.ts:45-103`, `humanCapacityPolicy.ts:29-55`, `portfolioRiskLedger.ts:375-470`, `executableRiskHeadroom.ts:47-89` at audit base. Different currencies/units must not be added as interchangeable headroom.

The table uses the timestamped **visible position book** from closeout capitalVersion; it is a reproducible derivation, **not a successful full PortfolioRisk replay**. Active unresolved pending risk, omitted live claim facts and non-atomic ownership reads may add blockers/exposure. `current-derived-gates.json` retains this limitation. Current profile source is settingsVersion 219 readback; no Settings was changed.

| Gate / formula | Used | Limit | Headroom | Existing-book shortfall | Size / authority decision |
|---|---:|---:|---:|---:|---|
| Gross G ≤ maxGrossNotionalUsd | 11,201.215949 USD | 10,811.957 | 0 | 389.258949 | Size dependent; preserve one approved aggregate risk authority |
| Human sum(POSITION N) + candidate N ≤ maxHumanNotionalUsd | 11,201.215949 | 10,811.957 | 0 | 389.258949 | Same position dollars/cap; remove duplicate authority after canonical pending treatment is proven |
| Cluster max C_k ≤ maxClusterNotionalUsd | 11,201.215949 | 10,811.957 | 0 | 389.258949 | `clusters={}` maps every exposure to UNMAPPED_CORRELATED; exactly gross here |
| Direction LONG | 3,648.266062 | 8,649.565 | 5,001.298938 | 0 | Size dependent independent only if concentration policy intended |
| Direction SHORT | 7,552.949887 | 8,649.565 | 1,096.615113 | 0 | Same |
| Capital-at-risk M | 1,087.973770 margin USD | 10,811.957 | 9,723.983230 | 0 | Margin model differs from real exchange available balance; don't count both as new capital |
| Worst stress, current all-unmapped map | 4,116.446861 loss USD | 5,405.978 | 1,289.531139 | 0 | Derived 0.3675×G; implied G ceiling 14,710.144218, looser than gross cap |
| Overall slots | 22 | 50 | 28 | 0 | Count independent of order size; candidate consumes 1 |
| Potential human slots (20 HUMAN + 2 HANDOFF + 0 AI) | 22 (+1 candidate) | 50 | 28 before candidate | 0 | Same positions as slot authority now; no measured operational capacity calibration |
| Pending handoff count | 2 | 50 | 48 | 0 | Governance count, no independent margin fact |
| ACK maximum age | oldest 47.401574 h | 24 h | 0 h | 23.401574 h | Size independent global veto; category STALE/WRONG-SCOPE |
| Available entry funds | USDT 3,437.173178; USDC 4,969.916687 | exchange available facts | 8,407.089864 total | 0 for minimum orders | EXECUTION_CORRECTNESS; BTC valuation excluded from entry funding |
| Ratio gross (separate legacy path) | 11,201.215949 | equity×1 = 10,339.759632 | 0 | 861.456316 | OBSERVE, **not** a hard veto; must not silently become one |
| Ratio cluster for new ZRO route | 0 | equity×0.35 = 3,618.915871 | 3,618.915871 | 0 | ENFORCE; different cluster authority (`OTHER:ZRO`) from UNMAPPED_CORRELATED is a conflict |

For a candidate n, notional-gate shortfall is max(0, used+n-limit), not just existing-book shortfall. Margin gate must use n/leverage, stress gate must use incremental loss, not n. Existing `rankAdmissionReasons()` adds candidateNotional to every gate's `usedUsd`, even MARGIN_USD/LOSS_USD gates; this is dimensionally wrong diagnostic shortfall. The stress gate also uses stress result including candidate while others subtract its contribution. These are source-proven diagnostic defects, not permission to loosen a gate.

Stress exact formula per scenario j: `a_j=abs(priceShock)+spread+funding+abs(markBasis)+depth+(unavailable?penalty:0)`; `loss_j=a_j*G + sum_{cluster with >1 members}(C_k*abs(priceShock)*clusterConvergence)`; take max_j. Current coefficients: DOWN/UP 10% = 0.195; EXCHANGE_GAP_15 = 0.3675. All losses use absolute shocks and gross dollars; LONG/SHORT hedge benefit is absent. A genuinely independent scenario limit needs different tail-risk information, not another name for G. With fixed clusters the executable candidate ceiling can be solved per scenario; crossing a cluster from one to two members is a discontinuity requiring piecewise evaluation, not a global division shortcut.

Margin buffer code `(availableMargin - marginUsed)/availableMargin` compares to min 0. Available exchange balance generally already reflects used margin; the audit flags a potential double charge pending account-asset source semantics, rather than claiming an external-account proof. For USDT visible inputs the formula yields about 68.64%; for USDC about 99.80%. Per-asset actual authority replay and historical buffers remain UNKNOWN. Liquidation buffer threshold is 0; each position still needs verified directional liquidation facts. Drawdown uses `(peak-(assetEquity-netExternalFlow))/peak`, clamped at zero; current exact flow-adjusted denominator/cash-flow rows were not reconstructed, so no fabricated current drawdown gate value is supplied.

ACK source: ownership rows for PENGUUSDT/UNIUSDT, `HANDOFF_PENDING`, reason `LEGACY_OR_INVALID_PLAN`, no ack, ages 47.401574h / 47.180499h. They carry no loss/margin/market freshness measurement. Their exposure remains counted independently. TP is 22/22 protected. Therefore ACK age has no independently demonstrated execution-safety function for an unrelated NEW automated entry. Preserve operator task/alert and TP ownership, challenge its global hard authority. Current displayed 2.4h threshold comes from `Math.round(maxAckAgeMs/3_600_000)/10` at `portfolioRiskLedger.ts:458`; actual comparison remains 86,400,000ms = 24h.

## 6. Exact order critical values and false-zero analysis

At a fixed observed price p and step s: `u_min=max(ceil(minQty/s),ceil(minNotional/(p*s)))`; `q_min=s*u_min`; actual minimum notional is p*q_min. `u_max=floor(min(all independent executable notional ceilings)/(p*s))`; executable iff u_max≥u_min and no size-independent correctness blocker. For a price interval, use the appropriate worst-endpoint bound and the symbol's price tick; a point quote is not an authorization to submit later.

`legal-order-critical-values.csv` gives **24 symbol-side rows** from the same closeout's bounded candidate projection (not all 26 possible routed sides), with Decimal rounding. Examples:

| Symbol | Price / step | Minimum units / quantity | True minimum USD | Ceiling excluding PortfolioAdmission (upper bound only) | Final current admission ceiling |
|---|---|---|---:|---:|---:|
| 1000BONKUSDC LONG | .003624 / 1 | 1,380 / 1,380 | 5.001120 | 3,607.449225 | 0 |
| OPUSDT LONG | .1434 / .1 | 349 / 34.9 | 5.004660 | 3,618.915871 | 0 |
| WLDUSDC LONG | .5258 / .1 | 96 / 9.6 | 5.047680 | 3,600.614848 | 0 |

Excluding PortfolioAdmission is an explicitly incomplete counterfactual, not a tradable ceiling; includes funding, enforced ratio cluster/direction and per-trade risk only. Current final zero is explained by ACK, plus a visible book already over the committed gross cap. **No smaller positive order can clear an unchanged gross cap while the book already exceeds it.** Claiming that deleting ACK alone restores submission is disproven by the remaining arithmetic.

False-zero mechanisms challenged in current source:

1. `capacityFacts` treats any non-direction gate headroom ≤0 as any-size denial, including LOSS_USD/MARGIN_USD; stress can have side/cluster-specific incremental effects. It does not solve a candidate-specific stress/margin ceiling when positive room remains. Positive scalar room is not an exact maximum executable notional.
2. Human slots are computed from all positions; pending reservation notional is omitted from human potential while counted by gross. Consolidation must not drop canonical pending occupancy.
3. Legacy ratio cluster and durable correlation clusters disagree in scope. Merely adding both minima does not prove each is independently necessary.
4. `readAdmissionCapacity` catches a capacity calculation exception and returns no verdict. This can present a feasible upper bound to pre-AI readers; final admission must still refuse absent authority. Current route factVersion contains `riskAdmission:[null,null]`, while final capacity visibility reports ACK zero. Avoid creating another gate; use one timestamped authority result consistently.
5. Historical minimum-quantity economics gate ignored possible larger legal quantities. Current source includes fixes; historical 261 hits are evidence of lost throughput, not a reason to reapply an old patch. Quantity below legal min must remain refused; final authorized quantity should never be silently clamped after model approval.

## 7. Minimum-sufficient hard-gate chain proposed

**Verified execution facts → one canonical exposure/funding ledger with independently justified limits → exact legal quantity interval → atomic reservation/ticket → JIT fact/version/owner/idempotency validation → one exchange submit.**

| Family | Class | Proposed authority |
|---|---|---|
| Testnet/Production lock, exchange filters, symbol state, private/market freshness, balance, leverage brackets | EXECUTION_CORRECTNESS | Keep; one source per fact, unknown never zero |
| Owner/cycle identity, uncertain orders, version/CAS, reservation, idempotency | EXECUTION_CORRECTNESS | Keep atomic/JIT validation; repeated time-of-use check is not a redundant policy gate |
| Aggregate risk, concentration genuinely distinct from aggregate, measured tail loss, per-trade adverse loss | INDEPENDENT_RISK_AUTHORITY | Single evaluator; approved limits and exact candidate incremental costs, one primary binding cause |
| Human notional vs gross; equal-cap all-unmapped cluster; identical total/directional cluster caps | DUPLICATE/DERIVED | Consolidate redundant expressions while retaining the stricter independently justified authority and all pending risk |
| Snapshot-incomplete wrapper, health counters, dashboard mismatch summary, SHADOW economics | TELEMETRY/DIAGNOSTIC | Explain constituent facts; never add a second execution veto |
| ACK age, legacy invalid-plan handoff status as unrelated global entry stop | STALE/WRONG-SCOPE | Operator queue/alert; keep exit ownership and exposure accounting, remove global Entry authority only with focused evidence/tests |
| POOL eligibility / Scout / Primary direction | Selection/strategy decision | Track separately from order impossibility; NO_DIRECTION_EDGE is not a risk error |

Removing duplicated names does not create capital or independently justify a higher risk limit. Do not alter leverage, live Settings, real unknown-risk claims, Testnet lock, JIT or order identity to increase the count.

## 8. Decision after analysis and verification status

**Decision: no product patch in this round.** The report establishes actionable simplification targets, but does not meet the instruction's complete historical per-gate numeric exhaustion: historic `gates` are absent, upstream unique opportunity denominators are incomplete, and exact full current admission replay including the active UNKNOWN is not closed. Committing this bounded report must not be represented as the complete evidence gate authorizing a broad risk rewrite. No extra risk layer is proposed or installed.

The next implementation should be a narrow consolidation of existing authority and governance/diagnostic separation, after closing the above facts; no new approval service or safety checker is required. The numerical overlap already rejects the premise that ACK removal alone guarantees orders. Source-proven hour-display/unit errors can be fixed together after the analysis gate, but changing only labels would not meet the user's root-cause objective.

Validation in this audit: Python aggregator executed against read-only evidence, Decimal exchange-floor calculations, source inspection and Git whitespace checks. Product tests/typecheck/formal build: **NOT_RUN_ANALYSIS_ONLY** (no product code modified; no implementation acceptance claimed). Hosted CI: **NOT_RUN_BILLING_LIMIT**. Deployment/online canary: **NOT_RUN_EXTERNAL**. No forced orders, fake fills or lower thresholds.

Current operational context: 22 positions / 22 TP protected; one unresolved active-risk fact; no lifecycle action taken. Historical WS peak and REST timeout/reconnect totals are not fully reconstructed in this scope and remain UNKNOWN; market/private failure event counts in log coverage are observations, not distinct outage counts. No statement here signs off natural runtime acceptance.

Final distinction: true independent execution failures (illegal quantity, stale/private/unknown facts, JIT) are observed; duplicate gross/human/unmapped-cluster authority and governance ACK veto materially dominate recent recorded denials; operator ACK and dashboard readiness must not be described as exchange funding impossibility. Complete all-stage historical numeric proof remains explicitly unclosed.
