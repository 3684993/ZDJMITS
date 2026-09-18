# ZDJ-MITS V3.9.4 Testnet 暴露治理报告（Exposure Cleanup Report）

日期：2026-09-19
分支：`v394-binance-governance-settings-20260918`
治理时 exact HEAD：`39f049ff99718609a1a427156fe42d06a8e95ac3`（CI `V3.9.x Verify` run 316 attempt 2 = success）
执行器：`scripts/run-v394-stage7-to-stage9.ps1 -Phase Cleanup -AuthorizeTestnetCleanup`
证据目录：
- `data/rollout/v394-stage7-9/evidence-20260919-014452`（首轮，低损清理带：CRVUSDT / DOTUSDT）
- `data/rollout/v394-stage7-9/evidence-20260919-020942`（次轮，剩余 4 笔显式人类平仓 + 终态验证）
- `data/reports/v394-exposure-20260919-005812/`（前置调查与分类）

## 1. 结果

```
positions   6 -> 0     （/api/v3/positions 与 pipeline.existingPositions.count 双口径一致）
activeRisk   0
drift        0         （unresolvedDriftCount，交易所侧无未被本地管理的 entry / 孤儿 TP）
orphanTp     0    duplicateTp 0    wrongSide 0    qtyMismatch 0    unverifiedTp 0
takeProfit.status  DEGRADED -> READY
http429      17 -> 17   delta = 0
http418       3 ->  3   delta = 0
egress       VERIFIED   172.104.186.174（全程未变，无 route/egress 违例）
account READY   ws LIVE   reconciliation SETTLED
EXPOSURE_CLEANUP_PASS=TRUE
```

**整个治理过程新增 0 次 429/418**，固定出口与路由身份全程保持——即 V3.9.4 的 Binance 请求治理在真实连续写操作下未被削弱。

## 2. 治理路径（全部走系统现有正式链路，未新增第二套清仓逻辑）

### 2.1 前置：只读分类

按调查报告 `EXPOSURE-INVESTIGATION-REPORT.md`：6 笔为 A 类真实暴露；10 笔 `UNKNOWN` 为 D 类（`exchangeOrderId=null`、`verifiedNoActiveRiskUnknownCount=10`、`activeRemoteEntryWithNewPrimaryCount=0`）。

**对这 10 笔未发送任何 cancel、未改写状态、未触碰 SQLite。** 它们没有交易所订单号，向其发撤单既无对象又违反验收计划 §4 末段。

### 2.2 顺序

1. `POST /api/v3/runtime/trading-control/pause`（先停新入场，再放开写）
2. `PUT /api/v3/settings` → `executionMode: READ_ONLY -> TESTNET_ENABLED`
   （该端点在服务端强制保留当前 `connections.exchange` 与 `connections.proxy`，因此不可能经由这条路径改写出口或环境）
3. 二次确认：`demo-fapi.binance.com` + egress `VERIFIED` + Account `READY` + WS `LIVE` + Reconciliation `SETTLED`，并再次 pause
4. `GET /api/v3/testnet/cleanup/preview`
5. `POST /api/v3/testnet/cleanup/run {confirm:true}` —— 现有低损清理链
6. 对其余仓位 `POST /api/v3/positions/{id}/manual {action:'EMERGENCY_CLOSE', confirm:true, idempotencyKey}` —— 现有显式人类平仓链
7. 轮询真实 flat + TP/对账完整性
8. 恢复 `executionMode: READ_ONLY`，交还给 Stage7 的 arming 前置条件

### 2.3 两条链路的选择依据

`TestnetLowLossCleanupService` 的准入是 `isEligibleCleanupPnl = pnl<0 && pnl>-10`，即它**只处理小额亏损**，且声明为 "One-shot, human-invoked, Testnet-only … deliberately not registered with any scheduler"。preview 实测：

```
eligible  = CRVUSDC, DOTUSDT
excluded  = TIAUSDC, FETUSDT, AAVEUSDT, XLMUSDT   原因全部 PNL_AT_OR_BELOW_MINUS_10
```

因此剩余 4 笔按设计不属于低损清理带，改用 `EMERGENCY_CLOSE`。这不是绕过，而是两条既有链路各自的适用边界。

## 3. 逐笔结果

