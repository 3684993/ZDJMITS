# ZDJ-MITS V3.9.5 本地部署与 SHADOW 启动验收报告（含一次受控 Engine 重启）

- 时间：2026-09-19 09:20–09:56 (+08:00)
- 授权范围：本地部署 + **一次**受控 Engine 重启 + SHADOW 验收；**禁止 ENFORCE、禁止人为造单**
- 结果：**V3.9.5 已在 `3.9.5-f93676140a441bc0199c` 上稳定运行，SHADOW 语义经真实事件证明为"只观察不阻断"，持仓/TP/治理零损伤。未触发任何自动回滚条件。**
- 首要修正：**上一轮 I-2 的"构建不可追溯"结论是错的**（见 B 段第一小节）。

---

## A. V3.9.5 exact HEAD / 本地 build / test 结果

| 项 | 事实 |
|---|---|
| 构建位置 | 独立 worktree `D:\MITS-WORKTREES\v395`，detached HEAD `0223be94be41c55b8e85d54a9fed489ac5b94764`（`git status -uno` 0 行，tracked 干净） |
| 依赖 | `npm ci` exit 0（lockfile 未改） |
| 本地 CI 等价链 | `npm run verify` = `verify:deps` → `verify:scripts` → `typecheck` → `build` → `test`，**`VERIFY_EXIT=0`** |
| typecheck | contracts / core / dashboard(vue-tsc) / engine 四个 workspace 全通过 |
| test | **Test Files 112 passed (112)，Tests 597 passed (597)**，另有前置两批 `8 passed` |
| verify:scripts | 含 `run-v394-stage7-to-stage9.test.ps1` 等 4 个 PowerShell 契约测试，全 PASS |
| 与远端 CI 的关系 | 这是**本机 Node v22.23.1 + 本机 npm ci** 的独立复现，不只是引用 GitHub Actions #369 的绿灯；两者结论一致 |
| 部署后本地仓库 | `D:\MITS` 现 checkout 到新本地分支 `v395-economics-human-managed-20260919`（tracking origin 同名分支），HEAD `0223be94…`，tracked 干净，**43 个 untracked 项全部保留**（未删、未 clean、未覆盖） |

## B. V3.9.4 可验证 rollback baseline

### B-0 先纠正上一轮的结论

`buildId` 的尾巴**不是 git commit**。`apps/engine/src/runtime/runtimeIdentity.ts:27,32` 证明它是**内容哈希**：

```
buildId = `${RELEASE_VERSION}-${contentTreeHash(root, ['apps/engine/dist','packages/core/dist',
           'packages/contracts/dist','apps/dashboard/dist']).slice(0,20)}`
```

我在部署前对 `D:\MITS` 现场重算：

```
artifactHash = dde660cff8db1901fc1e3474ed1c6714762eddf33b0257fc4d2639551dcc5dca   ← 与运行中实例完全相同
sourceHash   = 1ff3b6d45ae12a4012fef8a9164e2d5ab8cf53fcc67461e9a8310c0e44fae303   ← 与运行中实例完全相同
```

→ 正在运行的 V3.9.4 构建**一直可以精确绑定到 `d013d33` 的 dist+src**；`dde660c` 从来不是"仓库里缺失的 commit"。上一轮把它当 commit 去 `git cat-file`/`fsck` 是我的解释错误，本报告予以更正，并且**未**尝试伪造或"恢复" `3.9.4-dde660c`。

### B-1 基线一：位级精确（首选回滚目标）

| 项 | 值 |
|---|---|
| 备份位置 | `D:\MITS-WORKTREES\backup-live-dist\20260919-094000`（仓库外） |
| 内容 | 4 棵 dist 树，791 文件，3,643,214 B |
| 验证 | 对备份目录重算 `contentTreeHash` = `dde660cff8db1901fc1e…5dca` **等于运行中实例** → 还原后 buildId 必然回到 `3.9.4-dde660cff8db1901fc1e` |
| 还原步骤 | 复制 4 棵树回 `D:\MITS` → `git checkout v394-binance-governance-settings-20260918`（该指针仍在 `d013d33`）→ `stop-zdj-lan.ps1` → `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` |

### B-2 基线二：源码可追溯重建

