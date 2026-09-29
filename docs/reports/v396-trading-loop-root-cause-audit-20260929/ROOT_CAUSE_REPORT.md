# V3.9.6 交易闭环根因审计

审计日期：2026-09-29（Asia/Shanghai）。状态：审计完成，实施未执行。

## 1. 基准、权限和证据边界

- 按 GitHub `3684993/ZDJMITS` 当前 `main` 的 `docs/prompts/v396-trading-loop-root-cause-audit-20260929.md` 执行。fetch 后基准为 **1e39fc8283c4618c46e4e3d0e5cce421e10d3f9c**，不是提示中历史 SHA。它与运行目录 HEAD `417694b68742e1c5be4a4eb22391f9506ebaa21d` 之间仅新增提示文件，业务源码相同。
- 运行实例：PID **10480**，instance **2cac26f8-587d-4757-a631-db0461ca90a4**，build **3.9.6-8349d66ab6af161e855d**，启动于 2026-09-28 15:01:55.575 +08:00，TESTNET / TESTNET_ENABLED。本轮没有停启、热加载、配置写入、交易所写入或业务代码修改。
- 重新执行身份脚本：源码、dist、buildId、API/实例和源码清洁五项通过；remote/local HEAD 因上述提示文档不同而不等，脚本总 verdict 为 `IDENTITY_BROKEN`。不能据此推断业务版本漂移，也不伪称本轮六项全通过。源码 hash `e659b3930457663543093a2f7fbc2302aa8862f1847c8af4be9e54b05b5c534f`；artifact hash `8349d66ab6af161e855dc23d27abc583d4b2096cf1d7f034903a9735850fc389`。
- 驾驶舱基准快照 T0：**2026-09-29 07:52:12.796 +08:00**，`/api/v3/snapshot.ts=1790639532796`。同时读取 `/diagnostics/closeout`、`/orders`、`/positions`、`/human-managed`、`/brain/resources`、`/observability/trading-quality`、`/operations/health`、`/diagnostics/private-sync`。均为本机既有只读 API；没有调用 sync/apply/repair 等动作端点。
- SQLite：`D:\MITS\data\zdj-settings.sqlite`、`v396-ownership.sqlite`，Node `DatabaseSync({readOnly:true})`；主库批量读取使用 `PRAGMA query_only=ON; BEGIN … ROLLBACK`。只选择业务表，不读取 secrets。两库及不同 HTTP 响应不是同一事务，差异明确按时间与作用域解释。
- 主库有 70,003 条 runtime_events，最早 `1790453516819`、当次最新 `1790639608652`；24h 查询留存 29,572 条。日志有保留上限，因此事件计数是**留存样本数**，不是完整全历史流量。AI archive、executionFills、tradeRecords 分开查询，不能直接拿三者相除当转化率。
- 证据主要来自真实源码、数据库、驾驶舱同源 API 及现有测试；交易所事实是 Engine 已保存的 USER_DATA_WS / exact-order / reconciliation 事实，**本轮没有独立向交易所重拉订单或成交**。无法证明的远端实时状态标为 UNKNOWN。
- 临时分析输出位于系统 Temp；按用户要求只提交本报告和 IMPLEMENTATION_PLAN，不提交原始数据库、配置或额外脚本。

证据级别：**PROVEN**=当前代码与直接状态/持久化记录一致；**STRONG_EVIDENCE**=机制与多份事实一致但缺少完整历史重放；**UNKNOWN**=没有足够证据。不把提示中的截图读数或旧报告当现状。

## 2. 根因结论与严重程度

| 编号 | 结论 | 级别 / 严重度 | 受影响阶段 |
|---|---|---|---|
| R1 | 持仓复核关闭；AI Exit 为 SHADOW；绝大部分存量仓已归 HUMAN 或 HANDOFF，自动亏损退出不是当前运行策略 | PROVEN / 高 | Review → AI Exit |
| R2 | TP 固定净利润 $1 与小额 Entry 不相容；全仓隐含 1.2% 下限覆盖配置的 0.45%；最终 TP 普遍比原 AI 目标远 | PROVEN 机制及分布 / 高；与持有时长的完整因果量化 UNKNOWN | TP target → 长期挂单 |
| R3 | 已成交 TP 未收敛到 durable Exit task；连续收敛前 8 项饥饿，旧 claim 阻止新周期补 TP | PROVEN / 高 | Reconciliation → claims → TP repair |
| R4 | 加仓订单各自 cycle 与聚合仓位 cycle 不一致，整仓 TP 被记到单个 Entry cycle，数量不守恒、Closed Trade 缺失 | PROVEN 三个实例 / 高 | Fill attribution → lifecycle → Closed Trade |
| R5 | `v396x…` 系统退出单被标为 EXTERNAL_OR_UNLINKED；身份识别仍依赖旧前缀/Entry 表 | PROVEN / 高 | Exit fill provenance / 统计与经验 |
| R6 | funds-only 仍有真实历史风险 veto：`claimEntryExecution` 按 underlying/ENTRY 排他，历史 UNKNOWN 挡住新 Intent，后被包装为 RESERVATION_INVALID | PROVEN / 高 | Final submit |
| R7 | 资金费归属未闭合；AI Exit 的 funding/FX/depth 事实链未接全，即使开启权限也不能直接工作 | PROVEN / 高 | Exit facts / PnL / Review memory |
| R8 | capacity 的 NOT_APPLICABLE 风险 ceiling=0 被 UI 当最终资金容量；风险漏斗仍统计旧 allowed；Human cap 文案仍报阻断 | PROVEN / 中 | 驾驶舱、漏斗、原因诊断 |
| R9 | 分析 lease 预留整个可用 quote 上限，而非最终小仓保证金；双资金读数语义不同，前者真实抑制并行分析 | PROVEN / 中 | Pre-AI lease → route/readiness |
| R10 | 1 分钟授权等待价格可达后过期是真实路径；不是已证明的“模型排队把授权耗尽” | PROVEN 样本 / 中 | WAIT_EXECUTION_RANGE → TTL |
| R11 | 列表缺少累计持有时间；详情已有 age。生命周期基础存在，但加仓账本身份未闭合，不能仅换 UI 就称全链准确 | PROVEN / 中 | 持仓与人工列表 |

**需要纠正前一轮结论**：旧报告称“所有历史风险都无 Entry veto”过宽。源码的高层风险门确实降级了，但数据库 claim 路径 R6 仍有效，且本轮找到了真实失败链。此前成功提交样本不能证明其它 underlying 的所有路径畅通。

## 3. 55 持仓、Entry/Exit 频率与订单结构

### 3.1 同口径快照

T0：55 个仓位，SHORT 36、LONG 19；管理标签 HUMAN_MANAGED 46、AUTO_MANAGED 9；浮动 PnL **-$703.06**。所有 position 行 `entryTimeSource=SYSTEM_FILL`，这证明字段来源标签，不等于每个加仓 cycle 已正确入账。

