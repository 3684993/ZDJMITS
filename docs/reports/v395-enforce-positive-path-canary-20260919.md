# ZDJ-MITS V3.9.5｜ENFORCE 正向链路 Canary 报告（2026-09-19）

- 实施依据：`docs/prompts/ZDJ-MITS-V3.9.5-ENFORCE正向链路Canary-Codex提示词-2026-09-19.md`（commit `1ea50f3`）
- 分支 / HEAD：`v395-economics-human-managed-20260919` @ `1ea50f3`；live 构建 `3.9.5-57b2843729dff7a298a9`，PID 9680，instanceId `1c6cc310…`，`restartCount 161`（**全程未重启 Engine**，全部热应用）
- 时间线：`17:16:51` 只读基线（v181）→ `17:22:36` 隔离 PUT（**v182**）→ 隔离客观验证 → `17:26:11` cap 例外 + ENFORCE PUT（**v183**）→ 观察窗口 **15 分 45 秒 / 38 次采样 / 8 条 ENFORCE 评估** → `17:42:16` 自动恢复（**v184**）
- **结论：Stage 1 判定"具备正向条件"（未改任何风险限额）；正向链在 8 次真实尝试中 0 次放行，且 7 次是被 `minHistoricalReachProbability=0.50` 挡下——`$1` 净利门槛在同一尺寸下 7/7 通过。 Canary 未产生 `passed=true`，因此按 Stage 8/9 的口径，JIT 与 economic-TP 两条腿记为"未观测"，不伪造 PASS。**

---

## A. 当前 gross / long / short headroom

Stage 1 只读实测（`/runtime/trading-control` + `/positions` 交叉重算，`executableRiskHeadroom.ts` 同源公式）：

| 项 | 值 |
| --- | --- |
| equity | **$10,731.93** |
| gross notional（24 持仓） | $7,634.70 |
| long / short notional | $2,331.60 / $5,303.10 |
| `maxGrossExposurePct` / 预算 | 1.0 → $10,731.93 |
| `maxDirectionExposurePct` / 预算 | 0.5 → $5,365.96 |
| **gross remaining** | **$3,097.46** |
| **LONG remaining** | **$3,034.57** |
| **SHORT remaining** | **$62.89**（窗口末尾降到 $0.08） |

15 张 historical UNKNOWN 经 `entryOrderOccupiesRisk` 过滤后对在途敞口贡献 **0**（`entryRiskOccupancy.ts:59`），已排除"陈旧订单虚增敞口"的可能；`activeRiskUnresolvedCount=0`、`activeClaims=0`。

## B. 是否具备正向 Canary 客观条件

**具备（判定为 YES，故继续）**，且不需要动任何风险限额：gross 剩余 $3,097、LONG 剩余 $3,034，而本次 Canary 最大只需 ~$200 名义。实测也证实：整个窗口 `capacity.used 24 < maxPositions 25`，`routed=['VVVUSDT']`、`executableCandidateCount 1`，AI 决策确实到达了 ENFORCE 经济性关卡 8 次（上一轮是 0 次）。

两点如实记录的约束（都不是我制造或绕过的）：

1. **SHORT 侧几乎无余量**（$62.89 起、窗口末 $0.08）。我没有为此指定方向；8 次 AI 决策**全部自主 PLACE_LONG**，方向由模型给出。
2. `maxPositions` 按本提示词 Stage 4 的规则取 **`当前 used + 1`**（24→25），不是固定 1；`maxPendingEntries=1`、`dynamicMarginEnabled=false`、`entryMarginUsd=maxMarginPerPositionUsd=` 计算值。

## C. 是否反驳 15–25 USDT 建议；计算依据

**不反驳"可行"，但反驳上一轮报告里我给出的推导路径。** 用 207 条真实评估重算：

- 有效成本率（实测反推，非假设）：`cost = (notional×move − expectedNet)/notional` → **中位 0.0882%、p75 0.0885%、max 0.0903%**（与 `tradingCost.ts:32` 的 entry+exit+slippage+feeBuffer 结构一致）
- 真实 AI 目标位移分位：**p25 0.4269% / p50 0.8694% / p75 1.4412% / p90 2.8960%**
- `requiredNotional = 1/(move − 0.000882)`：p25 → **$295.24**，p50 → **$128.01**，p75 → **$73.91**
- `requiredMargin = requiredNotional / leverage(8)`：p25 → $36.90（超 25 上限），**p50 → $16.00**，p75 → $9.24