| 项 | 值 |
|---|---|
| 位置 | `D:\MITS-WORKTREES\v394-rollback` @ `6ff7d5ca254da2a216e9c5a011986c58cb70789c`（v394 远端 tip） |
| 构建 | `verify:deps` + `typecheck` + `build` **exit 0** |
| artifactHash | `cf8af0d69e55b165ce730f89da049e09154883264bee782b8bce332c446fd725` → buildId `3.9.4-cf8af0d69e55b165ce73` |
| 为何与 live 不同 | `d013d33..6ff7d5c` 经核验**只有 1 个新增文档文件**（V3.9.5 计划，1001 行，0 删除，无任何 code/runtime 变化）；哈希差异来自 git 在新 worktree 按 CRLF 检出 135/301 个 src 文件，而 live 树是 LF —— 逐文件比较在换行归一后**完全相等**。属换行符口径差异，不是代码差异 |
| 结论 | 需要"源码可追溯的 V3.9.4"时用基线二；需要"和刚才一模一样"时用基线一 |

### B-3 回滚在设置层的可行性（已实测）

把迁移后的文档喂给 **V3.9.4 构建**的 `SettingsStore`：`loaded=true`，`settingsVersion=177`，`maxPositions=50`，`dynamicMarginEnabled=true`，`tradeEconomics` 被 schema 丢弃（V3.9.4 无此字段）。
⚠ 但 `minNetProfitUsd` 会保持 **1**（V3.9.4 不会把它改回 0.01）→ 回滚不会自动回退 TP 净利率下限，若需回退必须人工改 Settings。

## C. Settings migration 前后精确 diff

方法：在**临时目录**新建 `SettingsStore`（V3.9.5 构建），用 `GET /api/v3/settings` 的 live 文档以 `version=177` 播种，再让 V3.9.5 的启动迁移路径 `load()` 真实运行；**未接触 `D:\MITS\data`**。脚本 `D:\MITS-WORKTREES\dryrun\migration-dry-run.mjs`，输出 `migration-dry-run.json`。

**全部变化（叶子级）= 10 项：**

| 类型 | 路径 | before → after |
|---|---|---|
| CHANGED | `takeProfit.minNetProfitUsd` | **0.01 → 1** ← 唯一被改值的既有字段 |
| ADDED | `tradeEconomics.parameterProfile` | `CUSTOM` |
| ADDED | `tradeEconomics.admissionMode` | `SHADOW` |
| ADDED | `tradeEconomics.historicalTpReachabilityEnabled` | `true` |
| ADDED | `tradeEconomics.minHistoricalReachProbability` | `0.5` |
| ADDED | `tradeEconomics.reachabilityLookbackBars` | `120` |
| ADDED | `tradeEconomics.reachabilityMinSamples` | `30` |
| ADDED | `positionManagement.humanManagedAdmissionCapsEnabled` | `true` |
| ADDED | `positionManagement.maxHumanManagedPositions` | `4` |
| ADDED | `positionManagement.maxHumanManagedNotionalPctEquity` | `0.2` |

**门禁 21/21 PASS**，其中你点名的几条：

- `settingsVersion` **保持 177**（内存与 DB 行都是 177）；`migrate()` 只重写 `≤15→16`、`≤17→18` 两段，绝不可能落到出厂默认 20 —— 默认文件的 `settingsVersion:20` 仅在**无 DB 行**的 bootstrap 分支使用，且 `merge()` 让 stored 优先
- `parameterProfile=CUSTOM`、`admissionMode=SHADOW` ✅
- 未被 profile 覆盖：`maxPositions=50`、`maxPendingEntries=6`、`entryMarginUsd=200`、`dynamicMarginEnabled=true`、`baseMarginUsd=200`、`maxMarginPerPositionUsd=500`、`globalMaxLeverage=20`、`leverage.mode=DEFAULT`、`takeProfit.mode/targetPriceMovePercent/tpEconomicsEnabled`、代理与 Testnet 参数 —— 全部逐字段核验未变
- 二次 `load()`（模拟再次重启）**0 变化、版本不 creep** → 幂等
- 引擎**从不读** `parameterProfile`：它只是 dashboard 的 `<select @change>` 客户端表（`tradingParameterProfiles.ts:5-28`，CUSTOM 直接 early-return），非 CUSTOM 时才会覆写上述参数

**live 实况**：重启后 `settingsVersion 177 → 178`。这是 V3.9.4 就存在的**合法递增**（`appRuntime.ts:170-177` 在 TESTNET+TESTNET_ENABLED 启动时 `store.save()`、`runtimeSettingsResources.ts:60-61` 代理规范化），`save()` 用 `Math.max(current+1, parsed+1)` 严格向上；不是降级、不是迁移 bug。live 现值：`admissionMode=SHADOW`、`parameterProfile=CUSTOM`、`minNetProfitUsd=1`。