| 当前连续持仓年龄 | 数量 | 浮动 PnL USD | 亏损数量 |
|---|---:|---:|---:|
| <1h | 0 | 0 | 0 |
| 1–6h | 12 | +0.61 | 7 |
| 6–24h | 24 | -0.43 | 14 |
| 24–72h | 0 | 0 | 0 |
| 72–168h | 8 | -5.29 | 8 |
| ≥168h | 11 | -697.94 | 10 |

年龄中位数 13.89h，P90 223.69h，最大 234.89h；39/55 浮亏。19 个仓位已持有超过 72h。大额浮亏集中于旧仓：AVAX SHORT 223.69h / -447.46，BTC LONG 171.16h / -141.68，ENA SHORT 212.50h / -61.63，ZEC SHORT 206.58h / -36.99。不能把此次小额新 Entry 的频率直接当成这些多日前亏损的原因。

执行成交按 `(symbol,tradeId)` 去重，区间结束 T0；按 side 与 direction 判 ENTRY/EXIT，不依赖 attributionStatus：

| 留存事实窗口 | Entry fill 行 | Exit fill 行 | 不同 Exit exchangeOrderId | CLOSED record |
|---|---:|---:|---:|---:|
| 1h | 10 | 0 | 0 | 0 |
| 6h | 51 | 2 | 2 | 0 |
| 24h | 163 | 29 | 8 | 2 |

这里 fill 行不是完整交易或订单数；29 个 Exit fills 来自 8 个订单，可能含部分成交。24h 含启动前数据，事件保留与 fill 保留也不同。最近 1h Exit=0 是同源成交事实支持的读数；“从来没有退出”被证伪。最近 6h 有 2 个真实方向为 Exit 的 WS 成交却没有新增 CLOSED，R4 解释了其中的守恒缺口。

### 3.2 活动委托口径

T0 account 投影：activeEntryOrders=23，activeTpOrders=52，驾驶舱公式得到 **75**，并非提示中的 67。后者是旧瞬时读数，本轮不能倒推出那 67 单的准确组成。`OverviewView.vue:221` 仅加 Entry 与 TP，不含 manual。

邻近 `/orders`：Entry 共888行（FILLED351/CANCELED258/UNKNOWN79/REJECTED200），TP593行（WORKING52/FILLED282/EXPIRED43/CANCELED169/REJECTED47），manual42行（FILLED32/CANCELED8/EXPIRED1/UNKNOWN1）。**UNKNOWN 与活动风险占用不等于交易所仍挂着该单**；activeEntryOrders 与原始 status 行亦不是同一时刻/口径。私有对账稍后投影 entryUnknownHistorical=79、proofValid=63、occupyingRisk=16，manualUnknown=1，明确标注 `BEST_EFFORT_CROSS_STORE`。

TP Guardian T0：required55、protected52、missing3、orphan0、duplicate0、qtyMismatch0、wrongSide0、retryQueue3。现有52个 WORKING TP 每仓一个；没有证据支持“大量重复/孤儿 TP”是主因。缺口是 BRUSDT SHORT、NEARUSDT SHORT、WLDUSDT SHORT；后续 health 瞬时出现 UNKNOWN1、missing4，说明对账过程变化，不能把多时刻混成一个总数。逐仓表见附录。

## 4. Exit 实际执行链、权限与调度

```text
Entry fill / remote position
  → PositionService / PositionLifecycleTracker → ownership deadline + TradePlan
  → (a) TP Guardian.ensure/sweep → target + mandate + reduction proof
       → ExitCoordinator PREPARED/claim → JIT → GTC LIMIT → WS/exact-order
  → (b) PositionReviewRunner → bounded REVIEW_BRAIN → usable review evidence
       → V396AiExitRunner(costs + plan + owner) → AiExitAuthority
       → ENFORCE only: coordinator → reduction proof/JIT → reduce LIMIT
  → (c) human manual goal → coordinated LIMIT reduce/cancel-replace
  → fills + order terminal → task/claim convergence → cycle accounting → CLOSED
```

### R1：当前自动退出职责是受限的

真实设置：`exitCoordination.aiExitAuthority=SHADOW`、`positionReviewEnabled=false`、`aiExitAllowSmallLoss=false`、lossLimitUsd=10、minNetProfitUsd=.2、reviewMinIntervalMs=300000、reviewAuthorityTtlMs=20000。`positionManagement.lossHandoffBars=4`、humanHandoffAfterMinutes=1440。

- `aiExitAuthority.ts:28`：OFF 不决策，SHADOW 只记录，只有 ENFORCE 可 prepare/submit。不是“AI 说退出但执行器忽略”。
- `positionReviewRunner.ts:tick` 先检查 enabled；关闭时零模型调用。主库 positionReviews/reviewBudgets 均空，24h archive 只有 PRIMARY_BRAIN / SCOUT，没有 REVIEW_BRAIN；留存事件没有 POSITION_REVIEW / AI_EXIT_SUBMITTED / AI_EXIT_SHADOW_DECISION。后者还受 R7 前置事实拦截。
- ownership 库80行：HUMAN65/HANDOFF11/AI_ACTIVE4；与当前55 position cycle 精确连接：**46 HUMAN、6 HANDOFF_PENDING、3 AI_ACTIVE**。AUTO_MANAGED=9 不能等同9个仍获 AI 权限的周期。
- `lossHandoff.ts:tick` 连续4根事实完整的亏损15m收盘柱后仅改人工管理标签、保留TP；既不平仓也不移动TP。`v396AiExitRunner.ts:62` 只考虑 durable AI_ACTIVE，且 deadline 未过期。
- `s03AiExitPolicy.ts` 即使日后启用，亏损超限返回 HANDOFF；小亏且 `allowSmallLoss=false` 返回 HOLD；获利还要求 exitConditionMet。lossLimit=10 **不是交易所止损单**。`ExternalTradeAdapter.ts:103` TP 是 GTC LIMIT（单向 reduceOnly / 双向 positionSide）；本链没有已部署的自动 STOP_MARKET 保护。

因此“持续建仓而未建立对称的主动退出职责”成立，但这包含**当前权限/策略选择**而非全部是 bug。HUMAN-owned 仓不能通过开启一个全局开关擅自重新赋予 AI 权限。

### 调度与模型竞争

`appRuntime.ts:805–850`：市场/ExchangeLoop 1s、Entry分析2.5s、Entry维护2s、manual goal2s、ownership/AI Exit/convergence触发5s、Review60s、TP sweep5s、reconciliation15s，各自定时。TP/claim收敛不调用模型，不能因 PRIMARY_RESOURCE_BUSY 就断言其被模型饿死。

Entry使用 SCOUT `qwen3.5:9b`（8081，maxConcurrency1）和 Primary `qwen/qwen3.8-27b`（8084，maxConcurrency1）。24h archive 查询时 Primary完成724（LONG122、SHORT602，均PLACE），失败8；平均耗时分别约61.56s / 60.81s，SCOUT737次、平均10.79s。提示中的“AI不停开仓”有频率证据，但并非其模型质量已被证明差。

