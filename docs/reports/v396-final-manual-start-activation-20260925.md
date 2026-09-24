# V3.9.6 最终人工启动授权轮：Testnet 执行已激活，保证金档位覆盖缺口清零（2026-09-25）

计划：`docs/plans/v396/CODEX-V396-FINAL-MANUAL-START-AUTHORIZATION-20260924.md`
上一轮报告：`docs/reports/v396-position-risk-v3-one-shot-activation-20260924.md`（自引入的 leverage NaN P0 与受损数据修复）
证据目录：`docs/evidence/v396/position-risk-v3-one-shot-activation-20260924/`
时间戳统一为 UTC（本地 +08:00 加 8 小时）。

## 0. 终态

```text
状态名：V396_TESTNET_ACTIVE_EXECUTION_ANALYSIS_PIPELINE
environment=TESTNET  executionMode=TESTNET_ENABLED  lockedToTestnet=true
runtimeControl=RUNNING  executionGovernance=AUTO_RUNNING  entrySafetyMode=AUTO  aiExitAuthority=SHADOW
portfolioRisk profile=READY   authority=MATCHED   coverage=58 symbols   missingSymbols=[]
executionReadiness: intent=true ready=true modelSpendPermitted=true blockers=[]
生产写=0；本轮新实例 Testnet 写=0（lastWriteAt=null）；12 仓 TP 12/12 PROTECTED；integrity HEALTHY
自然 PLACE：组合风险准入 allowed=5 / denied=0（截至 16:22:21Z，generation 1-5），全部 factCoverage 五层 VERIFIED
```

未达成的一项：**没有出现真实 submit**。原因不是权限、不是档位、不是 profile，也不是安全闸，而是三个被准入放行的
自然候选在 TradePlan 数量/时间层被拒绝：`TRADE_PLAN` stage，`PLAN_SIDE_NOT_EXECUTABLE:LONG` 与
`CANDIDATE_SET_NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY`。当前 gross 余额只有 $1,425.89（12/50 slot），
在最小可下单数量上，扣费后的最低盈利价高于该周期历史收盘能支撑的移动幅度，因此按规则给出 NO_TRADE。
这是计划允许的唯一"不建新仓"解释之一（真实资金/组合容量与没有可执行候选），本轮没有为此放宽任何门槛。

## 1. runtime identity 与 lifecycle 动作清单

计划第 2 条要求"闭合则不为形式重复 build"。第 1 次启动前：磁盘 dist 与 `HEAD=a80119f` 的 src 树双向闭合
（`gates/16`、`12-final-start-identity-check.txt`，自算与已部署 `runtimeIdentity.contentTreeHash` 完全一致），
因此没有重建，直接启动。

| # | 动作 | 证据/身份 | 对应的、独立的修补 |
|---|---|---|---|
| 1 | `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` | PID 37856，`3.9.6-cbdb0b3dd9a3150342d5`，`artifactHash=cbdb0b3d…`，`sourceHash=5ca74a60…`，instanceId `d0b4f242…`，restartCount 177 | 部署 `d477fd9`+`7020f34`（PositionRisk V3 + leverage 修补） |
| — | CAS `READ_ONLY → TESTNET_ENABLED`（`source=cas`，settingsVersion 202→203） | 自 diff 只有 1 个叶子；readback `EXECUTION_READY` | 计划 §H |
| 2 | `stop-zdj-lan.ps1` → `MANUAL_START` | PID 37704，`3.9.6-ebaf5df944629390c1c3`，`artifactHash=ebaf5df9…`，`sourceHash=a8c6776b…`，instanceId `e269a046…`，restartCount 178 | 提交 `747fbf8`：authority 刷新只增不减（并集） |
| — | 显式 authority commit（settingsVersion 204→205） | coverage 13→15，MATCHED/READY | §G 的第一次刷新；随后证明 15 仍不够 |
| 3 | `stop-zdj-lan.ps1` → `MANUAL_START` | **PID 42676，instanceId `9333cd35-ae4f-4dcb-bb09-c04c92345539`，`buildId=3.9.6-f9c61c22779610cf2905`，`artifactHash=f9c61c22779610cf2905aef3bb8ef3eb9839dbd78a2f641a2ed5a28fadb31ca1`，`sourceHash=3a5cad4b5b8c1bb28288533cc87f3555e8a5d2f817697e9f6882dfce19c99a64`，`startReason=MANUAL_START`，restartCount 179** | 提交 `894da08`：覆盖需求取"可路由台账"而非连接池快照 |
| — | 显式 authority commit（settingsVersion 206→207，16:12:20Z） | coverage 15→58，`marginTierVersion=TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_0081998e0d49…`，MATCHED，missingSymbols=[] | §G 的第二种原因：需求来源定义错误 |

