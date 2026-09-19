# ZDJ-MITS 本地交接汇报：V3.9.4 长期验收提前终止 + V3.9.5 部署前事实核查

- 时间：2026-09-19 09:03–09:15 (+08:00)
- 触发：用户主动指令，提前终止 V3.9.4 12H/24H acceptance，转入 V3.9.5 事实交接
- 本轮授权范围：只停验收 runner、只读调查、只出报告。**未**部署 V3.9.5、**未**切换 ENFORCE、**未**启动新 Canary、**未**触碰任何已验收架构、**未**执行任何 Engine 生命周期动作
- 本机事实源：`/health`、`/api/v3/pipeline`、`/api/v3/diagnostics/*`、`data/rollout/v394-stage7-9/`、`data/runtime-logs/`、`git`
- 派生证据：`data/reports/v395-handover-20260919-085938/acceptance-final-facts.json`（+ 同目录 11 个 API 快照）、`data/reports/v395-handover-20260919-085939/`（停止后复核快照）

---

## A. acceptance runner 是否已安全停止 — 是

| 项 | 事实 |
|---|---|
| 被停进程 | PID **18500** `powershell.exe -File D:\MITS\scripts\run-v394-stage7-to-stage9.ps1 -Phase All -AuthorizeTestnetCleanup -AuthorizeStage7Write -AuthorizeStage8AutoTrading`（04:51:04 启动） |
| 停止方式 | 杀掉前用 `Get-CimInstance` 重新校验 PID 18500 的 CommandLine 确为该 rollout 脚本，才执行 `Stop-Process -Id 18500 -Force`；返回 `RUNNER_STOPPED=TRUE` |
| 是否重生 | 唯一子进程是 `conhost.exe`（附着控制台）；启动器父进程 PID 22300 早已退出 → 无 wrapper 会重启。计划任务 `ZDJ-MITS V3.9.2 Testnet Acceptance Monitor` = **Disabled**、`ZDJ-MITS Local Health Monitor` = **Disabled**、`ZDJ-MITS Manual Engine` = Ready 未运行。三个任务本轮**均未增删改** |
| 停止确认 | 停止后 75 s 再查：`samples-accept12h.jsonl` mtime 固定为 `09:03:10.433`、size 固定 471052 B → 采样确已停止 |
| Engine | PID **21948** `node.exe apps/engine/dist/main.js` **未动**，停止后复查 `READY` / `RUNNING` / `AUTO_RUNNING` |
| 未停止的东西 | 行情 WS、账户同步、Reconciliation、TP Guardian、持仓与 TP 维护全部照常运行（见 D/F） |
| 未清理的东西 | checkpoint、日志、samples、SQLite、订单、持仓、Stage6-8 证据全部原样保留，未删一行 |
| 新增（只追加） | `data/rollout/v394-stage7-9/ACCEPTANCE-TERMINATED-BY-USER-20260919-090310.md`；`checkpoint.json` 顶层追加 `acceptanceTermination` 字段（4 个 phase 节点原样未改，`accept12h.status` 仍为 `RUNNING`） |

**明确记录：这是"用户主动提前终止长期验收"，不是 12H/24H PASS。**

---

## B. 停止时最后 acceptance 数据

窗口 `accept12h`（60 s 采样）：