Review 经 `appRuntime.reviewPosition:1149` 构建带持仓、管理deadline、原计划/失效谓词和历史memory的上下文，`aiFabric.review:219` 使用**同一个 Primary资源**，与Entry不同prompt和budget，却没有独立保底队列。开启后存在资源冲突风险；20s review authority TTL 也明显短于当前 Entry模型约61s的耗时（Review自身耗时尚无样本，不能直接断言必超时）。当前零 Review 的直接原因是关闭，不是已证实的竞争。真正已证实的饥饿发生在 R3 的 Exit task 遍历。

## 5. TP 目标设计与长持仓

### R2：收益下限覆盖原始目标

`tpGuardian.ts:163–185` 顺序：有效HUMAN mandate → 合法且经济性满足的AI目标 → 15m结构目标 → FIXED_PROFITABLE。AI目标还检查 openedAt+horizon、15m closed evidence、range、ATR距离、净利润与市场一侧。原目标过期时不意味着必须退出。

真实配置 targetPriceMovePercent=.45、quantityPercent=100、minNetProfitUsd=1、minNetProfitRoiPct=.15、entryFeeRate=.0004、takerFeeRate=.0004、feeSafetyBufferPct=10（**手续费的10%，不是名义本金10%**）。

全仓 `canaryMinMovePct=1.2`，fixedMove=max(.45,1.2)。`packages/core/src/tradingCost.ts:22–33`：requiredNet=max($1, margin×.15%)，再反解覆盖手续费的盈利价格。fixed价格不受AI分支的 `max(structureMaxMovePercent,6×ATR)` 上界约束。因此约$5名义小仓为了净赚$1，需要约20%价格有利变动，远大于配置表面所示0.45%。这不是模型自己把TP设到了20%。

T0：19仓名义≤$10；52个WORKING TP 相对加权入场价距离 min1.2000%、median6.7099%、P90 19.9633%、max20.0903%，15仓距离>15%。55仓 profitTakePlanSource 全为 FIXED_PROFITABLE。24h留存209个TP_TARGET_SELECTED全部固定回退：141次AI horizon已过期、68次尚未过期但AI目标仍无效。现存BTC TP已WORKING约171.16h，LTC约232.03h。

**结论范围**：机制与远距离目标已证明，增加等待难度有强证据；没有逐仓完整行情路径/所有历史ATR/成交队列，不能证明每个目标永远不可达，也不能给出缩短TP后必定成交或更高收益的承诺。≥7d亏损主要来自少数大额旧仓（它们TP只离入场约1.2%，但离当前市场5–24%），所以“全部长持仓都是小仓$1门槛造成”被证伪。还涉及亏损不自动退出/人工接管。

TP ensure 对有效现有WORKING单优先保留；不是按原AI horizon不停追价。价格穿越会exact-query确认，而非假造成交；未确认不应强行撤掉保护。本轮没有证据显示反复reprice是所有长期仓主因。

## 6. 已成交但 task/账本未闭合

### R3：真实 TP 缺口由旧 claim 与遍历饥饿造成

| symbol/side | 旧TP exchangeOrderId | clientOrderId | local TP | durable task / claim | 新周期缺口 |
|---|---|---|---|---|---|
| BRUSDT SHORT | 309686722 | v396x8ff81eeea97014fb49f7ec9945b7b5 | FILLED | WORKING / ACTIVE18 units | 新仓6 units，reducible=0 |
| NEARUSDT SHORT | 636148297 | v396x9cbfe0a573145bbffe286e7f79885f | FILLED | WORKING / ACTIVE6 units | 新仓4 units，reducible=0 |
| WLDUSDT SHORT | 534679168 | v396x1fd9654fa96d299651ea549765ed75 | FILLED | WORKING / ACTIVE41 units | 新仓11 units，reducible=0 |

直接事件例：BR `1790639033549` TP_MANUAL_REVIEW_REQUIRED attempt21、NEAR `1790639279635` attempt15、WLD `1790638913191` attempt7。均为 `TP_EXIT_CLIENT_ORDER_ID_MISSING: QUANTITY_BUDGET_EXCEEDED:reducible=0|OPEN_CLAIM_UNITS=…`、submissionOutcome=NOT_ATTEMPTED，不是交易所拒绝新TP，也不是“TP参数未达净利”。

代码路径：

1. `s04ExitCoordinator.ts:72,145–167` 所有同scope的非终态task（**跨cycle**）占用可减数量；这本来用于防止双重reduce，不能简单删掉。
2. `reconciliationService.ts:124–125` 更新 tpOrders；`positionService.recordExchangeFill:46` 处理fills，但这些路径没有把每个订单终态统一广播到 ExitCoordinator。两份状态分离。
3. `v396ExitRuntime.ts:316–340` interval120s、batchLimit8，`tasksNeedingQuery().filter(eligible).slice(0,8)`；尝试后仅设置 now+max(60s,interval/2)。下轮120s到来时，前8项已再次eligible，若始终WORKING，尾部永远不能前进。`allTasks` SQL没有轮转/lastQuery排序。
4. 真实两次只读比对：51个open任务，只有前8项 updatedAt 推进（约123410或248019ms）；index13/24/28正是上述三个已填TP，delta=0。这把“可能饥饿”提升为实测证据。

修复应是**可靠终态传播＋公平收敛**，而不是释放所有UNKNOWN或删除数量预算。远端ABSENT、暂时查询失败、旧本地FILLED但缺原始事实时仍不可随意释放。

### R4：加仓 cycle 粒度与整仓退出粒度冲突

真实账本连接：

| 旧cycle | Entry qty | Exit qty | remainingQty | 状态 / observedClosedAt |
|---|---:|---:|---:|---|
| cycle_entry_intent_mukxjzol_q8q1s20j (BR SHORT) | 6 | 18 | -12 | PARTIALLY_CLOSED / 1790610272327 |
| cycle_entry_intent_mul3nfr5_swpdn8uc (NEAR SHORT) | 2 | 6 | -4 | PARTIALLY_CLOSED / 1790624141249 |
| cycle_entry_intent_mukz0v9n_7nvjuu3q (WLD SHORT) | 10 | 41 | -31 | PARTIALLY_CLOSED / 1790633216458 |

三者都标记 `EXCHANGE_FILL_CONSERVATION`，有真实WS平仓fill且记录已观察到仓位归零，但没有CLOSED。

`entryCoordinator.preparedOrder:316` 每新Intent产生 `cycle_<entryOrder>`；`positionService.recordExchangeFill:51–60` 为其创建单独record，按localOrder.cycle归属Entry；`PositionLifecycleTracker.observe:9–17` 对非零仓加仓保留旧物理cycle；`reconciliationService:122` 保留local.cycle和原openedAt；TP按聚合仓位全量与旧cycle发出。`accountCycle:28–54` 要求同cycle Entry/Exit数量守恒才产生完整closed。在 funds-only允许同标的加仓后，该隐含“一个Entry≈一个仓位cycle”的假设暴露。

