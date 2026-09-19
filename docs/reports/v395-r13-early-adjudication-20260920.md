# ZDJ-MITS V3.9.5｜R13 提前裁决报告（4 小时档，实际观察 6.1 h）→ UNKNOWN 复核风暴优先治理

标记：**`R13_EARLY_ADJUDICATION_AT_4H`**

诚实声明：**本轮不是"10 小时稳定性 PASS"。** 原计划 R13 连续观察 10 小时（`R13_BASELINE = 2026-09-20 00:31:52` → 计划 `10:31:52`）。用户在约 4.1 小时处明确授权终止等待、提前进入 Phase C/D；实际裁决执行时刻为 **06:35:51**，即已连续获得 **6.07 h / 33 轮**轻量采样 + 6 次小时级 durable 收割。因此本文所有结论的适用口径是"6.1 h 提前裁决窗口"，10 小时窗口未完成。

- 观察期间 Engine **未重启**（PID 2320、`restartCount 162` 全程不变）、**未暂停交易**（`RUNTIME_CONTROL_CHANGED` 事件 0 次）、未做人工 backfill、未清缓存、未改任何 Settings。
- 采集器（本机脚本）为只读：`/health`、`/api/v3/pipeline`、`/api/v3/diagnostics/*` + `runtime_events` 只读连接。

---

## 一、为什么 6.1 h 已具备决策信息量

原 10 h 窗口的目的不是"熬时间"，而是要拿到三件在短窗口内**可能永远不发生**的真实事件。它们在 6.1 h 内全部发生并被记录：

| 需要真实事件才能裁决的问题 | 是否在窗口内发生 | 结果 |
| --- | --- | --- |
| K 线自愈的 live 正向路径（R12 留为"未演练"） | **是，01:27 自然 WS gap** | 通过（见二） |
| egress 探针失效时是否 fail-open | **是，03:39–04:14 UNAVAILABLE** | 通过，正确 fail-closed（见三） |
| historical UNKNOWN 复核风暴是否稳定可量化 | **是，全程持续** | 确认为第一优先治理对象（见五） |

继续等到 10 h 只会把同一类样本的计数放大，不会改变本轮的工程裁决；而该风暴每小时产生 ~880 条重复事件与约 2,600 次远端请求，多等 4 小时的代价是继续烧预算并继续把真实证据滚出保留窗口。故提前裁决在收益/风险上是正确的。

## 二、K 线 self-healing：真实 live 证据（R12 缺口已补齐）

01:27:00.309 → 01:32:02.424（**5 分 02 秒**）：

- `stream.reconnects = 1`、`gapsByType.websocketConnection = 1`、**`gapsByType.kline = 126`**（旧 build 该计数器恒为 0，R10 判定的 4 号缺陷已修好并被真实事件证明）
- 114 个标的、401 条 `1m closed candle gap`，**单标的最多 6 条即止**（91 个标的出现 ≥2 条）：洞被发现后不会每分钟重放大
- `MARKET_KLINE_SEQUENCE_REPAIRED = 112`（全部 `frames:["1m"]`、`outcome.ok=true`、`missing=0`）
- `MARKET_KLINE_SEQUENCE_REPAIR_FAILED = 1`：`ASTERUSDT` 01:28:37 `reason=BINANCE_REQUEST_QUEUE_TIMEOUT`（`/fapi/v1/klines`，`source=MARKET_DATA`）⇒ **01:30:11 同一 `symbol:timeframe` key 冷却后自动重发并 `ok=true`** ⇒ 冷却/退避/重入路径被真实演练一次并通过
- `MARKET_KLINE_SEQUENCE_INVALID = 0`、`MARKET_RECOVERY_FAILED = 0`、`MARKET_FRESHNESS_RECOVERED = 0` ⇒ **完全没有退化为全快照恢复**
- 事后 `klineFreshRatio` 回到 **1.0**，`pipelineState` 全程 `RUNNING`（33/33 轮无一例外），无人工干预
- 对照旧 build 同一失败模式：22:00–22:19 曾 19 min 产生 1,107 条 gap 且持续 14 h 不自愈

证据文件：`r13/gap-0127-evidence.json`（抢在 `runtime_events` ~2 h 滚动裁剪前固化的 per-symbol 明细）。

## 三、egress 失效演练：fail-closed 成立

03:39 探针读回 `UNAVAILABLE`（期望 IP 仍为 `172.104.186.174`），期间：