## D. 旧持仓 TP dry-run 结果

先纠正输入事实：**dry-run 覆盖的是 12 个在架持仓**，不是 13。13 → 12 发生在本轮之前（09:08 尚有 13，09:29 抓取 live 时 XMRUSDT 已自然离场）。方法：`tp-dry-run.mjs`，用引擎自带 `MockExchangeAdapter`（**结构上不可能写交易所**）把同一批 live 持仓 + 同一批 WORKING TP 订单，分别喂给 V3.9.4 guardian（原设置）与 V3.9.5 guardian（迁移后设置）。

**9/9 门禁 PASS：**

| 断言 | 结果 |
|---|---|
| V3.9.5 交易所写操作数 | **0**（`actions=[]`） |
| V3.9.4 对照组写操作数 | 0 |
| 12 个持仓 V3.9.5 后仍 `PROTECTED` | ✅ 全部 |
| `tpOrderId` 逐个保留（无 cancel/replace） | ✅ 12/12 相同 |
| TP 指标逐项相同 | ✅ `{required:12, protected:12, missing:0, orphanTp:0, duplicateTp:0, qtyMismatch:0, wrongSide:0, unverifiedTp:0, retryQueue:0}` |
| 无持仓带 `economicAdmission` | ✅ 12/12 `null` |
| SHADOW 下 sub-1.2% 特例不可用 | ✅（`tpGuardian.ts:65` 要求 `mode==='ENFORCE'` 才置 `aiMinMovePct=0`） |

关键机理（`tpGuardian.ts:43-54`）：存在 `WORKING` 且数量/方向匹配的 TP 订单时，函数在**任何**价格重算分支之前就 early-return 并标 `PROTECTED` → 迁移与重启**不可能**动它。

三条必须让 ChatGPT 知道的量化事实：

1. **1.2% 门槛在 SHADOW 期完全保留**，V3.9.5 的"经济型 TP 可低于 legacy 1.2%"能力**尚未生效**（这是设计，不是故障）。且现存 12 个 TP 距入场价均 ≥1.2%（0 个低于），legacy 门槛本来也不是当前的约束项。
2. **8/12 现存 TP 价格在 `$1` 净利下限之下**（`expectedNetProfit < requiredNetProfit=1`）：TAOUSDT 0.2197、ADAUSDT 0.1319、CRVUSDT 0.0752、PENGUUSDT 0.1590、DOTUSDT 0.6917、AAVEUSDT 0.6196、WLDUSDT 0.6323、ETHUSDT 0.9354（USD）。**当前无任何动作**；但若将来某个 TP 需要修复/重建，V3.9.5 会把目标价推到更远的 `minProfitableExitPrice`。4/12（BCHUSDT/XLMUSDT/UNIUSDC/DOGEUSDT）已满足 $1。
3. `historicalTpReachability` 只作用于**入场路径**（`entryCoordinator.ts:285`、`economicEntryFeasibility.ts:67-77`），**不参与 tpGuardian** —— 与提问框架里的假设不同，特此更正。

## E. 是否执行 Engine 重启；新 PID / instanceId / buildId

**执行了，恰好一次。**

| 项 | 重启前 | 重启后 |
|---|---|---|
| PID | 21948 | **26520**（launcher host PID 24408，`LAUNCH_ID=6047eade…`） |
| instanceId | `d97da680-cc70-40bd-b202-e2e3ddfb1bc8` | **`f38e3dec-10d7-49c2-82cc-cae8598b475a`** |
| version / buildId | `3.9.4` / `3.9.4-dde660cff8db1901fc1e` | **`3.9.5` / `3.9.5-f93676140a441bc0199c`** |
| releaseName / apiVersion | Trading Quality SHADOW / V3.9.4 | **Economic TP + Human Managed / V3.9.5** |
| artifactHash | dde660cf… | `f93676140a441bc0199c59ee9434428b5354a3090662b194aa500bb7af85f052` |
| restartCount / startReason | 159 / UNKNOWN | 160 / **MANUAL_START** |
| runtimeDataDir | `D:\MITS\data` | **`D:\MITS\data`（未变，未产生第二数据根）** |