这里不能把所有历史fill按symbol粗暴合并：同symbol重开、LONG/SHORT、不同环境/账户必须隔离。必须设计连续非零物理positionCycle与多个Entry lot/plan间的关系，再基于exact订单事实重建受影响范围。现存150 OPEN records远多于55 positions，也不能直接称150个真实持仓。

### R5：系统 Exit fill 被错误标记为 external

例如 WLD tradeId64473594、order534679168、qty41、realizedPnl1.0186、client `v396x1fd…`，source USER_DATA_WS，但 attributionStatus=EXTERNAL_OR_UNLINKED。24h样本29个退出fill均是该标签。

`positionService.ts:48` 的 systemProven 查 Entry order/intent或旧前缀 `entry_|ml_|tp_|manual_|ma_|mr_|mc_|ec…`，不识别新的v396x，也不以退出task/TP identity证明系统来源。`exactCycleRecord` 会通过TP表找到cycle，所以**external标签与cycle归属不是同一问题**。不要用“加一个前缀”冒充完整安全身份修复；应查durable registry。

`api/projections.ts:71–100` 的 Exit fills按side/direction对所有fill计数，不过滤external。因此最近1h Exit=0不是仅由标签造成；更长窗external标签、完整record及净收益却确实不可信。R4才直接解释三个“有Exit但无closed”。

## 7. 资金费、对账与 AI Exit facts

### R7：192不是192条资金费账单

主库372个tradeRecords全为 fundingAttributionStatus=UNKNOWN，其中192 CLOSED。驾驶舱 `tradeFundingUnknownCount` 来自完整交易/ledger记录的资金费归属状态（`api/projections.ts:144`、`tradeRecordReadModel.ts:28`），不是192条已收到未确认的income记录。提示“192笔资金费未确认”的业务标签容易误导。

`cycleAccounting.ts:38–54` 在funding未知时仍允许数量守恒且费用完整的CLOSED，保留 tradingNetPnlExFunding，但 canonical netPnl=null。**funding UNKNOWN不必然阻止生成Closed Trade**，不可把R4全部归咎于资金费。

却存在另一条真实影响：`s03ExitCostFacts.ts:103–107` 要求EXACT funding，否则拒绝AI Exit事实。24h留存11124个 AI_EXIT_FACTS_INCOMPLETE：8785个 funding+depth；2299个再加USDC FX；40个还缺quote/单位参数。真实路径 `v396AiExitRunner.ts:93–97` 传 `quoteAsset:'USDT', fx:null`，深度读 `quote.depthNotionalUsd`；市场深度来自orderBook，当前生产事实生产路径未填该quote字段。tests向quote手工注入50000可以通过，不能说明真实接线完成。

代码存在离线 `attributeFunding` 和独立quality funding事件；没有找到把完整收入覆盖证明接入当前canonical tradeRecord funding=EXACT的生产闭环。数据库全UNKNOWN与此一致。这里应补齐账户/资产/时间覆盖和cycle分配，不能用0替代未知。USDC不能靠固定USDT标签假装完成换算；也不能把depth缺字段误报为市场深度真实不足。

本次reconciliation曾返回 HEALTHY、SETTLED、verifiedOrderFactMismatchCount=0，但TP仍缺、Exit claim漂移、历史UNKNOWN很多；健康指标的检查作用域有限。另一时刻曾读到private/market短时DEGRADED。因此提示的DEGRADED本身不构成根因，**已证实的根因是跨账本状态不收敛与事实接线缺口**。不能证明所有远端事实已被收全，需保留覆盖UNKNOWN。

## 8. Entry 真实 veto 图谱

### 8.1 如何计数

本审计按“不同输入/责任方、能停下该阶段”的**30类条件族 E01–E30**计数；同一条件在多个阶段重查算一族，暂时排队、策略不选与最终veto分别标明。另有3类配置条件门 D1–D3。这不是声称只有30个 `if`：schema字段、行情子原因、数据库/网络错误可以扩展，不能用reason字符串数假装固定权限数。当前TESTNET路径不只有资金/交易所检查；还包含正常市场策略/授权正确性，以及R6这一不应保留的历史风险门。

调用顺序：Universe/route → runtime/readiness → dispatch/preflight → Primary slot/market refresh → envelope/candidate set → lease → Scout/Primary → post-AI/plan → durable reservation → maker wait or leverage → final/JIT → durable claim → adapter submit → pending/reprice/reconciliation。

表中 EC=`services/entryCoordinator.ts`，RS=`state/runtimeState.ts`，其余均相对 `apps/engine/src/`。作用域T=当前TESTNET自动Entry；P=Production：普通自动Entry在E01已锁住，通用函数/legacy门仍保留；不代表已获Production交易权限。

