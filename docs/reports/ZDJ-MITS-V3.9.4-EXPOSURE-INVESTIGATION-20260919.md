# ZDJ-MITS V3.9.4 Stage7 前置：Testnet 历史暴露调查报告

日期：2026-09-19
分支：`v394-binance-governance-settings-20260918`
核对 HEAD：`1d35bce6782f820a97d140e4983df6296406647b`
CI 证据：GitHub Actions `V3.9.x Verify` run **311** = `completed / success`（attempt 1，head_sha 精确等于上述 HEAD）
分析方式：只读静态 + 只读 HTTP 快照。取证目录 `data/reports/v394-exposure-20260919-005812/`。
本轮未删除任何 SQLite 数据，未向交易所发送任何写请求，未重启 Engine。

## 1. 运行实例身份确认（先证明"看到的是当前代码的行为"）

Engine 由上一轮人工启动后持续存活：PID 2544、instanceId `b7497569-98c4-4777-9841-4e1290410d41`、startedAt `2026-09-18T16:03:17.126Z`、`status=READY`。

`buildId=3.9.4-60a9bb2fe0e4a5940cd1` 中的 20 位片段是 `artifactHash` 前缀，**不是 git SHA**（见 `apps/engine/src/runtime/runtimeIdentity.ts:32-33`），不可用于版本判定。

改用 `sourceHash` 判定：它是对 `apps/engine/src`、`packages/core/src`、`packages/contracts/src`、`apps/dashboard/src` 的内容树哈希。用同一算法对当前工作树重算：

```
running  : cf840498d35c5e7b7bbb404236b19709dd9d93c8b12630e8406f4fe29fb361e3
recompute: cf840498d35c5e7b7bbb404236b19709dd9d93c8b12630e8406f4fe29fb361e3   MATCH
```

叠加 `git status` 中除 `.gitignore` 外无已跟踪文件改动，且 `a7ae494..1d35bce` 四个提交只改本文档所引用的计划文件（`git diff --stat` = 1 file, docs only）：

**结论：运行中 Engine 的源码 == 工作树源码 == HEAD `1d35bce` 源码 == run 311 CI 通过的源码。** 后续任何本地运行结论均可归属于该 exact HEAD。

## 2. 结论：`positions=1 activeEntry=10` 中只有一个是暴露计数，另一个是测量缺陷

| 门禁报的数 | 真实值 | 性质 |
|---|---|---|
| `positions=1` | **6** | 门禁计数缺陷（严重低估并恒定报 1） |
| `activeEntry=10` | 风险口径 **0** | 门禁口径与引擎风险模型不一致 |

### 2.1 `positions=1` 是 PowerShell 数组摊平缺陷

`scripts/run-v394-local-rollout.ps1:108` 原文：

```powershell
$positions=@(ApiGet '/api/v3/positions')
```

实测（`probe-gate-semantics.ps1`，Windows PowerShell 5.1，与 CI 同源）：

```
ApiGet /positions -> Count = 1          # 函数返回值经 @() 包裹后
raw .GetType().Name = Object[]          # 同一端点直连
raw .Count = 6
```

`/api/v3/positions` 返回**顶层 JSON 数组、6 个元素**（已确认为真数组而非对象映射）。但数组作为函数返回值传出时是**单个 `Object[]` 实例**，`@(...)` 将其计为 1。因此 `$positions.Count` 对任意非空持仓集合恒为 1。

影响定性：该缺陷**不会漏报暴露**（`Count>0` 仍触发拦截，属 fail-closed），但**使 Stage7 的阻断原因完全不可读**，且无法区分"1 个仓位"与"6 个仓位"这两种差别极大的现场。

### 2.2 `activeEntry=10` 是口径不一致，不是暴露

`/api/v3/orders.entry` 共 207 笔，状态分布：

```
FILLED 82 | CANCELED 78 | REJECTED 37 | UNKNOWN 10
```

