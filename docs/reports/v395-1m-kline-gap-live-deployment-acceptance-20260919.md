# ZDJ-MITS V3.9.5｜本地 CI 替代门禁 → 1m K 线修复部署与 live 自愈验收（2026-09-19）

- 实施依据：`docs/prompts/ZDJ-MITS-V3.9.5-本地CI替代门禁-K线修复部署验收-Codex提示词-2026-09-19.md`（分支 `docs/v395-actions-recovery-deploy-20260919`，blob `5480a35`）
- 用户明确授权：**本轮以"全新 worktree + exact HEAD + 与 CI 同步序全流程验证"替代当前不可用的 GitHub Actions 远端 CI 门禁**；远端 workflow 保留不动，不是删除/关闭/降低标准。
- 上一轮事实：远端 Actions 自 22:16 起因账户欠费/额度用尽无法启动 runner（#388/#389/#390 均"job was not started"，0 step），live 因此在 R11 保持未部署。
- 本轮结论：**本地替代门禁 9 步全绿 ⇒ 已一次受控部署 live ⇒ 旧 build 自 09:19 起持续放大 14 h 的缺口风暴模式终止：23:19–00:26（67 min）窗口内 `1m closed candle gap` = 0、`MARKET_SYMBOL_ERROR` = 0、`MARKET_RECOVERY_FAILED` = 0，45 轮采样 `klineFreshRatio` 全程 1.0、`eligibility` 最低 2 且从未归零，28 个部署前仓位中 27 个逐字段无损、1 个由交易所 TP 成交盈利离场。**

---

## A. 本地 CI 替代门禁 exact HEAD

| 项 | 值 |
| --- | --- |
| 正式分支 | `v395-economics-human-managed-20260919` |
| exact HEAD | `def5d294410bec6ac8aa0c6c2b95722b6a21afa4` |
| 验证工作树 | `D:\MITS-worktrees\v395-localci-def5d29`（`git worktree add --detach`，本轮新建） |
| 初始状态 | clean（`git status --porcelain` 0 行）、**无继承 `node_modules`**、无源码改动 |
| 日志 | `D:\MITS-WORKTREES\v395-localci-def5d29-20260919.log` / `.exit` |

## B. 工具链版本

- Node `v22.23.1`（与 workflow `node-version: '22'` 一致）、npm `10.9.8`、git `2.55.0.windows.3`
- 仓库 `engines.node >= 22.12.0`；`npm ci` 使用仓库锁文件，安装后锁文件仍无 diff（`git status --porcelain -- package-lock.json` 空）

## C. 逐项结果（按远端 `V3.9.x Verify` 的真实步序）

| # | 步骤（对应 workflow step） | 命令 | exit | 用时 |
| --- | --- | --- | --- | --- |
| 1 | Diff check from V3.9.3 frozen baseline | `git diff --check 08487ca..HEAD` | **0** | 0 s |
| 2 | Install exact dependencies | `npm ci` | **0** | 15 s（added 279 packages / audited 284） |
| 3 | Build workspace type prerequisites | `npm run build -w @zdj/contracts` | **0** | 5 s |
| 4 | 同上 | `npm run build -w @zdj/core` | **0** | 3 s |
| 5 | Verify scripts | `npm run verify:scripts` | **0** | 9 s（PowerShell 契约测试 6 项 PASS，`# skipped 0`、`fail 0`） |
| 6 | Typecheck | `npm run typecheck` | **0** | 19 s（4 个 workspace） |
| 7 | Test | `npm test` | **0** | 38 s |
| 8 | Build | `npm run build` | **0** | 32 s（vite `built in 8.06s` + engine tsc） |
| 9 | 聚合门禁（提示词第 8 步，workflow 内没有此步仍执行） | `npm run verify` | **0** | 100 s |

`V3.9.3 autonomous Entry migration` / `Persist migration patch` 两步在 `v395-*` 分支上由 `!startsWith(github.ref_name,'v395-')` 跳过，本地同样不执行（与远端语义一致）。

## D. 测试数量

