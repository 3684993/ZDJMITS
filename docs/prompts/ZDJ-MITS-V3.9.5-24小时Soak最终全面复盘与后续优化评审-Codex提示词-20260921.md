# ZDJ-MITS V3.9.5｜24小时 Soak 最终全面复盘 + 后续优化评审

## 任务定位

24小时 soak 已结束。

本轮**不是继续开发**，首先是一次独立的最终审计：基于 24h 全量 durable evidence、live DB、runtime events、代码 HEAD、R16/R15/R14/R13/R12 报告，判断 V3.9.5 是否可以作为稳定基线，并系统提出下一阶段优化建议。

**最高原则：证据优先，不为 PASS 找证据，也不要为了发现问题而制造问题。**

先读当前正式分支最新代码与以下报告，再查实际运行证据；不要仅凭报告结论。

---

# Stage 1｜冻结对象与身份闭环

记录并证明：

- 24h soak 起止时间（完整连续窗口）
- soak baseline commit
- 当前应用代码 commit
- code identity / application source tree
- buildId
- artifact/contentTreeHash
- PID / instanceId / restartCount
- settingsVersion
- admissionMode
- SHADOW/ENFORCE
- HUMAN cap
- Binance Testnet endpoint
- expected egress IP

如果 soak 期间只有 docs commit，明确区分：

**运行中的 application code ≠ 后续 docs HEAD。**

不得把 docs commit 当成运行代码变化。

---

# Stage 2｜24小时稳定性总审计

完整统计：

## Engine

- uptime
- crash
- restart
- startup recovery
- memory / CPU 如已有可靠采样
- queue/backpressure
- database errors

## Pipeline

- RUNNING / PAUSED / DEGRADED 各状态时长
- 每次非 RUNNING 的原因
- 是否自动恢复
- 是否存在 silent starvation

## AI

- 8081 / 8084 availability
- AI request count
- success/failure
- timeout
- schema/parser failure
- latency p50/p95/p99
- Primary READY / IDLE_NO_DISPATCHABLE_CANDIDATE
- 是否存在“模型健康但系统无可执行候选”的正常 idle

不要把 idle 自动解释成 AI 故障。

---

# Stage 3｜市场数据自愈最终复盘（重点）

这是 V3.9.5 已经真正 live 验证过的核心能力之一。

统计整个24h：

- WS reconnects
- kline gaps
- affected symbols
- gapsByType.kline
- `MARKET_KLINE_SEQUENCE_REPAIRED`
- `MARKET_KLINE_SEQUENCE_REPAIR_FAILED`
- `MARKET_KLINE_SEQUENCE_INVALID`
- `MARKET_RECOVERY_FAILED`
- repair latency
- retry/cooldown 次数
- targeted REST calls
- full snapshot calls
- 每 symbol/timeframe REST 上界
- 是否出现 repair storm
- klineFreshRatio p50/p95/min
- freshMarkets
- eligibility 是否因 market-data 问题归零

重点证明：

**WS gap → sequence detection → bounded targeted repair → technical rebuild → freshness recovery → 无人工重启。**

如果24h没有新的 gap，不要伪造结论；使用 R13/R14 已获得的真实 gap 样本 + 本24h窗口证据区分“已验证能力”和“本窗口未触发”。

---

# Stage 4｜egress fail-closed 最终安全审计（最高优先级）

R16 已把早期 Entry admission gate 接上，同时保留 transport write boundary。

必须完整检查24h：

- egress VERIFIED / UNAVAILABLE / MISMATCH / UNVERIFIED 时间线
- Entry admission blocked/resumed
- productionWrites
- blockedProductionWriteAttempts
- 是否存在任何 Entry write 越过 admission gate
- 是否存在任何 transport write 越过 assertTestnetExchangeWrite
- TP repair 行为
- manual exit 行为
- 是否出现 egress failure 时裸仓
- 是否出现 TP protection 缺口

特别关注已经记录的设计取舍：

> 当前保护性写入（TP补挂/人工减仓）与新增风险写入共用底层 egress 闸。

不要在本轮修改它。

判断：

1. 当前是否安全可接受；
2. 是否应作为下一版本 P1 安全优化；
3. 如果建议拆分 risk-increasing 与 risk-reducing write，必须给出完整安全边界，而不是简单放行。

---

# Stage 5｜Binance 请求治理最终复盘

统计24h：