| 字段 | 值 |
|---|---|
| phase / status | `accept12h` / `RUNNING` → 被终止（`accept24h`/Stage9 **从未启动**） |
| 窗口起点 | 2026-09-19 **04:51:04.808** (+08) |
| 最后一份样本 | 2026-09-19 **09:03:10.429** (+08) |
| 已连续运行 | **252.09 分钟**（4 h 12 m 09 s）／要求 720 分钟 → **完成 35.0%** |
| 样本数 | **252**（与 checkpoint `samples=252` 一致） |
| continuity breaks | **0**；最大采样间隔 **69.4 s**（阈值 `60×3+30=210 s`） |
| instanceId | 全程唯一 `d97da680-cc70-40bd-b202-e2e3ddfb1bc8` → **未变化** |
| enginePid / restartCount | 全程 `21948` / `159` → **未重启** |
| HTTP 429 | 起点 17 → 终点 **17**，**Δ = 0** |
| HTTP 418 | 起点 3 → 终点 **3**，**Δ = 0** |
| Account | 252/252 `READY` |
| WS | 252/252 `LIVE` |
| Reconciliation | 252/252 `SETTLED` |
| tradingMode | 252/252 `RUNNING` |
| budgetStatus | 252/252 `AVAILABLE` |
| readiness violations | **0** |
| REST host | 252/252 `demo-fapi.binance.com` → violations **0** |
| static egress | `VERIFIED`，expected/verified 均 `172.104.186.174`，routeIdentity `proxy-a087cc91667b` → violations **0** |
| positionsApi / projection | 1 → **12**，全程相等 → divergence **0** |
| 持续性违规上限判定 | maxConsecutiveRisk `1`、maxConsecutiveTpIntegrity `1`、maxConsecutiveUnverifiedTp `1`，阈值 `8` → 均通过 |
| rate limit | 峰值 usageRatio **8.47%**；falseCounterDiscontinuity **0** |
| 未入门禁的观察 | `observationTrust != TRUSTED` **36/252 样本（14.3%）**；`BACKGROUND` lane `timeout=1` **10/252 样本**（见 E 的 08:48:53 klines 队列超时）。当前脚本把这两项记录但**不设门禁**，故不计为 violation |
| checkpoint 路径 | `D:\MITS\data\rollout\v394-stage7-9\checkpoint.json` |
| 样本路径 | `D:\MITS\data\rollout\v394-stage7-9\evidence-20260919-045102\samples-accept12h.jsonl` |
| runner PID / Engine PID | 18500（已停）/ 21948（运行中） |

仍然有效的已完成阶段（本轮未改动）：`cleanup` **PASS**、`Stage7` **PASS**（自然 canary `ETHUSDT LONG 0.032 @2629.31`，13 s 成交、44 s `TP_PROTECTED`）、`Stage8` **PASS**（`RUNNING` + `AUTO_RUNNING`，`maxPositions=50 / entryMarginUsd=200 / dynamicMargin=true` 真实恢复）。

因此本轮结论只能是：**Stage6-8 有效，12H 未完成（35.0%），Stage9 24H 未运行，`V3.9.4 Binance API Governance Stable` 不得声明。**

---

## C. 当前本地 branch / exact HEAD / git status

```
branch : v394-binance-governance-settings-20260918
HEAD   : d013d334f67e6cc32fa6276b3af838e948d73dc9
         "docs: add V3.9.4 closeout diagnosis and TP economics findings"
```

- `git status -uno` → **tracked 工作区干净**：0 modified、0 staged、0 deleted
- 未跟踪条目 **42 个**：`scripts/` 36、`docs/` 2、顶层 `ZDJ-MITS-V3.9.3-SHADOW-...md` 1、`_codex_pr2_gate_9b6549c/` 1、`.qwen/` 1、`.tmp-audit/`（本轮临时目录）1
- 无 stash
- **本轮唯一的 git 写操作是 `git fetch origin`（只更新 remote-tracking 引用）**，未 checkout / merge / rebase / reset / commit / push
- fetch 暴露的偏差：本地 `origin/v394...` 跟踪引用此前是**陈旧**的。fetch 后 `origin/v394-binance-governance-settings-20260918 = 6ff7d5c`，本地 HEAD **落后 2 个 commit**（`d156894 docs: add V3.9.5 economics optimization plan`、`6ff7d5c docs: fix V3.9.5 plan whitespace for verify`），本地**领先 0** → 没有未推送的本地工作，缺的都是文档

---

## D. 当前交易系统是否仍正常运行 — 是，且正在自然交易

