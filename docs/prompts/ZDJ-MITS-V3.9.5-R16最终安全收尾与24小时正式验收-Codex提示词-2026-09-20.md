# ZDJ-MITS V3.9.5｜R16 最终安全收尾 + 24小时正式稳定运行验收｜Codex提示词

## 当前结论

R15 已完成。

当前不再继续做性能型优化。

R15 已证明：

- K线自愈 live 真实通过
- TP 持续全保护
- HUMAN_MANAGED 无自动亏损退出
- durable claims 正常
- 429/418 无新增
- Primary idle 误诊已修
- historical UNKNOWN 零删除
- 请求风暴已显著下降，但未完全达到 replay 理论值
- ENFORCE 当前 NOT_READY

**本轮唯一必须先解决的问题是 egress fail-closed 安全链。**

R16 完成并通过后：

**冻结 V3.9.5 代码，进入 24 小时正式 soak。**

---

# Stage 0｜先裁决 egress 缺口到底在哪一层

当前源码已知：

`BinanceTransport.entryBlockReason()`

包含：

- expectedStaticEgressIp 已配置
- egress.status != VERIFIED
- 返回 `BINANCE_EGRESS_*`

但当前：

`EntryCoordinator.processPool()`

前置调用的是：

`binanceEntryBlockReason(environment)`

它不包含 egress proof。

同时：

`BinanceTransport.assertTestnetExchangeWrite()`

也存在 egress fail-closed 检查。

因此必须先查清：

1. setLeverage 是否最终调用 `assertTestnetExchangeWrite()`
2. placeEntry / submit order 是否最终调用
3. replaceEntry 是否最终调用
4. cancelEntry 是否最终调用
5. TP create/replace/cancel 是否最终调用
6. manual exit write 是否最终调用

输出完整写路径：

`Entry/TP/Manual Exit → Adapter → Transport → assertTestnetExchangeWrite`

如果所有真实写操作已经在 transport 层 fail-closed：

本问题是：

`EARLY_ENTRY_ADMISSION_EGRESS_GATE_MISSING`

不是“真实写路径 fail-open”。

如果存在任何写路径绕过：

`TESTNET_WRITE_EGRESS_FAIL_CLOSED_BROKEN`

按 P0/P1 修复。

不得根据旧报告直接假设。

---

# Stage 1｜统一安全真源

禁止在多个地方复制 egress 判断。

优先保持：

`BinanceTransport.entryBlockReason()`

或抽取唯一纯函数作为真源。

Entry 早期准入必须能读取**当前实际 transport 的 routeIdentity + egress proof**。

不要只传：

`environment`

因为这无法判断：

- UNVERIFIED
- UNAVAILABLE
- MISMATCH
- expected IP change

要求：

当 expectedStaticEgressIp 已配置时：

### VERIFIED
允许继续。

### UNVERIFIED / UNAVAILABLE / MISMATCH
禁止新 Entry 写路径继续。

reason 必须明确：

- BINANCE_EGRESS_UNVERIFIED
- BINANCE_EGRESS_UNAVAILABLE
- BINANCE_EGRESS_MISMATCH

---

# Stage 2｜双层 fail-closed

最终必须形成两层：

## Layer A｜Entry admission

在浪费 AI / reservation / leverage / order submit 之前尽早阻断。

但不要因为 egress probe 短时失败：

- 平仓已有 TP
- 删除已有 TP
- 破坏 position read/reconciliation

Entry blocker 只阻止**新风险增加写入**。

## Layer B｜Transport write boundary

真实 Binance Testnet 写请求仍必须在最底层重新检查。

即使上层漏掉：

- set leverage
- new entry
- replace
- cancel/recreate
- TP
- manual exit

涉及“安全退出”的写操作不能被错误禁止到让已有仓裸奔。

因此必须按写类型明确：

### Risk increasing
fail-closed on unverified egress。

### Risk reducing / protection preserving
根据现有架构和安全语义单独裁决。

不要简单把所有 write 一刀切，导致 TP 修复或人工减仓无法执行。