- `@zdj/engine`：**117 files / 639 tests**
- `@zdj/core`：8 files / 17 tests
- `@zdj/dashboard`：8 files / 46 tests
- `@zdj/contracts`：`vitest --passWithNoTests`（0 files）
- 合计 **133 files / 702 tests**，`Test Files ... passed`、`Tests ... passed`，无 failed、无 skipped、无 retry
- 修复链 `1df815a^..cf7437b` 的 diff 中不含 `it.skip/describe.skip/.only/retry:`/`expect(true)`（已 grep 验证）⇒ 无断言削弱

## E. 最终 worktree 状态

`final_untracked_or_dirty_lines=0`（忽略 `node_modules`/`dist`/`data` 后）⇒ 验证结束时工作树仍 clean，无临时 patch、无新增未跟踪源码。

## F. 应用代码 identity 与 dist hash（闭环）

1. docs-only HEAD 与代码身份分离已证明：`git diff cf7437b..def5d29 -- apps packages` **输出为空** ⇒ `def5d29` 的应用代码 == `cf7437b`（`def5d29` 仅新增本报告链路上的 docs）。
2. 全新 worktree 构建后的 dist 内容哈希（与 `runtimeIdentity.contentTreeHash` 同一算法，对 `apps/engine/dist`+`packages/core/dist`+`packages/contracts/dist`+`apps/dashboard/dist`）：
   - `artifactHash = 9a67d9f72261f548890bfa84a307d5a3ca1869d68d9271644256f92218f46f76`
   - 预期 `buildId = 3.9.5-9a67d9f72261f548890b`
3. 部署到 `D:\MITS` 后重算（同一算法、同一四棵树）：`artifactHash = 9a67d9f72261f548890b...` ⇒ **与本地 build 完全一致**。
4. 启动后 live 自报：`buildId 3.9.5-9a67d9f72261f548890b`、`artifactHash 9a67d9f72261f548890b`、`sourceHash d7ebed7a73a6d971f82f` ⇒ 运行中的字节 == 通过门禁的字节。
5. 运行源码 == HEAD 的独立证明（避开 CRLF 假阳性陷阱）：`D:\MITS` 与验证 worktree 的四棵 `src` 树在 `\r\n→\n` 归一化后逐文件哈希相同：

```
apps/engine/src        live=cb4f9ba18af8db1b verified=cb4f9ba18af8db1b  IDENTICAL
packages/core/src      live=3c84c067bd140049 verified=3c84c067bd140049  IDENTICAL
packages/contracts/src live=d58c8a5b68e795ce verified=d58c8a5b68e795ce  IDENTICAL
apps/dashboard/src     live=709b39c33049ff43 verified=709b39c33049ff43  IDENTICAL
```

（`git status --porcelain -- apps packages` 为空 ⇒ live 源码就是 `def5d29`。）

## G. 是否部署 live

**是。** 一次受控部署，序为：entry-only 安全暂停 → 身份校验后 graceful stop（`stop-zdj-lan.ps1`，先证明 8080 owner 是 `dist/main.js` 且 pid==identity 才 `Stop-Process`）→ 四棵 dist 树备份 → 安装已验证 dist → 重算 hash → `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` → egress 自动 VERIFIED → 恢复正常 SHADOW 运行。

- 备份：`D:\MITS-WORKTREES\backup-live-dist-r12-20260919-2319`（832 文件；部署后安装 832 文件，数量一致）
- 未动：`8081` AI scout、`8084` primary brain、`127.0.0.1:20081` SOCKS5/HTTP 代理、`data/` 运行时 DB、settings 业务参数
- 未做：人工全量 backfill、手工清 candle cache、任何 `productionWrites`

## H. 新实例

| 项 | 部署前 | 部署后 |
| --- | --- | --- |
| buildId | `3.9.5-57b2843729dff7a298a9` | `3.9.5-9a67d9f72261f548890b` |
| PID | 9680 | **2320** |
| instanceId | `1c6cc310-45d8-4edb-9324-df710f98daf1` | `090e80f9-13fc-4d0a-80e1-3c9f63b9cecc` |
| startedAt | 09:19:52 | **23:19:43.079** |
| restartCount | 161 | **162**（仅这 1 次，用于加载新 build） |
| lastRestartReason | `MANUAL_START` | `MANUAL_START` |