门禁使用 `scripts/run-v394-local-rollout.ps1:19` 的原始状态白名单：

```powershell
$activeStatuses=@('NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED')
```

`UNKNOWN` 被无条件计入 active → 10。

而引擎自身的风险占用谓词 `apps/engine/src/services/entryRiskOccupancy.ts:23-26`：

```ts
if(ACTIVE_ORDER.has(order.status))
  return order.status==='UNKNOWN' ? !hasVerifiedNoActiveRisk(order,now) : true;
return entryHasUnresolvedExchangeTerminalRisk(order,now);
```

即 UNKNOWN **只有在缺少"无活跃风险"验证证据时**才占风险，证据有效期 `unknownRiskEvidenceTtlMs=300000`（5 分钟，由 `unknownRiskScanIntervalMs=60000` 持续复核）。

同一份 `/api/v3/pipeline` 读数（`probe-fixed-gate.ps1`）：

```
riskBearingEntry = 0        # activeRiskUnresolvedCount
unresolvedDrift  = 0        # 交易所侧无未被本地管理的 entry / 孤儿 TP
verifiedNoActiveRiskUnknown = 10
```

配合 `/api/v3/diagnostics/p0-entry-integrity`：

```
activeRemoteEntryWithNewPrimaryCount  = 0
unverifiedRemoteTerminalReleasedOccupancyCount = 0
verifiedOrderFactMismatchCount        = 0
crossSymbolOrderMismatchCount         = 0
passed = true
```

10 笔 UNKNOWN 明细（`exposure-analysis.md`）全部 `exchangeOrderId=null`、提交时间 09-16T22:40 ~ 09-18T00:14，即 v3.9.2 UNKNOWN-P0 治理链路已确认"交易所侧无对应活动订单、且不产生占用"的历史残骸。

分类：**D 类（已终态但按原始状态被误计为 active）**。

因此这 10 笔的正确处置是**修门禁的 active 定义**，**不是**向交易所发 cancel——向交易所发 cancel 既无对象（无 exchangeOrderId），又违反计划 §4 末段"不允许向交易所发送无意义的 cancel/close"。

同时暴露一个结构性问题：`UNKNOWN` 状态按设计不会为审计目的被改写为终态，所以旧门禁是一个**永远无法打开的死锁门禁**。

## 3. 真实暴露（A 类）：6 个 SHORT 仓位

全部为交易所真实持仓，非本地幻影：每笔都有交易所数字 order id 的活动 TP，且 `tpCoverageSource=BINANCE_OPEN_ORDER`、`tpLastVerifiedAt` 为最新一帧；`unresolvedDriftCount=0` 说明本地与交易所一致。

| symbol | side | qty | entry | mark | uPnL | mgmt | tp | TP exchId | openedAt(UTC) |
|---|---|---|---|---|---|---|---|---|---|
| DOTUSDT | SHORT | 50.3 | 1.0111 | 1.1348 | -5.95 | HUMAN_MANAGED | PROTECTED | 618519402 | 09-17 05:40 |
| AAVEUSDT | SHORT | 1 | 122.81 | 137.83 | -14.68 | HUMAN_MANAGED | PROTECTED | 419913368 | 09-17 09:45 |
| CRVUSDC | SHORT | 39.1 | 0.314 | 0.3418 | -0.99 | HUMAN_MANAGED | PROTECTED | 136878939 | 09-17 10:22 |
| XLMUSDT | SHORT | 20986 | 0.18107 | 0.19195 | -223.62 | HUMAN_MANAGED | PROTECTED | 719457247 | 09-17 10:25 |
| TIAUSDC | SHORT | 3960 | 0.3456 | 0.4015 | -216.15 | HUMAN_MANAGED | PROTECTED | 134127967 | 09-17 11:00 |
| FETUSDT | SHORT | 504 | 0.1569 | 0.1835 | -13.00 | HUMAN_MANAGED | PROTECTED | 333108799 | 09-17 11:46 |

