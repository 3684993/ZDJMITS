# V3.9.5 停机前最近 10 小时运行审计（2026-09-23）

审计窗口 2026-09-22 21:33:25 → 2026-09-23 07:33:25（UTC+8）。被审对象为**现网运行中的 V3.9.5**：实例 `939b2020-73de-4a94-9f4d-2e927c72d3c9`，PID 10540，版本 3.9.5，buildId `3.9.5-8b7cc98ccaaa6c06456c`（artifactHash `8b7cc98c…`、sourceHash `3ec075a1…`，见 `data/runtime/engine-instance.json`），2026-09-20 11:48:16 手动启动，已连续运行 67.9 h，`supervisor.status=NOT_RUNNING`（无自动拉起）。

机器可读证据与复现方式见 [v395-10h-audit](../evidence/v396/runtime-cutover-20260923/v395-10h-audit/README.md)。

**一句话结论：AI 大脑从 04:56:52 起再没有收到过一个候选，原因不是"市场没机会"，也不是 AI 链坏了，而是账户 29 笔存量持仓的名义敞口（10,724 USDT）已经超过"权益 × maxGrossExposurePct=100%"上限（10,412 USDT），`remaining.gross` 归零；V3.9.5 的 AI 派发被一道**前置**的资金/风险容量闸挡住，闸门判定"没有任何候选可执行"，于是调度器每 2.5 秒空转一次并继续把状态写成"持续扫描中：当前没有合格可执行机会"。驾驶舱无法区分"真的没机会"与"分析链停摆"——这是本次审计确认的首要缺陷（P1 可观测性）。**

## 1. 最近 10 小时逐时时间线

计数取自 `runtime_events`（窗口内完整，非下界；留存完整性论证见证据 README）。列为：AI 派发 / AI 终局 / 候选状态变化 / 候选被拒 / 建仓意图 / 成交 / 候选再派生 / 供给健康 / 行情补集 / 私有流 / 人工交接。

| 小时桶（+08 起） | POOL_ANALYSIS_STARTED | AI_RUN_TERMINAL | CANDIDATE_LIFECYCLE_CHANGED | CANDIDATE_REJECTED | ENTRY_INTENT_CREATED | ENTRY_FILLED | CANDIDATE_LIFECYCLE_REDERIVED | CANDIDATE_SUPPLY_HEALTH | MARKET_COHORT_REFILLED | BINANCE_USER_DATA | POSITION_HUMAN_HANDOFF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 09-22 21:33 | 6 | 5 | 34 | 4 | 1 | 0 | 1002 | 56 | 9 | 4 | 0 |
| 09-22 22:33 | 8 | 9 | 58 | 6 | 3 | 1 | 1378 | 79 | 16 | 24 | 0 |
| 09-22 23:33 | 11 | 9 | 70 | 7 | 1 | 0 | 1371 | 80 | 19 | 31 | 0 |
| 09-23 00:33 | 17 | 18 | 116 | 6 | 8 | 2 | 1134 | 63 | 24 | 14 | 1 |
| 09-23 01:33 | 27 | 24 | 171 | 10 | 12 | 2 | 1274 | 77 | 25 | 56 | 0 |
| 09-23 02:33 | 36 | 35 | 228 | 12 | 20 | 2 | 1759 | 100 | 27 | 26 | 0 |
| 09-23 03:33 | 20 | 19 | 130 | 9 | 8 | 4 | 1074 | 53 | 25 | 131 | 1 |
| 09-23 04:33 | 11 | 11 | 76 | 7 | 3 | 1 | 1598 | 79 | 24 | 58 | 1 |
| **09-23 05:33** | **0** | **0** | **0** | **0** | **0** | **0** | 1044 | 55 | 27 | 2 | 2 |
| **09-23 06:33** | **0** | **0** | **0** | **0** | **0** | **0** | 1189 | 63 | 24 | 2 | 0 |

