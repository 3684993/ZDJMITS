# ZDJ-MITS V3.9.5｜受控 ENFORCE Canary 报告（2026-09-19）

- 实施依据：`docs/prompts/ZDJ-MITS-V3.9.5-受控ENFORCE-Canary-Codex提示词-2026-09-19.md`（commit `3da1cc3`）
- 分支 / HEAD：`v395-economics-human-managed-20260919` @ `3da1cc3`（tracked 工作树干净）
- live 构建：`3.9.5-57b2843729dff7a298a9`，PID 9680，instanceId `1c6cc310-45d8-4edb-9324-df710f98daf1`
- 构建身份：部署构建对应 `4770a21`；`git diff 4770a21..HEAD -- apps packages` 为空 ⇒ 运行中的构建与 HEAD **代码完全一致**（其间仅 3 个 docs 提交）
- Canary 窗口：**14:03:17 → 14:38:54（35 分 37 秒，84 次采样）**，settingsVersion `179 → 180（进入）→ 181（恢复）`
- **结论：Stage 1 隔离门槛通过；ENFORCE evaluation 真实发生 3 次，全部 `passed=false` 且真实 fail-closed；未产生任何 EntryIntent / 订单 / 持仓；旧仓 TP 零影响；窗口结束自动恢复 SHADOW + cap 原值。**

---

## A. Canary 隔离机制

系统中**唯一**的"白名单"是 `selection.mode='CUSTOM_SYMBOLS'` + `selection.customSymbols`，且被**两道独立关卡**执行：

| 关卡 | 代码 | 效果 |
| --- | --- | --- |
| 资格层 | `packages/core/src/selection.ts:36` → `NOT_IN_CUSTOM_SYMBOLS` → `eligible:false`（:48） | 候选不进入 `pool.refreshReadyView`（`apps/engine/src/services/entryCoordinator.ts:85` 要求 `candidate.eligible`），永不 READY，Primary 永不被调度 |
| 提交层 | `apps/engine/src/services/entryCoordinator.ts:165-166` | 即使 PLACE 已返回，`executionHardBlock` 在唯一 `placeEntry` 调用点前抛 `MARKET_QUALITY_NOT_ADMITTED`（:197） |

live 实测（进入 Canary 后 12 秒）：`eligible = [('FILUSDT', 1)]`，`routedCandidates = ['FILUSDT']`，`capacity 15/16`，`pending max 1`。整个窗口内**非 Canary 标的的 entry 路径事件 = 0**。

三项必要的机制性澄清（不是放宽，而是本轮事实）：

1. **entry-only pause 与 Canary 互斥，未使用。** `runtimeControlService.canDispatch()` 与 `entryCoordinator.ts:159/326` 在 `runtimeControl.mode!=='RUNNING'` 时拒绝**一切**提交；`POST …/trading-control/pause` 会把 Canary 一起冻结。白名单已完整表达"普通 Entry 暂停"，且是单原子 PUT，避免"ENFORCE 已开、隔离未生效"的中间窗口。
2. **`maxPositions=1` 在 15 持仓下不可用。** `runtimeState.ts:57-61` 的 `used` 含现有持仓，`preAiExecutionEnvelope.ts:50` 会同时掐死 Canary。故取 **`maxPositions=16 = 15+1`**，严格保持"最多新增一个持仓"的原意；此偏离在此明示，未静默。
3. **隔离不影响任何存量运行。** `tpGuardian.ts:21` 起不读任何选择名单；`grep exclud|blacklist|assetDirectory` 在 `tpGuardian/positionService/reconciliationService/positionLifecycleTracker/exchangeLoop/manualPositionService` 中 **0 命中**；行情留存由 `marketCohort.ts:10-12`（`positionSymbols + activeEntrySymbols + BTC/ETH`）保护，`appRuntime.ts:515` 继续刷新 protected symbols。窗口内 `market count 80→85`、`FRESH`、13 个存量仓 WS/TP 维护正常。

恢复同理：字段级 PUT + `settingsVersion` CAS，未重启 Engine（`applySavedSettings` `appRuntime.ts:599-603` 热应用 `setSettings + new DynamicPool + universe.refresh + runtimeControl.evaluate(true)`）。

## B. Canary 标的与依据

**FILUSDT**（USDT 本位）。依据：

