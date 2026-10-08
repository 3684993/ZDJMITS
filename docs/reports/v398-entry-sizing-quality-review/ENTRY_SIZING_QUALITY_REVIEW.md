# Current closure — V3.9.8 RUNNING / 2026-10-09 06:17 +08

用户另行明确授权的当前TESTNET升级启动完成：代码3327c84，CI37850135010 success，remote217hash通过。PID8524/build3.9.8-7271c941c2cdec049610；/health READY、closeout200、identity6/6、TP13/13。生产写0、Engine自然TP写1、任务人工交易0；Settings247/digest与原dirty checkout未变。仅一次实际MANUAL_START，无退出定时器/自动重启。风险函数仅影子、formal calibration/new-origin natural evidence UNKNOWN。额外在线native GET备份超界已取消；临时私有copy因policy拒绝删除而本机保留。详见IMPLEMENTATION_REPORT.md / RUNTIME_CLOSEOUT.json。下方为原分阶段历史，旧NOT_DEPLOYED不能作为当前状态。

---

# I2 当前状态 — 2026-10-09

研究和计划已先发布并完成 152 项 GitHub readback。确定性禁止独立补仓代码及原始授权持久化已在隔离目录实施，完整本地验证 240 files / 2063 tests PASS。严格 envelope schema 保留兼容可选政策声明，Primary 权限不变。风险数量函数仅影子，正式风险校准继续 INSUFFICIENT_EVIDENCE；下方 R2 研究结论和原始交易事实不被改写。

研究、代码、运行三个阶段分别验收。此提交尚未启动实例；用户另行明确要求升级启动当前停止的 TESTNET 8080，I2 远端/CI 通过后才执行一次，并单独记录健康及身份闭合。详细实现/失败日志/限制见 `IMPLEMENTATION_REPORT.md`。

---

# V3.9.8 建仓数量、禁止独立补仓与风险预算研究 — R2

2026-10-08 Asia/Shanghai。基线 `3242a79bb480db81d7bd5fba9bd3a7300e8256e5`。R0/R1/R2完成；**算法参数 IMPLEMENTATION_BLOCKED / INSUFFICIENT_EVIDENCE；确定性禁止独立补仓可进入离线验证，尚未部署。** 下方原Round1是历史记录，本节覆盖其没有live数据的结论。

用户最后一句明确要求升级启动已停止实例，覆盖文档默认不部署/不重启；仅最终已通过本地门禁的当前TESTNET Engine/8080，不授权改Settings、模型、SSH、人工交易或制造样本。前期不能通过启动绕过只读采集。长期存活不能由测试保证，不启用自动重启。

## 本轮真实基线