| ID / 条件族 | 路径/输入 | 输出与停点 | T/P、重复情况 |
|---|---|---|---|
| E01 环境与执行写锁 | executionReadiness:82；ExternalTradeAdapter/transport；environment, executionMode, credential scope | ENVIRONMENT_NOT_TESTNET / EXECUTION_WRITE_LOCKED；不花模型或不写单 | T强制；P整体阻断；前后重复必要 |
| E02 手动运行与AUTO授权 | readiness；EC:282,497,581,588；runtime mode/governance/entrySafety | RUNTIME_NOT_RUNNING / POLICY_NOT_AUTO / EXECUTION_PERMISSION_CHANGED | T/P正确性，多个副本 |
| E03 egress/请求预算 | EC:134,143,277；BinanceTransport.entryBlockReason/requestBudget | BINANCE_EGRESS_* / BINANCE_BUDGET_*；调度/submit等待 | T/P合法可达性；不是组合风险 |
| E04 真实私有账户新鲜度 | privateAccountFresh→preflight/readiness/RS:201/JIT | PRIVATE_* / EXECUTION_PERMISSION_CHANGED | T/P必须；原因名不统一 |
| E05 市场事实/依赖完整新鲜 | EC:256,390,412,292；entryDataError/market.primaryReadyReasons | MARKET_DATA_* / DATA_ERROR / EIP依赖不全 | T/P必须；symbol隔离 |
| E06 用户资产/标的范围 | core selection；EC:284–288；blacklist/custom/listing | SYMBOL/UNDERLYING_BLACKLISTED, ASSET_NOT_ADMITTED, candidate missing | T/P市场选择；非持仓风险 |
| E07 市场质量/流动性 | selection.marketQuality；EC:289 | MARKET_QUALITY_NOT_ADMITTED、volume/spread/data/tier/topN | T/P策略筛选，前后重查 |
| E08 无资本route/候选 | runtimeControl/capitalAdmission/preflight；executableCandidateCount | NO_EXECUTABLE_CANDIDATE / NO_CAPITAL_ROUTE / NO_FEASIBLE_DIRECTION | T真实路线派生；P legacy也算风险 |
| E09 资本快照身份与时效 | preflight:capitalFresh；RS:203–210；generation/version/recheckAt | CAPITAL_* REQUIRED/STALE/EXPIRED | T仍可阻断；不是risk ticket但含旧命名，重复 |
| E10 候选生命周期/冷却 | EC.tick、candidateLifecycleDeriver；readyList/active/nextEligible | WAIT/COOLDOWN，无本轮分析 | T/P暂缓；已持仓高层占用T跳过 |
| E11 模型资源与健康 | EC:206；aiFabric.choose/circuit/timeout | AI_BUSY / PRIMARY_RESOURCE_BUSY / offline/circuit/schema失败 | T/P调度/失败，不是资金 |
| E12 Pre-AI envelope可执行侧 | preAiExecutionEnvelope:94–114；route plan/filter/funds | PRE_AI_EXECUTION_ENVELOPE缺侧、noHardExecutableSide | T资金/合法性；P含legacy风险 |
| E13 quote资金域/杠杆可证明 | capitalCapacity；USDT/USDC、leverage/minimum | QUOTE_ASSET_NOT_ENTRY_ELIGIBLE / LEVERAGE_UNPROVEN | T/P合法资源定义 |
| E14 实际资金减承诺 | capitalCapacity、RS:197、EC:291,311 | INSUFFICIENT_AVAILABLE_MARGIN / RESERVED_QUOTE_MARGIN / HEADROOM | T/P必须；lease/reservation双生命周期 |
| E15 分析lease存在/余额/时效 | executionLease:18–23；EC:449,499 | EXECUTION_LEASE_NO_CAPACITY/MARGIN_CHANGED/MISSING/EXPIRED/SYMBOL_MISMATCH | T/P；过大lease见R9 |
| E16 模型自主非PLACE | EC analyze；d.decision/tradeSide | WAIT/REJECT；不建Intent | T/P策略结果，不应强制PLACE |
| E17 模型契约与post-AI验证 | EC:post-AI；direction/range/quantity/evidence结构 | DETERMINISTIC_POST_AI_VERIFY_FAILED、parse failure | T/P正确性；缺证据另有shadow事件 |
| E18 一个Primary结果只消费一次 | EC:464；brainRunId→entryIntents | ENTRY_DECISION_ALREADY_CONSUMED | T/P真实幂等，必须保留 |
| E19 冻结侧和量上下界 | EC:500–508,299–304；envelope vs decision/order | AI_DIRECTION_NOT_EXECUTABLE、AI_QUANTITY_* | T/P授权，不得静默放大量 |
| E20 合法数量/价格/名义 | quantityHorizonCandidates:191–194,267–269；EC:304,583 | EXCHANGE_MINIMUM_NOT_MET/PRECISION_INVALID/CANDIDATE_QUANTITY_BELOW_LEGAL_MINIMUM | T/P；模型前后市价漂移可重新触发 |
| E21 TradePlan选择与不可变参数 | tradePlanService:buildTradePlan；selection/candidate/hash/thesis/predicate | PLAN_*、CANDIDATE_*、schema refusal；不持久化plan | T/P；风险snapshot在T可null，不再拒绝 |
| E22 Plan/reservation持久化事实 | EC:plan persist；RS:186–225；输入正数/事务/plan去重 | RESERVATION_FACTS_INVALID/DURABILITY_FAILED/PLAN_ALREADY_RESERVED | T/P；maxPositions/maxConcurrent仍做正整数schema检查，T不做数量阈值veto |
| E23 reservation仍有效 | EC:281,368–372；id/status/expiresAt | RESERVATION_INVALID / WAIT_FACT_MISSING | T/P；会掩盖E28根因 |
| E24 maker可达与价格授权带 | nearMarketPrice；EC:578,374；recent trades/quote/range | UNREACHABLE_MAKER→WAIT_EXECUTION_RANGE；不可超授权追价 | T/P，策略执行正确性 |
| E25 AI授权/order TTL | EC:280,572,588；createdAt+horizon/absolute TTL | AI_AUTHORIZATION_EXPIRED / TTL取消 | T/P必须；与lease/plan TTL不同 |
| E26 杠杆设置及交易所接受 | EC:584；ExternalTradeAdapter:88；signed response | SET_LEVERAGE错误、Post Only -5022、exchange reject | T允许；P写锁先挡 |
| E27 最终实际名义再验资金 | EC:309–313；actualNotional/fresh funds/otherReservations | RISK_FINAL_NOTIONAL_EXCEEDS_HEADROOM等 | T名称RISK但计算是funds；必要JIT，需统一命名 |
| E28 **跨Intent/历史claim排他** | EC:329–335 → settingsStore:1049–1069；scope=env/account/underlying/ENTRY | ENTRY_SUBMISSION_UNKNOWN_DURABLE_TASK_EXISTS；新单未submit | **T仍真实veto，P也有；R6待修** |
| E29 同一订单提交不确定/身份冲突 | EC:321–325；preparedOrder/journal/clientOrderId | UNKNOWN仅query、不重发；JOURNAL_CONFLICT | T/P真正幂等，与E28必须拆开 |
| E30 pending维护/reprice约束 | EC.reviewPending/resumeExecutionWaits；TTL/maxReprices/new filters/unchanged identity | reprice blocked/cancel/query，不能新造身份绕过 | T/P正确性；不代表组合风险恢复 |

条件分支（真实代码存在，但当前设置未启用）：D1 `tradeEconomics.admissionMode=ENFORCE` 会在经济可行性、candidate set与final拒绝净利/可达性，当前SHADOW；D2 `tradingQuality.mode=ENFORCE` 要求质量evidence storage/verification，当前SHADOW；D3 legacy portfolio/admission/ticket/count/underlying门仅在 `!testnetFundsOnlyEntry(settings)` 执行，当前精确TESTNET+TESTNET_ENABLED下跳过。改变设置会改变图谱，不能只看UI“观察”推断所有条件永久关闭。

**重复与矛盾**：资金在route/preflight/envelope/lease/reservation/final均计算；前段缓存用于少花模型，reservation/JIT用于防TOCTOU，不宜删除最后复核。问题在事实版本/语义重复、lease过大、claim权责混杂。profileStatus仍可能显示UNREADY而readiness.ready=true；它是观察状态，不等于当前执行阻断。`capacityRoom.enforced=true`仍可带旧80%quote policy元数据，和实际funds-only最终ALLOW不同，不能把它当已执行veto。

### 8.2 遗留控制逐项分类