生命周期统计：本轮 stop 2 次、MANUAL_START 3 次，全部与上表一一对应；没有 watchdog、autostart、service、
hot reload、`npm run dev`/`tsx watch`，也没有无事实变化的重试。当前实例 `PROCESS_EXIT=0`，
`engine.stderr.log` 中 `ZodError|UNCAUGHT|nan` 命中 0 次，uptime 已 14.7 分钟（>上一实例 175 秒崩溃窗口的 5 倍）。
`engine-instance.json` 自写身份与启动前预测值逐字节相同（双向闭合）。

一处需要如实记录的旁证：settingsVersion 203→204 由第 2 个实例启动时的
`source=v3.2-migration` + `source=api` 代理规范化写入产生（3 秒内两次），不是本轮操作；审计行见
`settings_audit`。本轮自己造成的版本变化只有 202→203（CAS）与 204→205、206→207（两次 authority commit），每次恰好 +1。

## 2. PositionRisk V3 在线复验（§F）

经已部署通道读取的 `/fapi/v3/positionRisk` 真实载荷（`14-live-authority-preview-and-probe.txt`、
`05-p0-live-v3-vs-v2-payload.txt`）：

- `endpoint=/fapi/v3/positionRisk`，`rowCount=12`，`readError=null`；20 个 fieldNames 中不含 `leverage`
  （`/fapi/v2/positionRisk` 含，且返回 1,484 行含零仓）；`initialMargin`、`maintMargin`、`marginAsset`、
  `liquidationPrice`、`notional`、`positionAmt` 齐备。
- 12/12 仓位在线具备：`marginAsset`（BNBUSDC=USDC，其余 USDT）、`maintenanceMarginUsd`、
  整数 `leverage`、`positionRiskSource=V3_VERIFIED`（`25-final-live-state.txt`：
  `marginAssetProven=12 maintMarginProven=12 v3Tagged=12`）。
- `liquidationPrice=0` 的仓位：3 个，全为 LONG（BTCUSDT、ETHUSDT、BCHUSDT），exchange 原始值 `"0"`，
  按 §C3 得到有限 buffer=1 与 provenance `EXCHANGE_REPORTED_ZERO`；其余 9 个 SHORT 为方向合理正价。
- 无 NaN、无契约污染：`check-position-contract.mjs` 对 12 行持久化仓位跑真实 `PositionSchema`，
  `rows=12 rejected=0`；preview/probe 前后 `testnetWrites/productionWrites/lastWriteAt` 全部不变（GET-only）。
- `MAINTENANCE_MARGIN_UNPROVEN / POSITION_MARGIN_ASSET_UNPROVEN / LIQUIDATION_BUFFER_UNPROVEN`：按事件时间轴精确划界
  ——三者在 durable `runtime_events` 中的最后一次出现都是 **11:42:24Z（V3 修补上线之前）**，自 V3 实例启动
  （15:09:04Z）以来命中数均为 0。更强的正向证据是准入事件的
  `factCoverage.marginTier="VERIFIED"`——该字段只有在每个仓位的 `maintenanceMarginUsd` 与强平缓冲都可证明时
  才可能为 VERIFIED（判定式在 `apps/engine/src/services/portfolioRiskLedger.ts:211`），而 16:12:20Z 之后
  的 4 次准入全部带着这个 VERIFIED。
- 需要一并记录的两处瞬态（都不是本轮引入，也都没有被掩盖）：`MARGIN_TIER_SYMBOL_UNPROVEN` 在
  15:09:04Z～16:12:20Z 之间命中 86 次（本轮两次覆盖修补的对象），16:12:20Z 之后为 **0**；
  `ACCOUNT_ASSET_UNVERIFIED`（含 `MARGIN_ASSET_UNVERIFIED`）在第 1 个实例上于 15:33:03Z 命中 4 次
  ——那是私有账户快照的一次数值未就绪抖动，按 §H 的处理方式等待事实恢复而没有回退 READ_ONLY，
  16:12:20Z 之后同样为 0。

## 3. 覆盖缺口从"存在"到"清零"的过程（这才是本轮的技术结论）