原D:\MITS六项dirty原样保留；隔离D:\MITS-worktrees\v398-entry-quality-20261008从最新main建立。GitHub [Verify37779203134](https://github.com/3684993/ZDJMITS/actions/runs/37779203134)对3242a79 completed/success，未dispatch/re-run，后续提交不能继承此成功。8080无监听，netstat证实8081/8083/8084仍12732/17468/51124；PowerShell Get-NetTCPConnection没有返回记录，不能误称所有模型离线。Engine当前production counter UNKNOWN，本研究exchange writes=0。

SQLite `mode=ro/query_only`，正常WAL、有界read transaction，无immutable/reset/migration/live写入；Settings247 /TESTNET_ENABLED。读取762TradeRecords、2697intents、2674orders、5002fills、3668plans、18persistedpositions、2697exact-linkedallocations、258非空linkedrunarchives。allocation全表超过5000后改exact-ID查询，失败日志保留。签名GET使用官方SQLite backup私有临时副本，秘密/完整privateprompt不发布。

20:58:44+08账户锚17非零持仓、16openorders；21:06:35+08独立历史采集锚同为17/16、risk-increasing openorders=0；两者与SQLite不是原子同刻。85publicGET全部返回：17symbols×1w/1d/4h/1h/15m，只保留exchange clock前closedbars。ETH/AVAX历史固定6日窗，共5windows/10signedGET，各response<1000；无目标侧exit、全部entryqty与现仓守恒。未作任何exchange写/Settings写/lifecycle。

数据/哈希/查询bound见[evidence](evidence-20261008/README_EVIDENCE.md)、[current file:line+SHA callgraph](evidence-20261008/architecture-callgraph.md)、[source audit](evidence-20261008/sizing-authority-audit.json)、[exchange reconstruction](evidence-20261008/exchange-cycle-reconstruction.json)、[missing facts](evidence-20261008/missing-facts.json)。不复用其他实例事实。

## 源码权限及根因

真实链：market/universe→pre-AI funds envelope→frozen quantity/horizon/target menu→Primary selectedCandidateId→allocation→immutable TradePlan→reservation→intent→durable exact journal→JIT/environment/funds→adapter→WS/exact recovery→physicalcycle/lots/TP/owner→lineage。行号从当前checkout机械生成，不猜。

- `minimumQuantityForTarget`：exchange/businessnotional、至少100quote initialmargin、10–20leverage、absoluteprofit floor；availablemargin×leverage给上界，profitfloor可主动推大qty。AVAX历史origin intent leverage=8，不能倒灌今天10–20约束。
- `quantityHorizonCandidates`：最多4rungs，horizon/target/floor形成冻结menu，risk字段加入margin/notional。TESTNET funds-only以真实native availablefunds给上界；旧portfolio finalNotional不缩减菜单。
- `primaryOccupancyBlock`在funds-only返回null，`entrySubmissionIdentity`按每个intent做SUBMISSION_ONLY：exactidentity只能防同订单duplicate，不能防另一个独立intent增加同物理cycle。每次新intent可重新取得完整fundsbudget。
- `PositionLifecycleTracker`每次quantity增加都递增addCount，含同订单partialfill/后续数量观察；不是独立add order计数。
- `manualPositionService`存在HUMAN确认ADD通道；PLACE_LIMIT实际反向side/reduceOnly，不能按名称误称新Entry。PositionReview在人管时review-only，没有证据把历史adds归咎Review；TP改价保持owner/identity/qty，独立于Entry。
- `entryLineage`严格逐lot验证fill/intent/plan/completedPRIMARY/model/context。SQLite-only full-lotexact56/762；174recentclosed funding全UNKNOWN。不得用runreference/current源码/finalVWAP补成历史模型批准。

PROVEN current-source：缺no-separate-add边界，funds-only绕过occupancy及旧riskveto。STRONG_EVIDENCE historical：每个独立真实add有自己intent/runreference，17AVAX+3ETH在记录的人管接管后成交。UNKNOWN：各旧completedPRIMARY内容/时间、ownerVersion、当时组合/资金/reservations。

## ETH / AVAX逐订单事实

| case | origin真实成交 | 独立orders / separateadds | 展示addCount | 物理守恒 |
|---|---|---:|---:|---|
| ETHUSDT LONG | 10-05 14:57:18+08；0.211@2719.22；originalorder授权0.589、余量CANCELED |4 /3|5|0.211+.369+.518+.369=1.467；32partialfills、无目标侧exit |
| AVAXUSDT SHORT |09-20 00:10:45+08；400@9.483；6originpartialfills|18 /17|25|1263nativeentryqty；无目标侧exit；18orders各matchlocalintent/runref |

ETH3adds在记录18:00:51humanhandoff后、AVAX17adds在记录01:16:05后；不能据当前owner回填当时ownerVersion。所有exactids/time/qty/price/fees/authorizationcap/intentleverage见[exchange-lots-by-cycle.csv](evidence-20261008/exchange-lots-by-cycle.csv)。补证前SQLite-only短统计保留为中间证据，上表是交易所补证后结果。

AVAX原始TradeRecord entryQty=288、17lots合计1074、exchange/position1263，真实持久化聚合不守恒；另立derivedexchange重建，不改原history、不晋升canonical，具体历史投影根因未在本主题修复。

固定20:58 mark、仅保留已成交origin、ex-funding算术（**不是完整因果回测**）：

|case|reportedcurrentuPnL|origin-onlyqty|origin-only固定markuPnL|quantity下降|
|---|---:|---:|---:|---:|
|ETH mark2530|-267.11078999USDT|.211|-39.92542USDT|85.6169%|
|AVAX mark10.56584866|-97.41386385USDT|400|-433.139464USDT|68.3294%|

AVAX no-add不保证每时刻亏损更小：adds提高shortVWAP，此恢复时点实际合并账浮亏比origin-only小；库存/tail敏感度下降与某刻损失不同。用户过去-1000/-298.59、ETH-261.65不冒充本轮读数；历史truemax/完整MAE/underwater UNKNOWN。初始授权减半不代表真实fill必减半：ETH .589cap/.211实际partial，queue/TP/资金/未来fill改变均UNKNOWN。policyCSV的scaled-fill仅演示线性暴露，不声称可执行fill。

## 八政策及PIT/统计资格

相同origin/冻结机会/可见截止为比较单位；physicalcycle为独立样本，不把adds当17/3独立输赢。正式结果全部null及缺口保存[policy-comparison](evidence-20261008/policy-comparison.csv)。

|policy|机制 / 已知|裁决|
|---|---|---|
|Uniform haircut|.5只是预先写下的算术对照，固定pricePnl线性|真实fill、机会损失、winning contraction、formalnet UNKNOWN，不live|
|Linear location|示例1−.5×directionalextremity|fillanchorclosed52w可算；decisioncutoff UNKNOWN，shadow|
|Nonlinear location|示例1−.75×extremity²；强趋势/衰减二维|参数无OOS，不live|
|Vol targeting|budget/adverseATR或realizedvol|currentATR/vol可算，historicalregime/decisioncoverage不足，formalqtyUNKNOWN|
|Stressloss|side/horizon scenario或训练前ES/CVaR损失预算|无stop不是绝对maxloss，完整path/fee/funding/holdout不足|
|Cyclebudget|origin固定累计cap，未来separateadds=0，原partial/exactrecovery保留|确定性no-add可离线验证；oldunknown不能继承新权利|
|Portfolio/factor|nativeLONG/SHORTgross/net、共同cryptoshock、pending资金|current可算，historicalbook/FX/factor不足，shadow/null|
|Hybridminbounds|Qmax=min(Qfunds,Qcycle,Qstress,Qportfolio,Qfactor)+softpreference|推荐架构非盈利最佳阈值；仅既有funds/exchange和no-addphysical可执行|

currentUSDTgross37031.29149216/netLONG7688.789037/uPnL−1691.07483788；USDCgross/netLONG10095.56214325/uPnL−390.16954804，分asset不加总。reportedinitial/maintenance在nativeassetJSON，notional/L不是exactcrossallocatedmargin；降低leverage不降低相同notional价格风险，liquidationPrice0不代表无风险。

三个0.8都代理同一tail时乘积.512重复惩罚，独立上界min=.8；这是代数例子非校准。保守共同shock替代稀疏correlation乐观点估计，仍需scope/time/scenario证明独立性。Qmax低于step/minQty/minNotional/100quote业务margin/profitfloor时必须NO_FEASIBLE_EXECUTABLE_QUANTITY，明确exchangelegal/funds/strategyeconomic，不加qty/抬leverage掩盖notional。

85responses只取exchangeclock前closed；origin演示取firstFill前closed，历史observation和completedPrimarycutoff仍UNKNOWN。AVAXfillanchor52wrangeposition≈.04913、ETH≈.39558；**此TESTNET样本不证明ETH处于极端周线高位**。HigherTimeframeLocationScore应另有26/52w、EMA20/50warmup、ATRextension、robustzscore、drawdown/rally与daily/4hADX/trendslope/persistence二维。currentfeaturestrata只给实际算出的range/ATR/vol，缺窗口/未算不填normal。sizeevidence、modelcontext、experimentonly区分；不用RSI方向veto。

174recentclosed funding UNKNOWN；formalnet/训练禁止。pricepathgap、historicalowner/book/reservations、oldrunarchives不足；purgedwalkforward/embargo/day-regimeblockbootstrap/holdout NOT_RUN_UNQUALIFIED_DATA。worst1/5%、CVaR、portfolioMAE、truemaxdrawdown、opportunityloss、calibratednet均null，open保留rightcensored。

## 实施gate

不依赖旧模型归档的确定性no-add：同symbol/side已有库存/HUMAN/pending/UNKNOWN不能获新独立authorization；futureorigin的cap/owner/identity/durability必须由当前代码+hostiletests闭合。旧事实缺失仅保持occupied，不用来给予恢复/新Entry权利。旧PRIMARY/AVAXrecord矛盾阻塞historical资格及新量化参数；如新链criticalowner/order/cap仍不证、S00/CI/localgate失败、TESTNET不成立，立刻IMPLEMENTATION_BLOCKED。no-add不能伪装成subjectivepostPLACEveto；仅物理授权collision，Primary仍唯一Entry。

R2普通commit/push、远端hashreadback后才准改source；I2提交真实代码/tests/实施报告/影子状态再远端核验。最终启动授权存在，但不得启动仍允许补仓的旧代码来冒充任务完成；必须localgate+health/closeout/identity/TESTNET/Production/TP真实接受。F04/F10/F11/Reactivity/TP策略不扩展。

---

# Historical Round 1 (superseded by R2 above)
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

## 最终只读复查补充（2026-10-09 06:25–06:29，Asia/Shanghai）

本文较早的 TP13/13、Engine TESTNET写1、无新origin描述是启动后早期快照，不能作为当前统计。`runtime-completion.json` 的固定观测时点为 UTC2026-10-08T22:25:56.351Z：PID8524，3.9.8，health READY/HTTP200，closeout200，scheduler RUNNING，TP14/14，缺失/重复/数量/方向/未核验均0；累计 Engine TESTNET gateway写23，生产写0。这些包含系统自然 Entry、保护、杠杆等请求，任务人工交易写0，不能描述为全局零写。

`local-identity-completion.json` 随后观测6个active origin；更晚独立只读事务 `natural-origin-completion.json` 取得7个历史origin及其exact intent/clientOrderId/原始quantity上限/任务订单投影（账户标识省略）。AAVE投影filled1.4，ZEC0.327，VVV8.01，另4个filled0；订单投影与授权数量在公开JSON中可复核。计数变化来自持续运行与不同观测时间，不拼为同一快照。现在已存在自然授权及成交投影，旧“未发生”条件不再成立；这些有限记录尚不能证明完整逐lot交易所链、所有独立补仓拦截或跨重启接受，相关验收仍UNKNOWN，不强迫交易/重启制造样本。

代码提交3327c84的GitHub Actions已SUCCESS；证据提交1cd6d75的272项远端哈希PASS，其Actions在回执时in_progress。最后归档提交仅证据/报告变化，不改变已加载Engine源码/dist。额外在线原生GET未完成的UNKNOWN、临时私有备份保留、风险校准INSUFFICIENT_EVIDENCE等边界继续有效。
