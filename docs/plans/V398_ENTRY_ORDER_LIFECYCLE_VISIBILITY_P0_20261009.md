# V3.9.8 P0 — AI Run 显示「已挂单」但活动订单列表为空：订单终态、历史可视化与身份闭环

**创建日期**：2026-10-09，北京时间用户所示 15:24 后  
**状态**：`SOURCE_CAUSE_IDENTIFIED / LIVE_UNI_ORDER_TERMINAL_UNKNOWN / IMPLEMENTATION_NOT_YET_STARTED`  
**审计基线**：GitHub `main` `7c9c94e9807c8c8ab1a9e0c8b205e391974493ec`。实施前必须回读 main，保持当前 ENGINE、3 模型、代理与 WER 全部持续运行；禁止凭旧 PID 判断实际运行身份。

## 事实与界限

- 用户报告 BrainView 2026-10-09 15:20:34，北京时间：**UNIUSDT** / PRIMARY_BRAIN / COMPLETED / SHORT / PLACE_SHORT / **已挂单**。
- 用户报告订单页面 15:24:06 的 **完整 Binance TESTNET open-orders 快照 READY**：交易所活动建仓 0、TP 12、人工 0、历史未确认 3。活动订单数 0 是一个**当前时点快照**，并不证明某个既往订单从未提交，也不证明它已撤单/成交/过期。
- 独立上传回执 `UPGRADE_ENTRY_ACCEPTANCE.md` 证明 **DOGEUSDC、ENAUSDT、WLDUSDT** 三笔自然 PLACE 均已提交并经交易所确认，Review 后 `CANCELED`，各自 fill0。**UNIUSDT** 不属于这三条已明确终态的历史样本。必须按 UNI 的同一个 `brainRunId` / `intentId` / `internalOrderId` / `clientOrderId` / `exchangeOrderId` 单独做 GET-only 事实归并，不能假定它也是 Review 取消。

## 已经核实的实现缺口（从 main 原文件逐项交叉检查）

1. `apps/dashboard/src/views/OrdersView.vue` 当前仅有 tab `entry/tp/manual/history`。Entry tab 只读取 API `entry`，也就是最近一次完整 open-orders 现存活动项；历史 tab 仅展示 `historicalUnknown`，并**不**展示正常 `CANCELED`/`FILLED`/`EXPIRED`/`REJECTED` 终态的历史 Entry。页面仅在 `onMounted` 调用 `loadOrders()`，没有自动刷新，也没有带时间戳的显式手动刷新控件。
2. `apps/engine/src/api/router.ts` `GET /orders` 返回 `entry:runtime.reconciliation.currentOpenEntryOrders()`、`historicalUnknown`、TP和manual；**没有**稳定、可分页的 `entryHistory` 视图。已有 `/audit/entry-chain`、`/decision-chains/:id`、`/brain-runs/:id` / 精确订单 registry 等内建证据源可利用。应从既有持久化 source of truth 派生，不维护第二份擅自修改的订单账本。
3. `apps/engine/src/services/runExecutionOutcome.ts` 的执行状态枚举只有 `DECISION_ONLY/READ_ONLY_NON_EXECUTABLE/EXECUTING/WAITING_PRICE/NOT_SUBMITTED/SUBMITTED/PARTIALLY_FILLED/FILLED`。`ENTRY_ORDER_CREATED` 把 `row.orderId` 设为非空，最终投影条件 `if (row.orderId != null) state='SUBMITTED'`；却不消费后来独立事件 `ENTRY_ORDER_TERMINAL_RECONCILED`、`ENTRY_ORDER_TTL_CLOSED`、`PENDING_ENTRY_REVIEW_ACTION_CONVERGED`、`ENTRY_ORDER_CANCELED_MANUAL` 等。于是历史提交会**持续显示**“已挂单”，即使当前实际状态为 CANCELED/EXPIRED。直接判 `SUBMITTED` 不等于交易所当前活动。
4. `apps/engine/src/services/brainRunArchive.ts` 已将 current `state.entryOrders` 的精确身份关联为 `orderFact`，附带 status、filledQuantity、remainingQuantity、absoluteExpiresAt、ttlRemainingMs、updated/verifiedAt，并在 `projectBrainRun` 里建立 timeline。说明现有底层可支持更完整的 UI，无需凭 symbol/time 猜配。
5. `apps/engine/src/services/entryCoordinator.ts` 的 `schedulePendingEntryReview()` 对 CANCEL/REPLAN 先做精确交易所查询，取消后发 `PENDING_ENTRY_REVIEW_ACTION_CONVERGED` 或 `...UNVERIFIED`；`reviewOpenOrders()` 发 `ENTRY_ORDER_TTL_CLOSED`，且确有 **local EXPIRED + exchangeTerminalStatus UNKNOWN** 的独立组合。不得把 `本地TTL到期` 当成 `交易所已经确认 EXPIRED`；后台 Review 取消不得在 AI Run timeline 中丢失。
6. `router.ts` 的人工取消端点本身有 `entryCancelEligibility`，只对最新完整活动快照中可证明身份的活动委托执行，不能从历史表给终态记录提供误导性“取消”按钮。