| 维度 | 09:03 停止后 → 09:08:48 复核 |
|---|---|
| Engine 进程 | PID 21948，03:32:51 启动，uptime ≈ 5 h 36 m，`restartCount=159`（`lastRestartReason=UNKNOWN`，本次窗口内为 0 次重启） |
| `/health` | `READY`，`ready=true`，version `3.9.4`，`buildId 3.9.4-dde660cff8db1901fc1e`，监听 `0.0.0.0:8080` ownerPid 21948 |
| 数据库 | `HEALTHY`，`integrity=true`，`auditEvents=65958` |
| 行情 WS | `LIVE`，`reconnects=1`，`gaps=0`（quote/bookTicker/depth 均 0），消息实时 |
| 私有数据 | `READY`，`consecutiveFailures=0`，`snapshotAgeMs≈1.5 s`，`lastFailureAt` 06:35:12（此后无失败） |
| Reconciliation | `READY`，`driftCount=0`，`unresolvedDriftCount=0`，5 min 全量订单扫描在跑 |
| 运行控制 | `mode=RUNNING`、`executionGovernance.mode=AUTO_RUNNING`、`entrySafetyMode=AUTO`、`autoResume=true`、`manualRiskOverride=INACTIVE`、`scheduler=RUNNING` |
| 执行模式 | `connections.executionMode=TESTNET_ENABLED`、`environment=TESTNET`、`marketDataMode=BINANCE`、`aiMode=OPENAI_COMPATIBLE` |
| 生产写边界 | `lockedToTestnet=true`、`testnetWrites=127`、`productionWrites=0`、`blockedProductionWriteAttempts=0` |
| Dashboard/API | `http://127.0.0.1:8080/` → 200；`http://192.168.1.50:8080/` → 200；11 个 API 端点全 200 |
| AI 资源 | scout `qwen3.5:9b`@8081 `ONLINE`，242 runs / 0 failures / lastLatency 14.0 s；primary `qwen/qwen3.8-27b`@8084 `ONLINE`，229 runs / **13 failures** / lastLatency 53.5 s / `currentStatus=DEGRADED` / `queueDepth=6`（见 I-4） |
| Settings 关键参数（`settingsVersion=177`） | `portfolio.maxPositions=50`、`maxPendingEntries=6`、`entryMarginUsd=200`；`dynamicMarginEnabled=true`、`baseMarginUsd=200`、`minMarginUsd=1`、`maxMarginPerPositionUsd=500`、`maxEquityPct=0.1`、`globalMaxLeverage=20`、`leverage.mode=DEFAULT`；`takeProfit.enabled=true`、`mode=PRICE_MOVE_PERCENT`、`targetPriceMovePercent=0.45`、`quantityPercent=100`、`tpEconomicsEnabled=true`、`minNetProfitUsd=0.01`、`minNetProfitRoiPct=0.15`、`takerFeeRate=0.0004`；`entry.maxReprices=12`、`nearMarket{enabled,maxDistanceBps=5,maxOffsetTicks=2,interval=5s,maxReprices=6}`；`positionManagement.humanHandoffAfterMinutes=1440`；`selection.mode=COMPREHENSIVE_MAINSTREAM`、`poolMax=24`、`maxSpreadBps=18`；`tradingQuality.mode=SHADOW`；`riskGovernance.maxConcurrentReservations=6`、`circuitBreakerEnabled=true`、`protectionMode=SHADOW` |
| Binance Demo host | REST `demo-fapi.binance.com`（`deprecatedTestnetRestHost=false`，`failClosed=true`）；WS `wss://stream.binancefuture.com/ws`，同代理同 routeIdentity |
| 代理与固定出口 | `socks5h://127.0.0.1:20081`（监听者为 `WindmillVPN_1.8(Win10).exe` PID 18216；另有 `node proxy.js` PID 20300）；`expectedStaticEgressIp=172.104.186.174`，`forceBinanceRest/WS=true`，`proxyDns=true` |
| 停止验收后仍在交易 | 09:03 样本 12 持仓 → 09:08:48 **13 持仓**（`TAOUSDT`、`XMRUSDT` 等自然新开仓），`placeCount30m=28`、`fillCount30m=2` → 停止验收未影响主循环 |
| 池供给（观察） | `POOL_SUPPLY_SHORTAGE`：target 20 / current 16 / gap 4 / `governanceBlockedSymbols=23`、`belowLowWatermark=false` |

---

## E. Binance 429/418 与请求治理状态