| 概念 | 当前TESTNET Entry权限 | Exit/Reduce/TP/Cancel/Reconciliation影响 |
|---|---|---|
| UNKNOWN、pending/history risk、historical claim/risk proof | 高层risk观察；**E28仍可按历史proof/claim拒绝新Intent**；同一订单E29保留 | UNKNOWN exit claim必须保守占用，但R3旧终态未释放造成错误阻挡 |
| Gross、Direction、Cluster | executable headroom强制OBSERVE；风险ledger原始拒绝保留，无高层veto | 未找到TP因这些暴露上限被拒绝；不能泛化成所有exit事实无关 |
| Stress、Capital-at-Risk、risk admission unavailable | admission bridge NOT_APPLICABLE、风险snapshot允许null、ticket不强制 | AI Exit仍要求成本/归属事实（R7），不是Entry gross限制 |
| Human Potential、人管上限 | preAi/economic人管cap降级；humanManagedProjection仍误报newEntryBlockedByCaps=true | durable owner HUMAN/HANDOFF确实禁止AI主动退出；TP mandate仍可维护 |
| position count、pending count、slot | 计数展示；max阈值T不veto；RS输入仍正整数校验 | Exit按可减quantity预算而非position slot |
| duplicate underlying、active position | selection/primaryOccupancy/final显式跳过 | 最终underlying Entry journal排他未跳过；非同一层 |
| reservation / analysis lease | 有效未提交资金承诺、时效/身份仍veto | Exit另有quantity claim，两者不是可互换的钱或数量 |
| portfolio generation/snapshot/ticket | T不要求portfolio binding；risk影子记录保留 | Exit task still stores riskGeneration；不能将字段存在等同Gross veto；真实owner/mandate/position version必须校验 |
| capital generation/version/freshness | T仍veto E09；riskCapitalVersion可比较 | 属于事实版本路径；需拆命名，不能把过期事实当可靠 |

### R6：残留veto的直接失败链

INJ run `airun_mulvpfnw_7fuwyerd` / intent `intent_mulvqsvb_4o3zwkxl`：

| ts | 事实 |
|---:|---|
| 1790638187984 | PRIMARY_DECISION_NORMALIZED |
| 1790638188475 | TRADE_PLAN_PERSISTED |
| 1790638188805 | ENTRY_RESERVATION_CREATED（约$0.428，expires1790638488491） |
| 1790638189284 | ENTRY_INTENT_CREATED |
| 1790638194288 | ENTRY_ORDER_SUBMISSION_UNKNOWN，reason=ENTRY_SUBMISSION_UNKNOWN_DURABLE_TASK_EXISTS |
| 1790638197105 | ENTRY_EXECUTION_WAIT_TERMINATED，RESERVATION_INVALID；授权尚有约52s，资金约$3986.53 |

EC拒绝claim后删除新本地order、释放新reservation，把旧order恢复进state，再抛submission-unknown；随后新Intent找不到自己的uncertain order，读到released reservation，故后果覆盖首因。24h留存24个RESERVATION_INVALID和24个AI_AUTHORIZATION_EXPIRED，不能合并解释。后续数据库OP scope仍有active UNKNOWN `entry_intent_muli0c5k_w5m0r9vx`，INJ/CRV历史UNKNOWN的proof状态会随轮询变化；本轮没有完整冲突事件中的旧owner ID，因此不把某条后来读到的旧INJ行断言为该毫秒的唯一阻挡者。

## 9. 驾驶舱矛盾与授权过期

### R8：明确的展示错误与正常语义区别

1. 槽位T0 **58/50** 且firstBlocker=NONE：funds-only不执行slot上限，语义正常；UI仍叫“风险与安全限制”且没标slot OBSERVE，误导。
2. `admission.status=NOT_APPLICABLE, ceilingUsdBySide={LONG:0,SHORT:0}`；真实 `entryCapacity.LONG.executableNotionalUsd≈492.86`、9 routes、firstBinding=PLANNED_NOTIONAL。`OverviewView.vue:76–89` 优先读 `admission.ceilingUsdBySide ?? row.executableNotionalUsd`，**0不是null**，所以显示最终$0；sideStatus来自真正的capacity算法，仍显示BOTH_SIDES_EXECUTABLE。这是确定的UI source选择错误，不是当前资金真的为0。
3. PLANNED_NOTIONAL是“已允许计划受到计划量限制”，不是拒绝原因；UI称“首因”会与blocker混淆。
4. USDT账面available3983.25、analysisLease3986.87、executable0；USDC executable4959.45，故“仍有空间”是跨asset总量成立。lease创建时与账户更新时刻不同可略超当前available。另一处capital.usdtAvailable是未减lease值。它们不是两个不同交易所余额，必须展示scope/asOf/lease owner。
5. 当前API LONG/SHORT均有逐候选candidates；页面使用默认折叠的 `<details>`（Overview:361）。本轮**未复现API数据为空**；不能认定需要补造候选，先区分未展开、旧资产快照与确实空数组。
6. `/human-managed.summary.newEntryBlockedByCaps=true`由`humanManagedProjection.ts:49–50`旧公式得到，当前高层Entry已忽略cap；这是一处真实错误语义，不是新的资金门。

### 漏斗

T0 30m：Primary21、PLACE21、riskAllowed0、economicAdmissionPassed0、TradePlan19、Reservation19、Intent19、submitAttempted9、orderSubmitted9、entryFilled4；topDropReason=RESERVATION_INVALID(5)。1h AI_AUTHORIZATION_EXPIRED=4。与提示21/21/0/19/19/19/8/8不完全一致，是不同窗口。

`runExecutionOutcome.ts:484` 只在 `allowed===true && !analysisOnly` 加riskAllowed；不看entryVetoEnforced=false。实际无veto的risk拒绝仍计0，而后续可继续，这个旧“阶段”已不能画成必须通过的串行漏斗。economic SHADOW同理。主readiness也不把它作门，**无需为了显示riskAllowed去伪造allowed=true**。应标OBSERVED/N/A，并独立呈现真实execution admission。

### R9：lease过度预留是真实调度影响

`preAiExecutionEnvelope.ts:102,141` 以极大plannedNotional求上限，leaseRequiredMargin=max(LONG.maxMargin,SHORT.maxMargin)；funds-only下接近全quote available。`executionLease.ts:18` 获得该金额，存WeakMap、TTL=max(45s,decisionTimeout+15s)，此处135s；Primary前Scout+Primary约70s。完成后转成实际小额reservation并finally释放。

本快照reservedMargin=0而lease约$3987，不能指责“历史pending Entry一直占用资金lease”。UNKNOWN订单不再由funding commitment二次扣款。分析lease确实把该quote的其它路线临时变为0，且被capacity/readiness读取，不只是UI。是否长期泄漏：没有证据；代码有finally和过期清理。应优化预算粒度，不能直接删除原子防超额承诺。

### R10：授权过期样本

CRV run `airun_mulv9kfu_2aazxhjk`：intent创建1790637449974，AI授权到1790637509974（60s）；1790637450612开始WAIT，原因NO_RECENT_TRADE_IN_AUTHORIZED_NEAR_BAND，价格范围.3695–.371，而盘口.3717/.3718；1790637511147过期时盘口.3729/.3731，资金充足。另有USELESS、TIA相同链。

