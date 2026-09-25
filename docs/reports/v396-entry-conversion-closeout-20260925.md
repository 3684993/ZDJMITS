# V3.9.6 — PLACE→Submit 转化率与执行可观测性最终闭合轮（2026-09-25）

任务书：`docs/plans/v396/CODEX-V396-ENTRY-CONVERSION-AND-EXECUTION-VISIBILITY-CLOSEOUT-20260925.md`
产品分支：`codex/v396-final-convergence-20260922`
证据目录：`docs/evidence/v396/entry-conversion-closeout-20260925/`

## 0. 结论（先给判定）

- SHADOW 模式下把历史可达性 ceiling 当硬 veto 的错误已修复，改为记录证据并保留候选；ENFORCE 语义不变。
- 每条 Primary Run 现在都有 Engine 自己折叠事件日志得到的执行结果（已挂单 / 未挂单 · 层 · 首因 / 等待价格 / 正在执行 / 部分成交 / 已成交），Dashboard 只做显示。
- 真实 Testnet 提交链已在线跑通：修补后累计 3 笔被交易所接受的挂单（含订单号与 `BINANCE_EXACT_ORDER` 精确回读）与 2 笔真实成交持仓，修补前该窗口内为 0（见 §5）。
- 修转化率的过程中新发现并修掉了三类"静默/自伤"缺陷：候选选择层可以在没有任何原因的情况下否决模型的三元组；提示词邀请模型选择的期限与计划层接受的阶梯不一致；漏斗把已成交的一轮统计成 0。
- 判定：`V396_TESTNET_ACTIVE_EXECUTION_ENTRY_CONVERSION_CLOSED = 是`，见 §8 第 14 条；剩余 blocker 与停止线见 §7。

## 1. 冻结不变量的执行结果

本轮没有改动任何风险或利润参数。部署前后逐值对读（`live-baseline-pre-deploy.json` / `live-baseline-post-deploy.json`）：

| 字段 | 部署前 | 部署后 |
| --- | --- | --- |
| `takeProfit.minNetProfitUsd` | 1 | 1 |
| `takeProfit.minNetProfitRoiPct` | 0.15 | 0.15 |
| `riskGovernance.maxGrossExposurePct` | 1 | 1 |
| `riskGovernance.maxDirectionExposurePct` | 0.8 | 0.8 |
| `riskGovernance.maxClusterExposurePct` | 0.35 | 0.35 |
| `riskGovernance.maxClusterDirectionExposurePct` | 0.35 | 0.35 |
| `portfolio.maxPositions` | 50 | 50 |
| `tradeEconomics.admissionMode` | SHADOW | SHADOW |
| `connections.exchange.environment` / `executionMode` | TESTNET / TESTNET_ENABLED | TESTNET / TESTNET_ENABLED |
| `riskGovernance.entrySafetyMode` | AUTO | AUTO |
| `riskGovernance.exitCoordination.aiExitAuthority` | SHADOW | SHADOW |
| PortfolioRisk profile | READY `v396r2dc9bae77…` | READY `v396r2dc9bae77…` |
| Production writes | 0 | 0 |

唯一变化是 `settingsVersion` 递增。这是既有的启动写回行为，不是本轮代码造成的数值漂移：上一轮未含本轮改动的一次重启同样留下 `205→206`（`source:"api"`，启动后约 3 秒）的记录，本轮两次重启各留下一次；审计摘要里 `maxPositions` before/after 相同，且上表逐值未变。

## 2. 根因与修补

### 2.1 修补 A：SHADOW 统计 ceiling 不再是硬 veto（§4）

`quantityHorizonCandidates.ts` 原来把 `floorBeyondCeiling === true || (enforceEconomics && profitFloorUnmet)` 合成同一个拒绝条件，因此**统计**上限在 SHADOW 账户上也硬性否决了候选，和同文件"经济/统计门只在 ENFORCE 生效"的注释以及 S06-C 契约直接矛盾；同时它复用了 `NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY` 这个"没有利润"的说法，于是仪表盘读到的是"26 个 PLACE 都不够 $1 利润"，而事实是 `ATTAINED_NET_PROFIT_USD > MIN_NET_PROFIT_USD`。

现在：

