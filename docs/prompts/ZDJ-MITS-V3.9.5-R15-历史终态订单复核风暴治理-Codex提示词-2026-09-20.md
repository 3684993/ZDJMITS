# ZDJ-MITS V3.9.5｜R15 历史终态订单复核风暴治理 + UNKNOWN残余收口｜Codex提示词

## 当前基线

正式分支：

`v395-economics-human-managed-20260919`

当前已提交：

- `3835332`：historical UNKNOWN 分层审计治理
- `37c67be`：R13/R14 中文验收报告
- `cbc5840`：部署后一小时补充采样

当前 live：

- buildId `3.9.5-b48e7b022bcf41dcfb84`
- SHADOW
- HUMAN cap=true
- Testnet
- 429=17 / 418=3
- K线自愈已在真实 WS gap 下两次通过
- TP 全量 PROTECTED
- historical UNKNOWN 未删除
- durable claims active=0

GitHub Actions 仍因 budget=0 不可用，用户已授权继续使用：

**全新 worktree + exact HEAD + 本地完整 CI 步序**

作为本轮部署门禁。

---

# 最高原则

本轮只做有 6 小时 live 证据支持的问题。

优先级：

1. 历史终态订单复核风暴
2. UNKNOWN deferral 位置前移 + 审计抖动
3. 诊断/事件降噪

**不切 ENFORCE。**

不要为了“优化”修改交易策略、AI 决策权或风险限额。

---

# Stage 1｜先量化历史终态订单复核风暴

当前实测：

- `/fapi/v1/order` ≈ **3,435.5 次/h**
- 主体不是 UNKNOWN，而是历史 terminal entry orders
- `entryOrders` ≈ 383
- terminal ≈ 353
- reconciliation 中存在每轮抽取历史终态订单复核的逻辑
- 当前大致为每批 8 单 + 每单 5 min 节流

先只读复盘当前实现。

必须回答：

1. 哪些 terminal 状态会进入复核？
2. 为什么 terminal order 仍长期被 exact-order 重查？
3. 哪些字段变化会真正影响：
   - fill attribution
   - position attribution
   - trade record
   - durable claim
   - risk occupancy
4. 哪些 terminal order 已经拥有不可变、充分的 Binance 事实？
5. 哪些 terminal order 仍可能出现 late fill / late fact？
6. 当前复核真正发现过多少“后来发生变化”的 terminal order？

不要先改 TTL。

---

# Stage 2｜终态订单分类

至少分为：

## T0｜RECENT_TERMINAL

刚进入：

- FILLED
- CANCELED
- EXPIRED
- REJECTED

仍可能存在延迟的：

- userTrades
- fill attribution
- allOrders/exact order propagation

保持高频/原 cadence。

## T1｜STABLE_VERIFIED_TERMINAL

只有满足充分远端事实后进入：

- terminal status 已由 Binance 事实确认
- exchangeOrderId/clientOrderId identity 明确
- fill quantity 与 trade facts 一致
- position attribution 已收敛
- trade record 已同步
- durable claim 已终结
- 最近连续多次远端事实 hash 不变

可低频复核。

## T2｜ARCHIVAL_TERMINAL

只有在更严格条件下：

- 多轮稳定
- 无 unresolved drift
- 无 late-fill indication
- 无 identity mismatch
- 无 open order
- trade/fill/position 均闭环
- age 足够

进入很低频审计。

## T3｜REACTIVATED / CONFLICT

任何：

- late trade
- late fill
- remote status change
- quantity mismatch
- identity mismatch
- position conflict
- trade-record drift

立即退回 T0，高频 fail-closed。

---

# Stage 3｜先 replay，不凭感觉改 cadence

使用现有 live DB / durable evidence 对历史 terminal orders 做 replay。

至少比较：

### Current
现有真实 cadence。

### Candidate A
5m → 15m → 30m

### Candidate B
5m → 30m → 60m

### Candidate C
你认为更合理的方案

输出：

- exact-order calls/h
- userTrades calls/h
- allOrders calls/h
- weight/h
- event count/h
- 最大 late-fact detection latency
- terminal order 数量
- 历史真实“晚到变化”的分布

如果 60m 会显著扩大 late-fill 风险而收益有限，可以拒绝。

---

# Stage 4｜实现原则

优先复用 R14 的 audit tier 结构。

不要再造第二套完全独立框架。

建议抽象成统一的：

`remote fact audit policy`

但只有在不造成大重构的情况下。

至少做到：