| 项 | 事实 |
| --- | --- |
| 历史经济性 | 09:46 以来 5 次 SHADOW 评估，其中 **1 次唯一 blocker 就是 `HUMAN_MANAGED_EXPOSURE_LIMIT`**；mean reach **0.664**，mean 预期净利 **$6.06** |
| 当前资格 | eligible **rank 3**、marketQuality **grade B admitted**、spread 7.06 bps、24h 量 $968M |
| 无冲突 | 无 FIL 持仓（含其它计价合约）、无 active durable claim（`activeClaims=0`）、无未解决风险（`activeRiskUnresolvedCount=0`） |
| 附带价值 | 该标的有 1 张 historical UNKNOWN（`entry_intent_mu7pl054_0zap65tp`，claim 已按交易所事实证明释放）→ 顺带在 live ENFORCE 路径上复验 durable claim 修复 |

注：`FILUSDT` 在进入 Canary 前一刻曾因 `DUPLICATE_UNDERLYING_CONTRACT`（`packages/core/src/portfolio.ts:577`）被判非优；白名单生效后 FILUSDC 变不可选，FILUSDT 自动成为 chosen（rank 1，reasons 空），无需任何人为干预。

方向、`quantityUnits`、`acceptablePriceRange`、`targetPrice` 全部由 Primary AI 自主产出（见 E/F）。

## C. 启动前 Settings（179）→ Canary（180）→ 恢复（181）

| 字段 | 启动前 | Canary | 恢复后 |
| --- | --- | --- | --- |
| `tradeEconomics.admissionMode` | SHADOW | **ENFORCE** | SHADOW |
| `positionManagement.humanManagedAdmissionCapsEnabled` | true | **false（临时例外）** | true |
| `selection.mode` | COMPREHENSIVE_MAINSTREAM | **CUSTOM_SYMBOLS** | COMPREHENSIVE_MAINSTREAM |
| `selection.customSymbols` | `[]` | **`["FILUSDT"]`** | `[]` |
| `portfolio.maxPositions` | 50 | **16** | 50 |
| `portfolio.maxPendingEntries` | 6 | **1** | 6 |
| `portfolio.entryMarginUsd` | 200 | **5** | 200 |
| `portfolioIntelligence.dynamicMarginEnabled` | true | **false** | true |
| `portfolioIntelligence.maxMarginPerPositionUsd` | 500 | **5** | 500 |

**全程冻结未动**：`takeProfit.minNetProfitUsd=1`、`tradeEconomics.minHistoricalReachProbability=0.5`、`parameterProfile=CUSTOM`、`historicalTpReachabilityEnabled=true`、`maxHumanManagedPositions=4`、`maxHumanManagedNotionalPctEquity=0.2`、`riskGovernance.entrySafetyMode=AUTO`、`connections.executionMode=TESTNET_ENABLED`、`environment=TESTNET`。`riskGovernance.maxGrossExposurePct=1 / maxDirectionExposurePct=0.5` 亦**未改**（见 Q）。

启动前其余快照：15 持仓（AUTO 6 / HUMAN 9）、**15/15 TP PROTECTED**、`historicalUnknownCount 15`、`activeClaims/activeUnknownClaims 0`、`releasedUnknownClaims 14`、`durableTasks 224`、equity $10,643.04、USDT available 4,021.98 / USDC 4,430.95、`http429 17 / http418 3`（lastLimitedAt `1789694699483`）、egress `VERIFIED 172.104.186.174`、p0 `passed:true`。

## D. ENFORCE evaluation 数量

- `ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE}`：**3 次**，全部 FILUSDT（`1789799254340 / 1789799683000 / 1789799922234`）
- FILUSDT Primary 运行：**6 次**（`PRE_AI_EXECUTION_ENVELOPE_CREATED` 6 次，latency 54.5–58.1 s，model `qwen/qwen3.8-27b`）；其中 **3 次**止步于更早的 `POST_PRIMARY_EXECUTION_ENVELOPE / AI_DIRECTION_NOT_EXECUTABLE`（AI 提 LONG，该瞬间 LONG 侧无客观容量），**3 次**抵达 ENFORCE 经济性关卡
- 窗口内 `ENTRY_ECONOMIC_ADMISSION_EVALUATED` 总数 4 = 上述 3 + 恢复后 BCHUSDT 的 1 条 **SHADOW**（正常回归流量，非 Canary 样本）