## I. startup egress 自动 VERIFIED 用时

- `expectedStaticEgressIp = 172.104.186.174`，`routeIdentity = proxy-a087cc91667b`
- `lastVerifiedAt = 1789831187045` ⇒ 启动后 **3.97 s** 自动 `VERIFIED`，`lastError = null`；未人工触发任何 egress 操作。

## J. `1m closed candle gap` 前后

同源计数（`runtime_events.type='MARKET_SYMBOL_ERROR' AND payload LIKE '%closed candle gap%'`）：

| 窗口 | 时长 | gap 事件 | 涉及标的 |
| --- | --- | --- | --- |
| 旧 build 21:00–21:19（风暴成形前） | 19 min | 0（gap 事件从 `21:20` 桶开始：119 → 1,136/10 min） | – |
| 旧 build 22:00–22:19 | 19 min | **1,107** | 51 |
| 旧 build 23:00–23:19（部署前最后 19 min，已自然衰减） | 19 min | **228** | 11 |
| 新 build 23:19–23:41 | 22 min | **0** | 0 |
| 新 build 23:19–00:26（验收窗口） | **67 min** | **0** | 0 |

- 旧 build 自 09:19 启动至部署前累计（保留窗口内）：**4,807** 次 gap 事件、`MARKET_SYMBOL_ERROR` 5,448 次、`MARKET_RECOVERY_FAILED` 1,377 次。
- 新 build 自 23:19 启动至 00:26：`MARKET_SYMBOL_ERROR` **0**、`MARKET_RECOVERY_FAILED` **0**、`MARKET_FRESHNESS_RECOVERED` 0（未进入过"批量恢复"分支）。
- 衰减说明：部署前 22:30–23:14 的速率已在下降（396→312→244→180→133→57/10 min），这是旧进程内受损集合被逐轮重刷耗尽的结果，**不是**旧代码自行修好；同窗口内旧 build 仍每分钟新增 gap（最后一条 23:14:11）。

## K. `gapsByType.kline` / `lastKlineGap`

- 旧 build：`gapsByType` 字段存在但 kline 分支从未递增 ⇒ 部署前实测 `gaps=3, gapsByType={websocketConnection:4, depthSequence:3, kline:0}` 而同期 gap 错误 4,807 次 —— **计数器与实际缺口完全脱节**（正是 R10 判定的 4 号缺陷）。
- 新 build：`lastKlineGap` 字段已出现在 `/health checks.marketStream`（旧 build 无此字段）⇒ 新代码确实在运行。67 min 窗口 45 轮采样：`stream.state` 全程 `LIVE`、`reconnects=0`、`gaps=0`、`backfills=0`、`gapsByType` 全部子项 **0**（含 `kline`、`websocketConnection`）、`lastKlineGap=null` 45/45。**未发生自然 closed-bar 跳变，因此该计数器为 0 是"无事件"而非"事件未被识别"。**

## L. targeted repair 成功/失败

`MARKET_KLINE_SEQUENCE_REPAIRED` / `MARKET_KLINE_SEQUENCE_REPAIR_FAILED`：67 min 窗口内 **0 次成功、0 次失败**（`type LIKE 'MARKET_KLINE%'` 事件数 = 0）。

诚实结论：**live 正向路径仍未被真实事件演练**。原因不是逻辑未部署，而是本窗口内既无 WS 重连、也无 closed-bar 跳变，`repairableSequenceFrames()` 的前置条件（存在 sequence-blocked 帧 + 已有 snapshot + quote/orderBook 均新鲜）从未同时成立。该路径的边界行为已在确定性仿真 `klineRecoverySimulation.test.ts`（60 标的 × 1m 洞 ⇒ 恰好 60 次 klines 重载、每标的 ≤1 次、`getSnapshot` 0 次）中钉住，live 侧留待下一次真实 WS 缺口做验收。

## M. 每 symbol/timeframe REST repair 上界