**身份绑定证明链（三段闭环，不靠命名约定）：**
1. worktree HEAD = `0223be94…`（唯一提交），tracked 干净；
2. 该 worktree 构建产物 `contentTreeHash` = `f9367614…`；把 4 棵树**字节级**复制进 `D:\MITS` 后重算 = **同一个 `f9367614…`**（`MATCH=true`，文件数 672/72/45/22 逐个核对）；
3. 运行实例自报 `buildId=3.9.5-f93676140a441bc0199c`，与 (2) 预测值逐字符相同。
→ 运行代码 ⇔ `0223be94` 建立；且 `D:\MITS` 的工作区 HEAD 也已是 `0223be94`，源码与 dist 一致。

**切换时序（全部使用既有脚本，未发明新机制）：**
1. 09:41 保存 pre-restart 事实快照（`pre-restart-snapshot.json`）；
2. `POST /api/v3/runtime/trading-control/pause` → `PAUSED_MANUAL / MANUAL_PAUSE / autoResume=false`，**同时刻 TP 仍 12/12 PROTECTED、reconciliation READY**（该机制只 gate 新建仓：`runtimeControlService.ts:32 canDispatch()`，TP Guardian `appRuntime.ts:547` 每 5 s 无条件扫描）；
3. `stop-zdj-lan.ps1`（身份三重证明后 `Stop-Process`）→ "port 8080 is free"；
4. `git checkout -b v395-economics-human-managed-20260919 origin/…` → HEAD `0223be94`（09:45:56）；
5. 4 棵 dist 树替换 + 哈希核验（`install-dist.ps1`，先备份后替换，计数校验）；
6. `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` → 09:46:27 PROCESS_START，09:46:29 HTTP_LISTENING，随后 `/health` 200 READY；**停机窗口 ≈ 3 分钟**；
7. 验收后 `POST …/resume` → `RUNNING / AUTO_RUNNING / entrySafety AUTO`。

8081（llama-server PID 12732）、8084（PID 9704）、代理 20081（WindmillVPN PID 18216）、proxy.js（PID 20300）**全程未停**，四个 PID 与创建时间戳逐项复核未变。

## F. 重启前后账户、持仓、订单、TP 对照

| 维度 | 09:41 pre | 09:52 post | 判定 |
|---|---|---|---|
| wallet / equity / available | 10693.98 / 10671.84 / 4173.93 | 10696.11 / 10659.43 / 4160.42 | 正常（Mark 波动） |
| uPnL / realized24h | −22.14 / −479.33 | −36.68 / −478.72 | 正常（24 h 滚动窗） |
| 持仓数 | 12 | **11** | 差 1：WLDUSDT 由**自身 TP 成交**离场（09:50:16，`clientOrderId=tp_mu7gent0_003cd7b`，`exitQty=100`、`remainingQty=0`、`tradingNetPnlExFunding=+0.652854`）。随后 `ORPHAN_TP_CANCELED reason=NO_MATCHING_POSITION` 是平仓后的孤儿单清理（V3.9.4 既有行为，该文件本轮未改）。**非迁移损伤** |
| 管理态 | HUMAN 9 / AUTO 3 | HUMAN 9 / AUTO 2 | CRVUSDT 于 09:50:11 `POSITION_HUMAN_HANDOFF reason=LOSS_HANDOFF_BARS` 且 **`tpRetained=true`** → 转人工保留 TP |
| 每个原有持仓 TP | 12 个 PROTECTED | 11 个仍 PROTECTED，**tpOrderId 与价格逐个未变**（例 ETHUSDT `tp_mu7d248a_1lm6dj8b` 2660.87、UNIUSDC `tp_mu7gfggx_qph7zizz` 9.202） | ✅ 无 cancel / 远移 / 重建 / 失保 |
| TP 指标 | READY 12/12 | READY 11/11，`missing=0 orphanTp=0 duplicateTp=0 qtyMismatch=0 wrongSide=0 unverifiedTp=0` | ✅ |
| 订单账本 | entry 256（F98/C91/R52/U15）、TP 217（F103/C40/R37/E25/W12）、manual 37 | entry 256（…U**15**）、TP 218（F**105**/…W**11**）、manual 37 | UNKNOWN **未增加**（15→15）；TP FILLED +2 = 自然止盈；WORKING 与持仓 1:1 |
| Reconciliation | READY, drift 0, unresolved 0, activeRisk 0, mismatch 0 | READY, `driftCount=15`（启动首扫修正）→ `correctedDifferenceCount=15`，`unresolvedDriftCount=0`、`activeRiskUnresolvedCount=0`、`verifiedOrderFactMismatchCount=0` | ✅ 无未决差异；`p0-entry-integrity passed=true` |
| Settings | version 177，无 tradeEconomics，minNet 0.01 | version 178，`tradeEconomics{SHADOW,CUSTOM,…}`，minNet 1 | 预期迁移 + 合法 revision bump |
| 身份 | 3.9.4 / dde660c | 3.9.5 / f9367614 | ✅ |
| 前端 | — | `/`、`/human-managed` 均 200；页面渲染 9 条待处置持仓，标题 "待人工处置"，明示"严重度仅用于风险排序，不授权自动止损、超时平仓或 panic-close"，仅有 保持持仓 / 打开处置控制台 两类人工按钮 | ✅ 已用浏览器实测渲染 |

