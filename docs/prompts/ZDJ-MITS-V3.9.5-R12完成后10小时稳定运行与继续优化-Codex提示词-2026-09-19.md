# ZDJ-MITS V3.9.5｜R12完成后10小时稳定运行→证据驱动继续优化｜Codex提示词

你现在接续当前正在执行的 R12，不要中断当前工作。

## 最高指令

**先把当前 R12 全部做完，再正常运行 10 小时，然后基于这 10 小时真实 live 证据继续下一轮优化。**

不要把“10 小时运行”当成任务结束点。

本提示词只有在当前 R12 已经完整完成以下阶段后才开始执行：

- R12 Stage1：local CI replacement gate at exact HEAD
- R12 Stage2-3：code identity proof + pre-deploy live snapshot
- R12 Stage4：one controlled deploy of the kline fix
- R12 Stage5-8：live kline self-healing + safety acceptance window
- R12 最终报告已提交
- 当前 live 已回到稳定正常运行状态

如果当前 R12 任何一项还没完成：

**先完成 R12，不得跳到 10 小时观察。**

---

# Phase A｜R12 完成后的起点冻结

R12 完成后立即记录：

- exact repository HEAD
- application code identity
- buildId
- PID / instanceId
- settingsVersion
- admissionMode
- HUMAN cap
- Engine health
- WS state
- egress
- account/equity/available
- positions
- TP protection
- historical UNKNOWN
- durable claims
- pipelineState
- eligibility
- freshMarkets
- klineFreshRatio
- MARKET_KLINE_SEQUENCE_REPAIRED / FAILED
- gapsByType.kline
- 429 / 418
- request governor
- AI 8081 / 8084 health

把这个快照记为：

`R13_BASELINE`

---

# Phase B｜保持系统正常运行 10 小时

从 R13_BASELINE 时间戳开始，连续观察 **10 小时**。

## 10 小时期间硬边界

保持：

- SHADOW
- HUMAN cap = true
- 原正式 Settings
- Binance Demo/Testnet
- productionWrites = 0
- 8081 / 8084 / proxy 正常
- 不主动切 ENFORCE
- 不人为平仓
- 不人为制造订单
- 不修改风险限额
- 不修改 minNetProfitUsd
- 不修改 reachability threshold
- 不修改 AI side/quantity/price 自主权

除非出现真实 P0/P1 故障，否则：

- 不重启 Engine
- 不重启模型
- 不重启代理
- 不做人工全量 K 线 backfill
- 不人为干预市场数据

## 观察方式

不要每秒高频采样制造额外负载。

建议每 10–15 分钟采一次轻量快照，并持续从 durable/runtime evidence 读取关键事件。

必须覆盖：

### 市场数据
- WS reconnect
- gapsByType.kline
- lastKlineGap
- MARKET_KLINE_SEQUENCE_REPAIRED
- MARKET_KLINE_SEQUENCE_REPAIR_FAILED
- full snapshot recovery 次数
- targeted repair 次数
- klineFreshRatio
- freshMarkets
- eligibility
- pipelineState

### 请求治理
- 429
- 418
- usedWeight1m
- estimatedWeight1m
- queued
- blocked
- queueTimeout
- request-governor anomalies

### Entry
- AI Primary runs
- economic admissions
- EntryIntent
- ENTRY_SUBMIT_ATTEMPTED
- ENTRY_ORDER_CREATED
- ENTRY_SUBMISSION_UNKNOWN
- DURABLE_TASK_EXISTS
- active durable claims
- historical UNKNOWN
- reservation/pending
- fill rate
- maker cancellation/reprice

### Position / TP
- positions total
- AUTO / HUMAN
- TP required/protected
- orphan/duplicate/missing/qtyMismatch/wrongSide
- TP rebuild
- natural TP fills
- HUMAN handoff
- automatic loss exit 是否始终为 0

### AI
- Scout / Primary availability
- latency
- parser repair rate
- failures
- context errors
- queueing
- 8081 / 8084 utilization evidence（若已有指标）

---

# Phase C｜10 小时结束后先做证据裁决，不立即改代码

10 小时结束后，先生成完整事实分析。

必须回答：

1. K 线 self-healing 是否真正经受了至少一次真实 WS gap/reconnect？
2. targeted repair 是否在真实环境稳定工作？
3. 是否出现 REST storm？
4. 429/418 是否新增？
5. pipeline 是否仍会因 technical stale 长时间暂停？
6. durable claim starvation 是否复发？
7. UNKNOWN 是否增加，增加原因是什么？
8. Entry 从 AI 决策到 submit/fill 的主要损失环节是什么？
9. 当前 SHADOW economics 的 blocker 分布是什么？
10. reachability 0.50 的真实通过率是多少？
11. minNetProfitUsd=1 在真实尺寸下是否仍不是主要 blocker？
12. HUMAN cap 当前是否仍导致 100% economics block？
13. TP 保护是否持续无损？
14. HUMAN_MANAGED 是否仍没有自动亏损退出？
15. 当前最大的吞吐瓶颈到底是：
   - market data
   - risk headroom
   - candidate supply
   - AI latency
   - economics
   - reachability
   - durable task
   - Binance request governance
   - Maker fill
   - TP
   - 其他