`EC:572` 授权从**模型完成后的Intent创建**起计，不是Primary排队开始。模型60s耗时会让输入价格更陈旧，但不能据此说“直接吃掉60s授权”；本样本直接原因是maker/recent-trade可达性没有恢复。维护独立2s调度，样本终止比deadline晚1–4s，未见分钟级模型阻塞。计划需区分数据年龄、模型延迟、postdecision等待、claim拒绝，禁止盲目延长所有授权或放宽范围。

## 10. 当前 lifecycle 持有时间

`PositionsView.vue:27–28` 桌面/移动列表显示绝对建仓/首次同步时间，没有易读的累计时长；`HumanManagedView.vue:56`亦仅绝对时间。`PositionConsole.vue:135–138` **已经有持仓时间age**，因此“整个系统完全没有”被证伪。

`PositionLifecycleTracker` 对INCREASE/REDUCE保留openedAt，确认CLOSE后下一次OPEN新建cycle；`reconciliationService:122` 保留SYSTEM_FILL/首次观察来源。该规则适合连续非零持有时间，部分平仓不重置；不能用最新加仓时间代替首次入场。当前55行的age可显示，但R4导致逻辑Entry cycle与物理仓cycle不一致，旧/新同symbol串联、断线期间归零再重开仍需exact事实裁定。UI应区分“连续持有”“距最近加仓”“首次观察下界/UNKNOWN”，而不是只做Date.now-openedAt且不标来源。

未获得控制市场/入场质量后的统计实验，长持仓与低Exit频率是同时发生、并有R1/R2/R3机制支持，不声称仅凭当前年龄分布证明单一因果或模型胜率。

## 11. 被证伪、未证明与测试边界

- 被证伪：Exit从未发生；所有DEGRADED来自Gross；所有风险veto已消失；长期持仓全是AI不愿退出；资金费UNKNOWN必然阻止CLOSED；当前零Exit全由前缀误归因造成；逐候选API一直空白；整个UI完全没有age。
- 未证明：每个目标相对完整未来/历史波动必然不可达；所有长期仓原始thesis已失效；当前模型切换能提高收益；Production同样发生这些运行故障；不存在其它未保存的远端成交。不得据此实施策略/参数改动。
- 只读审计不触发模型、不强制生成新样本。独立隔离worktree运行现有8个文件94个测试，全通过：testnetFundsOnlyEntry、executionLifecycle.integration、j1ExitTruthHostile、j1AiExitConsumer、cycleAccounting、tpGuardianEconomics、runExecutionOutcome、positionLifecycleIntegrity。日志结束为 `8 passed / 94 passed`，duration4.74s。
- 这些测试的盲区正是重要发现：funds-only happy path没有真实SQLite跨Intent历史claim；Exit测试没有>8个长期WORKING任务的公平性；consumer注入深度/精确成本而非真实生产字段；cycle测试没有多个Entry plan叠加后整仓TP。通过不等于这些问题不存在。
- 本轮无业务改动，不重复全量build/verify、不运行GitHub Actions、不重启。最终diff仅两个要求文档，实施内容见独立计划。

## 12. 可复核查询口径

代码均基于本报告基准SHA，可用 `git show <sha>:<path>` 精确复核。下列查询必须readOnly/query_only执行；不得将下面的SELECT变成修复UPDATE：

```sql
SELECT kind, count(*) FROM runtime_entities GROUP BY kind;
SELECT count(*), min(ts), max(ts) FROM runtime_events;
SELECT role, status, decision, count(*), avg(latency_ms)
FROM ai_runs_archive WHERE started_at >= :since GROUP BY role,status,decision;
SELECT ts,type,symbol,payload FROM runtime_events
WHERE ts >= :since AND type IN ('TP_MANUAL_REVIEW_REQUIRED',
 'ENTRY_ORDER_SUBMISSION_UNKNOWN','ENTRY_EXECUTION_WAIT_TERMINATED',
 'AI_EXIT_FACTS_INCOMPLETE','TP_TARGET_SELECTED') ORDER BY ts;
SELECT scope,active,released_at,payload FROM entry_execution_tasks
WHERE scope = '["TESTNET","binance-primary","INJ","ENTRY"]';
-- ownership.sqlite，另一个只读连接：
SELECT id,scope,cycle_id,state,payload FROM v396_exit_tasks;
SELECT id,scope,payload FROM v396_quantity_claims;
SELECT scope,cycle_id,version,payload FROM v396_owners;
```

fill窗口：先按symbol/tradeId去重，再过滤executionTime∈[T0-window,T0]，side==LONG?BUY:SELL为entry，其反向为exit；不得依赖旧client前缀。逐仓TP关联用positionId、symbol、side、quantity与status，不能仅凭tpOrderId存在宣称受保护。统计基于上述留存数据，复跑时间前进后数值允许变化。

## 附录：T0逐仓分布

下表以物理positionId的symbol+side分行；年龄是当前openedAt来源的连续持有投影，TP数量是邻近只读订单快照的WORKING行。UNKNOWN Entry列只表示同symbol/side本地未知历史行数，不等于真实挂单或资金占用。金额/比例四舍五入；不是新的交易建议。

