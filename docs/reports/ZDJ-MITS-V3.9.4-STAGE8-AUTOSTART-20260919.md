# ZDJ-MITS V3.9.4 Stage8 报告：Testnet 自动交易启动

日期：2026-09-19
代码 HEAD：`e40b2b5`（CI `V3.9.x Verify` success，exact HEAD）
证据：`data/reports/v394-stage8-start-20260919-0450xx`（Stage8 summary）、`data/rollout/v394-stage7-9/evidence-20260919-045102/Stage8.log`

## 1. 结果

```
schema=V3.9.4-STAGE8-START-1
runtimeMode=RUNNING   executionGovernance=AUTO_RUNNING   executionMode=TESTNET_ENABLED
automaticTradingStarted=true
STAGE8_AUTO_TRADING_STARTED  →  NEXT=run 12H V3.9.4 write canary acceptance
```

启动后实测（12H 窗口开始时）：

```
trading=RUNNING  positions=1  capacity.used=1/50  inFlight=0
poolReady=4/20 → 重建中   universe=8   eligible=4   noEntryReason=null
takeProfit=READY  protected=1/1  orphanTp=0
reconciliation: unresolvedDriftCount=0  activeRiskUnresolvedCount=0
egress=VERIFIED 172.104.186.174   restHost=demo-fapi.binance.com
```

Production 边界保持：`environment=TESTNET`、`lockedToTestnet=true`、`productionWrites=0`、`blockedProductionWriteAttempts=0`。

## 2. Stage8 的一处实质缺陷（已修，且是本轮最有价值的一条发现）

第一次 Stage8 运行 **业务动作全部成功**（上表 summary 即其产物），但"恢复正常 Testnet 参数"是**静默空操作**：

Stage8 的实现是从 Stage7 记录的 `settings-before.json` 恢复。而盘面上三份 Stage7 快照（03:03 / 03:27 / 03:32）记录到的 `maxPositions / entryMarginUsd / dynamicMarginEnabled` **全部已经是 canary 值 `1 / 5 / false`** —— 因为 02:20 那次被中断的 arming 已经改掉了参数，之后每一次"基准快照"拍到的都是被污染后的状态。

后果如果没被发现：12H 与 24H 窗口会全程在 `noEntryReason=POSITION_CAPACITY_FULL` 下观察一台**没有交易容量**的引擎 —— 时间跑满、指标全绿，却什么都没验收。这正是"用通过换虚假通过"的形态，因此必须修而不是忍受。

修复（`scripts/run-v394-stage7-to-stage9.ps1`）：

1. 编排器自行维护 **pre-canary 基线** `data/rollout/v394-stage7-9/settings-baseline.json`。本次基线取自 `data/reports/v394-exposure-20260919-005812/api_v3_settings.json`（00:58 捕获，早于任何 canary 变更，`settingsVersion=161`，`maxPositions=50 / entryMarginUsd=200 / dynamicMarginEnabled=true`）。
2. `Test-CanaryShaped` 判据：`maxPositions <= 1 且 entryMarginUsd <= CanaryMarginUsd`。
3. Stage7 arming 前：若无基线且引擎已是 canary 形状 → 抛 `BASELINE_UNRECORDED_ENGINE_ALREADY_CANARY_SHAPED`，**拒绝把污染态当基线**。
4. Stage8 之后：若仍 canary 形状 → 按基线恢复，失败抛 `NORMAL_TESTNET_BASELINE_RESTORE_FAILED`；成功打印 `TESTNET_BASELINE_RESTORED`。

本次运行日志确认生效：

```
TESTNET_BASELINE_RESTORED maxPositions=50 entryMarginUsd=200 dynamicMargin=True
```

恢复后 `PUT /api/v3/settings` 读回 `maxPositions=50`、`entryMarginUsd=200`、`dynamicMarginEnabled=true`、`settingsVersion` 173 → 177。

## 3. 顺带修掉的编排器缺陷

`Start-Process -PassThru` 不带 `-Wait` 时 `.ExitCode` 不可靠，导致 Stage8 明明成功却被 `STAGE8_EXIT_CODE_UNOBSERVED` 判失败；而带 `-Wait` 又会因引擎继承重定向句柄永不返回。现改由 `cmd.exe` 持有重定向、PowerShell 只等 cmd 进程退出，退出码可观测且不再挂死。

契约测试同步：移除已不存在的 `WaitForExit` / `-RedirectStandardError` 断言，新增 `cmd.exe` 与三条基线守卫标记；并保留"从编排器自身的 `$flag` 赋值里解析授权名、逐个对照子脚本 param 块"的反拼写校验（该校验已用注入原拼写错误的方式做过反向验证）。

## 4. 下一步

`accept12h` 于 04:51 开始采样（60s 间隔，窗口要求 720 真实分钟，`breaks=0`），随后 `accept24h` 需 1440 真实分钟。只有 Stage9 24H 全绿才可声明 `V3.9.4 Binance API Governance Stable`。