## 第一阶段 P0 — 立刻调查 UNIUSDT 的真实生命周期（只读、不触发交易）

- 对 2026-10-09 15:20:34+08 的 Primary Run，在 SQLite 找唯一 `brainRunId`，按 exact `runId→decisionChainId→frozenCandidateId/candidateSetHash→Reservation→Intent→Order→clientOrderId/exchangeOrderId` 重建单条链。
- 同步读取最新 8080 `/brain-runs/:id` 详情中的 `execution`、`orderFact`、`timeline` 和历史 event，以及对应本地持久 order status、`exchangeTerminalStatus`、`filledQuantity`、`lastVerification`。
- Binance TESTNET 的 READ ONLY signed GET：精确 order identity、current open-orders 完整性、userTrades/fill、account positions及 relevant TP（仅必要时）。对于 status COMPLETE/partial fill，要证明 quantity、trade IDs、仓位变化一致；若远端因时间窗口/API接口返回不到，不得猜测已撤/已成。
- 给出唯一终态之一：`OPEN_WORKING`、`CANCELED_UNFILLED`、`CANCELED_PARTIAL_FILL`、`EXPIRED_CONFIRMED`、`LOCAL_TTL_EXPIRED_REMOTE_UNKNOWN`、`FILLED`、`UNKNOWN`，同时显示证据来源 `BINANCE_EXACT_ORDER/WS/SQLITE/LOCAL_ONLY`、时间戳、内部/交易所身份、每次 Review 和成交记录。私人原始身份只留本机，远端放脱敏指纹。
- 如发现 UI `SUBMITTED` 与 exact 远端 `CANCELED` 的事实不一致，标 `PRESENTATION_STALE_TERMINAL`，而不是补单、重下单或无条件刷新订单状态。

## 第二阶段 P1 — API / 投影的最小向后兼容修复

- 将 **历史行为**（`wasSubmitted`、`submittedAt`）和 **当前终态**（`lifecycleStatus`、`terminalAt`、`filledQty`、`remainingQty`、`lastExchangeVerifiedAt`、`statusAuthority`、`terminalReason`、`decisionRunId`）拆分。若需要新增 `CANCELED`、`EXPIRED`、`SUBMITTED_BUT_REMOTE_UNKNOWN`、`REJECTED` 到执行投影，请同步更新 API 合同、dashboard、funnel 和使用者测试，不改变旧字段的真实含义而不兼容。
- 既有 `runExecutionOutcome.ts` 的 durable fold 应按事件的**同一 run/order owner** 纳入已记录终态；对没有 `brainRunId` 的 Review/TTL 事件，只有在持久 identity index 证明单一 owner 时才归属。不能按最近相同 symbol/时间推断。必要时用 `brainRunArchive` 已有 current state exact identity 作为单独的 `liveOrderFact`，保留其 fresh/stale 标签。
- 注入 terminal authority 时按最强证明排序：精确 Binance 订单/成交及已确认 UserData WS > 有精确 identity 的 durable reconciled record > 本地单独猜测，**远端未知必须保持 UNKNOWN**；历史 UNKNOWN不可删除或重写。
- 若单次 AI Run 后 Reprice/REPLAN 导致多个 exchangeOrderId，必须显示串联的 `orderAttempt[]` 和每个 order identity 的 start/terminal，不得取最后一笔覆盖所有旧尝试；给出最终 fill 汇总且不重复统计。
- `GET /orders` 新增只读、分页或有界 `entryHistory` 数据（如最近24小时/最近7天；数量上限和总计/较老隐藏数），源于实际持久 records/exchange事实。不要让加载历史页面反复请求所有 Binance 历史，避免再次诱发 request storm、commit和句柄异常。