⇒ **15–25 区间的最小可行值是 16 USDT（p50）**，25 USDT 覆盖到 0.49% 以上的位移；只有 p25 尾部（<0.43% 的保守目标）需要 36.9 USDT，超出硬上限，**我没有突破 25**。

**必须修正的一处推理**：我一度按 `notional ≈ entryMarginUsd × 0.14 × leverage` 推断"25 USDT 只能得到 ~$28 名义"。源码否定该推导——`aiQuantityAllocation.ts:13` 是 `notionalUsd = AI quantityUnits × step × authorizationMaxPrice`，保证金只通过 `preAiExecutionEnvelope.ts:52` 的 `maxMarginByPolicy = min(freeMargin, maxMarginPerPositionUsd, equity×maxEquityPct)` 形成**上限**，不参与决定尺寸。live 也否证了它：**8 次里 7 次 AI 自主取到 $198.24–$198.98 名义（≈25 USDT × 8x 的 99%）**。第一条 $28.25 是 AI 自己只取 1 个 unit，不是公式压制。

## D. 最终 Canary margin 与理由

**25 USDT**（区间上限，非最小值）：`entryMarginUsd=25`、`maxMarginPerPositionUsd=25`、`dynamicMarginEnabled=false`。理由：25 USDT 的包络 ≈ $200 名义，恰好让 **p50 位移（0.87%）产出 ~$1.56、p75 产出 ~$2.66 净利**，即 `$1` 门槛在自然目标下有余量；实测 7/7 次大尺寸样本净利 $1.87–$8.01 全部过线，证明该 margin 选择正确。**没有**用加杠杆、扩大 AI target 或提高 quantityUnits 越界来凑 economics。

## E. Canary 标的与理由

**VVVUSDT**（并反驳"FILUSDT 仍是最佳"）：

- **FILUSDT 已不可用**：它在上一轮结束后被正常建仓（`FILUSDT LONG AUTO_MANAGED`），Stage 3 要求"当前无持仓"，故自动出局（这是事实变化，不是我改口径）。
- VVVUSDT：无持仓、无 pending entry、`activeClaims=0`、`activeRiskUnresolvedCount=0`、market data FRESH、`marketQuality grade B admitted`、spread 0.35–6.32 bps（18 bps 限额内）、24h 量 $1.41B、`recommendedLeverage 8`、`minNotional 5`。
- 经济性证据在"当前未被持有"的候选里最强：**24 条评估中 9 条 reach≥0.50（37.5%），6 条在 $200 尺寸下可同时过 reach 与 $1 两关（25%）**，且 `4/16` 的 SHADOW 评估曾被**人工 cap 单独**挡住；未被持有的同批候选（BTCUSDT/XRPUSDC/BCHUSDT/ADAUSDT）reach 中位数只有 0.24–0.40，明显更差。
- 唯一不利事实也如实记录：VVV 的 book 在 17:22 前后从 0.35 bps 瞬时宽到 **64 bps**（> 18 bps 限额），eligibility 因此间歇翻转（窗口内出现 `SPREAD_TOO_WIDE / MARKET_QUALITY_C / POOL_SUPPLY_SHORTAGE` 时段）。这是真实市场事实，不是隔离或参数问题。

## F. ENFORCE evaluations 数量

`ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE}` = **8 条**，全部 VVVUSDT：
`17:27:23 / 17:29:00 / 17:31:26 / 17:33:37 / 17:35:38 / 17:37:19 / 17:40:33 / 17:42:10`，来自 8 次独立 Primary 运行（`airun_mu86nkmw… / mu86pm2v… / mu86so9d… / mu86vhrv… / mu86y2e5… / mu8709ia… / mu874hcl… / mu876kd3…`，latency 56.7–61.6 s）。

## G. passed=true / passed=false 数量与 blockers

**0 passed=true / 8 passed=false**，且每条 blocker 都与事实一致：