## G. V3.9.5 SHADOW economics 是否真正"只观察不阻断"—— **是，已用真实事件证明**

代码面（V3.9.5 构建，`0223be94`）：
- `entryCoordinator.ts:334-336`：**总是**评估并发布 `ENTRY_ECONOMIC_ADMISSION_EVALUATED{passed,wouldBlock,…}`，**仅当 `mode==='ENFORCE' && !passed` 才拒单**；`:176-179` 最终订单门禁同样只认 ENFORCE
- `preAiExecutionEnvelope.ts:53`：`humanHardBlock = admissionMode==='ENFORCE' && capsEnabled && !withinLimits` → SHADOW 下恒 false
- `economicEntryFeasibility.ts:43-48`：`OFF` 才短路

**运行时实证（09:51 自然产生，未人为干预）：**

```
ENTRY_ECONOMIC_ADMISSION_EVALUATED  mode=SHADOW  passed=false  wouldBlock=true
  blockers=[TP_REACH_PROBABILITY_UNMET, HUMAN_MANAGED_EXPOSURE_LIMIT]
  expectedNetProfit=1.7544  requiredNetProfit=1.0
→ 紧接 ENTRY_INTENT_CREATED  BTCUSDT side=LONG confidence=0.65 idealPrice=81284.4 acceptablePriceRange=…
→ 再 ENTRY_ORDER_SUBMISSION_UNKNOWN（说明 POST 真的发往交易所）
```

即：**经济门禁判定为 wouldBlock，建仓仍照常进入 Intent→提交** → SHADOW 确实是记录 evidence/wouldBlock、不阻断。重启后至今**没有任何**因 economics/human-managed 上限而产生的 `ENTRY_ORDER_BLOCKED`/`ENTRY_DECISION_BLOCKED`（计数 0）。

⚠ 需要注意的显示口径：`/api/v3/human-managed` 与页面里的 **"新增风险门禁：已阻止"** 来自投影字段 `newEntryBlockedByCaps=true`（`humanManagedProjection.ts:49`，9 个 HUMAN_MANAGED ≥ cap 4，名义 $9,637 ≥ cap $2,130）。在 SHADOW 下它**只是报告**；一旦切 ENFORCE，同一个条件会经 `preAiExecutionEnvelope.ts:53` 变成**真实硬阻断**。见 J。

## H. HUMAN_MANAGED 是否保持"人工扛单、无自动亏损退出"—— **是**

- 投影 `policy`（`/api/v3/human-managed`）实测：`{humanHandoffMeansManualHold:true, automaticStopLoss:false, timeoutClose:false, panicClose:false, severityMayAutoExit:false}`；`items[].automationPermission` **9/9 为 false**
- `humanManagedProjection.ts:17` 注释与 `:38` 一致：severity 仅排序、永不授权退出；`allowedHumanActions=[HOLD,REPLACE_TP,REBUILD_TP,REDUCE,EMERGENCY_CLOSE]` 全部是**人工**动作
- 新端点 `router.ts:361-369` 只发布 `HUMAN_MANAGED_ACKNOWLEDGED{exchangeWrite:false, tpChanged:false}`
- 唯一改 `managementStatus` 的仍是 V3.9.4 的 `lossHandoff.ts:39`，且其事件强制断言 `tpRetained:true`（本轮 CRVUSDT 实例已观测）
- **本轮 HUMAN_MANAGED 持仓无任何自动退出**：唯一的持仓减少（WLDUSDT）是 TP 限价单成交；重启后事件流中不存在止损/timeout/panic 类事件
- HUMAN_MANAGED 相关的读取（`economicEntryFeasibility.ts:22`、`preAiExecutionEnvelope.ts:53`）只作用于**新 Entry 门禁**，永不触碰既有持仓