合计空头名义约 **5,925 USDT**，合计未实现 **-485.4 USDT**（Testnet）。

关键副作用：这 6 笔空头已吃满方向额度（`limits.direction = 5467.10` = 权益 10,934.20 的 50%），因此当前 8 个 capital route 全部呈

```
longExecutable = true   shortExecutable = false
SHORT blockers = ["REJECT_DIRECTION_EXPOSURE"]   physicalCapacity={LONG:true,SHORT:false}
```

也就是说，在收敛这 6 笔之前，Stage7 的"AI 自然 Entry"事实上只可能走 LONG 一侧——这是客观风险容量，不是策略偏置，符合冻结语义。

## 4. 已实施的最小修复（仅动运维门禁，未触碰冻结核心）

`scripts/run-v394-local-rollout.ps1` 的 `AssertNoExistingExposure`：

1. 计数改为返回整数的 `Get-ResponseItemCount`，绕开数组摊平语义；
2. active 判定从"原始状态 ∈ UNKNOWN"改为消费引擎权威风险读模型：`positions==0 && activeRiskUnresolvedCount==0 && unresolvedDriftCount==0`；
3. 原始状态口径以 `rawStatusActive=` 保留在报错信息中，**只观测不隐藏**。

该定义在 drift / 未决终态两个维度上比旧口径**更严**，仅在"已由交易所证据在 5 分钟 TTL 内持续复核为无风险"这一维度上不再一票否决，而这一维度正是旧门禁死锁的来源。

修复后端到端复测（加载脚本内真实函数文本执行）：

```
FIXED gate sees positions = 6
GATE RESULT: BLOCKED -> STAGE7_REQUIRES_NO_EXISTING_EXPOSURE: positions=6 riskBearingEntry=0 unresolvedDrift=0 rawStatusActive=10
```

配套测试 `scripts/run-v394-local-rollout.test.ps1` 通过 AST 抽取脚本内**实际发布的** `Get-ResponseItemCount` 并真实执行 5 个用例（6 元素包装数组 / 空数组 / $null / 单对象 / 单元素包装数组），其中"单个持仓必须数成 1"这条在开发过程中真实抓到了第二版修复引入的回归（`return $items` 摊平单元素数组 → `$null -gt 0` 为假 → **单个持仓会穿过门禁**）。测试为行为级，非字符串断言。

## 5. 待处置与后续动作

1. 收敛 §3 的 6 笔 SHORT 至 flat，走现有正式退出链路：
   `POST /api/v3/positions/:id/manual {action:'EMERGENCY_CLOSE', confirm:true, idempotencyKey}`
   → `manualPositionService.execute/executeLocked`（`reduceOnly=true`、先 `fetchPositions()` 复核真实数量、已平则返回 `POSITION_ALREADY_CLOSED` 且幂等可重放）
   → `AccountExecutor` → `BinanceTransport`。
   该端点已内建"先撤销同向未完成 entry、再执行明确人类平仓目标、并靠 exact cancel 确认推进"的冲突处理，无需新增第二套清仓逻辑。
2. 写操作前需要 `executionMode: READ_ONLY -> TESTNET_ENABLED`（`packages/contracts/src/settings.ts` 该枚举只有这两个值），并保持 `environment=TESTNET`、`lockedToTestnet` 与固定 egress 不变。
3. 对 §2.2 的 10 笔 UNKNOWN：不发 cancel，不改状态，不动 SQLite。
4. 之后进入 side-neutral 防回归证明与 Stage7。

## 6. 未能闭环的一点（如实记录）

用户简报给出的 `positions=1` 无法复现其来源：`data/reports/` 下**不存在任何 stage7/stage8/stage9 证据目录**，说明该报错来自一次未落证据的手工运行；而按本报告 §2.1，旧门禁在 1 到 6 个持仓下都只会打印 `positions=1`，故该数字既不表明当时是 1 个仓位，也不与今天测到的 6 个矛盾。不影响后续判断，以本报告实测值为准。