- **窗口内零增量**：`http429 17→17 (Δ0)`、`http418 3→3 (Δ0)`，252 个样本 `budgetStatus` 全 `AVAILABLE`
- **这两个计数器是跨重启的持久累计值**（进程 03:32 启动，而 `lastLimitedAt=2026-09-18 09:24:59` 早于启动）→ 真实含义是"该 TESTNET 路由自建立以来累计 17×429 / 3×418，最后一次被限流在 **≈24 小时前**"，最近 1 小时**无任何 429/418**（`blockedUntil=0`、`retryInMs=0`）
- 权重：`usedWeight1m 225~343 / 6000`（3.8–5.7%），`estimatedWeight1m 602`，窗口峰值 `usageRatio=8.47%`，`limitSource=BINANCE_EXCHANGE_INFO`
- Governor 决策（累计）：`admitted 33581 / queued 33584 / blocked 3 / queueTimeout 3`（拒绝率 0.009%）
- Lane（当前分钟窗口）：`EXECUTION admitted 2`、`PRIVATE_TRUTH 419`、`CONTROL 9`、`MARKET_PUBLIC 77`、`BACKGROUND 5`，各 lane `queued=0 blocked=0 timeout=0`。注意 `laneStats` 是**窗口化计数**（样本里出现过的 10 次 `BACKGROUND timeout=1` 在当前读数中已归零）→ 该字段不能当累计值用，这是本轮新发现的可观测性口径问题
- `observationTrust=TRUSTED`（当前），窗口内 36/252 样本曾为 `INCONSISTENT`
- `lastObservedBanIp=130.176.187.104`（历史记录，非当前出口；当前出口仍是 `172.104.186.174`）
- **egress 独立复核**：样本里的 `verifiedEgressIp` 取自引擎缓存的 `lastVerifiedEgressIp`，其 `lastVerifiedAt=2026-09-19 03:35:00`，即窗口期间**未再做新的出口探测**。本轮我用同一代理 `127.0.0.1:20081` 独立出网探测，得到 **`172.104.186.174`**，与期望值一致 → 固定出口事实成立，但"窗口内 252/252 VERIFIED"严格说是 252/252 读取到同一个 03:35 的缓存结论，不应理解为每 60 s 重新验证过一次
- 最近 1 小时 error 事件仅 3 条，全部 fail-closed 且未产生订单风险：
  - 08:28:50 `ENTRY_ANALYSIS_FAILED / AI_QUANTITY_BELOW_MIN_NOTIONAL`（`intentCreated=false`, `FAIL_CLOSED`）
  - 08:35:32 `ENTRY_DATA_ERROR / KEY_MARKET_FACT_MISSING`
  - 08:48:53 `MARKET_SYMBOL_ERROR / BINANCE_REQUEST_QUEUE_TIMEOUT`（`/fapi/v1/klines`, `TARGETED_REFRESH`, routeIdentity 正确）
- 最近 1 小时 warn 事件 **0** 条

---

## F. 当前账户 / 持仓 / TP / UNKNOWN 状态（09:08:48 +08）

账户（Testnet USDT 本位）：`walletBalanceUsd=10696.25`、`equityUsd=10666.94`、`availableUsd=4155.55`、`unrealizedPnlUsd=-29.31`、`realizedPnlUsd24h=-434.20`。资产侧含 BTC 0.01（815.17 USD）、USDT 4938.99、USDC 4942.79；`directionBudget` long 598.42 / short 416.84 notional USD。

持仓 **13**（`positionsApi=13` = `positionsProjection=13` = `capacity.used=13/50`）：

| Symbol | Side | Qty | Entry | uPnL | TP | 管理 |
|---|---|---|---|---|---|---|
| TAOUSDT | LONG | 0.078 | 252.55 | 0.00 | PROTECTED | AUTO_MANAGED |
| XMRUSDT | LONG | 0.125 | 574.56 | -0.18 | PROTECTED | AUTO_MANAGED |
| ADAUSDT | LONG | 44 | 0.2278 | -0.04 | PROTECTED | AUTO_MANAGED |
| CRVUSDT | LONG | 19.8 | 0.3415 | -0.03 | PROTECTED | AUTO_MANAGED |
| PENGUUSDT | LONG | 1040 | 0.00799 | -0.06 | PROTECTED | AUTO_MANAGED |
| BCHUSDT | SHORT | 14.641 | 254.94 | -10.00 | PROTECTED | HUMAN_MANAGED |
| XLMUSDT | SHORT | 5702 | 0.19236 | -10.98 | PROTECTED | HUMAN_MANAGED |
| DOTUSDT | LONG | 54.5 | 1.1384 | -0.35 | PROTECTED | HUMAN_MANAGED |
| AAVEUSDT | SHORT | 0.4 | 138.40 | -1.46 | PROTECTED | HUMAN_MANAGED |
| UNIUSDC | LONG | 410 | 9.092 | **-99.22** | PROTECTED | HUMAN_MANAGED |
| WLDUSDT | LONG | 100 | 0.4253 | +0.22 | PROTECTED | HUMAN_MANAGED |
| DOGEUSDT | LONG | 10000 | 0.08835 | -5.65 | PROTECTED | HUMAN_MANAGED |
| ETHUSDT | LONG | 0.032 | 2629.31 | -0.33 | PROTECTED | HUMAN_MANAGED ← Stage7 canary 单，仍在仓 |