| symbol | side | qty | exitAvg | 实现净额(不含资金费) | exitFills | remaining | integrityFlags | 通道 |
|---|---|---|---|---|---|---|---|---|
| CRVUSDC | SHORT | 39.1 | 0.3408 | -1.057 | 4 | 0 | `[]` | cleanup/低损（maker 撤→counterparty 成交）|
| DOTUSDT | SHORT | 50.3 | 1.13832 | -6.423 | 9 | 0 | `[]` | cleanup/低损（ec1 EXPIRED→ec2 FILLED）|
| AAVEUSDT | SHORT | 1 | 138.31 | -15.569 | 3 | 0 | `[]` | EMERGENCY_CLOSE |
| FETUSDT | SHORT | 504 | 0.1835 | -13.459 | 1 | 0 | `[]` | EMERGENCY_CLOSE |
| TIAUSDC | SHORT | 3960 | 0.4012 | -220.446 | 1 | 0 | `[]` | EMERGENCY_CLOSE |
| XLMUSDT | SHORT | 20986 | 0.19315 | -255.182 | 81 | 0 | `[]` | EMERGENCY_CLOSE |
| **合计** | | | | **-512.136** | | 全为 0 | | |

全部 4 笔 `EMERGENCY_CLOSE` 的 intent 均为 `reduceOnly=true`、`replayed=false`（首次执行，无重放下单），且**同一 pass 内完成**，无 error 文件。

XLMUSDT 的响应快照显示 `PARTIALLY_FILLED`（81 次 exit fill 的累积过程），终态经轮询确认为 `remainingQty=0`。

## 4. 过程中发现并修复的执行侧缺陷（均属本轮运维代码，不涉及冻结核心）

### 4.1 HTTP 客户端超时 ≠ 平仓失败（已修）

首轮 `POST /testnet/cleanup/run` 为同步多阶段长调用，客户端 120s 超时抛错并终止了 runner——**但引擎侧继续把 CRVUSDT、DOTUSDT 平完了**。把超时当作失败会导致误判和危险的重放决策。

修复：长写调用超时提高上限，超时后记录 `cleanup-run-interrupted.json` 并**改为轮询真实 flat**，不把客户端异常读成业务失败。

### 4.2 授权标志未传递给子进程（已修）

`Invoke-StagePhase` 计算了 `$flag` 只用于报错文案，没有加入子进程参数，导致已授权的链条在 Stage7 自身安全门前即中止（`STAGE7_REQUIRES_-AuthorizeTestnetWrite`）。属纯运维脚本缺陷，引擎侧无写入、状态未变。已修复并补契约断言（`@childArgs`、`"-$flag"`）。

### 4.3 PowerShell `-File` 不解析数组字面量（已修，在本地启动器）

`powershell -File launcher.ps1 -ExtraArgs '-A','-B'` 会把逗号串当单个字面参数，授权开关全部丢失。启动器改为内部拼装开关。

## 5. 幂等与重放证据

第二轮启动时 checkpoint 中 `cleanup.status=RUNNING`（首轮未正常收尾），执行过程：

- preview 的 `eligible` 已为空（首轮那两笔确实已平）→ 未重复调用 `cleanup/run`
- 只对仍存在的 4 笔发起平仓，每笔绑定固定 `idempotencyKey`
- 引擎侧 `claim(executionScope(env, credentialRef, symbol, side))` 提供持久化 exactly-once：同一位置任务重放返回 `DURABLE_POSITION_TASK / replayed:true`，不会产生第二张订单

第三轮若再次启动，将直接 `CLEANUP_ALREADY_PASS_SKIPPING`。这一路径在同 HEAD 上已实测（cleanup PASS 后重跑 `All` 跳过清理）。

## 6. 仍存在的已知事项

1. **CI 存在既有 flake**：run 316 attempt 1 因 `snapshotReadOnly` / `riskPauseOverride` / `eipService` 三处 `Test timed out in 5000ms` 失败（8.1s/7.0s/6.1s），三者共用 `EngineRuntime.createTestHarness`（内部 `market.refresh(120)`）。本轮按仓库既有做法以 `rerun-failed-jobs` 取得 attempt 2 全绿，未改测试、未降标准。该项作为 V3.9.5 CI 稳健性事项登记。
2. `trade-records.summary` 报 `awaitingReconciliation=10 / ledgerReconciliationPending=10`，数量与那 10 笔历史 UNKNOWN 相同：交易所事实层面它们不占风险（本轮三次独立读模型一致确认），但台账仍有待收口项。不属于 Stage7 前置，登记观察。
3. 治理后交易控制为 `PAUSED_MANUAL`，由 Stage7 自行 `ResumeEntries`。