窗口内 AI 请求总量（`ai_runs_archive`）：**PRIMARY_BRAIN 完成 130 次、失败 5 次；SCOUT 完成 136 次**；PRIMARY 输入 2,714,652 token、输出 109,005 token，SCOUT 输入 501,287、输出 47,883。建仓链：意图 56、下单 19、提交尝试 26、成交 12、提交前被拦 6、提交结果 UNKNOWN 6。平仓链：`POSITION_CLOSED_USER_DATA` 14、`EXCHANGE_FILL_ATTRIBUTED` 294、`ORDER_FILL_RECONCILED` 261→（窗口内）见证据文件。私有账户同步在 21:34:32–00:10:20 抖动 121 次失败并在 00:10:42 自行恢复，随后 7.5 小时无失败。

时间线读法：**AI 在 04:33 那一小时仍在工作（11 次派发、11 次终局）**，04:55:18 最后一次派发（TIAUSDT），04:56:27 最后一次终局，04:56:52 最后一次候选状态迁移；此后三个"零"小时里，扫描层（再派生 1,044–1,189/小时、供给健康 55–63/小时、行情补集 24–27/小时）、私有账户流、止盈维护和人工交接全部照常运行。

## 2. 04:55:28 之后为什么没有新分析：逐假设裁决

关键时间锚点：最后一次 AI 请求开始 **04:55:28**、最后一次终局 **04:56:27**、最后一次派发 **04:55:18**、最后一次候选状态变化 **04:56:52**；`capitalExecutableCount` 最后一次 >0 是 **04:54:53**，其后的 **165 次**供给健康采样全部为 0，连续 **156.9 分钟**（截至观测时刻）。