如果现有 `assertTestnetExchangeWrite()` 是全局一刀切：

必须说明其当前安全取舍，不能在本轮未经测试重构成大体系。

---

# Stage 3｜测试

至少覆盖：

1. expected IP configured + VERIFIED → Entry 可继续
2. UNVERIFIED → Entry blocked
3. UNAVAILABLE → Entry blocked
4. MISMATCH → Entry blocked
5. expected IP change → 旧 proof 失效，Entry blocked
6. verify success → Entry 自动恢复
7. 不需要 Engine restart 即恢复
8. egress blocked 时不创建新的 Entry submit
9. 不产生 exchange NEW ENTRY write
10. transport write boundary 仍有二次保护
11. setLeverage 不应先于 egress admission
12. egress blocker 不误伤只读 reconciliation
13. egress blocker 不删除/破坏既有 TP
14. existing position safety truth 不变
15. 429/418/request budget 语义不变

如发现 TP repair / manual risk-reducing write 会被 transport egress gate 一并阻断：

必须在报告里单独说明。

不要擅自放宽，除非有测试和明确安全理由。

---

# Stage 4｜本地 exact-HEAD 门禁

GitHub Actions budget=0，仍不触发。

使用用户已授权的本地替代门禁。

必须创建全新 worktree：

- exact candidate HEAD
- 无继承 node_modules

按 CI 顺序：

1. diff check
2. npm ci
3. contracts build
4. core build
5. verify:scripts
6. typecheck
7. full tests
8. build
9. npm run verify

要求：

- 全部 exit 0
- skipped 0
- worktree clean
- 无 retry/only/断言削弱

---

# Stage 5｜一次最终受控部署

只有 Stage 4 PASS 后部署。

部署前：

- inFlight = 0
- pendingEntries = 0
- TP 全保护
- egress 当前状态记录

允许一次 Engine restart。

不重启：

- 8081
- 8084
- proxy

完成 dist hash 闭环。

---

# Stage 6｜egress live 验收

不要人为破坏真实代理。

优先做：

### 正常 VERIFIED
确认 Entry admission 正常。

### 可控状态注入 / test harness
在不影响真实 Binance 网络的测试环境中验证：

- UNAVAILABLE blocks new Entry
- MISMATCH blocks new Entry
- proof restore 后自动恢复

如果生产 live 自然再次出现 egress UNAVAILABLE：

将其视为最佳真实样本。

必须证明：

- new Entry = blocked
- no new risk-increasing Binance write
- existing positions/TP 无损
- egress VERIFIED 后自动恢复
- 不需重启

---

# Stage 7｜R16 收尾判定

如果以下全部满足：

1. egress Entry gate 接线正确
2. transport write boundary 安全
3. tests 全绿
4. exact-HEAD 本地门禁全绿
5. live 部署无回归
6. TP 全保护
7. durable claims 正常
8. reconciliation 正常
9. K线自愈正常
10. 429/418 无新增

则标记：

`V3.9.5_CODE_FREEZE_READY`

从此停止继续优化代码。

R15 中未达到的：

- exact-order 进一步降频
- lifecycle event 双写
- event spam
- HUMAN cap ENFORCE readiness

全部进入后续 backlog。

**不要在 24h soak 前继续修改。**

---

# Stage 8｜开始 24 小时正式 soak

只有 `V3.9.5_CODE_FREEZE_READY` 后开始。

记录：

`V395_24H_SOAK_BASELINE`

包括：

- exact HEAD
- buildId
- artifactHash
- PID / instanceId
- restartCount
- settingsVersion
- SHADOW
- HUMAN cap=true
- minNetProfitUsd=1
- reachability=.50
- risk limits
- account/equity
- positions
- TP
- UNKNOWN
- claims
- reconciliation
- market freshness
- pipeline
- AI
- egress
- 429/418

---

# Stage 9｜24小时期间禁止事项

24 小时内：

- 不改代码
- 不改 Settings
- 不切 ENFORCE
- 不关闭 HUMAN cap
- 不提高风险限额
- 不人工建仓
- 不人工平仓
- 不人为断 WS
- 不人为制造 egress failure
- 不重启 Engine
- 不重启 AI
- 不重启 proxy