第一次刷新（并集修补）只把 coverage 从 13 提到 15，随后仍有成片拒绝：
`MARGIN_TIER_SYMBOL_UNPROVEN` 命中 WLDUSDT、TAOUSDT、NEARUSDT、PENGUUSDT、UNIUSDT、DOGEUSDC、XRPUSDC、NEARUSDC。
根因不是准入，而是需求来源：`portfolioRiskRequiredSymbols()` 取 `pool.readyList()` 与排名靠前的宇宙，
而调度器的真实候选集是 `candidateLifecycle` 台账（同一时刻 READY=47）。连接池只是它的一个瞬时视图，
所以任何一次提交都只覆盖"这一 tick 恰好在池里的 symbol"。

`894da08` 之后，需求定义并入路由台账（与调度器共用单一谓词 `isPipelineRoutableLifecycle`），
排名列表只能补足未占用名额、不能挤掉持仓/池/路由需求；上限 96 行（≈2,880 权重），超出按名拒绝而非截断。
提交结果：coverage 58，`authorityStatus=MATCHED`，`missingSymbols=[]`，`blockers=[]`，`collectionFailures=[]`。
提交后严格窗口内（16:12:20Z 起，截至 16:22:21Z）准入 `allowed=5 denied=0`（NEARUSDT、XRPUSDT、NEARUSDT、NEARUSDC、SOLUSDT，generation 1-5），`MARGIN_TIER_SYMBOL_UNPROVEN` 归零；完整逐条时间轴见 `27-blocker-timeline-boundary.txt`。

必须记录的一处连带后果：覆盖变宽后派生维持保证金率从 **0.025 升到 0.167**（`ENTRY_BOUND_TIERS`，仍低于
治理矩阵上界 0.2，否则提交会被 `MAINTENANCE_RATE_EXCEEDS_PROFILE_BOUND` 拒绝）。这是"档位表覆盖谁就要为
其中最保守的档位负责"的正确后果，本轮没有为了好看的数字回退它；它对候选侧的影响是每笔预期维持保证金更高，
在 gross 余额仅 $1.4k 时进一步收紧可开额度。数值上限本身一律沿用已批准 profile（逐字回传，见脚本输出）。

## 4. 自然 PLACE 的完整归因（§I，禁止人工造候选）

30 分钟窗口内 `placeCount30m=18`、`primaryCount30m=18`、`aiHealth.completed=36 failed=0 schemaInvalid=0`，
`ANALYSIS_ONLY=0`、`EXCHANGE_WRITE_LOCKED=0`、`PROFILE_NOT_CONFIGURED=0`，也没有因单 tick 轮动产生的全局暂停。

准入之后被拦在 TradePlan 的各条（截至 16:22:21Z 为 5 条），逐条原文（`26-final-execution-attribution.txt`）：

```text
16:15:34.604Z PORTFOLIO_RISK_ADMISSION_EVALUATED NEARUSDT  allowed=true  generation=1  五层 VERIFIED
16:15:34.611Z ENTRY_DECISION_BLOCKED             NEARUSDT  stage=TRADE_PLAN
   PLAN_SIDE_NOT_EXECUTABLE:LONG, CANDIDATE_SET_NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY,
   CANDIDATE_SET_MIN_NET_PROFIT_USD=1, CANDIDATE_SET_ATTAINED_NET_PROFIT_USD=1.001505
16:16:41.306Z PORTFOLIO_RISK_ADMISSION_EVALUATED XRPUSDT   allowed=true  generation=2  五层 VERIFIED
16:18:59.681Z PORTFOLIO_RISK_ADMISSION_EVALUATED NEARUSDT  allowed=true  generation=3  五层 VERIFIED
16:20:57.048Z PORTFOLIO_RISK_ADMISSION_EVALUATED NEARUSDC  allowed=true  generation=4  五层 VERIFIED
16:22:21.335Z PORTFOLIO_RISK_ADMISSION_EVALUATED SOLUSDT   allowed=true  generation=5  五层 VERIFIED
   五条同一形状：stage=TRADE_PLAN, PLAN_SIDE_NOT_EXECUTABLE:LONG,
   CANDIDATE_SET_NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY,
   ATTAINED_NET_PROFIT_USD = 1.001505 / 1.000324 / 1.001426 / 1.001402 / …（MIN = 1）
```