| 假设 | 裁决 | 证据 |
|---|---|---|
| 没有任何候选进入 AI（供给端空） | **REFUTED** | 窗口内 130 次 PRIMARY 完成 + 5 次失败、136 次 SCOUT；生命周期链可见 `READY → PRIMARY_QUEUED → PRIMARY_RUNNING → PRIMARY_COMPLETED → PLACE_READY`；观测时刻仍有 4 个候选（XRPUSDC/UNIUSDC/TUTUSDT/TIAUSDT）具备管线资格与分配方案 |
| 有候选但在 AI 之前被过滤 | **CONFIRMED（根因）** | 观测时刻 3 个已路由候选全部 `admission=ALLOW_REDUCED_SIZE` 却 `reason=REJECT_GROSS_EXPOSURE`、`longExecutable=false`、`shortExecutable=false`、`remaining.gross=0`；窗口内 61 次 `CANDIDATE_REJECTED` / `ENTRY_DECISION_BLOCKED` 理由全部是 `REJECT_GROSS_EXPOSURE`（其中 5 次叠加 `REJECT_DIRECTION_EXPOSURE`）；`directionBudget` 三项均为 0 |
| AI 调度 / 预算 / 队列 / 锁 / 冷却 / 隔离 / 超时阻断 | **RULED_OUT** | `aiHealth.{cooldown,quarantine,timeout}=0`、`queueDepth=0`、`active=0`；不存在跨候选的全局锁存；最后一个候选在 04:56:52 已从 `AI_FAILURE_COOLDOWN` 回到 `READY`，之后不再有状态迁移，说明它不是被冷却卡住而是被前置闸筛掉 |
| 模型端不可用或调用失败 | **RULED_OUT（作为静默原因）** | `brain-7900-primary`（qwen/qwen3.8-27b @ RX 7900 XTX）`status=ONLINE`、`connectionStatus=ONLINE`，健康检查时间戳持续更新（最后一次 `AI_RESOURCE_HEALTH_CHANGED` 07:27:48）；04:58:16→04:58:29、05:25:37→05:25:50 两次 "This operation was aborted" 抖动约 13 秒内自愈。5 次 `AI_OUTPUT_INVALID: output token limit reached`（00:14:29、02:30:12、03:29:18、04:29:22、04:36:01，延迟 59.8–63.8 s）是**独立真实缺陷**，但最后一次早于静默边界且其后仍有成功分析 |
| Engine 调度链或事件循环异常 | **RULED_OUT** | 双重独立证明：① 20 秒内 `/health` 的 shadow 采样计数 385,349→385,378（+29），`lastSampleAt` 前进 31,130 ms；② 驱动派发的 2.5 秒定时器与 `runtimeControl.evaluate(true)` 同回调（appRuntime.ts:537-542），`capital.evaluatedAt` 推进到 07:33:24、`nextRecheckAt` 07:33:54，且 `canDispatch()` 六个条件逐项为真（storage 无阻断、私有账户新鲜、`entryRiskBlocked=false`、governance `AUTO_RUNNING`、mode `RUNNING`、entrySafetyMode `AUTO`），因此 `processPool()` 确实被调用。反证：`DynamicPool.replenish` 会把管线合格成员标为 `READY`（pool.ts:26,31），只有 `refreshReadyView` 会降回 `WAITING`（entryCoordinator.ts:96、pool.ts:11），而 13 个池内成员全部 `WAITING` 且含 4 个管线合格者——派发 tick 在静默期内仍在执行 |
| 私有账户 / 行情事实不新鲜导致 fail-closed | **RULED_OUT（作为静默原因）** | `binancePrivate=READY`、`snapshotAgeMs` 观测时 7.7 s、`consecutiveFailures=0`；`freshMarkets=FRESH`、`quoteFreshRatio=1`、`klineFreshRatio=1`、`stale=[]`。私有同步确在 21:34–00:10 失败 121 次，但 AI 在其后继续分析了约 4 小时，因果方向不成立；该段应记为对更早时段扫描质量的 **CONTRIBUTING** |
| 其它（结构性放大） | **CONFIRMED（贡献因素）** | 上限按 `equity × maxGrossExposurePct` 动态计算，因此权益随浮亏下滑会**单方面收紧**新仓空间：观测时刻 equity 10,412.13、名义敞口 10,724.70（多头 4,615.96 + 空头 6,108.74），空头方向 6,108.74 也已越过方向上限 5,206.07（`remaining.direction` 空头 = 0）。浮亏最大的两笔 AVAXUSDT SHORT −679.89（−143.39% 保证金）与 ZECUSDT SHORT −149.39（−158.37%）本身就是压垮上限的主因 |

### 2.1 哪一层先停、哪一层最后仍活

自上而下：行情/私有账户层始终活；候选再派生层始终活（每小时上千次）；**候选状态机层在 04:56:52 停止产生任何迁移**（因为它只能由派发或被拒驱动，而两者都要求先通过前置容量闸）；AI 请求层在 04:55:28 停止；执行层在 04:40:38 最后一笔成交后无新仓。首先"事实上停止"的是 `objectiveCapacity` 的判定结果（04:54:53 最后一次为正），其后所有下游层依次静默。**没有任何一层崩溃或悬挂。**

## 3. 窗口内的错误、超时、限流、预算与积压