- 管理态分布：`HUMAN_MANAGED 8 / AUTO_MANAGED 5`（`humanHandoffAfterMinutes=1440` 到点自动转人工扛单；本轮未做任何人工平仓）
- TP：`takeProfit.status=READY`，`required=13 protected=13 missing=0`，`unverifiedTp=0`、`orphanTp=0`、`duplicateTp=0`、`qtyMismatch=0`、`wrongSide=0`、`repairing=0`、`retryQueue=0`
  - **瞬态记录**：09:05:40 曾出现 `takeProfit DEGRADED / unverifiedTp=1 / missing=1`（ADAUSDT 刚成交、`tpStatus=MISSING`、TP 订单 `tp_mu7ojtn5_svku33og` 处于 `UNKNOWN`），09:08:48 已自愈为 `READY/PROTECTED`。这验证了"TP 指标会短暂闪烁、不得按单样本判失败"的门禁设计，同时也提示：若 12H 恰好停在这种 3 分钟相位上，最后一样本规则会有真实抖动风险
- 挂单/订单账本：entry 共 **246**（`FILLED 97 / CANCELED 89 / REJECTED 47 / UNKNOWN 13`）；takeProfit 共 **214**（`FILLED 101 / CANCELED 40 / REJECTED 37 / EXPIRED 25 / WORKING 10 / UNKNOWN 1`）；manual 共 **37**（`FILLED 29 / CANCELED 7 / EXPIRED 1`）
- **UNKNOWN 订单：13 个 entry + 1 个 TP（已自愈）**。全部 `exchangeOrderId=null`；`historicalUnknownCount=13` 且 `verifiedNoActiveRiskUnknownCount=13` → `activeRiskUnresolvedCount=0`、`unresolvedDriftCount=0`、`correctedDifferenceCount=0`；`/api/v3/diagnostics/p0-entry-integrity` → `passed=true`，`verifiedNoActiveRiskReleaseCount=2841`，其余 5 项 mismatch 全 0。按既定政策：**未发任何 cancel、未改任何状态、未碰 SQLite**
- 趋势：UNKNOWN entry 订单从上一轮记录的 **10 → 13**（≈24 h 内 +3）。当前无风险（每 60 s 按交换事实复核、5 min evidence TTL、已验证无活跃风险），但需要增长率上限/告警，见 I-5

---

## G. V3.9.5 HEAD `0223be9` 是否已在本地 — 对象已在本地，代码**未** checkout

| 检查 | 结果 |
|---|---|
| fetch 之前 | `git cat-file -t 0223be9…` → **could not get object info**（本地不存在）；`git for-each-ref` 中**无任何 v395 引用** |
| 远端事实 | `git ls-remote origin` → `refs/heads/v395-economics-human-managed-20260919 = 0223be94be41c55b8e85d54a9fed489ac5b94764`（与用户给定 HEAD 逐字符一致） |
| 本轮 `git fetch origin`（两个分支 refspec）之后 | `origin/v395-economics-human-managed-20260919 = 0223be94be41c55b8e85d54a9fed489ac5b94764`，`git cat-file -t` → **commit** → **对象与树已完整在本地 `.git` 中，无需再联网** |
| 拓扑关系 | 本地 HEAD `d013d33` **是** `0223be9` 的祖先（`merge-base --is-ancestor` = YES）→ 切过去是**纯 fast-forward**，不存在冲突面；`0223be9` 领先本地 **43 个 commit**，改动 **30 个文件**（新增 10 / 修改 20 / 删除 0），含 `humanManagedProjection`、`economicEntryFeasibility`、`historicalTpReachability`、`HumanManagedView.vue`、`tradingParameterProfiles.ts` 等 |
| 工作区状态 | **仍在 v394 分支 `d013d33`，未 checkout、未 build、未 install** → 磁盘上的 `apps/engine/dist` 与运行中的 Engine 都还是 V3.9.4 |
| 版本身份 | `0223be9:packages/contracts/src/version.ts` = `RELEASE_VERSION "3.9.5"` / `RELEASE_NAME "Economic TP + Human Managed"` / `API_VERSION "V3.9.5"`；运行中 Engine 上报 `3.9.4` / `V3.9.4` |
| CI 证据 | Actions `V3.9.x Verify` **#369**（run id `35410419630`，`head_sha=0223be9…`，`head_branch=v395-economics-human-managed-20260919`，`run_attempt=1`）→ `completed success`；job `verify` 步骤逐步核对：`Diff check from V3.9.3 frozen baseline` / `Build workspace type prerequisites` / `Verify scripts` / `Typecheck` / `Test` / `Build` **全部 success**（两条 `Apply/Persist V3.9.3 autonomous Entry migration` 步骤 `skipped`，符合预期）→ 用户给出的"全绿"陈述**已独立验证成立** |
| ⚠ 构建来源缺口 | 运行中 Engine 的 `buildId=3.9.4-dde660cff8db1901fc1e`，而 `dde660c` 在本地对象库中**不存在**（`rev-parse --verify` 失败、所有 ref 无匹配、`git fsck` 无 dangling）→ **当前正在跑的这份构建无法从本地仓库精确追溯到某个 commit**。详见 I-2 |