## I. Binance 429/418、request governor、Demo host、static egress

| 项 | pre | post |
|---|---|---|
| REST host | `demo-fapi.binance.com` | `demo-fapi.binance.com`（`deprecatedTestnetRestHost=false`、`failClosed=true`） |
| routeIdentity | `proxy-a087cc91667b` | `proxy-a087cc91667b`（未变 → 同一代理路径） |
| proxy | `socks5h://127.0.0.1:20081` | 同 |
| egress | `VERIFIED 172.104.186.174`（缓存于 03:35:00） | `UNVERIFIED`→（用**既有**探针 `POST /api/v3/settings/resources/proxy/binance-proxy/test`，即 `run-v394-local-rollout.ps1:77` 的同一条）→ **`VERIFIED 172.104.186.174` @09:50:25**，`transport HEALTHY latency 1314 ms` |
| http429 / http418 | 17 / 3 | **17 / 3（跨重启零新增）** |
| budgetStatus / trust | AVAILABLE / TRUSTED | AVAILABLE / TRUSTED |
| governor decisions | admitted 38776 / queued 38779 / blocked 3 / queueTimeout 3（累计） | 本实例 admitted 966 / queued 966 / **blocked 0 / queueTimeout 0** |
| 写边界 | lockedToTestnet=true, productionWrites=0 | lockedToTestnet=true, `testnetWrites=2`, **productionWrites=0**, `blockedProductionWriteAttempts=0` |
| 治理端点 | 200 | 200；`/`、`/human-managed`、8081、8084 全 200 |

注：`egressTruthByRoute` 是**进程内 Map**（`BinanceTransport.ts:27`），重启即清空，且没有开机自动出口探测 —— 因此"重启后 UNVERIFIED、直到有人打探针"是 **V3.9.4 也一样的既有性质**，不是 V3.9.5 回归（上一轮观察到的"03:35 后 5 小时未再验证"同源）。已列入 K-3 建议。

## J. 当前是否具备进入 V3.9.5 ENFORCE Canary 的条件 —— **不具备，需 ChatGPT 决策**

已具备：exact HEAD 绑定、本机 test/build 全绿、迁移语义与幂等已证、13→11 持仓与 TP 无损、SHADOW 不阻断已实证、HUMAN_MANAGED 无自动退出已实证、Testnet/egress/governor 未变、位级可回滚基线在手。

**阻塞 ENFORCE 的实质理由（按重要性）：**

1. **ENFORCE 一开就会立刻掐死所有新建仓。** 当前 9 个 HUMAN_MANAGED 持仓、名义 $9,637.25（cap 为 `maxHumanManagedPositions=4`、`20% × equity = $2,130.91`）。SHADOW 下这已是 `wouldBlock`，`blockers` 里赫然有 `HUMAN_MANAGED_EXPOSURE_LIMIT`；ENFORCE 后经 `preAiExecutionEnvelope.ts:53` 变成硬阻断 → Canary 将**没有入场样本**，验收会变成空转。要么先由人工消化 HUMAN_MANAGED 账本，要么显式调整这两项 caps（属参数决策，必须人来定）。
2. **只有 1 条自然 admission 评估样本**（`passed=false`，blockers 含 `TP_REACH_PROBABILITY_UNMET`）。ENFORCE 需要知道 wouldBlock 的**分布**（多少比例、被哪个 blocker 卡住），否则等于盲切。建议先跑足够长的 SHADOW 窗口积累 `ENTRY_ECONOMIC_ADMISSION_EVALUATED` 样本 + 计划 §4 要求的历史回放。
3. **8/12 现存 TP 在 $1 下限之下**（D-2）：ENFORCE 之后任何一次 TP 修复都会把目标价推到更远，等于对既有仓位改变退出几何。需要 ChatGPT 明确"存量仓位是否按新下限重做 TP"的策略，再动 ENFORCE。
4. SHADOW 期 `1.2% legacy 距离门槛`仍生效，V3.9.5 的经济型 TP 优势尚未被真实验证过 —— 这正是 Canary 要测的东西，但顺序上应先有 SHADOW 证据分布。

建议给 ChatGPT 的两个互斥选项：**(a)** 保持 SHADOW 观察足够长以积累 admission 分布（并把 HUMAN_MANAGED 账本交给人工消化），**(b)** 若急于验证 ENFORCE，则先由人工处置 HUMAN_MANAGED 至 caps 之内、并由人工明确新的 `maxHumanManagedPositions/NotionalPct`，再单符号小额 ENFORCE。两者都不应 silent clamp quantity。