除非出现 P0/P1。

---

# Stage 10｜采样

不要用阻塞：

- sleep 2700
- sleep 3600
- 长时间占住当前 shell/Codex 会话

采集器独立轻量运行。

建议：

- 每 10–15 min 状态快照
- 每小时 durable evidence aggregate
- P0/P1 事件实时落盘

采样必须不影响 Engine。

---

# Stage 11｜24小时必须统计

## Engine
- uptime
- restart count
- crash
- health

## Market
- WS reconnects
- kline gaps
- targeted repair
- repair failures
- full snapshot fallback
- klineFreshRatio
- freshMarkets
- eligibility
- pipeline pauses

## Binance governance
- 429
- 418
- usedWeight
- queue
- blocked
- timeout
- egress verify transitions

## Entry
- AI runs
- economics eval
- intents
- submits
- created
- fills
- TTL close
- UNKNOWN
- durable claims

## Position/TP
- position count
- AUTO/HUMAN
- TP required/protected
- missing/orphan/duplicate/qtyMismatch/wrongSide
- natural TP fills
- HUMAN handoff
- automatic loss exit count

## AI
- 8081/8084 availability
- failures
- timeout
- parser/schema failures
- latency
- unexplained idle

## Data integrity
- reconciliation drift
- activeRiskUnresolved
- historical UNKNOWN
- database/storage errors

---

# Stage 12｜P0/P1 中断规则

出现以下任一即终止 24h PASS 计时：

- Engine crash/restart
- TP missing/qtyMismatch/wrongSide 持续
- duplicate order risk
- active claim starvation
- reconciliation persistent unresolved drift
- egress fail-open
- Testnet write route 错误
- global market-data deadlock
- REST request storm / sustained 429/418
- database corruption/write failure
- automatic loss close of HUMAN_MANAGED

修复后必须：

建立新 baseline，

**重新开始完整 24h**。

不能把两个窗口拼起来。

---

# Stage 13｜非P0/P1问题

例如：

- event spam
- lifecycle 双写
- exact-order 请求仍偏高但治理正常
- diagnostics 不够漂亮
- ENFORCE HUMAN cap block
- candidate supply 偏低

只记录，不修。

不允许因为 P2/P3 中途改代码破坏 soak。

---

# Stage 14｜24小时 PASS 条件

只有连续完整 24 h 且：

- restartCount 不变
- TP safety 无 P0
- egress 无 fail-open
- K线 gap 均能自愈
- pipeline 无长期假死
- 429/418 无异常增长
- claims 无永久占用
- reconciliation 无持续 unresolved
- HUMAN safety 正确
- 无 production write 越界
- 数据库稳定

才可标记：

`V3.9.5_24H_SOAK_PASS`

---

# Stage 15｜最终版本收尾

24h PASS 后：

生成最终报告：

`docs/reports/v395-final-24h-soak-and-release-baseline-20260921.md`

内容：

A. R16 egress 根因裁决
B. egress 修复
C. 双层 fail-closed 证明
D. tests
E. 本地 exact HEAD CI 门禁
F. final build identity
G. V395_24H_SOAK_BASELINE
H. 24h exact start/end
I. restart count
J. market self-healing
K. egress transitions
L. 429/418/request governance
M. Entry funnel
N. UNKNOWN/claims
O. reconciliation
P. positions
Q. TP safety
R. HUMAN semantics
S. AI health
T. storage/database
U. P0/P1
V. P2/P3 backlog
W. 24h PASS/FAIL
X. 是否冻结为 V3.9.5 正式稳定基线

如果 PASS：

创建/记录：

`V3.9.5_STABLE_BASELINE`

以后新功能、ENFORCE Canary、HUMAN cap 政策、进一步性能优化：

进入下一版本/独立工作轮次，

不要继续污染 V3.9.5 stable baseline。

完成后提交 GitHub，并执行：

`D:\MITS\scripts\notify.ps1`

然后停止。