## 第三阶段 P1 — 前台两种时间概念展示

- 在 BrainView Run 列表保留 `曾成功提交` 事实，同时附上**当前最终状态**：`已提交·活动中`、`已提交·已撤单(成交0)`、`已提交·已过期`、`已提交·已成交`、`已提交·部分成交后撤单`、`状态待核验`。无确认则显示 UNKNOWN，不允许把 `已挂单` 无限视为活动。
- `OrdersView` 新增 **全部建仓历史** 分页（开放/撤销/超时/已成交/未知独立筛选），显示创建时间、最新更新、Symbol、方向、Qty/价格、已成数量、Remaining、TTL和终止原因、提交/成交/取消时间、Review来源、client/exchange身份的脱敏摘要，允许点进唯一 AI Run timeline/原始审计。
- 保留现有 **活动 Entry** tab 仅表示最新 Binance open-orders 真正活动，并显示快照 `READY/STALE/UNKNOWN` 和 `verifiedAt`；增加显式**刷新**及合理低频自动刷新/焦点恢复刷新，不做频繁 REST exact-order 查询。
- 活动项中的取消按钮保留 `entryCancelEligibility` 身份+最新远端状态核对；终态、历史 UNKNOWN、身份不一致/未证实的项完全禁止取消等写入操作。历史页面只读。
- Review 原因`KEEP/CANCEL/REPLAN`、`NEAR_MARKET_TTL`、`ONE_HOUR_HARD_TTL` 应能从真实事件字段取得，UI 不编造超时或模型理由。即使新订单从提交到撤销只有几秒，也应留下明确历史可查证。

## 测试与上线门槛

- 加入针对 `SUBMITTED → REVIEW_CANCEL(CANCELED,fill0)`、`SUBMITTED → TTL_CLOSED(EXPIRED,exchangeUnknown)`、`SUBMITTED → FILLED`、`PARTIAL→CANCELED`、`REPLAN multi order`、`UNKNOWN`、`remote stale vs local evidence`、`unrelated same symbol AI run` 的单元+API+Dashboard测试。
- 先只读复盘 UNI 与历史三笔，创建最小增量修复、全量 `npm ci && npm run verify`、S00、工程安全测试。变更先独立分支、PR 审查，不直接推 main，也不自动部署或重启正在 RUNNING 的 Engine/模型/代理。
- 不更改 TP Guardian、Entry authorization、执行时长、交易策略、风险、Settings、订单提交行为；避免为了提高前台一致性产生新的 exchange WRITE。
- 需部署新 dashboard/API 才生效时，制定受控切换计划，先确认用户授权和账户保护状态（当前旧数据来自用户15:24，不是部署授权）。
- 最终回执须区分 `UNI_TERMINAL_VERIFIED` / `UNI_TERMINAL_UNKNOWN`、`UI_LIFECYCLE_READY` / `NOT_DEPLOYED`、`NATURAL_ORDER_RUNTIME_OBSERVED`，不得用测试 PASS 代替运行验收。

## 立即可行的无修改用户路径

Brain 页面找到 15:20:34 的 UNIUSDT Run，点击 `查看决策/未执行原因`，检查 `交易所订单事实` 的 status、filledQuantity、remainingQuantity 和 timeline。独立查询 `GET /api/v3/orders` 的 `entryReadback.verifiedAt` 以核对是否当前真为空。若订单详情 `orderFact.status` 为 `CANCELED` 且 `exchangeTerminalStatus` 不明，应标 `LOCAL_CANCELED_NEEDS_REMOTE_CONFIRM`，不要将缺 open-orders 当确认。建议让本机 Codex 直接按 runId 做精确 Binance GET。