## K. 所有异常/风险（含对本轮与上一轮结论的更正）

1. **[已更正·重要]** 上一轮 I-2"运行构建 `3.9.4-dde660c` 无法绑定源码、仓库缺该 commit"**结论错误**：`buildId` 后缀是 dist 内容哈希；现场重算 `dde660cf…`/`1ff3b6d4…` 与实例记录完全一致，构建一直可追溯到 `d013d33`。教训：不要把 20 位十六进制前缀当 commit 短 SHA 去 `cat-file`。
2. **[事实·非缺陷]** `settingsVersion 177 → 178`：启动期合法 revision bump（既有行为），非降级。
3. **[建议·中]** 重启后 egress 停在 `UNVERIFIED` 直到人工探针：`egressTruthByRoute` 仅存进程内、无开机自检、`lastVerifiedAt` 在上一实例停留 5 小时未刷新 → 长期验收里"252/252 VERIFIED"实为读同一缓存。建议开机即跑一次探针并周期性复核（属 V3.9.6 级改进，本轮未改代码）。
4. **[观察·中]** `driftCount=15` 且 `correctedDifferenceCount=15` 出现在启动首扫（历史 13→15 个 UNKNOWN 的重新核验），`unresolvedDriftCount/activeRiskUnresolvedCount/verifiedOrderFactMismatchCount` 全程 0，`p0 passed=true`。UNKNOWN 总量**未因重启增加**（15→15）。
5. **[观察·中]** 自然 BTCUSDT 建仓在提交环节出现 `ENTRY_ORDER_SUBMISSION_UNKNOWN`，随后进入 durable wait 并 `ENTRY_EXECUTION_WAIT_TERMINATED reason=RESERVATION_INVALID`。这正是上一轮记的 UNKNOWN 生成路径，V3.9.4 同样存在；说明"提交结果不确定 → 验证 → 释放"的链路在 V3.9.5 上行为一致，但也说明**这条链路产生 UNKNOWN 的速率**仍应设上限/告警。
6. **[风险·高，见 J-1]** `humanManagedAdmissionCaps`（4 个 / 20% equity）在当前账本下已判定超限：SHADOW 仅报告，**ENFORCE 即硬阻断新建仓**。
7. **[风险·中，见 D-2]** `$1` 净利率下限使 8/12 存量 TP 处于"下次修复即被推远"状态；回滚 V3.9.4 也不会自动回到 0.01（B-3）。
8. **[口径·中]** `minNetProfitUsd` 的 `[1,20]` clamp 是**每次启动无条件执行**（`settingsStore.ts:95`），不只是历史值迁移；`0.5→1`、`25→20` 都会在重启时被静默改写（保存路径则直接 Zod 抛错）。人工设值时要知道这点。
9. **[非缺陷]** V3.9.4 时代即有的 `observationTrust=INCONSISTENT`、`laneStats` 窗口化计数、`pool=POOL_SUPPLY_SHORTAGE`(16/20，`governanceBlockedSymbols=23`)、primary `BUSY/ANALYZING` 本轮继续存在；按要求**不作为回滚依据**，仅记录。
10. **[小·观察]** `marketSnapshots` 启动初期计数偏低（1→随时间增长），属预热，非异常。

### 自动回滚条件核对（全部未触发）

buildId/源码绑定 ✓ 成功（`3.9.5-f9367614…` 与预测逐字符一致）；Account/WS/Reconciliation ✓ 全部恢复 READY/LIVE；持仓 ✓ 除 1 个 TP 自然止盈外全部识别、数量事实与 projection 一致；TP ✓ 无异常 cancel/丢失、orderId 与价格逐项未变；HUMAN_MANAGED ✓ 无未授权退出；SHADOW ✓ 未阻断 Entry（已实证）；quantity ✓ 无 silent clamp（`audit-v394-entry-authorization.mjs`：`violations_total=0, entries=27, aiRuns=47, policyLeakSamples=[]`）；Binance host/egress/governance ✓ 未变；429/418 ✓ 零新增；Settings ✓ 未覆盖用户关键参数。**→ 无需回滚，V3.9.4 位级基线保持待命。**

### 本轮未做的事（边界）