- 硬利润地板失败 → `MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY`，并打印 `MIN_NET_PROFIT_USD=` / `ATTAINED_NET_PROFIT_USD=`，且保证 attained < min；S06-T02 语义完整保留（最小合法 q 过不了硬地板就是 `NO_TRADE`，不通过放大 q 去凑 `$1`）。
- 统计 ceiling 超过 → SHADOW 记录为 `statisticalEvidence`（`HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY` / `SELECTION_TARGET_BEYOND_STATISTICAL_CEILING` / `CANDIDATE_TARGET_BEYOND_STATISTICAL_BOUND`），候选保留；ENFORCE 仍然拒绝，reason 名字单独一类。
- `statisticalEvidence` 与 `noTradeReasons` 是两个列表：前者永不参与否决，避免"顺手复用同一个 reason"。
- 候选经济字段新增 `targetVsStatisticalCeiling: WITHIN|BEYOND|UNPROVEN`，让"样本不支持"这件事即使不否决也可见。
- 顺带修掉一个真实崩溃：利润要求高到 SHORT 侧不存在可表示的目标价时，`estimateTradingCost` 会因为价格为 0 抛 `TRADING_COST_INVALID_INPUT`。现在地板按最小一个 tick 表述，诚实回答"这个尺寸达不到"，不再抛错。

测试：`j3TradePlanHostile.test.ts` S06-T02（硬利润）、S06-T04（SHADOW ceiling 只留证据）、S06-T05（ENFORCE 仍拒）、S06-T06（两类 reason 不得混用，且打印利润数字时必然 attained<min）。

### 2.2 修补 B：pre-AI 硬可行性（§5）

`preAiPlanFeasibility.ts` 在调用 27B 之前回答一个便宜的问题：这一侧**有没有任何硬可执行路径**。它复用计划层同一套函数（`quantityLadder` + `minimumQuantityProfitFloor`），因此探测不可能比它后面的计划更严或更松：

- 两侧都没有硬路径 → 不调用模型，写 `ENTRY_DECISION_BLOCKED {stage:'PRE_AI_TRADE_PLAN', reason:'PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE'}` 并逐侧给出原因。
- 只有一侧没有 → 照常调用模型；探测不给方向建议（输出里没有任何 preferred/recommend 字段），S06-T01 不变。
- 统计事实按设计不参与：SHADOW 下它无权否决。
- 每侧按**该侧最有利的合法 maker 价**判定（LONG 取带宽下沿、SHORT 取上沿）。第一次部署时这里写反了（用了不利沿），那会让探测严于计划、可能悄悄饿死模型调用；已由 PF-09 钉住。

测试：`preAiPlanFeasibility.test.ts` PF-01…PF-09。

### 2.3 修补 C：链路闭合（§6）

`entryCoordinator` 单一路径不变，没有新增人工批准点、没有新增 sleep/观察窗口；补的是可追溯性：

- 新增 `ENTRY_RESERVATION_CREATED`（brainRunId + planId + cycleId + intentId + reservationId + 金额 + riskGeneration）。此前 reservation 只能由后面的 intent 反推。
- `ENTRY_DECISION_BLOCKED {stage:RESERVATION|LIVE_RISK_ENVELOPE}`、`ENTRY_ORDER_BLOCKED`（权限/最小尺寸/杠杆/提交异常）都补齐 `brainRunId / planId / reservationId / intentId / orderId / clientOrderId / stage`。
- JIT 拒绝统一带 `JIT_BLOCKED:<reason>` 前缀，事件 `stage` 相应为 `JIT`；`WAIT_FOR_PRICE` 保留原语义，但只能显示为"等待价格"。
- 提交成功即回写 `submittedAt`（`EntryOrderSchema` 新增可选字段），交易所恢复路径用提交发起时刻，两者不混用。

测试：`entryExecutionChain.test.ts` EC-01（T5 exactly-once 与顺序）、EC-02/EC-03（T6 JIT fail-closed 且显示 `未挂单 · JIT · JIT_BLOCKED:…`，reservation 释放为 `RELEASED`）、EC-04（提交结果未知时不重发）。

### 2.4 修补 D：Run→执行结果权威投影（§7）与驾驶舱漏斗（§8）

新模块 `runExecutionOutcome.ts` 是唯一真值源，输入只有 Engine 自己的 durable 事件日志：

- `projectRunExecutionOutcomes(events, runs, now, fallbackRunId?)` → 每条 Run 的
  `executionState / executionLabel / blockStage / blockReasons / portfolioRiskAllowed / tradePlanId / tradePlanReady / reservationId / intentId / orderId / clientOrderId / exchangeOrderId / submittedAt / firstFillAt / updatedAt / lineageProven / inconsistentFacts`。