- live 实测：**未被触发**（见 L），因此无法给出经验上界；
- 已部署字节中的硬约束（`marketDataHub.ts:49-61` + `BinancePublicMarketDataProvider.repairCandles`）：
  - `key = symbol:timeframe`，`if(last && now-last<60_000) → REPAIR_COOLDOWN` ⇒ 每标的时间框架 **≥60 s 一次**；
  - 预算被 defer 时 `klineRepairAt.set(key, now+120_000)` ⇒ 降速到 **≥120 s**；
  - provider 侧 `repairFlights` Map 单飞 ⇒ 同 key 并发 **≤1**；
  - 单次请求 `limit = timeframe==='15m' ? 241 : 120` 根 klines，权重 ≤5；
  - `recoverStale` 每轮 `slice(0,4)`、`mapLimit(...,2,...)` ⇒ 每轮最多 4 个标的、并发 2。

## N. 是否出现 full snapshot storm

**没有。** 部署后 67 min 的 REST 归因（`/diagnostics/binance-governance.requestBudget.attribution`）：

| source / endpoint | requests | est. weight | blocked | last status |
| --- | --- | --- | --- | --- |
| MARKET_DATA `/fapi/v1/klines` | 796 | 890 | 0 | 200 |
| MARKET_DATA `/fapi/v1/premiumIndex` | 695 | 695 | 0 | 200 |
| MARKET_DATA `/fapi/v1/openInterest` | 576 | 576 | 0 | 200 |
| MARKET_DATA `/fapi/v1/ticker/24hr` | 91 | 1,027 | 0 | 200 |
| MARKET_DATA `/fapi/v1/ticker/bookTicker` | 67 | 134 | 0 | 200 |
| MARKET_DATA `/fapi/v1/depth` | **15** | 30 | 0 | 200 |
| ORDER_VERIFICATION `/fapi/v1/order` | 2,078 | 2,078 | 0 | 400（UNKNOWN 复核未命中，见 V-5） |
| BACKGROUND_AUDIT `/fapi/v1/income` | 67 | 2,010 | **3** | 200 |

全量 `loadSnapshot` 会成套打 depth+ticker+klines；这里 **depth 仅 15 次 / 88 个市场**、klines 796 次且平均权重 1.1，`MARKET_RECOVERY_FAILED=0` ⇒ 恢复走定向 klines，未退化为全快照风暴。唯一的 3 次 `blocked` 全部落在低优先级 `BACKGROUND_AUDIT /fapi/v1/income`，`MARKET_PUBLIC / EXECUTION / PRIVATE_TRUTH / CONTROL` 四条 lane 的 `blocked=0`、`timeout=0`、`deferred=0`。

## O. `klineFreshRatio` / `freshMarkets` 前后

| 指标 | 部署前（23:14，14 h 热进程） | 部署后（00:26，67 min 冷进程） |
| --- | --- | --- |
| `freshMarkets.status` | `RECOVERING` | **`FRESH`** |
| `freshMarkets.count / total` | 89 / 97 | **88 / 88** |
| `klineFreshRatio` | **0.9588** | **1.0000（45/45 轮最小值也是 1.0）** |
| `quoteFreshRatio` | 1.0 | 1.0 |
| `stale[]` | 8 | **0** |

冷启动轨迹（每 60 s 一轮，共 45 轮）：`market count 1 → 30(23:29) → 40(23:35) → 59(23:49) → 73(00:00) → 85(00:13)`；`klineFreshRatio` **45 轮取值集合只有 {1.0}**、`quoteFreshRatio` 同样恒为 1.0。`stale[]` 在 13/45 轮非零（1–20，均发生在 hydrate 新标的的那一分钟，下一轮即回落），`freshMarkets.status` 因此出现 12 轮 `RECOVERING` + 1 轮 `DEGRADED`。cohort 增长受**既有**代码节流（`marketCohort.ts:26 batch=Math.min(gap,hydrateBatchSize,2)`，且 `pool.readyList>=readyLowWatermark(6)` 时停止扩张 —— 该文件最后修改是 v392 期 `d156ff5`，修复链未触碰），22 次 `MARKET_COHORT_REFILLED` 全部 `requested=2 loaded=2 accepted=2 partial=false`。