| 现象 | 等级 | 证据 |
|---|---|---|
| 私有账户同步失败抖动 121 次（21:34:32–00:10:20），98 次恢复，之后连续失败 0 | CONTRIBUTING（仅影响前 3.5 小时扫描新鲜度） | `PRIVATE_SYNC_FAILED` / `PRIVATE_SYNC_RECOVERED`；当前 `snapshotAgeMs` 秒级 |
| 对账失败 41 次（21:34:02–00:11:12） | CONTRIBUTING，已自愈 | `RECONCILIATION_FAILED`；`driftCount=0` |
| UNKNOWN 订单远端状态不可证实 879 次（`EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK`） | 已知残留（R17 记录），P2 | 每笔均以 5 个交易所来源判为无活跃风险；无换 ID 重发（`ENTRY_ORDER_SUBMISSION_UNKNOWN` 6 次） |
| Binance 限流 | **RULED_OUT** | 出口 scope `TESTNET:proxy-a087cc91667b`：`http429=17`、`http418=3` 均为累计值，`lastLimitedAt=2026-09-18 09:24:59`（窗口前 5 天），`blockedUntil=null`，`status=AVAILABLE`，`usedWeight1m≈179/6000` |
| 代理 / 出口 | 无异常 | R16 双层 fail-closed 在场，`verifyBinanceTransportEgress` 每 15 分钟一次，无阻断事件 |
| 模型服务不可用 | RULED_OUT（见 §2） | |
| token / 上下文溢出：5 次 PRIMARY 输出触顶 `AI_OUTPUT_INVALID` | **CONFIRMED，P1（分析质量）** | 窗口内 5/135 = 3.7% 的 PRIMARY 运行因输出 token 上限作废，延迟均 ~60 s；属提示词/输出预算问题，不是调度问题 |
| 队列积压 / 预算耗尽 / 重复冷却 / 隔离 | RULED_OUT | `queueDepth=0`、`aiHealth` 全零、`cooldownSymbols=0` |
| 任务悬挂 / 状态机卡死 | RULED_OUT | 见 §2 派发链存活证明 |
| 孤儿止盈撤销失败 1 次（21:58:02），其后 10 次 `ORPHAN_TP_CANCELED` 成功，`orphanTp=0` | P2，已自愈 | |
| `1w WARMING requires >=20 closed candles` 131 次 | 无害（周线预热） | `MARKET_SYMBOL_ERROR` 载荷 |

## 4. 驾驶舱为什么把这种状态显示成"正常扫描"

现网同一时刻三份文案互相不一致：

- 总状态：`pipelineState=RUNNING`，`runtimeControl.reasonCode=NO_EXECUTABLE_CONTRACT`，文案 **"持续扫描中：当前没有合格可执行机会"**；
- AI 面板：`idleReason=WAITING_CANDIDATE`、`nextStep="等待新的候选事实，避免重复推理"`、健康判定 **`READY` / `IDLE_NO_DISPATCHABLE_CANDIDATE`**；
- 顶层未建仓原因：`noEntryReason=WAITING_EXECUTION_CAPACITY`（唯一说对了的那一项）。

代码依据：

1. `runtimeControlService.ts:128` 只有当 `slots.used >= slots.max`（29 < 50，不成立）才换成"仓位容量已满"文案；否则一律输出"当前没有合格可执行机会"。**权益/敞口上限耗尽这一情形没有专属文案**，因此它和"市场真的没机会"共用同一句话。
2. `aiResourceHealth.ts:29-32`：`dispatchable = ready && eligible>0 && executableCandidates>0 && poolResidents>0 && pendingEntries<max`。本例中唯一为假的是 `executableCandidates>0`——也就是**恰恰是被根因卡住的那一项**。于是 `DEGRADED_UNEXPLAINED_IDLE`（>10 分钟空闲告警）在结构上永远不可能在"敞口耗尽"状态下触发，长时间 AI 空闲被归类为健康的 `IDLE_NO_DISPATCHABLE_CANDIDATE`。
3. `entryCoordinator.ts:127-130`：`WAITING_CANDIDATE` 的含义是"经容量过滤后待派清单为空"，而不是"不存在候选"；文案把它翻译成"等待新的候选事实"，把**准入闸筛掉**误说成**供给端没产出**。

结论：该文案依据的是"扫描循环仍活着 + 可执行候选数为 0"，**不能**区分"正常无机会"与"AI 分析链异常静默"。它当前也**确实没有**把一次真实的分析链停摆伪装成正常——因为这次停摆是合规的 fail-closed；但它不具备识别"不合规静默"的能力，这两件事必须分开陈述：**行为正确，可观测性不足。**