- 身份归属规则：谁引入这个 intent/order，事件就属于谁；一个自称别的 `brainRunId` 的 fill 会被记为 `inconsistentFacts` 并仍归给真正的拥有者（T7）。
- 缺失不等于失败：PLACE 之后事实尚未写完时是"正在执行"；超过 `EXECUTION_LINEAGE_GRACE_MS`（5 分钟）仍无任何链路事件才说 `未挂单 · 链路未记录 · EXECUTION_LINEAGE_UNPROVEN`。
- 症状不等于原因：`PLAN_SIDE_NOT_EXECUTABLE:SHORT` 这类包装性头条会被排到计算原因（`CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY`、`CANDIDATE_HORIZON_UNSUPPORTED:30` 等）之后，两条都保留在详情里。
- `entryConversionWindow/entryConversionReport`：30m 与 1h 的 8 层计数、4 个转化率、最大流失 stage/reason 及计数、`ENTRY_CONVERSION_DEGRADED`（`PLACE>=5 && Submit==0` 且首因不是资金/仓位/既定硬门时才亮；只告警，不自动暂停执行）。
- 出口：`GET /api/v3/pipeline → entryConversion`、`GET /api/v3/brain/runs → items[].execution`、`GET /api/v3/brain/runs/:id → execution`（`projectBrainRun` 的 summary 现在引用这个投影，而不是自己再判一次）。
- UI：驾驶舱"建仓转化漏斗"（30 分钟/1 小时切换、8 层、4 率、最大流失、降级告警、"就绪 ≠ 已挂单"提示），AI Run 表新增"执行结果"列，详情抽屉新增执行链 ID 与时间。

测试：`runExecutionOutcome.test.ts` EO-01…EO-14（含 T7 跨 Run 不串、T8 精确计数、空窗口不造假除法）、`brainRunExecution.test.ts` RX-01…RX-04（真实 coordinator → 真实 SQLite 日志 → 真实 HTTP 连接函数）、`OverviewView.conversion.test.ts`、`BrainView.execution.test.ts`。

### 2.5 修补 E：静默拒绝（本轮新发现）

第一次部署后线上 00:23:42 的一条 `PLACE_SHORT` 显示为 `未挂单 · TRADE_PLAN · UNPROVEN`：`refusals` 是空列表。根因在选择分支的 `else if` 链——"floorBeyondCeiling 且非 ENFORCE"只记录了统计证据，既不构造候选也不产生 refusal，计划层于是拿着空理由列表把决策拒了。这是同一类 bug（"被拒但说不出为什么"），只是换了位置：

- 该分支现在记录证据后继续构造候选，只有 ENFORCE 才拒绝；
- 生成器与计划层各加兜底：未提供的选择必须至少带一个具名原因（`SELECTION_NOT_OFFERED_UNSPECIFIED` / `CANDIDATE_SELECTION_REFUSED_UNSPECIFIED`）；
- S06-T07（SHADOW 的模型三元组必须被提供且带证据 / ENFORCE 仍拒）与 S06-T08（把生成器自己给出的三元组喂回去，任何 `offered:false` 都必须有原因）先红后绿。

### 2.6 修补 F：把合法目标期限作为执行事实发布（线上自然流量暴露）

修补 E 部署后，按 Run 读出来的首因变成 `CANDIDATE_HORIZON_UNSUPPORTED:30`（6 条自然 Primary 里 4 条）。根因既不是风险也不是统计，而是**系统与自己不一致**：提示词让模型在 5..1440 分钟之间自由选 `profitTakePlan.targetHorizonMinutes`，而计划层只为 horizon 阶梯（默认 15/60/240）写计划，两边从未对齐。

- `legalTargetHorizonMinutes(settings)` 是唯一定义：计划层与 pre-AI envelope 调用同一个函数，不存在第二份清单（TH-02 断言"发布的集合 == 候选集实际定价的集合"）。
- `EXECUTION_ENVELOPE.economics.targetHorizonMinutes` 作为执行事实发布，提示词要求模型取值必须落在已发布集合内。这只会**收窄**模型的可选项，不放宽任何门槛。
- 契约 `EntryIntent.executionEnvelope.economics` 最小扩展一个字段并给默认值，使历史 intent 仍可 round-trip —— 该扩展是被 `tradingQualityIntegration` 的严格 schema 测试逼出来的，不是事后补的。

## 3. 红→绿顺序（不事后补测试）