先给出明确排序和证据。

---

# Phase D｜Codex 自主决定下一轮优化目标

你有权反驳以前的建议。

只能选择 **1–3 个有证据支持的最高价值问题**实施。

优先级：

1. P0/P1 correctness / safety
2. 会导致系统假死、无法 Entry、数据失真
3. 会长期浪费 AI/GPU/REST 资源
4. 明确降低高质量建仓吞吐
5. 诊断/可观测性缺口

禁止为了“有优化内容”而改代码。

如果 10 小时证明系统稳定，没有值得动的 P0/P1：

可以只做小范围可观测性/效率优化，并明确写：

`NO_MAJOR_ARCHITECTURE_CHANGE_REQUIRED`

## 禁止范围

除非 10 小时证据证明存在真实 bug，否则不要：

- 重构 Entry/AI/TP 已验收架构
- 改 AI side 决策权
- 改 AI quantityUnits 决策权
- 改 AI acceptablePriceRange/targetPrice 决策权
- 恢复“15m决定方向”
- 新建第二套退出链
- 改 HUMAN_MANAGED 人工扛单语义
- 自动平亏损 HUMAN 仓
- 降低 minHistoricalReachProbability=0.50
- 降低 minNetProfitUsd=1
- 提高 gross/direction risk limits
- 将 HUMAN notional/equity 改成 margin
- 删除 historical UNKNOWN
- 为提高建仓率绕过 fail-closed

---

# Phase E｜实施优化

对每个选中的问题：

1. 写出源码证据和 runtime 证据；
2. 先写/补 deterministic regression test；
3. 最小修改；
4. 本地全新 worktree 完整 CI 替代门禁；
5. 不依赖当前不可用的 GitHub Actions；
6. git diff --check；
7. typecheck；
8. full tests；
9. build；
10. npm run verify。

GitHub Actions 当前因预算为 0 不可运行：

- 不 rerun
- 不重复 workflow_dispatch
- 不把 runner 未启动当代码失败
- workflow 保留不删、不降级

---

# Phase F｜部署优化

只有本地 exact HEAD 全量验证 PASS 才允许部署。

允许一次受控 Engine restart（如果新代码部署必须）。

不动：

- 8081
- 8084
- proxy

部署后用事实验证所修问题。

如果不需要部署就能完成优化（例如纯报告/诊断工具），不要重启。

---

# Phase G｜重新评估 ENFORCE Canary 条件

只有以下全部成立才允许提出“下一轮可以重跑 ENFORCE Canary”：

- market data 稳定
- K 线 self-healing live 验证通过
- 429/418 无异常新增
- durable claim 正常
- pipeline RUNNING
- eligibility 有持续供应
- old TP / HUMAN safety 正常
- 有至少一个方向真实 risk headroom
- 当前 candidate 有足够 economics/reachability 数据

本轮**不要自动切 ENFORCE**。

只给下一轮建议。

---

# 10小时异常处置规则

如果 10 小时中出现 P0/P1：

### 允许立即修
- 市场数据全局假死
- 订单身份/重复提交风险
- TP 丢失
- reconciliation drift
- durable claim 永久饥饿
- egress fail-open
- Binance request storm
- 数据库持续写坏
- Engine crash loop

修复后：

- 重新建立新的 R13_BASELINE
- 从修复完成后重新开始完整 10 小时稳定观察

不要把修复前后的两个窗口拼成“10小时稳定运行”。

### 非 P0/P1
记录证据，10 小时结束后再统一裁决。

---

# 最终报告

保存：

`docs/reports/v395-10h-stability-and-next-optimization-20260920.md`

至少包含：

A. R12 最终完成状态
B. R13_BASELINE
C. 10 小时开始/结束时间
D. 是否完整连续 10 小时
E. Engine restart 次数
F. WS reconnect / kline gaps / targeted repair
G. klineFreshRatio / eligibility / pipeline
H. 429/418 / request governance
I. Entry funnel
J. durable claims / UNKNOWN
K. economics blocker 分布
L. reachability 分布
M. AI latency / failure
N. Maker submit/fill/cancel
O. positions / AUTO/HUMAN
P. TP protection / natural fills
Q. P0/P1/P2 排名
R. 选择实施的 1–3 个优化项
S. 每项代码改动与测试
T. 本地 exact HEAD CI 替代门禁结果
U. 是否部署优化
V. 部署后验证
W. 是否建议下一轮重跑 ENFORCE Canary
X. Codex 对现行架构/历史建议的反驳与新建议

所有报告保存到 GitHub：

`docs/reports/`

不要保存到 Google Drive。

完成全部工作后才执行：

`D:\MITS\scripts\notify.ps1`

然后停止。