---

## H. 当前是否具备进入 V3.9.5 本地部署与 Testnet Canary 的条件 — **技术上具备，但本轮按指令未执行**

已满足的前置（本轮逐项实测）：

1. tracked 工作区干净、无 stash、无未推送 commit → 切分支无丢改动风险
2. `0223be9` 对象/树已在本地，且相对 HEAD 是 **fast-forward**（43 commits / 30 文件）
3. V3.9.5 新增 10 个文件与本地 42 个未跟踪条目 **0 碰撞** → `checkout` 不会被 untracked file 阻塞
4. CI #369 全绿且 head_sha 精确匹配 `0223be9`
5. 数据面健康：`/health READY`、DB `HEALTHY integrity=true`、WS `LIVE gaps=0`、私有数据 `READY consecutiveFailures=0`、Reconciliation `READY drift=0`、TP `READY 13/13 PROTECTED`、`p0-entry-integrity passed=true`
6. 治理面健康：`demo-fapi` + 固定出口 `172.104.186.174`（独立复核一致）、24 h 内零新 429/418、权重 <10%、`blocked=3/33581`
7. 写边界安全：`lockedToTestnet=true`、`productionWrites=0`、`blockedProductionWriteAttempts=0` → Canary 不可能误打生产
8. 本地工具链齐备：Node **v22.23.1**（与 CI `node-version: '22'` 一致）、npm 10.9.8、`package-lock.json`（2026-09-18 19:35）、`node_modules` 已安装（217 个顶层包）→ `npm ci && npm run build` 可直接跑
9. 证据保全：`data/rollout/v394-stage7-9/`、`data/reports/v394-*`、`data/runtime-logs/` 全部未动

需要在**用户显式指令**下才能做的动作（AGENTS.md：Engine 只做人工启动；本轮一律未做）：checkout v395、`npm ci`/`npm run build`、重启 Engine（**部署必然需要一次 Engine 重启窗口**，因为当前进程是 V3.9.4 构建）、Settings 变更、ENFORCE 切换、Canary 启动。

给 ChatGPT 的两点判断建议（不是行动指令）：

- 现有 **8 个 `HUMAN_MANAGED` 持仓 + 13 个 UNKNOWN 账本**恰好是 V3.9.5「HUMAN_MANAGED 处置中心」和「经济型 TP」最真实的验证样本。**部署前不建议人工清仓**，否则 Canary 一开始面对空集，读模型和 TP economics 路径得不到自然覆盖（`ETHUSDT` Stage7 canary 单也在其中）。
- 12H/24H 的结论只能按"未完成"冻结；若要为 V3.9.4 补一个真实完整窗口，它必须与 V3.9.5 部署**串行**、且不能共用被截断过的那段采样（同一条 checkpoint 续跑会得到被污染的分母）。

---

## I. 发现的阻断问题

**硬性阻断：0 个。** V3.9.5 本地部署与 Testnet Canary 无技术阻塞。以下 6 项是需 ChatGPT 裁决的真实缺陷/风险：