1. 修补 A 的红测先跑出 4 条失败（SHADOW 仍否决、reason 混用等），实现后转绿；引擎套件 `160 files / 1275 tests`。
2. 修补 B 的红测 PF-07/PF-08 先失败（探测未接入），接入后 `8 passed`，并暴露出 §2.1 最后一条 0 价崩溃。
3. 修补 C/D 的 EO/RX/EC 红测先失败（未接入投影与链路事件），实现后 `163 files / 1297 tests`。
4. 修补 E 的 S06-T07 先失败（`expected false to be true`），实现后全套 `163 files / 1301 tests`。
5. 修补 F 的 TH-01…TH-04 先全部失败（`legalTargetHorizonMinutes is not a function`、提示词不含期限约束），实现后 `164 files / 1305 tests`。

## 5. 线上自然流量验收

### 5.1 修补前：旧构建自己的事件日志被逐 Run 连接出来的形状

对旧构建（`3.9.6-f9c61c22779610cf2905`，PID 42676，本轮部署前）的 durable 日志做同一套折叠，得到的不是"频率低"，而是一条条可指的错误否决：

| 统计窗口 | 数量 |
| --- | --- |
| 自 09-24 06:46 起 `ENTRY_DECISION_BLOCKED stage=TRADE_PLAN` | 266 |
| 其中理由写着 `CANDIDATE_SET_NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY`、但同时打印 `ATTAINED_NET_PROFIT_USD > MIN_NET_PROFIT_USD` | **257** |
| 其中真正的硬利润失败（attained < min） | **0** |
| `CANDIDATE_HORIZON_UNSUPPORTED:*` | 8 |
| 理由列表为空（静默拒绝） | 1 |

示例（同一条事件里）：`PLAN_SIDE_NOT_EXECUTABLE:SHORT + CANDIDATE_SET_NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY + CANDIDATE_SET_MIN_NET_PROFIT_USD=1 + CANDIDATE_SET_ATTAINED_NET_PROFIT_USD=1.000393` —— 利润地板满足到 $1.000393，却被说成"没有可盈利组合"而硬拒。

按 Run 读出的执行结果（`live-observe-1.json`，最近 40 条 Primary，其中 37 条 PLACE）：30 条 `未挂单`、7 条 `正在执行`（事实从未写入，属旧构建的静默/未记录类）、`已挂单` 0、`已成交` 0。最大流失：`TRADE_PLAN / PLAN_SIDE_NOT_EXECUTABLE:SHORT` 17 次、`:LONG` 5 次，其次 `PORTFOLIO_RISK / PENDING_RISK_UNVERIFIED:order:…` 7 次、`MARGIN_TIER_SYMBOL_UNPROVEN:ZROUSDT` 1 次。

### 5.2 修补后：第一次真实 Testnet 提交及其完整 lineage

部署 `3.9.6-f9c61c2…`→`3.9.6-7d96882f72697b3f03ed`（修补 A/B/C/D 的首个构建）后，第 2 条自然 PLACE 走完了整条链：

| 层 | 时间 (UTC) | 事实 |
| --- | --- | --- |
| Primary | 00:22:12 | `airun_mug7tjog_dlsbzmbn` XRPUSDT `PLACE_LONG` |
| 经济/风险准入 | 00:22:12 | `ENTRY_ECONOMIC_ADMISSION_EVALUATED`、`PORTFOLIO_RISK_ADMISSION_EVALUATED allowed=true` |
| TradePlan | 00:22:12 | `plan_ac5dcee50c37d33ec1bda74203fee7d0` |
| Reservation | 00:22:12 | `reserve_1790295732558_lj37il`（本轮新增的 `ENTRY_RESERVATION_CREATED`，带 planId/intentId/brainRunId） |
| Intent | 00:22:13 | `intent_mug7us6x_978h3kgy` |
| Submit | 00:22:23→00:22:30 | `ENTRY_SUBMIT_ATTEMPTED` → 交易所接受，`submittedAt=1790295750938` |
| 订单 | 00:22:31 | `entry_intent_mug7us6x_978h3kgy` / clientOrderId `ml_25d6a89fc9f25b0bb536a6a74d98` / **exchangeOrderId `3508829138`**，936.2 @ 1.549 WORKING |
| 复核 | 00:23:23 | `statusSource/factSource = BINANCE_EXACT_ORDER`，终态 `CANCELED`（挂单未成交） |
| 执行结果 | — | `GET /brain/runs` 该行显示 **已挂单**，`firstFillAt=null` |