**为什么需要等 23 分钟才出现第一条评估**：启动 Canary 时全系统 `executableCandidateCount=0`（见 Q），直到 14:26:29 / 14:37:00 两张既有 TP 成交释放敞口，容量才真实打开。没有任何容量是我人为制造的。

## E. passed / blocked 与 blocker

3/3 **全部 `passed=false`**，且 `quantityMutated:false`、`targetMutated:false`。逐条核对 blocker 与事实一致：

| # | AI 侧 | 名义 | targetMove | hardMaxMove | reach | 预期净利 / 要求 | blockers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | SHORT | $39.71 | 1.7161% | 3.3108% | **0.0909** | **0.6468 / 1** | `ECONOMIC_MIN_NET_PROFIT_UNMET` + `TP_REACH_PROBABILITY_UNMET` |
| 2 | SHORT | $39.61 | 0.6760% | 3.3108% | **0.3933** | **0.2331 / 1** | 同上 |
| 3 | LONG | $39.73 | 1.3896% | 5.1279% | 0.8194 ✔ | **0.5169 / 1** | `ECONOMIC_MIN_NET_PROFIT_UNMET` |

一致性复核（手工重算，全部吻合）：

- run 1 SHORT：入场价取 `range.min=0.9615`、target `0.945` → `|0.945/0.9615-1|=1.7161%` ✔；`1.7161% < hardMax 3.3108%` 故**未**报 `TP_HISTORICAL_REACHABILITY_UNMET` ✔；`0.0909 < 0.50` → reach blocker ✔；毛利 `39.71×1.7161%=0.6814`，费用约 0.0346 → **0.6468** ✔
- run 3 LONG：入场 `range.max=0.9715`、target `0.985` → `1.3896%` ✔；reach `0.8194 ≥ 0.5`、`1.3896% < 5.1279%` → **可达性通过**，仅 `$1` 净利下限阻断 ✔；`39.73×1.3896%=0.5520` − 费用 0.0350 = **0.5169** ✔
- blocker 中**不含** `HUMAN_MANAGED_EXPOSURE_LIMIT` —— 与"该 cap 在窗口内被临时关闭"一致；即经济性拒绝与人为例外无关，是独立真实判定

## F. AI 自主输出（未被覆盖）

无 `passed=true` 样本；仍记录 AI 原始决策以证明未人工指定：

| run | decision | tradeSide | quantityUnits | acceptablePriceRange | ideal | TP target / 区间 | horizon | conf |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `airun_mu808czq_w95fx9l5` | PLACE_SHORT | SHORT | **413** | 0.9615 – 0.9625 | 0.962 | 0.945 / [0.94, 0.95] | 30 min | 0.65 |
| `airun_mu80hgx7_30cgfzgz` | PLACE_SHORT | SHORT | **412** | 0.9615 – 0.9635 | 0.9625 | 0.955 / [0.954, 0.956] | 30 min | 0.65 |
| `airun_mu80mmm5_snj40elp` | PLACE_LONG | LONG | **409** | 0.9680 – 0.9715 | 0.9697 | 0.985 / [0.98, 0.99] | 120 min | 0.65 |

- 方向由 AI 在 SHORT/LONG 间自然切换（2 SHORT + 1 LONG），engine 仅记录同一方向（`CANDIDATE_REJECTED.direction` 与 AI `tradeSide` 逐条相等）
- `quantityUnits` 409–413 均在 envelope 上限内（名义 ≈ $39.7 = 5 USDT 保证金 × 8 倍），**无 clamp**；`AI_SIZING_ERROR` 事件 **0**
- 6 次运行 `status=COMPLETED`、`finishReason=stop`、`error=null`；`parserRepaired=true` 是该模型**全天普遍状态**（今日 PRIMARY_BRAIN 运行 True 379 / False 61 / None 23，窗口之前即如此），非 Canary 引入，也未被用来强行通过

## G. 是否创建 EntryIntent

**Canary 标的：0。** 三条评估后 29–44 ms 内即 `ENTRY_DECISION_BLOCKED{stage:'ECONOMIC_ADMISSION'}` → `CANDIDATE_REJECTED{entryIntentCreated:false}`。窗口内 FILUSDT `ENTRY_INTENT_CREATED` = **0**（`entryCoordinator.ts:336` 在 :350 之前 return，符合设计）。