## 5. 已具备与缺失的可观测事实（Q6）

已存在且可直接用于告警：`ai_runs_archive.max(started_at)` = 最后一次 AI 请求（04:55:28）、`AI_RUN_TERMINAL` = 最后一次终局（04:56:27）、`entryActivity.lastPrimaryRunAt / lastPlaceDecisionAt / lastEntryIntentAt / lastEntrySubmittedAt / lastEntryFilledAt`、`primaryBrain.lastRunAgeMs`（已算好，观测时 9,477,548 ms）、`AI_RUN_FAILED` 与 `short_reason`、`aiHealth.consecutiveFailures`、模型健康 `status/connectionStatus/healthCheckedAt`、候选供给各计数、逐候选准入理由 `capacity.candidates[].reason` 与 `riskHeadroom.remaining`、`directionBudget`、扫描心跳（再派生/供给健康/cohort 补集/shadow `lastSampleAt`）、私有账户与行情新鲜度。

缺失（不可用现有字段替代）：

1. **派发 tick 心跳时间戳**：`scheduler` 只有 `{status:"RUNNING"}`，没有 `lastProcessPoolAt`。本次只能靠"池成员被降级为 WAITING + `capital.evaluatedAt` 推进"间接推断派发在跑——推断成立，但代价太高且不可告警。
2. **"最后一次候选通过前置容量闸"** 这一事实没有独立字段（`candidateLifecycle.nextCandidate=null` 不带原因码）。
3. **与可派发性解耦的空闲告警**：`consecutiveFailures` 在完全静默时恒为 0（没调用就不会失败），因此任何"连续失败"型告警对本场景天然失效。
4. **"敞口耗尽" vs "无机会"的区分**：准入算术齐全但只暴露在 `/api/v3/diagnostics/supply`，未上升为状态/事件。
5. **告警通道**：没有任何事件类型或设置项表示"AI 已 N 分钟未分析"；最接近的 `TRADING_PIPELINE_PAUSED_DAILY_RISK_LIMIT` 因 `entryRiskBlocked=false` 不会触发。
6. **funding 事实**：窗口内 14 笔平仓记录 `fundingAttributionStatus` 全为 `UNKNOWN`、`funding=null`、`economicEligibility/formalNetPnlStatus=null`。
7. 附带不一致：同一时刻两套阻断归因给出不同答案——`supply.health` 报 `rootBlocker=CAPITAL` 而 `reasonCounts` 为 `GOVERNANCE:76, CAPITAL:4`；`CANDIDATE_SUPPLY_HEALTH` 事件载荷则报 `blockerCategories={SUPPLY:18,CAPITAL:20,GOVERNANCE:0}`，且 `reasonCounts.EXECUTABLE>0` 与 `executableCandidateCount=0` 并存（前者在风险复核前统计）。归因口径未统一。

## 6. ">30 分钟无实际分析就告警"是否具备事实基础（Q7）

**具备，且不需要新增采集**：`lastRunAgeMs` 已在 `primaryBrain` 观测里算好（本次 9.48e6 ms），`AI_RUN_TERMINAL`/`ai_runs_archive` 提供权威时刻，缺的只是"允许在无候选时也告警"的判定与一条告警事件。建议告警必须至少区分以下五态，否则会把正常的敞口满载误报成故障：

| 状态 | 判定所需事实（均已存在） |
|---|---|
| 无候选供给 | `pipelineReadyCount=0` 且 cohort/再派生持续、`reasonCounts.SUPPLY` 主导 |
| 候选被规则/质量筛除 | `pipelineReadyCount>0` 且 `CANDIDATE_REJECTED`/`ENTRY_DECISION_BLOCKED` 持续产生并带理由 |
| **容量/敞口阻断（本次情形）** | `executableCandidates=0` 且 `riskHeadroom.remaining.gross=0` 或 `directionBudget.*=0`，同时 `slots.used<max` |
| AI 调度停滞（真故障） | 前三态条件都不成立、`lastRunAgeMs>阈值`、但无 `POOL_ANALYSIS_STARTED`；需要 `lastProcessPoolAt` 才能与"模型故障"分离 |
| 模型不可达 / 调用失败 | `connectionStatus!=ONLINE` 或 `AI_RUN_FAILED` 增长、`consecutiveFailures>0` |