即：本轮不满足于"解释为什么不提交"，而是真的产生了一笔带交易所订单号的 Testnet 挂单；未成交是 maker 限价单的正常市场结果，按任务书不伪造 Fill。四类结果都各自可辨：未生成订单（`未挂单 · 层 · 原因`）、已提交未成交（`已挂单` + `firstFillAt=null`，本例后转 CANCELED）、部分成交（`ORDER_FILL_RECONCILED status=PARTIALLY_FILLED` → `部分成交`）、已成交（`ENTRY_FILLED` → `已成交`）。

### 5.3 修补 E/F 之后：按 Run 的自然流量与真实成交

修补 E 构建（`3f1b2ad8…`）部署后的 6 条自然 Primary：4 条 `未挂单 · TRADE_PLAN · CANDIDATE_HORIZON_UNSUPPORTED:30`、1 条 `未挂单 · JIT · REJECT_GROSS_EXPOSURE`、1 条 `仅决策 · 未进入执行链`。这 4 条把修补 F 的必要性直接指了出来（§2.6）。

修补 F 构建（`9f8c4b8c…`）部署后 12.7 分钟内的 5 条自然 PLACE（`live-observe-horizon-3.json`）：

| Run | Symbol / 决策 | Engine 执行结果 |
| --- | --- | --- |
| `airun_mug9…` | UNIUSDT `PLACE_SHORT` | **已成交** |
| `airun_mug9…` | DOGEUSDC `PLACE_LONG` | 正在执行 |
| `airun_mug9…` | TAOUSDT `PLACE_LONG` | `未挂单 · JIT · JIT_BLOCKED:MARKET_QUALITY_NOT_ADMITTED` |
| `airun_mug9…` | NEARUSDC `PLACE_LONG` | `未挂单 · JIT · JIT_BLOCKED:MARKET_QUALITY_NOT_ADMITTED` |
| `airun_mug8…` | XRPUSDC `PLACE_LONG` | `未挂单 · PORTFOLIO_RISK · HUMAN_POTENTIAL_NOTIONAL_LIMIT` |

该窗口内没有一条再是 `CANDIDATE_HORIZON_UNSUPPORTED`，模型给出的目标期限回到已发布的阶梯内。两条由本轮链路真实成交的 Testnet 持仓（`/positions` 读回）：

| 持仓 | 方向 / 数量 / 开仓均价 | 开仓时间 (UTC) | TradePlan 目标 | cycle / intent |
| --- | --- | --- | --- | --- |
| UNIUSDT | SHORT 117 @ 9.206 | 01:08:21 | 9.12 @ 60 分钟 | `cycle_entry_intent_mug9gjt5_p9n3qold` |
| PENGUUSDT | SHORT 36,332 @ 0.009724 | 00:54:35 | 0.009643 @ 15 分钟 | `cycle_entry_intent_mug8yzgd_q650tibs` |

两者 `profitTakePlanSource=FIXED_PROFITABLE`、`entryTimeSource=SYSTEM_FILL`，持仓数从 12 增至 14。

### 5.4 最终构建（`3.9.6-e802da247ee8e861e1c4`）的驾驶舱读数

最后两次部署分别修的是：修补 F（期限发布）与 fill 归属（漏斗此前把已成交的一轮统计成 `建仓成交 0`，而同一屏的 Run 行写着"已成交"）。最终构建上 30m / 1h 的实际读数（`ui-overview-funnel-final.txt` + `/pipeline`）：

| 窗口 | Primary | PLACE | 风险通过 | TradePlan | Reservation | Intent | 已提交 | 成交 | 等待价格 | PLACE→TradePlan | TradePlan→Submit | PLACE→Submit | Submit→Fill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30m | 15 | 15 | 8 | 5 | 5 | 4 | 2 | 1 | 1 | 33.3% | 40% | 13.3% | 50% |
| 1h | 30 | 30 | 20 | 7 | 7 | 5 | 3 | 1 | 1 | 23.3% | 42.9% | 10% | 33.3% |

同一 durable 日志在自第一次修补部署以来的累计计数：`TRADE_PLAN_PERSISTED` 7（7 个不同 Run）、`ENTRY_RESERVATION_CREATED` 7、`ENTRY_INTENT_CREATED` 5、`ENTRY_SUBMIT_ATTEMPTED` 3、`ENTRY_ORDER_CREATED` 3；而修补前从 09-24 06:46 到本轮部署前的整个窗口内 `ENTRY_ORDER_CREATED` 与 `ENTRY_FILLED` 均为 0。