## P. `eligibility` / `pipelineState` 前后

- 部署前：`pipelineState=RUNNING`、`eligibility.count=4`、`noEntryReason=null`（但 `freshMarkets=RECOVERING`、`klineFreshRatio=0.9588`、8 个 stale，且当天多次进入 `PAUSED_MARKET_DATA_UNAVAILABLE`）
- 部署后 45 轮：**44/45 轮 `RUNNING`**；唯一一次非 RUNNING 是 **23:33:27 一轮 `PAUSED_MARKET_DATA_UNAVAILABLE`，`marketDataReason=MARKET_TECHNICAL_STALE`**（该轮 `market count 36 / fresh 16 / stale 20 / recoveryQueue 16`，而 `quoteFreshRatio=1.0`、`klineFreshRatio=1.0`）—— 发生在冷启动 cohort 批量 hydrate 期间，下一轮（23:34:27）即 `stale=1`、`RUNNING` 恢复。**没有靠人工干预恢复。**
- `eligibility.count`：45 轮取值 2–6，**最小 2、归零次数 0**（Stage 6 判据"≥1 且不再周期性归零"满足）
- 收尾（00:26）：`pipelineState=RUNNING`、`marketDataReason=null`、`eligibility={status:READY,count:3,excluded:31}`、`noEntryReason=WAITING_EXECUTION_CAPACITY`（AI/池位供给，而非行情缺失）、`poolTarget=20`、`poolCurrent=17`、`poolReady 0–5`
- 事件侧（与 `pipelineState` 标签是两条路径）：`TECHNICAL_*_SEQUENCE_INVALID` 与 `%TECHNICAL_STALE%` 事件均 **0** ⇒ 没有任何标的因 kline sequence 被挡在卡片外；23:33:27 那轮的 `MARKET_TECHNICAL_STALE` 来自 `marketDataStaleReason()` 对 `freshness.stale` 的判定（新标的刚 hydrate、卡片尚在建立），而非 sequence 阻塞

## Q. 429 / 418 / request governor 前后

| 指标 | 部署前 | 部署后（67 min 累计） |
| --- | --- | --- |
| `http429` | 17 | **17（0 新增）** |
| `http418` | 3 | **3（0 新增）** |
| `usedWeight1m` / `requestWeightLimit1m` | 388 / 6000 | 98–516 / 6000（收尾 113） |
| `estimatedWeight1m` | 348 | 220–662 |
| `queued` | 0 | 0–3（收尾 1） |
| `blocked` / `queueTimeout` | – | 聚合 3 / 3，**全部**来自 `BACKGROUND_AUDIT /fapi/v1/income`；`MARKET_PUBLIC`、`EXECUTION`、`PRIVATE_TRUTH`、`CONTROL` 四 lane 均 `blocked=0 / timeout=0 / deferred=0` |
| `status` | AVAILABLE | AVAILABLE（`blockedUntil=0`） |
| `decisions` | – | admitted 6,848 / queued 6,852 |

未调高任何 Binance 请求预算（`requestWeightLimit1m=6000` 为交易所默认档位，本轮零改动）。

## R. positions / TP 是否无损

逐仓对比三份快照：部署前 23:14（28 仓）→ 部署后 23:31（28 仓）→ 窗口末 00:26（31 仓）。

**紧邻重启的 23:14 → 23:31（真正衡量"重启是否伤到旧仓"）：**

- `only before = []`、`only after = []` ⇒ 无仓丢失、无新增
- 28∩28 逐字段比对 `quantity / tpStatus / tpOrderId / tpPrice / managementStatus / targetPrice / rangePct`：**差异 0 条**
- `takeProfit.protected 28/28`，`missing/orphanTp/duplicateTp/qtyMismatch/wrongSide/repairFailed` 全 **0**（前后相同）

**窗口全长 23:14 → 00:26（含重启后正常交易 67 min）：**

