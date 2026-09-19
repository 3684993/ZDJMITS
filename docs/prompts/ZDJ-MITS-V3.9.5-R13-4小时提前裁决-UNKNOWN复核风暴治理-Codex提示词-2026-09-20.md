# ZDJ-MITS V3.9.5｜R13 4小时提前裁决→UNKNOWN复核风暴优先治理｜Codex提示词

## 用户最新授权

原计划 R13 连续观察 10 小时。

用户现明确授权：

**不再机械等待满 10 小时。**

以当前约 4.1 小时 live 证据提前进入 Phase C/D：汇总、裁决、实施最有价值的 1–3 项优化。

必须诚实标注：

`R13_EARLY_ADJUDICATION_AT_4H`

不得把本轮写成“10 小时稳定性 PASS”。

---

# 一、为什么允许提前裁决

当前 4.1 h 已经获得原 10 h 计划最关键的真实证据：

## K线自愈已拿到真实 live 样本

01:27 自然 WS gap/reconnect：

- reconnects = 1
- gapsByType.kline = 126
- 114 symbols
- 401 条 1m closed candle gap
- 每标的最多 6 条即止
- MARKET_KLINE_SEQUENCE_REPAIRED = 112
- MARKET_KLINE_SEQUENCE_REPAIR_FAILED = 1
- ASTERUSDT queue timeout 后自动 cooldown/retry 并于 01:30:11 repair success
- MARKET_KLINE_SEQUENCE_INVALID = 0
- MARKET_RECOVERY_FAILED = 0
- 无 full snapshot recovery storm
- klineFreshRatio 恢复 1.0
- pipeline 持续 RUNNING
- Engine 未重启
- 无人工 backfill

因此 R12 中“live 正向路径尚未演练”的缺口已经被真实事件补齐。

## egress fail-closed 也被真实演练

03:39–04:14 egress UNAVAILABLE：

- TP repair 写入正确 NOT_ATTEMPTED
- Entry 在 SET_LEVERAGE 正确 BLOCK
- 04:14 自动恢复 VERIFIED
- 无 fail-open
- 仓位始终有 TP
- 无人工干预

## 请求治理稳定

- 429 = 17
- 418 = 3
- 4h 无新增

## TP / HUMAN safety 稳定

- 全部轮次 required == protected
- 自然 TP 成交正常
- HUMAN handoff 仍 tpRetained=true
- 自动亏损平仓 = 0

这些证据已经足够做工程裁决。

---

# 二、当前最高价值问题：UNKNOWN 远端复核风暴

4.1 h live 证据：

- ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED = 3,620
- 只涉及约 24 个 historical UNKNOWN
- 每订单约 163 次重复复核
- 99.6% 返回同一个结果：
  `EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK`
- historical UNKNOWN 不应删除
- active durable claims 当前无悬挂

现有根因假设：

`UNKNOWN_RISK_EVIDENCE_TTL_MS = 5min`

把“新鲜/在途 UNKNOWN”和“已经多次证明 VERIFIED_NO_ACTIVE_RISK 的历史 UNKNOWN”使用同一频率复核。

结果：

1. 持续浪费 Binance REST 权重；
2. /fapi/v1/order 产生大量重复 400 not-found；
3. runtime_events 被重复无变化事件灌满；
4. 有价值的真实事件约 2 h 就被滚动裁剪；
5. 与 MARKET_DATA / 其他后台读取争用预算。

这是本轮第一优先级调查对象。

---

# 三、UNKNOWN 治理硬安全边界

允许优化“复核频率 / 事件噪声 / 调度”，但**禁止降低风险真实性**。

绝对禁止：

- 删除 historical UNKNOWN；
- 把 UNKNOWN 直接改 terminal；
- 仅因 elapsed time 判定无风险；
- 仅因 exchangeOrderId=null 判定无风险；
- 仅因 filledQuantity=0 判定无风险；
- 取消 identityTombstone 校验；
- 取消 openOrders / userTrades / exact order 等必要冲突检测；
- 让新鲜/在途 UNKNOWN 使用长 backoff；
- 让真实 active risk 因 backoff 被漏掉；
- 修改 durable claim 的 fail-closed 安全语义；
- 为降低 REST 次数直接跳过远端事实验证。

---

# 四、先分类 UNKNOWN，不要直接改 TTL

必须先根据源码与 DB 事实给 UNKNOWN 分类。

至少区分：

## A. FRESH / ACTIVE-UNCERTAIN UNKNOWN