未切 ENFORCE；未人为创建任何测试单/Canary 单（唯一的 Entry 是 Primary 自然决策）；未停 8081/8084/代理；未改 Settings（迁移由引擎自身完成）；未动 42 个 untracked 项；未删任何证据/DB/日志；未安装 autostart/守护；未修改任何已验收架构代码（AI 自主 side/quantityUnits/acceptablePriceRange、side-neutral PreAiEnvelope、Maker Entry、quantity 不 clamp、HUMAN_MANAGED 人工扛单、唯一退出链、Testnet 治理与固定出口）。

### 证据清单

`D:\MITS-WORKTREES\`：`v395/`、`v394-rollback/`、`backup-live-dist/20260919-094000/`、`v395-verify.log`、`v394-build.log`、`dryrun/{migration-dry-run.json, tp-dry-run.json, pre-restart-snapshot.json, post-restart-snapshot.json, live-*.json, *.mjs, *.py, install-dist.ps1, backup-live-dist.ps1}`。上一轮 V3.9.4 终止证据仍在 `D:\MITS\data\rollout\v394-stage7-9\`。

---

## 补充 L. t+12.6 min 的 SHADOW 观察增量（报告主体写完后继续积累的真实样本）

稳态复核（09:59，实例 f38e3dec，运行 12.6 分钟）：`ready=true`、`buildId 3.9.5-f93676140a441bc0199c`、WS `LIVE` 且 `reconnects=0 gaps=0`、DB `HEALTHY`、11 持仓全部 `PROTECTED`、TP `READY 11/11`、`unresolvedDriftCount=0`、`activeRiskUnresolvedCount=0`、`historicalUnknownCount=15`（未增）、`429=17 / 418=3`（未增）、`egress VERIFIED 172.104.186.174`、`settingsVersion=178`、`admissionMode=SHADOW`。

**5 条真实 SHADOW 经济门禁评估（全部自然产生）：**

| # | expectedNetProfit | requiredNetProfit | blockers |
|---|---:|---:|---|
| 1 | 1.7544 | 1 | TP_REACH_PROBABILITY_UNMET, HUMAN_MANAGED_EXPOSURE_LIMIT |
| 2 | 2.0226 | 1 | TP_REACH_PROBABILITY_UNMET, HUMAN_MANAGED_EXPOSURE_LIMIT |
| 3 | 1.8910 | 1 | HUMAN_MANAGED_EXPOSURE_LIMIT |
| 4 | 1.9501 | 1 | TP_REACH_PROBABILITY_UNMET, HUMAN_MANAGED_EXPOSURE_LIMIT |
| 5 | 1.8696 | 1 | TP_HISTORICAL_REACHABILITY_UNMET, TP_REACH_PROBABILITY_UNMET, HUMAN_MANAGED_EXPOSURE_LIMIT |

`passed=false / wouldBlock=true` 5/5，但：

1. **`$1` 净利率下限不是阻断项**：5 条的 `expectedNetProfit` 全在 1.75–2.02，均 ≥ 1；阻断项 100% 是 **`HUMAN_MANAGED_EXPOSURE_LIMIT`（5/5）** 与 **可达性类 blocker（4/5 概率未达、1/5 历史可达未达）**。
2. **wouldBlock 之后建仓继续发生**：紧随其后有 4 个 `ENTRY_INTENT_CREATED`（BTCUSDT / SOLUSDT / ZECUSDT / BNBUSDT），`side=LONG`、`idealPrice`、`acceptablePriceRange` 均由 Primary 自主给出（例：BNBUSDT 763.5，区间 763.2–763.8）→ G 段"SHADOW 只观察不阻断"从 1 例升级为 5 评估 + 4 入场的连续证据。
3. 期间 3 次拦截全部来自**既有非经济门禁**：`MARKET_QUALITY_NOT_ADMITTED`(ZECUSDT)、`REJECT_DIRECTION_EXPOSURE`(XRPUSDC ×2)；事件中**没有任何**一条以 economics 或 human-managed 为由拒绝下单。

**对 J 的直接含义（加强版）**：以当前账本，ENFORCE 一旦打开会拒掉 **5/5** 的候选入场（阻断因子首位是 HUMAN_MANAGED 上限，与 economics 无关），并且其中 4/5 还会因可达性不达标被拒。因此 ENFORCE Canary 在人工处置 HUMAN_MANAGED 账本、或明确调整 `maxHumanManagedPositions/maxHumanManagedNotionalPctEquity` 之前启动，几乎必然得到"零入场"的空转结果。