（14:40:01 恢复 SHADOW 后 BCHUSDT 有 1 条 `ENTRY_INTENT_CREATED`，其 `economicAdmission` 持久化为 `{mode:'SHADOW', passed:false, blockers:[TP_REACH_PROBABILITY_UNMET, HUMAN_MANAGED_EXPOSURE_LIMIT]}` —— 正是 SHADOW"记录但不阻断"的既有语义，属回归正常而非 Canary 残留。）

## H. 是否提交 / 建单 / 成交

FILUSDT：`ENTRY_SUBMIT_ATTEMPTED` **0**、`ENTRY_ORDER_CREATED` **0**、成交 **0**、新持仓 **0**。窗口内对交易所的建仓写请求为 0。

## I. JIT economics 是否一致

**未触发**，因为没有订单可进入 JIT 复核：JIT 复算位于 `entryCoordinator.ts:176-178`（`mode==='ENFORCE'` 且 `intent.profitTakePlan && executionEnvelope` 时，用**实际委托价** `order.price` 重算并以其首个 blocker 阻断）。可在 live 侧证明的是同一条链路的上游判定（E 表算术自洽）。JIT 分支本身由既有确定性契约覆盖：`economicEntryFeasibility.test.ts`『rejects insufficient net profit instead of enlarging quantity』『rejects a target outside observed historical reachability』，以及 `executionLifecycle.integration.test.ts` 的 quantity/authorization 守卫。本轮**不**把未观测到的 JIT 分支记为 live PASS。

## J. 若形成 Position：`economicAdmission` 持久化

**n/a**：Canary 未形成持仓。持久化结构本身已由 `entryCoordinator.ts:342` 写入 intent（`{version:'V3.9.5', mode, passed, validatedAt, expectedNetProfit, requiredNetProfit, reachProbability, historicalHardMaxMovePercent, blockers}`），且恢复后 BCHUSDT 的 SHADOW 记录证明该字段在真实链路上正常落盘。

## K. TP 是否按 V3.9.5 ENFORCE 规则处理

Canary 无新仓，故无 V3.9.5 经济验证 TP 产生。同时验证了**反向边界**：`tpGuardian.ts:65` 的 sub-1.2% 让位仅在 `economicAdmission.version==='V3.9.5' && mode==='ENFORCE' && passed && blockers.length===0` 时生效；窗口内存量 13–15 个仓的 TP 全部沿用 legacy 规则，**未出现任何 cancel / move / rebuild**。相关契约：`tpGuardianEconomics.test.ts`『allows a V3.9.5 economically-admitted AI TP below the legacy 1.2% distance floor』『keeps the legacy 1.2% distance floor for a position without V3.9.5 ENFORCE admission evidence』『never cancels, moves or rebuilds a legacy protected TP whose net profit is below the $1 floor』。

## L. durable claim 是否正常

- 窗口内 `activeClaims 0`、`activeUnknownClaims 0`、`releasedUnknownClaims 14` 全程不变；`DURABLE_TASK_EXISTS` 事件 **0**
- Canary 标的 FILUSDT 带 1 张已释放的 historical UNKNOWN，**未阻塞**新评估（这正是上一轮修复在 live ENFORCE 路径上的复验）
- 无旧 intent 重放、无旧 clientOrderId 复用；恢复后 `durableTasks 224 → 225`（BCHUSDT 新单），`activeClaims 1` 对应那张**真实在途**订单，属正常占用

## M. 旧仓 TP 是否零影响

持仓 15 → 13，两笔减少均为**既有 TP 在既有价位成交**：

| 标的 | 成交 | clientOrderId / 引擎记录 id | TP 价（=基线） | 已实现盈亏 | 建仓时间 |
| --- | --- | --- | --- | --- | --- |
| SOLUSDT SHORT | 14:26:29 @ 111.36 | `tp_mu7xh7zr_002ce77` / `tp_mu7xh7zr_3gyd6nne` | 111.36 | **+3.9304** | TP 建于 13:09:37（Canary 前） |
| UNIUSDC LONG | 14:37:00 @ 9.202 | `tp_mu7gfggx_004b8f9` / `tp_mu7gfggx_qph7zizz` | 9.202 | **+45.1000** | TP 建于 05:12:23（Canary 前） |

要点（避免误读）：