- `03:45:25 TP_REPAIR_FAILED INJUSDT submissionOutcome=NOT_ATTEMPTED message=TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE` ⇒ **写入未发生**
- `03:47:49 ENTRY_ORDER_BLOCKED INJUSDT reason=TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE stage=SET_LEVERAGE` ⇒ 阻塞在 SET_LEVERAGE，订单未提交
- `03:47:50 CANDIDATE_LIFECYCLE_CHANGED INJUSDT status=TECHNICAL_COOLDOWN` ⇒ 该标的退到冷却，不重试轰炸
- 04:14:52 自动回到 `VERIFIED`、`lastError=null`；该轮 `tpProtected == positions`（33/33 轮皆成立）

⇒ "egress fail-open" 检查项：**未发生**；真实演练证明写入门禁在探针失效时关闭。窗口内仅 1/33 轮 `egress != VERIFIED`。

## 四、TP / HUMAN 安全与请求治理（6.1 h）

- 33/33 轮 `takeProfit.protected == positions`；`missing/orphanTp/duplicateTp/qtyMismatch/wrongSide/repairFailed` 全程 0
- 自然 TP 成交正常发生并正确归因：`POSITION_CLOSED_USER_DATA` 8 次、`TRADE_RECORD_REPAIRED` 659 条、`ORPHAN_TP_CANCELED` 在成交后 ~1 分钟内自行清理（00:32 与 01:4x 两例）
- `POSITION_HUMAN_HANDOFF` 9 次，全部 `reason=LOSS_HANDOFF_BARS tpRetained=true` ⇒ **自动亏损平仓 0 次**，亏损仍由人工扛
- 仓位在 29–33 之间自然波动，historical UNKNOWN 从 20 单调增到 25（**一条未删**），`verifiedNoActiveRiskUnknownCount=25`、`activeRiskUnresolvedCount=0`、`reconciliation.status=READY`
- durable claims：`durableTasks` 276 → 292、`activeClaims=0`、`activeUnknownClaims=0`、`releasedClaims/releasedUnknownClaims 19 → 21` ⇒ 无悬挂、无饥饿
- 请求治理：`http429` 恒为 **17**、`http418` 恒为 **3**（6.1 h **零新增**）；`blockedUntil=0`、`status=AVAILABLE`；`decisions` 自启动 admitted 62,639 / blocked 12 / queueTimeout 12（其中 1 次 queueTimeout 就是 01:28:37 那次 klines 修复，已自愈）
- `MARKET_SYMBOL_ERROR` 仅 01:27 那一次事件簇；`freshStatus` 33/33 轮 FRESH、`klineFreshRatio` 33/33 = 1.0、市场数 96→116（稳定 109–116）

## 五、第一优先问题：historical UNKNOWN 远端复核风暴（定量）

6.11 h 窗口内：

- `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` **5,372 条 = 879 条/h**
- 只涉及 **26 个 distinct order**，平均每单被复核 **206.6 次**（最高 234 次）
- **5,352 / 5,372 = 99.63%** 返回同一结论 `EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK`，其余 20 条为 `EXACT_QUERY_NOT_FOUND`（同一语义、证据尚未闭环）
- 该单一循环占窗口内 **全部 runtime_events 的 25.9%**（5,372 / 20,731），是第二大事件类型；这直接压缩了真实事件在 ~2 h 滚动保留窗内的可查时长（本轮我被迫在 02:40 抢捞 01:27 的证据，原因即在此）

代码根因（不是"5 分钟 TTL 一个常数写错"，而是三处互相咬合）：

1. `reconciliationService.ts:27 fullOrderScanDue()`：只要存在任何 `status==='UNKNOWN'` 订单，就把"全量 openOrders 扫描"的节奏从 `fullOrderScanIntervalMs=5min` 收紧到 `unknownRiskScanIntervalMs=60s`；
2. `reconciliationService.ts:73` 的"已证明无风险则本轮跳过"分支带 `&&!fullOrderScan` 条件 ⇒ 由于 (1) 恒为真，**该跳过永远不生效**；
3. `noActiveRiskEvidence()`（`:38-46`）只在 `fullOrderScan=true` 时执行，并调用 `ExternalTradeAdapter.fetchSymbolRiskFacts()`（`:84`）= **每标的一次 `pagedUserTrades` + 一次 `pagedAllOrders`**；再叠加 `:62` 每单一次 `findEntryByClientOrderId`（`/fapi/v1/order`）。

于是每 60 s、每个 historical UNKNOWN：1 次 exact order + 1 次 userTrades + 1 次 allOrders（三者都可能分页）+ 1 条重复事件。26 单 ⇒ **~2,600 次请求/h 的稳定常驻负载**，并且**随每笔自然平仓 +1 单调增长**（20 → 25 在 6 h 内），属于无界累积的浪费。