- 27 个部署前仓位仍在；除 3 个仓的 `managementStatus` 由 `AUTO_MANAGED` 变为 `HUMAN_MANAGED` 外，`quantity / tpStatus / tpOrderId / tpPrice / targetPrice / rangePct` **零差异**（这 3 条变化是：`ENAUSDC` 23:46:16、`XMRUSDT`+`DOGEUSDC` 00:03:08，事件 `POSITION_HUMAN_HANDOFF reason=LOSS_HANDOFF_BARS lossHandoffBars=4 tpRetained=true`）⇒ 这是既有的**亏损人工接管**策略在生效：**TP 保留、未自动平仓**（`tpRetained=true`，全窗口 `AUTOMATIC_EXIT/AUTO_CLOSE` 类事件 **0**）
- 1 个部署前仓位离场：`XPLUSDT LONG 1212` 于 23:41:33 `POSITION_CLOSED_USER_DATA`，`TRADE_RECORD_REPAIRED exitQty=1212 remainingQty=0 tradingNetPnlExFunding=+1.3332` ⇒ **TP 成交盈利离场**（随后 23:42:59 `ORPHAN_TP_CANCELED tp_mu8ewnw2_00pfa94 NO_MATCHING_POSITION` 清理残留 TP 挂单），按交易所成交事实归因，不计异常
- 4 个新仓由正常 SHADOW 链路开出：`TAOUSDT LONG`(23:42)、`BCHUSDT LONG`(23:51)、`BTCUSDT LONG`(00:02)、`AVAXUSDT SHORT`(00:09)，`ENTRY_ORDER_CREATED` 恰 4 次
- 00:26 状态：**31 仓 / 31 TP `PROTECTED`**，`missing=0 orphanTp=0 duplicateTp=0 qtyMismatch=0 wrongSide=0 repairFailed=0`；`managementStatus` 计数 `HUMAN_MANAGED 19 / AUTO_MANAGED 12`（其中 19 是长期人工接管集，本轮新增 3）
- `capacity.used` 一度为 29/30/31 而 `takeProfit.protected` 少 1：`/api/v3/positions` 始终给出现实仓位且**全部 TP `PROTECTED`** ⇒ 差额是**在途 entry order 占用**，不存在裸仓
- `productionWrites` 指标未新增（`diagnostics/storage` writes 仍为空对象），环境保持 `connections.exchange.environment=TESTNET`

## S. historical UNKNOWN / durable claims

- `historicalUnknownCount` 部署前 20 → 窗口末 **20（未删除任何历史 UNKNOWN）**，其中 `verifiedNoActiveRiskUnknownCount` 19 → 20
- 部署前 `activeRiskUnresolvedCount=1 / unresolvedDriftCount=1 / status=DEGRADED`（`ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED` 的 `POSITION_PRESENT_WITHOUT_DURABLE_ENTRY_PROVENANCE` fail-closed 占用），重启后由远端订单事实核验自行归零：`0 / 0 / READY`
- 窗口内 4/45 轮（23:43:30、23:44:30、00:06:35、00:07:35）再次出现 `unresolvedDriftCount=1 / DEGRADED` —— 都是**新一次 entry 在途**时的正常 fail-closed 占用，随后各自归零；00:26 收尾为 `status=READY driftCount=22 unresolvedDriftCount=0 activeRiskUnresolvedCount=0`
- `verifiedOrderFactMismatchCount=0`、`crossSymbolOrderMismatchCount=0`、`activeRemoteEntryWithNewPrimaryCount=0`、`unverifiedRemoteTerminalReleasedOccupancyCount=0`、`p0EntryIntegrity.passed=true`
- `durableClaims`：部署前 `{durableTasks 276, activeClaims 0, activeUnknownClaims 0, releasedClaims 19, releasedUnknownClaims 19}` → 窗口末 `{durableTasks 280, activeClaims 0, activeUnknownClaims 0, releasedClaims 19, releasedUnknownClaims 19}` ⇒ 4 次新 Entry 各新增 1 条 durable task 并全部落终态，**无悬挂 active claim，无 UNKNOWN 清理动作**
- `settingsVersion` 184 → 185：由**启动时的 settings 持久化**造成（`settings_audit` id 57，`changed_at=1789831183986`=启动后 0.9 s，`source="api"`，`maxPositions {before:50, after:50}`）。同样的启动 bump 在旧 build 09:19 启动时也发生过（id 50：178→179）。`positionManagement / tradeEconomics / takeProfit / selection / riskGovernance / connections` 六组参数逐字段与部署前相同（`admission(excl. runtimeControl) identical: True`）；我做的 entry 暂停/恢复**不写 settings**（该时段 `settings_audit` 无对应记录）。