1. **两个 id 不是"TP 被换过"**：`tp_*_3gyd6nne` 是引擎本地实体 id，`tp_*_002ce77` 是同单的交易所 clientOrderId（`TP_SUBMISSION_PREPARED/TP_PROTECTED` 事件同条携带两者）。基线比较脚本此前只打印 `tpOrderId`，一度看似 id 漂移，已用 `ai_runs/tpOrders/runtime_events` 三处交叉证伪。
2. 14:27:09 的 `ORPHAN_TP_CANCELED{orderId:'tp_mu7xh7zr_002ce77', positionId:'exchange-unknown', reason:'NO_MATCHING_POSITION'}` 是该仓平掉 **40 秒后**对交易所残留保护单的清理，不是平仓动作本身（成交在先）。
3. UNIUSDC 是 HUMAN_MANAGED 且基线浮亏 −42.71，其退出是**人工持有的多头在 9.202 盈利位自然成交**（+45.10），不存在"自动平亏损仓"。
4. 其余 13 仓 `tpOrderId / tpPrice / targetPrice / range / quantity` 与基线逐字段一致，`protected==required` 恒成立，`duplicateTp/orphanTp/missing/qtyMismatch/wrongSide` 全程 0。
5. 另有 3 条 `POSITION_HUMAN_HANDOFF{reason:'LOSS_HANDOFF_BARS', tpRetained:true}`（DOTUSDT 14:02:21、ZECUSDT/BNBUSDC 14:16:45）——引擎既有 `lossHandoffBars=4` 策略，未被我修改（该值与 `humanHandoffAfterMinutes` 都不在改动清单内），且 `tpRetained:true` 证明转人工不撤 TP。**未自动平任何 HUMAN_MANAGED。**

## N. 429 / 418 前后

`TESTNET:proxy-a087cc91667b` 计量器：`http429 17 → 17`、`http418 3 → 3`、`lastLimitedAt` 保持 `1789694699483`（未更新）、`status AVAILABLE`、`queued 0`。窗口内**零新增限流**；Binance request governance 未做任何修改。

## O. egress 状态

全程 `VERIFIED`，期望出口 IP `172.104.186.174` = 实测一致；`lastVerifiedAt 1789797596350（13:59:56）→ 1789799396058（14:29:56）`，即 `appRuntime.ts:499` 的 15 分钟自动重证在窗口内**自行触发**。**未调用任何人工探针**，`TESTNET_WRITE_EGRESS_NOT_VERIFIED` 事件 0，WS `LIVE`、`reconnects/gaps` 无新增。

## P. 结束后是否已恢复 SHADOW + HUMAN cap

**已恢复，9/9 字段逐项等值**（`canary-apply.py verify original` → 全 `OK`，`mismatches NONE`，settingsVersion 181）。恢复由 `canary-monitor.py` 的 `finally` 分支自动执行（`stopReason:SAMPLE_TARGET_MET`），即使本会话中断也一定会恢复。

恢复后 live 复核：`noEntryReason null`、`state RUNNING`、`eligibility READY 13`、`exec 13`、`universe 95`、`fresh FRESH 100`、`reconciliation READY / historicalUnknown 15 / activeRiskUnresolved 0 / unresolvedDrift 0`、7 个健康子服务全 `HEALTHY`、cap 数值 `4 / 0.20` 原样。普通 Entry 调度已恢复并立即产生真实自动建仓（14:40 BCHUSDT 限价尝试后被交易所 CANCELED，14:42:57 APTUSDT LONG 10 @ 0.7145 成交开仓），当前 **14 持仓 / 14 TP PROTECTED**、`pending 0/6`、`capacity 14/50`。上述恢复后活动发生在 settingsVersion 181（SHADOW + cap 全量生效）之后，与 Canary 无关。

## Q. 是否具备进入"正式 ENFORCE 参数决策"的技术条件

**技术条件成立了一半：链路与安全性已被 live 证明；"能放行"这一半尚未证明，且原因不是 economics。**

已 live 证明（Stage 9 的 1–3、5–12，共 **11/12 条**）：隔离有效；ENFORCE 评估真实发生；`passed=false` 真实 fail-closed（0 intent / 0 submit / 0 order）；AI side / quantity / range / target 未被覆盖、quantity 无 clamp；durable claim 修复在 live ENFORCE 路径正常；egress 自动验证正常；旧仓与旧 TP 完全隔离；结束恢复原值；429/418 零新增；无生产写入。**唯一未达成项（第 4 条）**：`passed=true` 才允许执行这一正向分支**在 live 未出现样本**（I/J/K 三条因此只能标 n/a，不能记 PASS）。