| # | notional | targetMove | hardMax | reach | netProfit / 要求 | blockers |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | $28.25 | 1.4159% | 5.0802% | 0.5393 ✔ | **0.375 / 1** | `ECONOMIC_MIN_NET_PROFIT_UNMET` |
| 2 | $198.25 | 1.0298% | 3.9653% | **0.4947 ✗** | **1.866 ✔** | `TP_REACH_PROBABILITY_UNMET` |
| 3 | $198.24 | 1.7530% | 5.0802% | **0.4444 ✗** | 3.298 ✔ | `TP_REACH_PROBABILITY_UNMET` |
| 4 | $198.37 | 1.2540% | 3.9653% | **0.3750 ✗** | 2.313 ✔ | `TP_REACH_PROBABILITY_UNMET` |
| 5 | $198.78 | 2.7400% | 6.4720% | **0.3291 ✗** | 5.270 ✔ | `TP_REACH_PROBABILITY_UNMET` |
| 6 | $198.63 | 2.4440% | 5.0802% | **0.2747 ✗** | 4.678 ✔ | `TP_REACH_PROBABILITY_UNMET` |
| 7 | $198.80 | 4.1200% | 6.4720% | **0.1375 ✗** | 8.011 ✔ | `TP_REACH_PROBABILITY_UNMET` |
| 8 | $198.98 | 1.6950% | 3.9653% | **0.1837 ✗** | 3.196 ✔ | `TP_REACH_PROBABILITY_UNMET` |

三条结构性结论：`$1` 门槛在 25 USDT 尺寸下 **7/7 通过**；`historicalHardMaxMove` **8/8 未成为约束**（位移均 < hardMax）；**唯一实际否决者是 0.50 reachability**，其中第 2 条只差 **0.0053**。全部 8 条 blocker 中均**不含** `HUMAN_MANAGED_EXPOSURE_LIMIT`，与"该 cap 在窗口内被临时关闭"自洽。

## H. 是否出现 `passed=true`

**没有。** 且我没有为凑样本做任何人为操作：未调 0.50、未调 $1、未移动 AI target、未加 quantity/leverage、未换方向、未重复强推。

## I. AI 原始决策（8 次全部记录，证明未覆盖）

| 时刻 | decision | units | acceptablePriceRange | targetPrice | acceptableTargetRange | horizon | conf |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17:28:02 | PLACE_LONG | 704 | 28.10–28.16 | 28.45 | 28.35–28.55 | 30 min | 0.72 |
| 17:30:25 | PLACE_LONG | 709 | 27.94–27.96 | 28.45 | 28.35–28.55 | 60 min | 0.65 |
| 17:32:36 | PLACE_LONG | 711 | 27.85–27.90 | 28.25 | 28.15–28.35 | 30 min | 0.65 |
| 17:34:36 | PLACE_LONG | 713 | 27.71–27.88 | 28.644 | 28.50–29.07 | 120 min | 0.72 |
| 17:36:19 | PLACE_LONG | 714 | 27.75–27.82 | 28.50 | 28.30–28.80 | 60 min | 0.65 |
| 17:39:36 | PLACE_LONG | 714 | 27.749–27.843 | 28.99 | 28.80–29.10 | 120 min | 0.72 |
| 17:41:13 | PLACE_LONG | 710 | 27.943–28.025 | 28.50 | 28.40–28.60 | 30 min | 0.65 |

- 方向、尺寸、区间、目标全部由模型自变（units 704→714 随价格漂移自适应，target 随结构位变化，horizon 30/60/120 混用）；`quantityMutated:false`、`targetMutated:false` 8/8；`AI_SIZING_ERROR` 0 次
- `quantity = units × stepSize(0.01) = 7.04–7.14 VVV`，`× maxPrice ≈ $198`，**未触及也未超出** `maxQuantityUnits`（$200/价格）⇒ 无 clamp

## J. JIT economics 结果

**未观测（结构性不可达，不是漏采）**。JIT 复算只在 `entryCoordinator.ts:176-178`（`executionHardBlock`，需 `order && intent.profitTakePlan && executionEnvelope && mode==='ENFORCE'`）触发，而它位于 `submitExactlyOnce` 内、**EntryIntent 创建之后**；8/8 在 :336 就被 ENFORCE 经济性阻断，从未产生 intent/order。