- recent terminal 高频；
- stable terminal 分层退避；
- conflict 即 reset；
- 所有关键远端事实仍可最终被发现；
- restart 后不 fail-open。

---

# Stage 5｜UNKNOWN deferral 前移

R14 已知缺口：

`remoteRiskAuditDeferred()`

判断发生在 exact-order query 之后。

因此 UNKNOWN 本身的 `/fapi/v1/order` 仍浪费约 135 次/h。

本轮将 deferral 判断移动到**任何 per-order 远端 exact query 之前**。

硬要求：

### Deferred historical UNKNOWN
本轮该 order：

- exact order = 0 calls
- userTrades/allOrders 若本轮策略也允许 defer，则必须证明安全
- openOrders 的免费/共享身份检查仍保持
- 任何新 live identity/fill/position 事实仍能立即打破 defer

新增明确测试：

`deferred historical UNKNOWN performs zero per-order remote audit calls`

---

# Stage 6｜nextAuditAt 确定性抖动

R14 已发现：

26 个 UNKNOWN 同时首次证明 → 同步过期 → 短暂：

- activeRiskUnresolvedCount 激增
- reconciliation DEGRADED

实现按稳定 identity/orderId 的确定性 jitter。

要求：

- deterministic
- restart 后同 identity jitter 稳定
- 不依赖 Math.random
- 不修改 tier duration 本身
- jitter 只分散 audit 时间，不延长超过安全上界

例如对 interval 使用小比例窗口，但具体比例由你根据 replay 决定。

测试：

- 100 orders nextAuditAt 不应集中同一秒
- 同 orderId 重启后 jitter 相同
- 最大审计延迟有明确上界

---

# Stage 7｜historical terminal 事件降噪

如果当前 terminal re-verification 每次都发无变化事件：

采用与 UNKNOWN 相同原则：

- 首次
- 状态变化
- fact hash 变化
- tier 变化
- 周期 summary

才 emit。

不要静默丢失审计信息。

health / diagnostics 至少能看到：

- terminal audit tiers
- due count
- deferred count
- last audit
- next audit
- conflict/reset count

---

# Stage 8｜Primary DEGRADED 诊断语义

只做诊断修复，不制造 AI 请求。

当前证据：

- 8081/8084 health 全程 200
- AI failures = 0
- primary 在 READY/DEGRADED 摆动
- 与 no executable candidate / risk capacity block 高相关

区分：

- connectionStatus
- probeStatus
- queueStatus
- modelAvailability
- dispatchIdleReason

如果模型健康、只是没有 candidate：

不要标成故障性 DEGRADED。

建议状态：

- READY
- IDLE_NO_EXECUTABLE_CANDIDATE

或等价诊断字段。

不要改变任何 Entry 门禁。

---

# Stage 9｜CANDIDATE_LIFECYCLE_REDERIVED 降噪

当前约：

- 940 events/h
- 占 runtime_events ~70%

先确认：

- 是否下游消费每一条；
- 是否只是重复派生同一状态；
- 是否存在状态 hash。

若无行为消费者：

改为只在：

- lifecycle state changed
- exclusion/reason changed
- summary interval

时 emit。

必须保持：

- Dashboard 真相不变
- Entry 行为不变
- candidate lifecycle state 不变

目标是减少 event spam，不是减少实际 lifecycle recomputation。

---

# Stage 10｜小修 observability

顺手修：

`unknownRiskLastAuditAt`

尚未审计时从 `0` 改为 `null`。

只改语义真实性。

---

# Stage 11｜绝对禁止

本轮不要：

- 切 ENFORCE
- 关闭 HUMAN cap
- 修改 minNetProfitUsd=1
- 修改 minHistoricalReachProbability=0.50
- 放宽 maxGross/maxDirection
- 自动处理 HUMAN_MANAGED
- 删除 historical UNKNOWN
- 删除 terminal records
- 修改 AI side/quantity/price/target 权限
- 修改唯一 ExitDispatcher 链
- 修改 K 线自愈核心架构
- 提高 Binance request budget

---

# Stage 12｜测试矩阵

至少覆盖：

## Terminal audit
1. recent terminal 保持高频。
2. stable terminal 可升 tier。
3. fill facts incomplete 不升 tier。
4. trade attribution incomplete 不升 tier。
5. unresolved drift 不升 tier。
6. late trade 出现立即 reset。
7. late fill 出现立即 reset。
8. remote status conflict 立即 reset。
9. restart 后 persisted tier 不 fail-open。
10. archival terminal 仍会周期复核。