判定依据（读代码确认，不是推测）：`quantityHorizonCandidates.ts:132` 的拒绝有两个析取支，
本例中各条的 `expectedNetProfit(1.0003…1.0015) + 1e-8 >= requiredNetProfit(1)` 全部成立，所以触发的是
`floorBeyondCeiling`——最小数量下扣费后的最低盈利价超出该周期收盘样本支持的移动上限。
也就是说这是市场数据不支持该笔最小规模交易的期望收益，而不是引擎不能下单。

同时必须点名一个可诊断性缺陷：该分支打印的 `MIN/ATTAINED` 两个数字来自同一 `smallestEconomics`，
在由 `floorBeyondCeiling` 触发时它们表达的是"已经达标"，操作员据此会得出与真实原因相反的结论
（本轮就是靠读源码才确定）。这是 P2 文案/归因缺陷，本轮没有顺手改它（它不改变任何风险判定），
留给下一轮：在拒绝原因里区分 `FLOOR_BEYOND_STATISTICAL_CEILING` 与真正的收益不达标。

## 5. 写边界与既有仓位健康

- `productionWriteBoundary`：`{"environment":"TESTNET","executionMode":"TESTNET_ENABLED","lockedToTestnet":true,
  "testnetWrites":0,"productionWrites":0,"blockedProductionWriteAttempts":0,"lastWriteAt":null,"lastWritePath":null}`。
  Production 写 0；本轮三个实例的 Testnet 写全部为 0，逐笔归因表为空——因为没有任何 submit 发生（§0）。
- 持仓：12 个，cycleId 与 TP 全部保留，`takeProfit` 指标 required=12 protected=12，
  missing/unverifiedTp/orphan/duplicate/qtyMismatch/wrongSide 全 0，retryQueue 0。
- ownership：`v396_owners` 27 行、重复 cycleId 0、`AI_ACTIVE` 0；`v396_quantity_claims` 3 行（人工退出配额）。
- reconciliation：`historicalUnknownCount=47 / verifiedNoActiveRiskUnknownCount=46 / activeRiskUnresolved=1`
  ——与本轮部署前的 live 基线一致，未新增、未删除任何历史 UNKNOWN。
- persistence：`integrity=true status=HEALTHY error=null`；`aiHealth.failed=0 dataError=0 quarantine=0`。

## 6. 门禁（真实退出码见 `gates/`）

每次修补都独立复跑：engine typecheck 0；engine 全量 **159 文件 / 1,264 用例全绿**（本轮新增 2 个红→绿用例）；
dashboard 12/44；core 8/46；contracts **0 用例**（既有限制，任何"契约层已覆盖"的说法仍不成立，
因此本轮的契约结论都由引擎内的 `PositionSchema` 断言与离线 `check-position-contract.mjs` 复核提供）；
S00 静态 0 blockers（每次正式 build 之后复跑）；storage coverage `S08_STORAGE_COVERAGE_PASS`；
`verify:scripts` 0；`git diff --check` 0。构建身份用已部署的 `runtimeIdentity.contentTreeHash` 与自算实现
双向核对，两次相同。

## 7. 下一轮该做的（≤5 条）与不该做的

1. 让第一笔 submit 落地：等真实容量（操作员手工平仓会释放 gross 余额）或等待更大规模的候选，
   全程沿用自然 PLACE，不要人工造候选/PLACE/fill 来"补一次 submit"。
2. 修 §4 点名的归因缺陷：`floorBeyondCeiling` 与"收益不达标"必须分成两个命名原因，并让 `ATTAINED` 只在
   后者出现——它是本轮唯一确认的可诊断性 P2。
3. 复看 0.167 的派生维持保证金率是否要按 symbol 分组承担（现在是全体取最大），任何改动都必须让
   保守性单调、且不引入 caller 可提供的费率字段。
4. 覆盖需求并入路由台账后，单次提交最多 96 行 ≈2,880 权重；若路由需求继续增长，需要一个可证明的分批
   提交/失效协议，而不是提高上限。
5. 24 h soak 的锚点是 **2026-09-25 00:05:27（本地）PID 42676 / `3.9.6-f9c61c22779610cf2905`**；
   前面任何实例的计数器与时长都不算本轮资格。

不该做的：不要为了产生一笔 submit 而放宽 `minNetProfitUsd=1`、`0.15` TP、reachability、
`maxGross/maxDirection/maxCluster*`、`maxPositions` 或 authority 的 0.2 上界；不要把 `aiExitAuthority`
从 SHADOW 改动；不要在自然候选之外造 PLACE/fill；不要把 `MARGIN_TIER_*` 判定降级为放行；
不要把 `executionMode` 再退回 READ_ONLY 当作收尾状态。