为下一轮准备好判据（本轮已用源码确认）：JIT 检查在 :181 发布 `FINAL_ORDER_RISK_EVALUATED` **之前**，因此

- `passed=true` + `FINAL_ORDER_RISK_EVALUATED` + `ENTRY_SUBMIT_ATTEMPTED` ⇒ JIT 以**实际委托价**接受，允许写交易所；
- `passed=true` + `ENTRY_ORDER_BLOCKED{stage:'BINANCE_SUBMIT', reason:<economic blocker>}` 且**无** `FINAL_ORDER_RISK_EVALUATED` ⇒ JIT fail-closed，未提交（按 Stage 8，这是有效 PASS）。

窗口内 `FINAL_ORDER_RISK_EVALUATED = 0`、`ENTRY_ORDER_BLOCKED = 0`，与该链路从未进入提交阶段一致。

## K. 是否创建 EntryIntent

**Canary 标的 VVVUSDT：0。** 每条评估后 29–130 ms 内 `ENTRY_DECISION_BLOCKED{stage:'ECONOMIC_ADMISSION'}` → `CANDIDATE_REJECTED{entryIntentCreated:false}`（8/8）。

（时间归属已严格核对：`17:18:22 VVVUSDT`、`17:19:39–45 ADAUSDT` 的 intent/submit/order 发生在 **v182 隔离 PUT 之前**；`17:43:33 BTCUSDT`、`17:44:48 BCHUSDT` 发生在 **v184 恢复之后**，均为正常 SHADOW 流量。窗口内 `17:22:36–17:42:16` 除 8 条 VVV ENFORCE 评估外，**任何标的的 intent/submit/order/position 事件 = 0**。）

## L. 是否提交 Maker order

**0。** `ENTRY_SUBMIT_ATTEMPTED` 在窗口内为 0，对交易所的建仓写请求为 0。

## M. 是否建单 / 成交 / 形成 Position

**全部 0**：`ENTRY_ORDER_CREATED` 0、成交 0、VVVUSDT 无持仓（恢复后 live 复核：24 持仓中不含 VVVUSDT）。

## N. `economicAdmission` 是否持久化

Canary 侧 **n/a**（无 intent、无持仓）。同一持久化路径在窗口外仍正常：恢复后 BTCUSDT/BCHUSDT 的 SHADOW intent 均带 `economicAdmission{version:'V3.9.5', mode:'SHADOW', passed:false, …}` 落盘，说明 `entryCoordinator.ts:342` 的字段写入没有被本轮改动破坏。

## O. TP 是否进入 V3.9.5 economic-validated 路径

**未观测**（`tpGuardian.ts:65` 的让位分支要求 `mode==='ENFORCE' && passed && blockers.length===0` 的持仓证据；本轮没有任何新仓，因此既未触发让位、也**不应**被记为 PASS）。反向边界依旧成立：存量 24 仓全部沿用 legacy 规则，无一个 TP 被重建或拉远。

## P. 旧仓 TP 是否零影响

**零影响。** 与 `17:16:51` 基线逐字段对比：`positions before/after 24/24`、`changed rows 0`、`tp protected 24 → 24`、`missing/duplicate/orphan/qtyMismatch/wrongSide/retryQueue` 全程 0，24 个存量仓的 `tpOrderId / tpPrice / targetPrice / acceptableTargetRange / quantity / managementStatus` 完全未变；窗口内 `TP_CANCELLED / TP_MOVED / TP_REPAIRED = 0`。

另需注意（非本轮造成）：窗口内 SHORT 侧余量被正常 SHADOW 活动继续消耗到 $0.08，`equity` 由 $10,731.93 变为 $10,679.58，`gross` $7,634.70 → $7,677.73——均为存量持仓 mark 漂移与 17:19 那张 ADAUSDT 真实挂单所致。

## Q. durable claims / UNKNOWN 是否正常