特征例如：

- 刚发生 submit uncertainty；
- evidence 未完整；
- evidence TTL 尚短；
- identity 尚未稳定；
- 可能仍存在 exchange order / fill / position 风险；
- activeRiskEvidence 非 VERIFIED_NO_ACTIVE_RISK；
- durable scope 仍可能占用。

这类保持现有或更严格频率。

## B. HISTORICAL VERIFIED-NO-RISK UNKNOWN

只有全部满足才可进入低频档：

- status 仍 UNKNOWN，仅用于审计；
- exchangeOrderId == null；
- filledQuantity == 0；
- 有完整远端事实；
- activeRiskEvidence.status == VERIFIED_NO_ACTIVE_RISK；
- identityTombstone 已建立且匹配；
- openOrders 无同身份；
- userTrades 无 fill；
- position 无对应风险；
- durable claim 已安全 release；
- 连续多轮远端事实没有变化。

## C. REACTIVATED / CONFLICT UNKNOWN

任何新事实：

- remote order 出现；
- trade 出现；
- position 出现；
- tombstone mismatch；
- identity conflict；
- reconciliation drift；
- evidence 不完整/过期且出现冲突；

必须立即回到高频 fail-closed 路径。

不得被历史 backoff 压住。

---

# 五、推荐但允许反驳的实现方向

你可以自主反驳以下方案，但必须给出更安全实现。

## 方案 1：分层复核 cadence

不要改“风险证据是否合法”的 TTL 语义来偷懒。

把：

**证据有效期**

与：

**下一次主动远端审计时间**

分开。

例如新增可持久化字段/状态：

- lastRemoteRiskVerifiedAt
- consecutiveVerifiedNoRisk
- nextRemoteAuditAt
- remoteAuditTier

建议行为：

### Fresh tier
高频，维持现有 5 min 或更快。

### Stable historical tier
在连续多次 VERIFIED_NO_ACTIVE_RISK 后指数/分档 backoff，例如：

5m → 15m → 30m → 60m

可设置合理上限，但必须由你根据真实 request budget 和风险窗口推导。

任何冲突立即 reset 到 Fresh。

**不要直接把 UNKNOWN_RISK_EVIDENCE_TTL_MS 全局改成 60 min。**

## 方案 2：事件去重

对于同一 UNKNOWN：

如果：

- remote evidence hash 不变；
- verdict 不变；
- identity 不变；

不要每轮都发布高体量 `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED`。

改为：

- 状态变化立即发布；
- 首次发布；
- 周期性 summary；
- 累计 counters；
- 最后一次 remote check 时间仍可查询。

必须保留审计能力，不能“静默消失”。

---

# 六、先做 replay / measurement，再改代码

基于这 4.1h 的真实 24 个 historical UNKNOWN 回放。

比较：

### 当前策略
估算/重放：

- /fapi/v1/order 次数
- openOrders
- userTrades
- allOrders
- event count
- request weight
- 最坏风险发现延迟

### 候选 tiered 策略
至少模拟：

- 5→15→30→60 min
- 更保守版本

输出：

- 请求下降比例
- 事件下降比例
- 最大风险发现延迟
- 对 fresh UNKNOWN 的影响必须 = 0

只有收益明显且安全边界成立才实施。

---

# 七、必须做的 deterministic tests

至少覆盖：

1. 新鲜 UNKNOWN 仍高频复核。
2. historical VERIFIED_NO_ACTIVE_RISK 可进入 backoff。
3. 未完整 evidence 不能进入 backoff。
4. tombstone mismatch 立即回 Fresh。
5. remote order 出现立即回 Fresh + fail-closed。
6. userTrade 出现立即回 Fresh。
7. position 出现立即回 Fresh。
8. evidence hash 无变化不重复灌相同事件。
9. verdict 变化必须立即 emit。
10. Engine restart 后 backoff 状态不能导致 fail-open。
11. durable claim release 语义不回归。
12. historical UNKNOWN 一条不删。
13. current entry/order identity 不会被旧 UNKNOWN 混淆。
14. request budget defer 下不形成 retry storm。
15. active risk detection latency 有明确上界。

---

# 八、第二优先级：Primary Brain DEGRADED 先调查，不要直接修

当前观察到：

- primaryBrain.status = DEGRADED
- 曾约 46 min 无新 Primary run
- 同时 executionReadyCount=0 / capitalExecutableCount=0
- LONG headroom 很低