误报风险主要来自：把"满载"当故障（应作为独立状态并给专门文案）、私有账户短暂过期导致 `executableCandidates` 瞬时归零（需连续 N 个采样而非单点，参见 §8 的 UNKNOWN TTL 抖动同理）、以及人工暂停/安全模式下本就不派发（`entrySafetyMode!=AUTO` 应先排除）。**本轮未新增或伪造任何告警事件。**

## 7. 最近 10 小时交易结果（Q8）

- **开仓 5 笔**（全部 `entryTimeSource=SYSTEM_FILL`）：DASHUSDT 00:55:29、BCHUSDT 03:22:13、XRPUSDT 03:36:58、WLDUSDT 04:17:04、HBARUSDT 04:40:03。
- **平仓 14 笔**，`closeReason=RECONCILIATION`、`source=SYSTEM`（由交易所成交事实收敛得出，不是 AI 主动砍仓）。合计 **tradingNetPnlExFunding = +27.271363 USDT**，费用合计 0.275003 USDT。逐笔（USDT，不含资金费）：XRPUSDT +1.0173、HBARUSDT +10.7958、DASHUSDT +1.0199、TUTUSDT +1.0063、PENGUUSDT +1.0058、BCHUSDT +1.0208、PENGUUSDC +1.0828、HBARUSDT +1.0332、PENGUUSDT +1.0138、WLDUSDT +1.0181、USELESSUSDT +1.0152、TUTUSDT +4.2281、UNIUSDC +1.0104、APTUSDT +1.0039（持仓 88.2 h，06:51:58 关闭）。
- **funding：`INSUFFICIENT_EVIDENCE`**（14/14 记录 `fundingAttributionStatus=UNKNOWN`），不填 0；因此"已实现净收益"只能报到"不含资金费"口径，`canonicalNetPnlStatus=NO_ELIGIBLE_SAMPLES`（覆盖 0/185），全账本累计 `tradingNetExFunding=+478.57` 亦不含 funding。
- **持仓变化：38 → 29**（窗口起点 24 笔留存 + 14 笔窗口内已平 = 38；窗口内开 5、平 14）。观测时刻 **29 笔（19 多 / 10 空）**，名义 10,724.70 USDT，**浮亏合计 −915.37 USDT**，其中 AVAXUSDT SHORT −679.89、ZECUSDT SHORT −149.39 两笔占 91%。
- **人工/AI 行为**：`managementStatus` = HUMAN_MANAGED 27 / AUTO_MANAGED 2；窗口内 4 次人工交接（BCHUSDT 04:31:18、XRPUSDT 04:48:42、HBARUSDT 05:45:17、WLDUSDT 06:03:11），原因均为 `LOSS_HANDOFF_BARS`（`lossHandoffBars=4`）且 `tpRetained=true`。即**亏损仓一律转人工、AI 未自动平掉任何亏损仓**，与既定损失处理政策一致；这 4 笔交接发生在 AI 静默期内，证明维护/交接链独立于模型。
- **未成交 / UNKNOWN / 异常订单**：Entry 累计 515（FILLED 204 / CANCELED 159 / REJECTED 106 / **UNKNOWN 46**）；46 笔 UNKNOWN 全部 `activeRiskExposure=false` 且 `VERIFIED_NO_ACTIVE_RISK`，`historicalUnknown=46 / verifiedNoActiveRisk=46 / activeRiskUnresolved=0 / drift=0`。`submissionUnknown` 6 次，均通过原 clientOrderId 查证收敛，**无换新 ID 重发**。
- **异常扛单与保护缺口**：**保护缺口 0**——29/29 持仓 `tpStatus=PROTECTED`，覆盖来源 100% `BINANCE_OPEN_ORDER`，交易所侧 `WORKING` 止盈单 29 笔与持仓一一对应；`unverifiedTp/missing/repairing/repairFailed/orphanTp/duplicateTp/qtyMismatch/wrongSide/retryQueue` 全为 0，窗口内 `TP_REPAIR_FAILED=0`。**但"扛单"事实成立且性质严重**：27 笔已转人工，其中 2 笔空头浮亏已超保证金 100%（AVAX −143%、ZEC −158%）。风险不在"缺保护"，而在"无人处置的存量深亏持续压缩权益上限，反向锁死新开仓能力"——这正是 V3.9.6 组合风险层要覆盖的场景。