## 6. lifecycle 清单（每次 stop/start 对应的实际修补）

| # | 停止 → 启动 | 部署构建 | 对应修补 |
| --- | --- | --- | --- |
| 1 | `stop-zdj-lan.ps1` → `start-zdj-lan.ps1 -StartReason MANUAL_START`（PID 42676 → 33496） | `3.9.6-7d96882f72697b3f03ed` | 修补 A + B + C + D（commit `80501c2`） |
| 2 | stop → MANUAL_START（33496 → 21872） | `3.9.6-137e4b0048c75fbc963c` | 执行结果首因排序 + pre-AI 探测改为有利价判定（commit `e9f08de`） |
| 3 | stop → MANUAL_START（21872 → 34468） | `3.9.6-3f1b2ad8e4271fe893e4` | 修补 E：消除候选选择层静默拒绝（commit `21de6c8`） |
| 4 | stop → MANUAL_START（34468 → 32584） | `3.9.6-9f8c4b8c229460b90c99` | 修补 F：发布合法目标期限（commit `54c6a08`） |
| 5 | stop → MANUAL_START（32584 → 39252） | `3.9.6-e802da247ee8e861e1c4` | fill 归属修正：漏斗按引入事件归属，成交不再记 0（commit `400959e`） |

每一次停止/启动都对应一组已经完成红→绿并提交的代码改动，没有一次纯重试；`supervisor.status=NOT_RUNNING`，未安装任何自启、守护或启动项；`restartCount` 179→184 与五次 MANUAL_START 一一对应，`lastRestartReason` 均为 `MANUAL_START`。第 5 次之后不再有代码改动，观察窗口全部落在最终构建上。

## 7. 剩余 blocker 与停止线

本轮之后仍然压着转化率的**不是**本轮引入的东西，而是既有硬门的残留（全部按 Run 可指认）：