- `/fapi/v1/order`
- userTrades
- allOrders
- openOrders
- klines
- depth
- total requests
- estimated weight
- queue timeout
- blocked
- 429
- 418

重点分解 `/fapi/v1/order` 来源：

1. historical UNKNOWN
2. terminal audit
3. Entry/JIT
4. TP
5. reconciliation
6. other

不要只看总量。

回答：

**R14/R15 优化后，剩余最大请求来源究竟是什么？**

如果某来源已经是低风险、合理 cadence：停止继续优化，不为了数字而改。

---

# Stage 6｜UNKNOWN / Terminal / Reconciliation 完整复盘

统计：

- historical UNKNOWN count
- new UNKNOWN
- released claims
- active durable claims
- terminal orders
- terminal audit tier distribution
- nextAuditAt 分布
- audit deferral 次数
- conflict/reset 次数
- late fact detection
- exact query 次数
- userTrades/allOrders 查询次数
- audit event 数量

验证 R14/R15 的三个关键目标：

### A
历史 UNKNOWN 不删除。

### B
真正活跃/新事实能立即提升审计优先级。

### C
稳定 terminal 不应无限高频轮询。

重点检查是否存在新的反模式：

- “为了省请求而把风险事实延迟太久”
- tier 永远升不上去
- tier 升级条件过严导致 T0 常驻
- conflict 检测遗漏
- restart 后状态错误

---

# Stage 7｜事件噪声最终复盘

重点统计：

- `CANDIDATE_LIFECYCLE_REDERIVED`
- `UNKNOWN_RISK_AUDIT_SUMMARY`
- terminal audit events
- ENTRY/TP events
- total runtime_events

计算 top 20 event types 占比。

判断哪些：

- 被真实消费者使用；
- 仅用于 observability；
- 可以 summary 化；
- 不能减少。

**不要因为 event 数字大就直接删事件。先找消费者。**

如果 lifecycle 双写仍占绝大多数且无行为消费者，作为下一版本优化候选；本轮只提出建议，不改。

---

# Stage 8｜Entry funnel / 经济性 / ENFORCE readiness

完整统计24h：

AI → economic evaluation → intent → reservation → submit → created → fill → TTL close → position

同时：

- economic pass/blocker distribution
- min-net-profit blockers
- reachability blockers
- HUMAN exposure blockers
- eligibility
- executionReadyCount
- capitalExecutableCount
- LONG/SHORT directional headroom
- gross headroom

重点回答：

### 1
为什么 SHADOW 仍然可能大量 `passed=0`？

### 2
HUMAN cap 是结构性阻断还是当前真实暴露造成？

### 3
reachability `.50` 是否仍有足够 out-of-sample evidence？

### 4
`minNetProfitUsd=1` 是否仍由真实成交结果支持？

### 5
是否存在“市场有候选，但 capacity/risk 使其不可执行”的正常状态？

不要因为 ENFORCE readiness NOT_READY 就放宽任何参数。

本阶段只做事实复盘和建议。

---

# Stage 9｜TP / Position / HUMAN safety 最终审计

完整统计：

- positions open/close
- TP required
- TP protected
- missing
- orphan
- duplicate
- qtyMismatch
- wrongSide
- natural TP fills
- HUMAN_HANDOFF
- automatic loss close
- manual exits
- exit dispatcher chain

硬要求：

- 不得存在自动亏损平仓 HUMAN_MANAGED
- 不得存在 TP safety regression
- 不得存在第二套 exit chain
- 不得存在 position/risk accounting 漂移

任何异常必须区分：

- 正常瞬态
- 自动自愈
- 真正安全缺陷

---

# Stage 10｜资源与调度效率

检查：

- 8081/8084 实际利用率
- AI idle 时间
- Engine queue
- scheduler cadence
- market-data cadence
- 是否存在无意义等待
- 是否存在重复扫描
- 是否存在单线程约2s remote call 把请求量顶住的问题

不要为了“GPU利用率更高”而增加无意义 AI 请求。

交易质量与安全优先于 GPU utilization。

---

# Stage 11｜数据库 / 数据保留 / 证据能力

检查：

- runtime_events retention
- 是否因为噪声导致关键事件提前滚出
- durable evidence 是否完整
- hourly aggregate 是否有缺失
- collector 是否影响 Engine
- DB lock / WAL / write errors
- reconciliation evidence

特别检查 R13 中暴露过的：

> runtime_events 滚动裁剪过快导致真实 WS gap 证据必须抢救。

如果24h仍存在类似问题，提出 observability-only 优化。