同时必须承认一个反向事实（它决定了解法方向）：`hasVerifiedNoActiveRisk()` 一旦过期（5 min），`entryOrderOccupiesRisk()` 就把该 historical UNKNOWN 重新计入 pending 风险敞口（`entryRiskOccupancy.ts:23-26`、`collectPendingEntryRiskExposures` 以 `remainingQty>0` 计 notional）。**所以"只是把复核频率调低"会让陈旧 UNKNOWN 长期虚占风险额度、进一步压死 eligibility。正确做法必须是把"证据有效期"与"下一次主动远端审计"同时分层，而不是只动调度。**

## 六、第二/第三优先问题的裁决（只调查，不放宽）

**Primary Brain DEGRADED：判定为诊断语义问题，不是模型服务故障。** 证据：窗口内 `http://127.0.0.1:8084/health` 与 `:8081/health` 全部 200 `{"status":"ok"}`（33/33 轮，两次检查点均无失败）；`aiHealth.failed=0`、`timeout=0`、`schemaInvalid=0`、`quarantine=0`、`topError=null`、`consecutiveFailures=0`；`AI_RUN_TERMINAL=65`、`AI_RUN_FAILED=0`、`PRIMARY_DECISION_NORMALIZED=65`，`primary.lastLatencyMs≈50.8 s`。而 `primary.status` 在 `READY` 与 `DEGRADED` 之间摆动，同时 `lastRunAgeMs` 一度 46 min —— 与 `eligibility`/`dispatchReady` 的塌缩同步出现。⇒ 属"**没有可执行候选导致长时间未调用**"被标成 DEGRADED 的类别；按提示词要求，**不为了保持活跃而制造 AI 调用**，只在语义确有问题时修诊断标签（本轮结论：不改行为，最多在报告里定性）。

**Risk headroom：`EXPECTED_RISK_CAPACITY_BLOCK`，不是 bug。** 06:40 实测：`equity=10,881.54`，方向上限 0.5 ⇒ 5,440.77/方向；`directionBudget={longAvailable:1,792.59, shortAvailable:26.45, grossAvailable:1,819.04}`；持仓 32（**LONG 20 / SHORT 12**）。同时 `supplyHealth`：`governanceBlockedSymbols=83`、`occupiedUnderlyings=32`、`freeResidentUnderlyings=0`、`poolReadySymbols=0`、`dispatchReadySymbols=0`、`eligibility={status:BLOCKED,count:0,excluded:32}`，`noEntryReason=WAITING_EXECUTION_CAPACITY`。
即：SHORT 侧方向预算已接近用尽（仅剩 26.45 USDT，低于多数标的 `minExecutableNotionalUsd`），叠加"同一 underlying 只能 1 仓"与 tier 方向偏好，导致 20 个 resident 全部无可执行 underlying。这是风险门禁**按设计生效**。**不提高 `maxGrossExposurePct` / `maxDirectionExposurePct`，不自动处置 HUMAN_MANAGED，不为吞吐量绕过 fail-closed。**

## 七、本轮选择实施的优化（1–3 项）

1. **【主项】historical UNKNOWN 远端审计分层 + 事件去重**：把"风险证据有效期"与"下一次主动远端审计"拆开；只有同时满足 A/B/C 分类中 HISTORICAL VERIFIED-NO-RISK 全部条件的订单才进入 5m→15m→30m→60m 分档，任何新事实/冲突/tombstone 不符立即回 Fresh 档并 fail-closed；相同 remote-fact hash + 相同 verdict + 相同 identity 的复核不再每轮重发高体量事件，改为状态变化即发 + 周期性 summary + 可查询 counters/last-check。**不删除任何 historical UNKNOWN，不缩短冲突检测节奏（5 min 全量 openOrders 扫描保留）。**
2. **【附属项】把已有的 `sequenceInvalid` 统计暴露到 pipeline `freshMarkets` 投影**（R12 V-1 的孤儿指标），使"sequence 挡住"与"卡片尚在建立"可区分。
3. **【不做】Primary DEGRADED 与 risk headroom 均只记证据、不改行为**（理由见六）。

实施前先做 replay/measurement（提示词第六节），比较当前策略与候选分档在 `/fapi/v1/order`、`allOrders`、`userTrades`、事件数、权重、最坏风险发现延迟上的差异，并要求对 fresh UNKNOWN 的影响 = 0。

---

### 与 R12 的关系

R12 报告（`v395-1m-kline-gap-live-deployment-acceptance-20260919.md`，commit `0b29562`）中记为"未演练"的两项（K 线自愈 live 正向路径、`gapsByType.kline` 真实递增）**由本窗口补齐并通过**；R12 报告 V-1 记为"刻意不改"的 `sequenceInvalid` 投影缺口由本轮第 2 项处理。