## 8. 停机前风险快照与 A2 停机判据

`stopline-snapshot.json` 的 8 项判据全部为真，**未发现 A2 中止条件**：29/29 持仓由交易所侧 `WORKING` 止盈单保护（停机后仍在交易所生效）；46 笔非终态 Entry 订单在 3 次采样中全部带 `VERIFIED_NO_ACTIVE_RISK` 证据且 `capacity.inFlight` 恒为 0（即不存在"无法判定且可能重复成交"的活单）；环境身份明确为 TESTNET / `demo-fapi.binance.com` / `credentialRef=binance-primary` / `settingsVersion=188`，无生产端点；私有账户 `READY`（age 7.7 s）、行情 `FRESH`（stale 0）；durable 存储 `AVAILABLE`（375.3 MB / 阻断阈值 1,342.2 MB），可做一致性在线备份。

一个必须记录的判据口径问题：**不能用单点 `activeRiskUnresolvedCount==0` 作为放行条件**。UNKNOWN 订单的"无活跃风险"证据带 TTL（300 s）并按 5/15/30 分钟阶梯重审，因此该值只是采样时刻的函数：07:19–07:24 观测到 1，07:33–07:34 三次采样为 0，07:39:29 又观测到 2，而同一分钟 `/api/v3/orders` 显示全部 46 笔的证据均在 0.9–29.3 分钟内刷新且无一笔缺证据。我最初把判据写成"未解决数 ≤1"，事后证明这个上界是凭空设定的（07:39 就被突破），已在 `lifecycle.json.stopLineDecision.correction` 里保留这条错误并说明实际采用的口径：**停机瞬间每一笔非终态 Entry 订单都必须带 `VERIFIED_NO_ACTIVE_RISK`（实测 46/46，缺失 0）、`capacity.inFlight` 在重复采样中恒为 0、29 笔持仓全部由交易所侧 `WORKING` 止盈单保护**。若把"必须为 0"写成停机前置条件，理论上可以永远等不到。

## 9. 发现的真实问题与优先级

**P1**
- P1-1 可观测性：`aiResourceHealth.ts:29-32` 把 AI 空闲告警与 `executableCandidates>0` 耦合，导致"敞口/容量耗尽"下的任意长度 AI 静默都显示为健康 `READY`；驾驶舱文案（`runtimeControlService.ts:128`）无法区分"市场无机会""权益敞口耗尽""分析链停摆"。用户要求的 >30 分钟告警在现有事实上可实现，但当前判定逻辑主动压制它。
- P1-2 分析质量：窗口内 5/135 次 PRIMARY 运行因 `AI_OUTPUT_INVALID: output token limit reached` 作废（约 3.7%），每次白烧约 60 s 与约 2 万 token 的输出预算。
- P1-3 风险结构：权益敏感的敞口上限使存量深亏（AVAX/ZEC 两笔空头 −143%/−158% 保证金）自动锁死全部新仓，且这一后果只体现在 `/diagnostics/supply` 的算术里，没有任何面向操作者的状态；"只停新仓不等于消除已有风险"。