## T. 是否在一次新的 WS gap 后无需人工干预完成自愈

**本窗口未出现新的 WS 断线或 closed-bar 跳变，因此这条仍未验收。** 观测：`reconnects=0`、`gaps=0`、`backfills=0`、`websocketConnection` 增量 0，全程 `stream.state=LIVE`。不做人工断线模拟（那需要重启或改代理，超出本轮授权）。

## U. 是否恢复到可以重跑 ENFORCE 正向 Canary 的市场数据条件

**市场数据侧：已达到，可以进入下一轮的只读 Stage 1 复评；但"K 线自愈 live 正向路径"这一项仍未演练。** 已满足（00:26 实测）：`freshMarkets=FRESH 88/88`、`klineFreshRatio=1.0`、`quoteFreshRatio=1.0`、`stale=0`、67 min 内 gap 事件 0、`MARKET_RECOVERY_FAILED=0`、`429/418` 零新增、`egress=VERIFIED`、`eligibility` 45 轮从未归零、`pipelineState` 44/45 轮 RUNNING。仍需在下一轮处理：

1. `poolReady` 收尾为 0、`noEntryReason=WAITING_EXECUTION_CAPACITY`、`eligibility.count=3`（R9 当时是 104 个候选里 96 个不合格）⇒ **供给量已够，但"够不够支撑一次正向 ENFORCE"必须按 R9 的纪律重新做一次只读 Stage 1 门槛 + 重新冻结预选注册表**，不得沿用 21:28 的旧注册表；
2. 正向 ENFORCE pass 腿仍未观测（R8 的 8 次评估 0 通过、最近失败 0.4947 vs 0.50）；
3. `MARKET_KLINE_SEQUENCE_REPAIRED` 的 live 正向演练仍为 0（见 L/T），下一轮遇到自然 WS 缺口时应优先把它当作验收样本。

## V. 对修复实现的反驳/补充