- `activeClaims 0 → 0`、`activeUnknownClaims 0`、`releasedClaims/releasedUnknownClaims 17/17` 全程不变；`DURABLE_TASK_EXISTS` **0**
- `historicalUnknownCount 18 → 18`（**未删一条**），`unresolvedDriftCount 0`、`verifiedOrderFactMismatchCount 0`、`verifiedNoActiveRiskReleaseCount` 持续增长（reconciliation 正常复核）
- `durableTasks 252 → 253` 发生在**恢复之后**（BTCUSDT/ADAUSDT 正常新建仓）；Canary 标的 VVV 的 scope 无任何 active 占用（`entry_execution_tasks` 查询 `LIKE '%VVV%'` = 0 行 active）

## R. 429 / 418 / egress

`http429 17 → 17`、`http418 3 → 3`、`lastLimitedAt` 保持 `1789694699483`（未更新）、`status AVAILABLE`、`queued 0`、`observedWeightAnomaly false` ⇒ **零新增限流**。egress 全程 `VERIFIED`（`172.104.186.174` = 期望值），并在窗口内由 `appRuntime.ts:499` 的 15 分钟任务自动重证（`1789810198511 = 17:29:58`）、恢复后再证一次（`17:44:58`）；**未调用任何人工探针**。

## S. 是否完整恢复 SHADOW + HUMAN cap + 原 Settings

**已完整恢复，9/9 字段逐项等值**（`canary-apply.py verify original` @ v184 全 `OK`），且恢复由 monitor 的 `finally` 自动执行（`stopReason=ALL_CANDIDATES_REJECTED_BY_ECONOMICS`），会话中断也会恢复：

| 字段 | 恢复值 |
| --- | --- |
| `tradeEconomics.admissionMode` | SHADOW |
| `positionManagement.humanManagedAdmissionCapsEnabled` | true（`maxHumanManagedPositions=4`、`maxHumanManagedNotionalPctEquity=0.2` 全程未改） |
| `selection.mode` / `customSymbols` | COMPREHENSIVE_MAINSTREAM / `[]` |
| `portfolio.maxPositions` / `maxPendingEntries` / `entryMarginUsd` | 50 / 6 / 200 |
| `portfolioIntelligence.dynamicMarginEnabled` / `maxMarginPerPositionUsd` | true / 500 |
| `takeProfit.minNetProfitUsd` / `tradeEconomics.minHistoricalReachProbability` | 1 / 0.5（**从未改动**） |

恢复后：`noEntryReason null`、`exec 4`、`routed` 6 个标的、`fresh FRESH 105`、7 个健康子服务全 `HEALTHY`、`reconciliation READY`、`capacity used 25/50`（24 持仓 + 恢复后新建仓产生的 1 张在途预留）、普通 Entry 调度已复现真实自动建仓（BTCUSDT/BCHUSDT intent、ADAUSDT 挂单）；`productionWrites` 依旧为 0（`environment TESTNET`、REST `demo-fapi.binance.com`、`failClosed true`）。

## T. 是否已经具备进入"正式 ENFORCE 策略参数决策"的证据条件

**比上一轮强得多，但仍缺最后一寸，且缺口位置已经明确。**

已 live 证明：ENFORCE 决策链路可在真实候选上被触发（8 次）；`passed=false` 时 fail-closed 完整（0 intent/0 submit/0 order）；AI 自主权未被触碰（含 units 随价自适应）；25 USDT 下 `$1` 门槛 7/7 通过；`hardMaxMove` 非约束；0.50 reachability 是真实有效的否决者；旧仓/旧 TP/claims/UNKNOWN/限流/egress 零影响；两段式受控进入与自动恢复可用。

仍缺：`passed=true → JIT（实际委托价）→ Maker 提交 → 成交 → V3.9.5 经济验证 TP` 这条正向闭环（J/M/N/O 全为"未观测"）。因此**现在还不能把"全局切 ENFORCE"当作已被 live 验证过的决策**——尤其不能据此判定 0.50 阈值在生产尺寸下的真实建仓率（本轮 8 次里 0/8，而 24 样本历史比率约 25%，两者差异本身就是需要更长窗口才能收敛的统计量）。

## U. 对现行设计与我自己上一轮建议的反驳与改进