1. **（已按计划处理，需登记结论）V3.9.4 12H/24H 未真实完成。** 实测 `252.09/720 min (35.0%)`、`accept24h` 从未启动。任何 `V3.9.4 Binance API Governance Stable` 声明**不成立**；Stage6-8 的 PASS 与其证据仍然有效。本轮已在 marker 与 checkpoint 中如实标注 `TERMINATED_BY_USER_BEFORE_WINDOW_COMPLETION`、`passClaimed=false`，未伪造窗口、未放宽门禁。
2. **运行中构建不可追溯（建议列为部署前置）。** Engine `buildId=3.9.4-dde660c…` 对应 commit 在本地仓库不存在，`git fsck` 亦无 dangling 对象 → 当前这份正在产出验收证据的构建无法绑定到源码。V3.9.5 部署时应从 `0223be9` **重新构建**，并确认 `/health.runtime.buildId` 前缀等于实际 HEAD，否则新窗口的验收证据同样缺少代码绑定。
3. **本地落后 origin/v394 两个 commit（均为 docs：`d156894`、`6ff7d5c`）。** 此前本地 `origin/v394` 引用陈旧，容易让"我以为在最新提交上"的判断失真。需决定：ff 到 `6ff7d5c` 再切 v395，还是直接 ff 到 `0223be9`（`0223be9` 已包含这两个文档 commit，经 `merge-base --is-ancestor` 验证）。
4. **AI 侧供给与 Primary 健康度观察。** `primaryBrain.resource.currentStatus=DEGRADED`、`queueDepth=6`、累计 `failures=13/229 runs`、`lastRunAgeMs=55.3 s`；`pool=POOL_SUPPLY_SHORTAGE`（target 20 / current 16 / gap 4，`governanceBlockedSymbols=23`，`belowLowWatermark=false`，`refillFailure=false`）。这不是 V3.9.4 治理缺陷，但会压低 Canary 的自然入场速率 —— V3.9.5 若用"无自然入场即失败"的门槛，需先确认观察窗口足够长。
5. **UNKNOWN entry 订单累积速率。** 10 → **13**（24 h 内 +3）。全部 `exchangeOrderId=null` 且 `activeRiskUnresolvedCount=0`，**无资金风险**，但账本只增不减、每 60 s 重复复核（近 1 h `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 556 条）。建议 V3.9.5 加：UNKNOWN 存量上限告警 + 该事件的采样/降噪策略。
6. **两个可观测性口径问题（门禁盲区，非违规）。** (a) `observationTrust` 在 36/252 样本为 `INCONSISTENT`，12H 门禁**未覆盖该字段**；(b) `laneStats` 是窗口化计数（窗口内出现过 10 次 `BACKGROUND timeout=1`，当前读数归零），不能作累计指标解读；(c) egress 的 `lastVerifiedAt` 停在 03:35:00，窗口内 252 次读取的是**同一个缓存验证结论**，而非 252 次重新探测。若要给 V3.9.5 定验收门禁，建议把这三项显式纳入（要么作为门禁、要么在文档里标明其语义是缓存/窗口值）。

**Google Drive 保存：** 失败，已按要求放弃且不重试。本机无 `gog` CLI（`gog: command not found`；`PATH`、`~/.qoder-cn/bin`、常见安装位置均无，`~/.config/gog` 不存在），`scripts/upload_to_gdrive.py` 因缺 `~/.config/zdj-gdrive/client_secret.json` 不可用，且 Drive 无头写入路径此前已确认不可自动化。本轮未安装任何第三方 CLI。报告落地为：GitHub（见下）+ 本地 `docs/reports/`（既有的用户认可兜底位置）。

---

## 附：本轮所有动作清单（可复核）

只读：`/health`、`/api/v3/{pipeline,positions,orders,settings,observability/entry,runtime/trading-control}`、`/api/v3/diagnostics/{binance-governance,p0-entry-integrity,closeout,private-sync}`、`GET /`(本地+LAN)、`8081/8084 /v1/models`、runtime-logs 近 1 h 事件分析、samples-accept12h.jsonl 全量再计算、GitHub REST（Actions run #369 与 job steps）、经代理 `127.0.0.1:20081` 的出口 IP 探测。

写入：`data/reports/v395-handover-20260919-085938/`（11 个 API 快照 + `acceptance-final-facts.json` + `build-final-facts.py`）、`data/reports/v395-handover-20260919-085939/`（停止后 5 个复核快照）、`data/rollout/v394-stage7-9/ACCEPTANCE-TERMINATED-BY-USER-20260919-090310.md`、`checkpoint.json` 顶层追加 `acceptanceTermination`（phases 未改）、`.tmp-audit/`（临时）、本报告。

生命周期：**仅** `Stop-Process -Id 18500`（验收 runner）。`git` 侧**仅** `fetch`。未删任何文件。