1. `PORTFOLIO_RISK / PENDING_RISK_UNVERIFIED:order:entry_intent_*`。本地有 46 条状态为 `UNKNOWN` 的历史建仓单（最早可追到 09-21 18:32 的 DASHUSDT，`ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 在 3.3 天里被反复记录 280 次仍未收敛），PortfolioRisk 因"无法核实未决风险"而 fail-closed 拒绝新建仓。这属于 §1 明确冻结的 UNKNOWN/fail-closed 语义，本轮不得为了提转化率去削弱它。
2. `JIT / JIT_BLOCKED:MARKET_QUALITY_NOT_ADMITTED`：市场质量未准入即拒绝提交（JIT 复核到的是当下事实），属既定质量闸而非本轮缺陷。
3. `PORTFOLIO_RISK / HUMAN_POTENTIAL_NOTIONAL_LIMIT` 与 `JIT / REJECT_GROSS_EXPOSURE`：真实敞口/人工敞口容量上限（持仓已从 12 增至 14），属冻结 caps 正常生效。
4. 重启后池子需要重新补足（`POOL_SUPPLY_SHORTAGE`、`NO_RUNNABLE_CANDIDATE` 在启动后数分钟内出现），这是供给节奏，不是执行链故障；每次重启后约 5-7 分钟才有第一批自然 Primary 完成。

本轮**不再做**的事（停止线）：不碰 UNKNOWN 复核通道（R14/R17 已证明该循环不收敛，需单独立项）；不为凑 `已挂单` 而放宽 `minNetProfitUsd=1 / 0.15`、风险 caps 或 JIT/private/integrity 语义；不改 TP/ownership 路径；不为 UI 再加一个"挂单终态（撤销/过期未成交）"细分状态而再重启一次（当前 `已挂单 + firstFillAt=null` 加详情里的订单终态已经足够诚实，列为下一轮候选）。

下一轮最多五件：① UNKNOWN 订单收敛（先只读根因，再谈是否引入有界重探）；② `MARKET_QUALITY_NOT_ADMITTED` 在 JIT 的判定是否与预模型口径一致（现在是按 Run 可数的第二大流失）；③ `MARGIN_TIER_SYMBOL_UNPROVEN` 覆盖补齐；④ 执行结果显示挂单终态细分；⑤ 在 ≥100 条自然 PLACE 的窗口上复测 `PLACE→Submit` 与 `Submit→Fill`，而不是用一次提交收工。

## 8. 任务书 §11 的 14 条必答

1. 产品代码最终 HEAD `400959e`（分支 `codex/v396-final-convergence-20260922`，其后仅文档/证据提交）；实际运行 `buildId=3.9.6-e802da247ee8e861e1c4`、`artifactHash=e802da247ee8e861e1c4570370ce43444864797d5b6988f0384151e116c4f36b`、`sourceHash=c8fc4278c2177fe3d6608ef010565a666f807a6b1168d3ac8c3670cd91614fca`、PID 39252、instanceId `ffcc26bb-c4a6-4b2a-8640-9c2867e1526a`。构建前四次部署的构建号与身份在 §6 与各自的 baseline JSON 中留痕。
2. 是：SHADOW 的统计 ceiling 已降为证据（`statisticalEvidence` + `targetVsStatisticalCeiling=BEYOND`），不再硬 veto；ENFORCE 对同一 fixture 仍然拒绝（S06-T04/T05/T06/T07 双向断言，含 selection 路径）。
3. 是：S06-T02 完整保留，`MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY` 只在最小合法 q 真的过不了地板时出现，且断言 `attained < min`；没有任何代码路径通过放大 q 去凑 `$1`（`quantityLadder` 只用阶梯内合法值，pre-AI 探测按 `ladder[0]` 判定，PF-03 断言）。旧构建里真实硬利润失败发生次数为 **0**（§5.1 的 266 条里 0 条 attained<min），说明这条门既没被削弱也没被误用。
4. 是，逐值不变：见 §1 表格（`$1`、`0.15`、Gross 1、Direction 0.8、Cluster 0.35、ClusterDirection 0.35、maxPositions 50、profile 版本 `v396r2dc9bae77…` 一致）；最终构建的读回另见 `live-baseline-final.json`。
5. 漏斗（Engine 自己按事件计数）：修补前 1h 为 Primary 41 / PLACE 41 / 风险通过 24 / TradePlan 0 / Reservation 0 / Intent 0 / 提交 0 / 成交 0；最终构建 30m 为 15 / 15 / 8 / 5 / 5 / 4 / 2 提交 / 1 成交 / 1 等待价格，1h 为 30 / 30 / 20 / 7 / 7 / 5 / 3 提交 / 1 成交 / 1 等待价格。
6. `PLACE→Submit`：0% → 30m 13.3%、1h 10%（此前无任何一笔）；`TradePlan→Submit` 40% / 42.9%；`Submit→Fill` 50% / 33.3%。最大流失从 `TRADE_PLAN / PLAN_SIDE_NOT_EXECUTABLE:*`（22/37 且理由说"没有利润"）迁移到 `JIT / JIT_BLOCKED:MARKET_QUALITY_NOT_ADMITTED` 与既有的 `PORTFOLIO_RISK` 硬门。
7. 是：每条 Primary Run 都有 `已挂单 / 未挂单 · 层 · 首因 / 等待价格 / 正在执行 / 部分成交 / 已成交 / 仅决策` 之一；无任何事实且超过 5 分钟才写 `未挂单 · 链路未记录 · EXECUTION_LINEAGE_UNPROVEN`。列表列与详情抽屉同源（同一 fold）。
8. 历史上 0 submit 的逐条解释：257/266 是被伪装成利润失败的统计 veto（已修），8 条期限不支持（已由修补 F 从根上消除），1 条静默拒绝（已修并双层兜底），另 7 条 `PENDING_RISK_UNVERIFIED` + 1 条 `MARGIN_TIER_SYMBOL_UNPROVEN` 属既定 fail-closed 硬门；没有任何一条被用"频率低/继续观察"概括。修补后仍 0 的窗口不存在：已经产生 3 笔交易所订单与 2 笔真实成交持仓。
9. 第一笔真实 submit 的完整 lineage 见 §5.2（brainRun→plan→reservation→intent→order→exchangeOrderId `3508829138`，并有 `BINANCE_EXACT_ORDER` 复核凭证）；随后两笔真实成交见 §5.3（UNIUSDT、PENGUUSDT 持仓及其 cycle/intent 与 TradePlan 目标）。
10. 写归因：全程 `lockedToTestnet=true`、`environment=TESTNET`、`executionMode=TESTNET_ENABLED`；`productionWrites=0`、`blockedProductionWriteAttempts=0`（部署前、修补 F 后、最终构建后三次读回，见三份 baseline JSON）。Testnet 写集中在本轮产生的 3 笔挂单与 2 笔成交持仓；进程内计数器在每次重启归零属既有实现，不作为累计证据。
11. lifecycle 清单见 §6：五对 stop/start，各自对应一组已提交并完成红→绿的实际修补，无纯重试、无守护自启。
12. 无回归：TP/ownership/integrity/private/authority 路径未改动，全仓 `164 files / 1306 tests`（引擎）、`52` 仪表盘、`46` core、`verify:deps/typecheck/verify:scripts/S00/存储覆盖/git diff --check` 全绿；PortfolioRisk profile 与 authority 版本读回不变；原有 12 条持仓与 TP 维护全程在线，新增 2 条为本轮链路自然成交。
13. UI 证据：`ui-overview-snapshot.txt`、`ui-overview-funnel-final.txt`（驾驶舱"建仓转化漏斗"8 层 + 4 率 + 最大流失 + "就绪 ≠ 已挂单"提示的实际渲染文本，最终窗口显示 已提交 2 / 成交 1）与 `ui-brain-runs-snapshot.txt`、`ui-brain-runs-snapshot-final.txt`、`ui-brain-page1.txt`（AI Run 表每行执行结果文本，如 `未挂单 · TRADE_PLAN · CANDIDATE_HORIZON_UNSUPPORTED:30`、`仅决策 · 未进入执行链`）。`已挂单` 那一行的同一 payload 存于 `live-observe-4.json`（`state=SUBMITTED, orderId=entry_intent_mug7us6x_978h3kgy, exchangeOrderId=3508829138`）。像素截图与翻页点击在本会话内置浏览器不可用（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，viewport=0x0），因此以可访问性树文本作为可审计 UI 证据，并如实标注这一限制。
14. 判定：`V396_TESTNET_ACTIVE_EXECUTION_ENTRY_CONVERSION_CLOSED = 是`。依据：错误 veto 已按事实改为证据且给出可指认的 reason taxonomy；S06-T02 与全部 caps 未动；每个 Primary Run 都有 Engine 权威执行结果；驾驶舱有完整漏斗、转化率与 `ENTRY_CONVERSION_DEGRADED`（只告警）；自然流量在修补后产生 3 笔交易所挂单和 2 笔真实成交持仓，修补前该计数为 0。剩余 blocker 是 §7 列出的既有硬门残留（UNKNOWN 不收敛为第一位），不属于"本轮该修而未修的转化率缺陷"。

## 9. 证据索引

- 红→绿与门禁原始输出：`engine-suite-after-fixB.txt`、`engine-suite-after-fixCD.txt`、`gate-s00.txt`、`gate-s00-final.json`、`gate-deps-typecheck.txt`、`gate-scripts-storage.txt`、`gate-build-check.txt`、`gate-formal-build.txt`、`gate-formal-build-2.txt`、`gate-rerun-after-reason-ordering.txt`、`gate-after-silent-refusal-fix.txt`、`gate-after-horizon-contract.txt`、`gate-after-fill-attribution.txt`、`gate-final-battery.txt`（每条含 exit code）。
- 部署前后逐值读回（含 caps、profile、write boundary）：`live-baseline-pre-deploy.json`、`live-baseline-post-deploy.json`、`live-baseline-post-horizon.json`、`live-baseline-final.json`。
- 按 Run 的执行结果与漏斗采样（只读 GET，`scripts/v396-entry-conversion-observe.mjs`）：`live-observe-1..4.json`、`live-observe-final-1..2.json`、`live-observe-horizon-1..3.json`。
- UI 可审计文本证据：`ui-overview-snapshot.txt`、`ui-overview-funnel-final.txt`、`ui-brain-runs-snapshot.txt`、`ui-brain-runs-snapshot-final.txt`、`ui-brain-page1.txt`。
- 测试清单：修补 A `j3TradePlanHostile.test.ts`（S06-T02/T04/T05/T06/T07/T08）、修补 B `preAiPlanFeasibility.test.ts`（PF-01…PF-09）、修补 C `entryExecutionChain.test.ts`（EC-01…EC-04）、修补 D `runExecutionOutcome.test.ts`（EO-01…EO-15）+ `api/brainRunExecution.test.ts`（RX-01…RX-04）+ 仪表盘 `OverviewView.conversion.test.ts`、`BrainView.execution.test.ts`、修补 F `targetHorizonContract.test.ts`（TH-01…TH-04）。
- 新增运维脚本（只读）：`scripts/v396-entry-conversion-baseline.mjs`、`scripts/v396-entry-conversion-observe.mjs`。