1. **反驳"必须靠更大保证金才能拿到正向样本"**：25 USDT（硬上限内）已让 `$1` 门槛 7/7 通过、`hardMax` 8/8 不约束，**否决者只有 0.50 reachability**。所以正向腿卡住的原因不是 margin，而是候选的可达性画像。上一轮我给"$1 vs 5 USDT"算的是**门槛可达性**，这一点仍然成立；但我把它说成"5 USDT 只能证明拒绝腿"的唯一原因，不够准确——真正决定尺寸的是 AI 自取的 `quantityUnits`（`aiQuantityAllocation.ts:13`），保证金只给包络上限（见 C）。
2. **反驳"必须拿成交才算成功"**：本轮 0 成交仍是有效实验——它把否决因子从"人工 cap / 敞口预算"收窄到唯一一个真实安全阈值，并证明该阈值确实在工作。按 Stage 7，我**没有**把 0.50 调低、也没有改用更宽标的来"制造" `passed=true`。
3. **反驳"现在一定有 exposure headroom"**：SHORT 侧已经没有（$0.08），LONG 侧有 $3,014；如果本轮 AI 全部自主选 SHORT，就会退化为容量拒绝而非经济性拒绝。下一轮必须把这个不对称写进前提，而不是事后解释。
4. **我自己的失误（要写进流程）**：初始 `maxPositions` 我用"持仓数 24 + 1"，但 `capacity.used` 含 in-flight + reserved（`runtimeState.ts:57-61`），PUT 时恰有一张在途预留，导致 `used 25 ≥ max 25` 短暂把 Canary 一起冻住（17:22–17:24）。改为**按 `entryCapacity().used + 1` 动态取值**即可避免；这条应固化进 Canary 手册。
5. **停止阈值定得太低**：Stage 10 条件 3 授权我"足够证明候选仍全部被拒"即停，我把阈值设为 8 次；按 VVV 历史 25% 单样本通过率，8 次全拒的概率本就有 **0.75⁸ ≈ 10%**，也就是说本轮"0 放行"里有相当成分是抽样运气。**改进**：正向窗口按 `attempt budget ≥ 16–20`（约 30–40 分钟、每次 ~100 s）设停止线，或按 `P(至少一次放行) ≥ 98%` 反推次数；否则"未获正向样本"不能作为参数决策的证据上限。
6. **标的筛选应换成可达性画像优先**：Stage 3 现在的排序偏"经济性/历史被 cap 单独挡"，这在上轮合理（当时否决者是 cap），本轮否决者变成 reachability，就应改为按 **`历史 P(reach≥0.5 且 move 覆盖 $1@该尺寸)`** 排序（本轮该口径下 VVV=6/24=25%，BTCUSDT/XRPUSDC/ADAUSDT 明显更低）。建议把这一指标固化成 Canary 标的筛选函数，而不是每次手算。
7. **对 ENFORCE 参数决策的建议**：`minNetProfitUsd=1` 在 ≥$100 名义下几乎不构成约束（本轮实测 7/7 通过，净 $1.87–$8.01；历史 76 条 >$210 样本中 75 条通过），真正决定建仓率的是 `minHistoricalReachProbability=0.50`（全量 216 条带 reach 观测的评估中仅 **71 条 ≥ 0.50，即 32.9%**）。因此**正式参数应把"建仓率 vs 可达性阈值"作为主决策轴**，`$1` 只是随附的地板；且阈值调整必须用带未来数据泄漏防护的前向窗口重标定（沿用上一轮 Stage 3 的 sweep 方法），而不是用本 canary 的 8 个样本。

---

### 附：硬边界自检

未改 `maxGrossExposurePct` / `maxDirectionExposurePct`（A 表原值 1.0 / 0.5）｜未减仓、未自动处置任何 HUMAN_MANAGED｜`minNetProfitUsd=1`、`minHistoricalReachProbability=0.50` 全程未改｜AI side/quantityUnits/acceptablePriceRange/targetPrice 未干预（8 条自主决策见 I）｜唯一退出链未改｜historical UNKNOWN 18 条一条未删｜Binance request governance 未改｜未人工指定 LONG/SHORT｜未为通过 Canary 篡改 AI target/quantity｜未进入生产（TESTNET + `demo-fapi.binance.com` + `failClosed true` + `productionWrites 0`）｜Engine 未重启（PID 9680、`restartCount 161` 不变，全程热应用）｜cap 例外仅 16 分 05 秒且自动恢复（Stage 11 逐项核对见 S）。