进入正式决策前必须先解决的两个真实约束：

1. **系统级约束是组合敞口预算，而不是经济性。** 启动 Canary 时 equity $10,643.04、gross $10,747.73 已超 `maxGrossExposurePct=1.0`（超 $104.69），long $5,406.11 / short $5,341.63 双双超 `maxDirectionExposurePct=0.5`（$5,321.52）⇒ `remaining.gross/direction=0`，15 个候选全部 `REJECT_GROSS_EXPOSURE|REJECT_DIRECTION_EXPOSURE`（`executableRiskHeadroom.ts`：`gross = 持仓 + 在途敞口`，而 15 张 historical UNKNOWN 经 `entryOrderOccupiesRisk` 过滤后贡献 0，已排除误判）。也就是说：**只要人工扛单账本不被消化，ENFORCE 开或关都建不了仓，SHADOW 也一样。** 需要人工决定：消化/减仓 HUMAN_MANAGED，或明确调整 `maxGrossExposurePct/maxDirectionExposurePct`（本轮我拒绝改动，属越界放宽）。
2. **5 USDT Canary 保证金与 `$1` 净利下限数学上冲突。** 5 USDT × 8x ≈ $39.7 名义，`$1` 下限要求到位约 **2.61%**（$1/39.7 = 2.52%，再加约 0.088% 往返费用与安全垫）；而 AI 实际给出的 target 位移只有 **0.676%–1.716%**，且 run 1 的 `hardMaxMove 3.3108%` 意味着 ≥2.6% 的目标已贴着历史可达上限。所以本轮 Canary 结构上**只能证明拒绝腿，不能证明放行腿**。建议下一轮 Canary 保证金 **15–25 USDT**（$1 下限对应到位净位移降到约 0.92%–0.59%，与 AI 自然目标位移区间重叠），并在 TP 成交释放敞口的窗口内执行。

配套量化（V3.9.5 全量 SHADOW 证据，09:46 起 126 条评估，覆盖当前实例）：`HUMAN_MANAGED_EXPOSURE_LIMIT` 出现 **126/126 = 100%**；**仅** lift 该 cap 时可通过 ENFORCE 的 **25/126 = 19.8%**；其余 blocker 频次 `TP_REACH_PROBABILITY_UNMET 78`、`ECONOMIC_MIN_NET_PROFIT_UNMET 54`、`TP_HISTORICAL_REACHABILITY_UNMET 6`；`reach ≥ 0.50` 占 38.1%。即：cap 例外之外，**0.50 可达性与 `$1` 下限各自仍在真实否决**，二者都不需要为了建仓率放宽。

**建议的下一步（互斥，交人工裁决）**：(a) 先由人工消化 HUMAN_MANAGED 敞口，再以 15–25 USDT 保证金重跑一次受控 ENFORCE Canary，目标拿到 `passed=true → EntryIntent → 限价 → 成交 → V3.9.5 经济验证 TP` 的完整正向样本；(b) 若短期内不消化敞口，则正式 ENFORCE 参数决策只能建立在"拒绝腿已验证、放行腿待验证"的现有证据上，不应视为可全局切 ENFORCE 的充分条件。

---

### 附：硬边界自检

全局长期关闭 cap：否（35 分 37 秒后自动恢复）｜修改 HUMAN cap 数值或语义：否（4 / 0.20 原样）｜自动平 HUMAN_MANAGED：否｜修改 `minNetProfitUsd=1`：否｜修改 `minHistoricalReachProbability=0.50`：否｜干预 AI side/quantity/range/target：否｜修改唯一退出链：否｜删除 historical UNKNOWN：否（仍 15）｜修改 Binance request governance：否｜人工指定 LONG/SHORT：否｜为通过 Canary 人为改 target/quantity：否（3 次拒绝均未放宽阈值）｜进入生产：否（`environment TESTNET`、REST host `demo-fapi.binance.com`、`failClosed true`）。Binance Demo/Testnet、static egress、Maker Entry、quantity 禁 clamp、HUMAN_MANAGED 人工扛单**全部保持**；Engine **未重启**（PID 9680 全程不变，`restartCount 161`）。