**P2**
- P2-1 归因口径不一致：`rootBlocker=CAPITAL` 与同刻 `reasonCounts GOVERNANCE:76/CAPITAL:4`、事件载荷 `blockerCategories SUPPLY:18/CAPITAL:20/GOVERNANCE:0`、以及 `reasonCounts.EXECUTABLE>0` 与 `executableCandidateCount=0` 并存。
- P2-2 派发 tick 无心跳字段（`scheduler` 仅 `status`），故障与满载不可分离。
- P2-3 `activeRiskUnresolved` 因证据 TTL 抖动，任何以它为条件的门禁都不稳定（10 分钟内实测取值为 0、1、2）。
- P2-4 UNKNOWN 订单每 ~30 分钟一轮的 5 来源重审产生 879 条窗口内事件（R17 已知，不再优化请求数）。
- P2-5 一次 `ORPHAN_TP_CANCEL_FAILED`（已自愈，`orphanTp=0`）。
- P2-6 funding 事实缺失（14/14 UNKNOWN），全账本 canonical 覆盖 0/185。
- P2-7 构建可复现性：停机时重算 `contentTreeHash(apps/engine/dist, packages/core/dist, packages/contracts/dist, apps/dashboard/dist)` 得 `f64edc21…`，与运行实例记录的 `artifactHash=8b7cc98c…` **不一致**。三个真正提供运行代码的 dist 树 mtime 均早于 11:48:11 启动时刻，唯 `apps/dashboard/dist`（22 文件）在 13:55:49 被本机重建过——这足以改变复合哈希，也与提交 `65e390e` 已记录的现象一致。裁决 `PARTIALLY_CORROBORATED`：不构成本轮运行行为结论的反证，但 **V3.9.5 的构建产物在文件层面不可复现**，且去掉 dashboard 也无法用减法隔离差异。V3.9.6 侧改由干净构建重新登记哈希。

**P0：无。** 未发现执行正确性、重复成交、越权或保护缺口类问题。

## 10. 是否需要改代码，以及先修哪一类

需要，但**不在本轮实施**（本轮只审计）。建议顺序：

1. **先修可观测性（P1-1 + P2-1/P2-2）**：把"最后一次 AI 请求/终局/通过前置闸"升格为一等状态，给 AI 空闲告警解耦 `executableCandidates`，并为"敞口耗尽"设立独立状态与文案；这是纯呈现层与判定层改动，能立刻消除"异常静默看起来像正常扫描"这一类误判，也是后续一切运行验证的前提。
2. **再修分析质量（P1-2）**：输出 token 上限与提示词预算，属可量化的收益损失点。
3. **风险结构（P1-3）不应通过放宽阈值解决**：恰恰要保留这道闸；要做的是让存量深亏的处置（人工响应安排/资本隔离）在驾驶舱里可见，而不是让新仓绕过它。**明确不要优化**：不要为了让 AI 重新工作而上调 `maxGrossExposurePct`、放大 `directionBudget` 或让 AI 主动平掉亏损仓。
4. UNKNOWN 请求数与 TTL 抖动（P2-3/P2-4）维持 R17 结论：不再以降请求数为目标。

## 11. 本轮是否触碰 Engine 生命周期、现网配置/数据库或交易所写接口

没有。全程未启动、未停止、未重启、未热重载 Engine（PID 10540 自 2026-09-20 11:48:16 起持续运行）；未安装或启用任何自动启动/看门狗；未修改现网 Settings 或数据库（`zdj-settings.sqlite` 以 `readOnly: true` 连接，仅 SELECT）；未向 Binance 发出任何请求（读或写）——所有交易所事实来自 Engine 既有只读投影；未部署。GitHub 推送仅包含源码/文档/证据。生产环境交易所写入次数：**0**。