1. **`sequenceInvalid` 统计成了孤儿指标。** 我在 `MarketDataHub.freshness()` 里新增了 `sequenceInvalid` 计数，但 `appRuntime.pipelineStatus()` 的 `freshMarkets` 投影只输出 `status/count/stale/quoteFreshRatio/klineFreshRatio`（`appRuntime.ts:1409-1418`），因此该值在 HTTP 侧不可见（本轮验收只能靠 `MARKET_KLINE%` 事件与 `/health` 的 `gapsByType.kline`）。属可观测性缺口，不是行为缺陷；**修它需要改代码，会让已验证的 dist 身份失效，所以本轮刻意不改**。
2. **定向修复的 live 正向证据仍为 0，风险集中在"从未跑过的那条分支"。** 目前唯一强证据是仿真 + 单测。下一轮若发生自然 WS 缺口，应直接把 `MARKET_KLINE_SEQUENCE_REPAIRED` 的 `outcome` 明细、该 key 的 60 s 冷却命中次数、以及同轮 `attribution.klines` 增量三者对齐做验收，而不是只看"错误变少"。
3. **本轮"gap 归零"包含不可分离的冷启动成分。** 冷 cache 使 fast path 从一开始就走 REST；因此 J 的对比证明的是"不再自我放大"，不等于"洞出现时一定能补上"。诚实的判据是 U/下一轮的自然缺口演练。
4. **`gapsByType.kline` 只在**新 closed 柱实际到达且 `openTime > previous+period` 时递增。若 WS 整段重连后从当前边界续播（不重发缺失柱），流侧计数器可能保持 0，而缓存洞由 `getCandles` 的连续性判定兜住 —— 两者是互补而非冗余；这也解释了 K 行"计数器 0 + 错误 0"并不矛盾。
5. **`/fapi/v1/order` 的 2,078 次 `lastStatus=400`**（UNKNOWN 复核 `EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK`）在本窗口继续每分钟发生，与 K 线无关，但它和 market hydration 争用同一 REST lane，且占了本轮权重消耗的绝大部分（`userTrades 5,115 + allOrders 5,085 + order 2,078 + income 2,010`，而全部 MARKET_DATA 只占 3,352）；R9/R10 已提出，仍待单独治理（不在本轮范围）。
6. **操作性发现（本轮自己踩到，值得固化进部署 SOP）：`entry-only 安全暂停` 并不是"行情中性"的。** `MarketCohort.globalBlockReason()` 把 `PAUSED_MANUAL` 视为全局 blocker，于是我在 23:18:46 暂停后，cohort 定向 hydrate 被 `MARKET_COHORT_DEFERRED{blocker:MANUAL_PAUSE, retryAt:0}` 连续挡住 3 次，市场数停在 2–3 达 6 分钟；23:25:19 恢复后 10 分钟内就到 40。⇒ **以后为部署做重启时，要么完全不暂停（v393 stage11 脚本就没暂停），要么把"暂停窗口"压到秒级并在验收前立即恢复**，否则会把自己造成的供给停摆误读成"新 build 起不来"。
7. **`freshMarkets.stale[]` 与 `klineFreshRatio` 不是同一口径，冷启动下会独自闪一次 DEGRADED。** 23:33:27 那一轮 `stale=20` 触发 `DEGRADED→PAUSED_MARKET_DATA_UNAVAILABLE`，但两个 ratio 都是 1.0 —— 因为 `stale` 来自 `primaryReadyReasons()`（包含"该标的卡片尚在建立"这类非 TTL 原因），ratio 来自 TTL 判定。新标签比旧 build 的 `MARKET_QUOTES_STALE` 诚实（不再把 quotes 指错），但**要真正区分"sequence 挡住"与"还没建好"，必须把已有的 `sequenceInvalid` 计数暴露到投影里**（与 V-1 同一处改动，建议下一轮连同其单测一起做）。

---

### 证据文件（本机，未入库）

| 内容 | 路径 |
| --- | --- |
| 本地替代门禁全量日志 + 逐步 exit code | `D:\MITS-WORKTREES\v395-localci-def5d29-20260919.log` / `.exit` |
| 门禁驱动脚本（步序即 CI 步序） | `D:\MITS-WORKTREES\dryrun\localci-gate-def5d29.sh` |
| 部署前 / 部署后 12 min / 窗口末三份 live 快照 | `D:\MITS-WORKTREES\dryrun\r12-snapshot-before.json`、`r12-snapshot-after-2331.json`、`r12-snapshot-after-window.json` |
| 45 轮验收采样（23:29:26–00:13:36） | `D:\MITS-WORKTREES\dryrun\r12-watch-post.jsonl`（采样器 `r12-watch.py`、汇总器 `r12-summarize.py`） |
| dist / src 哈希复算 | `D:\MITS-WORKTREES\dryrun\r12-treehash.mjs`、`r12-srcnorm.mjs` |
| 旧 dist 回滚基线 | `D:\MITS-WORKTREES\backup-live-dist-r12-20260919-2319`（832 文件） |
| stop / start 日志 | `D:\MITS-WORKTREES\dryrun\r12-10-stop.log`、`r12-20-start.log` |

### 关于提交后的 GitHub Actions

远端 Actions 仍处欠费/额度停摆（R11 已核实：run 只有 ~2 s、0 step、注解为 payment/spending limit）。因此**本文件提交后若出现 Actions failure，属于 runner 未启动的账户问题，不是代码失败，不做 rerun、不据此回退任何结论**。远端 CI 的标准本身未被删除或降低；账户恢复后仍应按原门禁重跑一次远端验证。

---

### 停止点

按提示词 Stage 9：本轮在 K 线修复的 live 验收（含诚实的"未演练"部分）记录后停止。**未重跑 ENFORCE Canary**；live 保持 `SHADOW` + `humanManagedAdmissionCapsEnabled=true` + 原 Settings + Testnet only；GitHub Actions 的远端门禁标准未被删除或降低，只是本轮以本地 exact-HEAD 全流程验证替代。