不要让采集器改写交易行为。

---

# Stage 12｜反事实检查：主动寻找“我们可能误判了什么”

这一节必须认真做，不得只总结好消息。

至少检查：

1. 是否把“没有事故”误认为“机制正确”？
2. 是否有事件被 retention 丢失？
3. 是否有 collector blind spot？
4. 是否有低频状态长期没被触发？
5. egress proof 是否可能出现假阳性？
6. Kline repair 是否存在只在特定 reconnect 类型下有效？
7. UNKNOWN audit 是否可能漏掉迟到事实？
8. terminal tier 是否可能掩盖 late fill？
9. Entry capacity 是否存在方向性 starvation？
10. SHADOW evidence 是否足以支持 ENFORCE？

每一项给：

**证据 / 反证 / 当前置信度 / 是否需要下一轮实验。**

---

# Stage 13｜最终风险分级

把所有发现分成：

## P0
必须立即修复，否则不能继续运行。

## P1
下一轮必须处理，否则不建议扩大交易权限。

## P2
值得优化，但不影响稳定运行。

## P3
纯 observability / 性能 / 清理项。

禁止把“请求还能降低”“事件还能减少”“代码还能漂亮”自动列为 P1。

---

# Stage 14｜下一阶段优化建议

不要泛泛给10条建议。

最多给 **5项**，按：

- 问题
- 证据
- 影响
- 风险
- 实施复杂度
- 是否需要重启
- 是否需要修改交易语义
- 是否需要重新24h soak

进行排序。

重点候选应从以下事实中筛选，而不是预设必须实施：

### 候选 A
保护性写入与新增风险写入的 egress gate 分层。

### 候选 B
剩余 terminal `/order` 查询治理。

### 候选 C
lifecycle/runtime event 降噪与 retention 优化。

### 候选 D
HUMAN exposure / capacity accounting 的进一步证据化。

### 候选 E
reachability / economic admission 的 out-of-sample 校准。

### 候选 F
其他由24h证据实际发现的问题。

如果没有足够证据支持某项，就明确写：**暂不优化**。

---

# Stage 15｜ENFORCE 结论

只允许输出客观状态：

- `READY_FOR_NEXT_CONTROLLED_CANARY`
或
- `NOT_READY`

如果 NOT_READY，列出客观 blockers。

不要自行切 ENFORCE。

即使 READY，也只提出下一轮 Canary 条件，不执行 Canary。

---

# Stage 16｜V3.9.5 最终收尾裁决

根据完整24h证据给出：

### `V3.9.5_24H_SOAK_PASS`
或
### `V3.9.5_24H_SOAK_FAIL`

只有真正连续24h且所有硬安全条件满足才能 PASS。

如果 PASS：

- 不修改 application code
- 不再做 V3.9.5 内优化
- 将剩余项目全部转 backlog
- 记录 `V3.9.5_STABLE_BASELINE`

如果 FAIL：

- 明确 P0/P1
- 不拼接窗口
- 不扩大交易权限
- 不删除证据

---

# Stage 17｜最终报告

生成：

`docs/reports/v395-final-24h-soak-and-release-baseline-20260921.md`

报告必须包含：

1. Executive Summary
2. exact 24h window
3. code/build identity
4. Engine stability
5. market-data/Kline self-healing
6. egress fail-closed
7. Binance request governance
8. UNKNOWN/terminal/reconciliation
9. event noise
10. Entry/economics/ENFORCE readiness
11. position/TP/HUMAN safety
12. AI health
13. resource/scheduler
14. database/evidence retention
15. counterfactual review
16. P0/P1/P2/P3
17. top 5 next optimizations
18. ENFORCE objective conclusion
19. V3.9.5 PASS/FAIL
20. V3.9.5 stable-baseline decision
21. Codex dissent / alternative interpretation

**不得为了报告而修改 application code。**

只有发现 P0/P1 时，停止最终收尾并先报告，不擅自实施修复。

---

# Stage 18｜完成动作

本轮默认是**审计 + 建议**，不是开发轮。

除非发现明确 P0/P1：

- 不改代码
- 不改 Settings
- 不重启 Engine
- 不切 ENFORCE
- 不人为开平仓
- 不重新跑24h

最终报告提交 GitHub。

只有完成全部复盘、报告提交后执行：

`D:\MITS\scripts\notify.ps1`

然后停止。

**不要用长时间 `sleep` 阻塞当前 Codex 会话。**