## UNKNOWN
11. deferred UNKNOWN = 0 per-order exact query。
12. openOrders/shared live risk 仍可打破 defer。
13. identity mismatch 立即 reset。
14. position conflict 立即 reset。

## jitter
15. audit deadlines 分散。
16. deterministic across restart。
17. 上界不突破安全 interval。

## events
18. identical terminal proofs 不重复 spam。
19. fact change 立即 emit。
20. lifecycle rederived 相同状态不重复 emit。
21. lifecycle state change 必须 emit。

## diagnostics
22. healthy Primary + no candidate 不标故障 DEGRADED。
23. real model failure 仍 DEGRADED/OFFLINE。
24. unknownRiskLastAuditAt 首次为 null。

---

# Stage 13｜本地 CI 替代门禁

代码完成后：

创建**全新 worktree**，checkout exact candidate HEAD。

不复用 node_modules。

按 CI 同顺序：

1. diff check
2. npm ci
3. contracts build
4. core build
5. verify:scripts
6. typecheck
7. full tests
8. build
9. npm run verify

必须：

- 全部 exit 0
- skipped 0
- 无 retry/only
- worktree clean

GitHub Actions：

- 不触发
- 不 rerun

因为 budget=0 已知不可用。

---

# Stage 14｜部署

仅本地 exact-HEAD 门禁 PASS 才允许。

一次受控 Engine restart。

不要：

- entry pause 长时间阻塞 cohort
- 重启 8081
- 重启 8084
- 重启 proxy

部署前确认：

`inFlight=0`

然后：

- 备份 dist
- stop Engine
- 替换已验证 dist
- hash 闭环
- start Engine
- egress VERIFIED

---

# Stage 15｜部署后短窗验收

不要用 `sleep 2700`、`sleep 3600` 等长阻塞命令。

使用：

- 短周期采样
- 当前证据
- bounded observation

以达到统计目标即停止。

至少收集 30–60 min，或直到每个 terminal audit tier 至少发生一次真实调度。

比较：

### 请求
- /fapi/v1/order
- userTrades
- allOrders
- total Binance requests
- estimated weight

### 事件
- terminal audit events
- UNKNOWN events
- CANDIDATE_LIFECYCLE_REDERIVED
- runtime_events total rate

### 安全
- historical UNKNOWN count
- terminal record count
- durable claims
- unresolved risk
- reconciliation
- TP coverage
- 429/418
- egress
- pipeline

### 诊断
- Primary READY / idle semantics
- audit tier distribution
- jittered nextAuditAt

---

# Stage 16｜成功门槛

目标不是追求某个固定百分比，而是：

1. terminal exact-order audit 显著下降；
2. UNKNOWN residual exact query 接近 0 during defer；
3. event spam 显著下降；
4. runtime_events 保留能力提升；
5. no active-risk detection regression；
6. no fail-open；
7. historical UNKNOWN/terminal rows 零删除；
8. TP 全保护；
9. 429/418 无新增；
10. Primary idle 不再伪装为服务 DEGRADED。

如果请求下降不明显：

必须解释真正剩余来源，而不是继续叠加 backoff。

---

# Stage 17｜ENFORCE readiness 只读复评

本轮优化验收 PASS 后，仅做只读 Stage 1：

读取：

- gross/long/short headroom
- HUMAN exposure
- economics blocker
- reachability
- current eligible candidates
- market freshness
- durable claims
- Primary health

结论只能是：

- READY_FOR_NEXT_ENFORCE_CANARY
或
- NOT_READY + 客观原因

**不要本轮切 ENFORCE。**

---

# 最终报告

保存：

`docs/reports/v395-r15-terminal-order-audit-governance-20260920.md`

至少包含：

A. terminal audit 风暴根因
B. terminal 分类
C. replay 对比
D. 最终 cadence
E. late-fact detection 上界
F. UNKNOWN deferral 前移
G. jitter
H. terminal audit event 去重
I. lifecycle event 降噪
J. Primary DEGRADED 语义
K. observability 小修
L. tests
M. 本地 exact HEAD CI 门禁
N. build/dist identity
O. 是否部署
P. 请求量部署前后
Q. event rate 前后
R. UNKNOWN/terminal rows 是否零删除
S. durable claims/reconciliation
T. TP
U. 429/418/egress
V. Primary health 最终状态
W. 只读 ENFORCE readiness 结论
X. Codex 对方案的反驳/补充

提交 GitHub。

全部完成后执行：

`D:\MITS\scripts\notify.ps1`

然后停止。