| Symbol | Side | 持有小时 | 管理标签 | 浮动PnL USD | WORKING TP | TP距Entry % | 本地UNKNOWN Entry | Entry占用投影 |
|---|---|---:|---|---:|---:|---:|---:|---:|
| AVAXUSDT | SHORT | 223.69 | HUMAN_MANAGED | -447.46 | 1 | 1.2027 | 0 | 0 |
| BTCUSDT | LONG | 171.16 | HUMAN_MANAGED | -141.68 | 1 | 1.2000 | 4 | 2 |
| ENAUSDT | SHORT | 212.50 | HUMAN_MANAGED | -61.63 | 1 | 1.2266 | 0 | 0 |
| ZECUSDT | SHORT | 206.58 | HUMAN_MANAGED | -36.99 | 1 | 1.2003 | 5 | 2 |
| LTCUSDT | SHORT | 232.05 | HUMAN_MANAGED | -4.46 | 1 | 4.9789 | 0 | 0 |
| FETUSDT | SHORT | 214.09 | HUMAN_MANAGED | -2.95 | 1 | 1.9642 | 0 | 0 |
| ONDOUSDT | SHORT | 231.96 | HUMAN_MANAGED | -1.67 | 1 | 2.2032 | 0 | 0 |
| SUIUSDC | SHORT | 92.45 | HUMAN_MANAGED | -1.53 | 1 | 4.0553 | 0 | 0 |
| FILUSDT | SHORT | 92.66 | HUMAN_MANAGED | -0.99 | 1 | 4.0950 | 0 | 0 |
| CRVUSDT | SHORT | 7.87 | HUMAN_MANAGED | -0.81 | 1 | 19.9696 | 0 | 0 |
| ETHUSDT | LONG | 175.49 | HUMAN_MANAGED | -0.76 | 1 | 2.1235 | 2 | 0 |
| INJUSDT | LONG | 90.59 | HUMAN_MANAGED | -0.71 | 1 | 12.5093 | 3 | 2 |
| VIRTUALUSDT | SHORT | 13.89 | HUMAN_MANAGED | -0.64 | 1 | 6.6932 | 0 | 0 |
| BCHUSDT | LONG | 148.50 | HUMAN_MANAGED | -0.61 | 1 | 17.0795 | 1 | 0 |
| POLUSDT | SHORT | 15.40 | HUMAN_MANAGED | -0.60 | 1 | 5.0322 | 0 | 0 |
| APTUSDT | SHORT | 92.03 | HUMAN_MANAGED | -0.54 | 1 | 3.6455 | 1 | 0 |
| DOTUSDT | SHORT | 234.89 | HUMAN_MANAGED | -0.51 | 1 | 3.8855 | 0 | 0 |
| BRUSDT | LONG | 13.78 | HUMAN_MANAGED | -0.39 | 1 | 6.1412 | 0 | 0 |
| XRPUSDC | LONG | 92.64 | HUMAN_MANAGED | -0.36 | 1 | 6.6231 | 5 | 2 |
| DOGEUSDC | LONG | 94.01 | HUMAN_MANAGED | -0.28 | 1 | 6.1516 | 0 | 0 |
| WLDUSDT | LONG | 10.86 | HUMAN_MANAGED | -0.28 | 1 | 19.4391 | 0 | 0 |
| DASHUSDT | SHORT | 89.59 | HUMAN_MANAGED | -0.27 | 1 | 15.9987 | 0 | 0 |
| ETHFIUSDT | SHORT | 15.03 | HUMAN_MANAGED | -0.26 | 1 | 19.9108 | 1 | 0 |
| TAOUSDT | SHORT | 16.29 | HUMAN_MANAGED | -0.21 | 1 | 3.9523 | 0 | 0 |
| XLMUSDT | SHORT | 1.82 | HUMAN_MANAGED | -0.16 | 1 | 19.4442 | 0 | 0 |
| HBARUSDC | LONG | 4.11 | HUMAN_MANAGED | -0.15 | 1 | 20.0032 | 0 | 0 |
| BNBUSDC | SHORT | 234.68 | HUMAN_MANAGED | -0.13 | 1 | 1.7272 | 0 | 0 |
| POLUSDT | LONG | 10.75 | HUMAN_MANAGED | -0.11 | 1 | 20.0134 | 0 | 0 |
| NEARUSDT | SHORT | 2.94 | HUMAN_MANAGED | -0.07 | 0 | — | 0 | 0 |
| BNBUSDC | LONG | 6.43 | HUMAN_MANAGED | -0.06 | 1 | 13.0749 | 1 | 1 |
| ONDOUSDT | LONG | 6.57 | HUMAN_MANAGED | -0.06 | 1 | 19.2205 | 0 | 0 |
| WLDUSDT | SHORT | 1.00 | AUTO_MANAGED | -0.06 | 0 | — | 0 | 0 |
| BCHUSDT | SHORT | 13.35 | HUMAN_MANAGED | -0.05 | 1 | 9.6096 | 1 | 0 |
| VVVUSDT | SHORT | 12.62 | HUMAN_MANAGED | -0.05 | 1 | 9.8332 | 0 | 0 |
| WIFUSDT | SHORT | 15.73 | HUMAN_MANAGED | -0.05 | 1 | 20.0604 | 4 | 0 |
| OPUSDT | SHORT | 1.12 | HUMAN_MANAGED | -0.04 | 1 | 20.0903 | 2 | 1 |
| TAOUSDT | LONG | 3.12 | HUMAN_MANAGED | -0.01 | 1 | 19.2062 | 0 | 0 |
| ADAUSDT | SHORT | 13.90 | HUMAN_MANAGED | -0.01 | 1 | 9.9894 | 0 | 0 |
| BRUSDT | SHORT | 4.51 | AUTO_MANAGED | -0.00 | 0 | — | 0 | 0 |
| DOGEUSDC | SHORT | 5.49 | AUTO_MANAGED | 0.02 | 1 | 10.0294 | 0 | 0 |
| XPLUSDT | SHORT | 13.43 | HUMAN_MANAGED | 0.05 | 1 | 6.7476 | 0 | 0 |
| HBARUSDT | LONG | 3.38 | AUTO_MANAGED | 0.07 | 1 | 19.9633 | 0 | 0 |
| VIRTUALUSDT | LONG | 5.09 | HUMAN_MANAGED | 0.08 | 1 | 19.9091 | 3 | 1 |
| TIAUSDT | SHORT | 12.48 | HUMAN_MANAGED | 0.14 | 1 | 3.9353 | 0 | 0 |
| PENGUUSDC | SHORT | 15.61 | HUMAN_MANAGED | 0.16 | 1 | 4.0865 | 0 | 0 |
| ETHFIUSDT | LONG | 11.05 | HUMAN_MANAGED | 0.16 | 1 | 6.7099 | 0 | 0 |
| LINKUSDC | LONG | 3.70 | HUMAN_MANAGED | 0.28 | 1 | 5.0274 | 0 | 0 |
| COTIUSDT | SHORT | 13.99 | AUTO_MANAGED | 0.30 | 1 | 6.7441 | 0 | 0 |
| ARBUSDT | SHORT | 231.85 | HUMAN_MANAGED | 0.31 | 1 | 15.9585 | 1 | 0 |
| RAYSOLUSDT | SHORT | 9.45 | AUTO_MANAGED | 0.36 | 1 | 6.6149 | 0 | 0 |
| JUPUSDT | SHORT | 13.83 | HUMAN_MANAGED | 0.41 | 1 | 3.3291 | 0 | 0 |
| USELESSUSDT | SHORT | 11.31 | HUMAN_MANAGED | 0.42 | 1 | 9.9469 | 0 | 0 |
| UNIUSDT | SHORT | 16.37 | AUTO_MANAGED | 0.53 | 1 | 5.6191 | 0 | 0 |
| XLMUSDT | LONG | 8.01 | AUTO_MANAGED | 0.62 | 1 | 4.9895 | 0 | 0 |
| CRVUSDT | LONG | 3.98 | AUTO_MANAGED | 0.64 | 1 | 10.0799 | 2 | 1 |

Entry占用投影使用当前源码 `entryRiskOccupancy.entryOrderOccupiesRisk` 对邻近 `/orders` 缓存按T0重新计算，包含UNKNOWN且proof无效的保守观察值，**不是交易所确认的挂单数**；快照或proof checkedAt跨T0的时间差会改变计数，不能强求与account的23相等。当前重算总数 23，其中落在当前55仓之外 11。本轮没有独立远端逐单核验，真正实时活动Entry的逐仓数仍UNKNOWN；52个WORKING TP的保护有效性引用既有Guardian投影，不能替代独立exchange readback。