先判定：

**这是模型/AI 服务真的 DEGRADED，还是因为没有可执行候选导致“长时间没调用”被错误标成 DEGRADED。**

必须区分：

- connection health
- probe health
- model HTTP availability
- queue health
- no-candidate idle

如果模型实际 200/healthy，只是没有 candidate：

只修诊断语义（如需要），不要为了“保持活跃”制造 AI 调用。

如果真实服务异常，再修真实问题。

---

# 九、第三优先级：risk headroom 只调查，不放宽

eligibility 下降到 1–2、capitalExecutableCount=0 很可能来自方向风险预算，而不是 market data。

量化：

- equity
- gross
- long notional
- short notional
- remaining gross
- remaining LONG
- remaining SHORT
- AUTO vs HUMAN exposure

如果确实是合法 risk headroom 用尽：

标记：

`EXPECTED_RISK_CAPACITY_BLOCK`

不要：

- 提高 maxGrossExposurePct
- 提高 maxDirectionExposurePct
- 自动处置 HUMAN_MANAGED
- 为吞吐量绕过风险门禁

这不是 bug。

---

# 十、可顺手做的小型可观测性修复

R12 已发现：

`sequenceInvalid` 内部已有统计但 HTTP pipeline projection 未暴露。

如果本轮已经要发代码且改动非常小，可以连同测试补上。

但它只能作为附属项，不能抢 UNKNOWN storm 的主优先级。

---

# 十一、提前裁决报告

先生成：

`docs/reports/v395-r13-early-adjudication-20260920.md`

明确：

- 原计划 10 h
- 用户在约 4.1 h 明确授权提前裁决
- 不宣称 10 h PASS
- 为什么 4 h 已具备决策信息量
- Kline live self-healing 已真实验证
- egress fail-closed 已真实验证
- TP safety
- request governance
- UNKNOWN storm
- risk headroom
- Primary diagnostic

然后再实施优化。

---

# 十二、实施、验证、部署

对真正选中的 1–3 项：

1. 先补 regression tests
2. 最小代码修改
3. git diff --check
4. typecheck
5. full tests
6. build
7. npm run verify

GitHub Actions 因 budget=0 仍不可用：

- 不触发 workflow
- 不 rerun
- 使用用户已授权的“全新 worktree exact HEAD 本地 CI 替代门禁”

必须是全新 worktree，不复用旧 node_modules。

PASS 后才允许一次受控 Engine restart 部署。

不动：

- 8081
- 8084
- proxy

---

# 十三、部署后验收重点

UNKNOWN 治理至少观察足够时间确认：

- historical UNKNOWN 数量不减少；
- active risk correctness 不变；
- exact order / userTrades / allOrders 请求显著下降；
- event spam 显著下降；
- runtime_events 保留有效证据时间变长；
- durable claims 正常；
- 429/418 不增；
- Entry / TP / reconciliation 不回归。

如果优化后出现任何风险识别延迟或 fail-open：

立即回滚该优化。

---

# 十四、本轮不要自动进入 ENFORCE

虽然市场数据已恢复且 Kline self-healing 真实验证，但本轮先完成基础设施治理。

保持：

- SHADOW
- HUMAN cap=true
- minNetProfitUsd=1
- minHistoricalReachProbability=0.50
- 原 risk limits

最终只给：

“是否建议下一轮重跑 ENFORCE positive-path Canary”。

不要本轮自己切 ENFORCE。

---

# 最终报告

保存：

`docs/reports/v395-r13-early-adjudication-and-optimization-20260920.md`

至少包含：

A. 提前裁决时间与实际观察时长
B. 为什么终止 10h 等待
C. kline self-healing 真实 live 证据
D. egress fail-closed 证据
E. TP/HUMAN safety
F. UNKNOWN storm 定量
G. UNKNOWN 分类模型
H. 当前 vs candidate cadence replay
I. 选定优化
J. 代码改动
K. tests
L. 本地 exact HEAD CI 替代门禁
M. 是否部署
N. 部署后请求量变化
O. event spam 变化
P. historical UNKNOWN 是否零删除
Q. durable claims / reconciliation
R. 429/418
S. Primary DEGRADED 最终判定
T. risk headroom 最终判定
U. 是否建议下一轮 ENFORCE Canary
V. Codex 对当前架构与本提示词的反驳/补充

提交 GitHub。

完成全部工作后执行：

`D:\MITS\scripts\notify.ps1`

然后停止。
