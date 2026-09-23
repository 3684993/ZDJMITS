# V3.9.6 部署 e890ed5（容量首因修复）并完成线上 readback

计划：`docs/plans/v396/CODEX-V396-DEPLOY-E890ED5-NOW-20260923.md`。2026-09-23，北京时间。
状态：**部署完成，全部 readback 通过，无新 P0/P1**；运行状态继续为 `V396_TESTNET_ACTIVE_ANALYSIS_ONLY`，且**当前运行实例已部署 e890ed5**。

## 1. 身份与生命周期

- fetch 后 `merge --ff-only` 到 `d2cea4a`；`git diff e890ed5..HEAD` 只有该授权计划文档一个文件，产品源码逐字节等于已全绿的 `e890ed5`（无未验收产品变更被偷偷带入）。
- 停止一次：`scripts/stop-zdj-lan.ps1` 退出 0，`ZDJ-MITS stopped; port 8080 is free`；旧实例 PID 26784 / `buildId=3.9.6-2fb37e445af4d3d351da` 记录 `CHILD_EXITED exitCode=-1`（脚本自身的 `Stop-Process -Force`，非崩溃）。停止前三重身份证明通过（instance 文件 PID+端口、`node.exe`、命令行含 `dist/main.js`）。
- 启动一次：`scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` 退出 0 → 新实例 **PID 33432**，`instanceId=8835e95d-0018-4665-a89c-47f17f09165f`，`startedAt=1790158781504`（18:19:41），`startReason=MANUAL_START`，`hostPid=44524`，`launchId=f38b0eb3ef4e494dbc12553061ecebfc`。
- 无 watchdog、无 supervisor、无计划任务、无自启动、无热重载、无第二次停启、无失败重试。

## 2. 正式构建与产物身份

`npm run verify:deps` = 0、`npm run build -w @zdj/engine` = 0、`npm run build -w @zdj/dashboard` = 0，产物真实写入 `apps/engine/dist` 与 `apps/dashboard/dist`（本轮按授权部署到线上路径，未改任何源码、阈值、Settings 或 DB）。

用运行期同一 `contentTreeHash` 预先算得 `artifactHash=50d14dbd22d1ea5ed7d299b9700e53efd234451fe242cc325322a36e0b8cc05d`、`sourceHash=4c628c6e5bfb96d1dd80539765b2d2f442032f33b8aaad50955608fd4f53e4fd`，与新进程自己写入的 `data/runtime/engine-instance.json` 逐字相同 → 新实例确为本轮新构建，非旧残留。抽查产物内容：`riskReadiness.js`/`entryCoordinator.js` 含 `exhaustedForNewRisk`，dashboard `OverviewView` chunk 含「首个饱和维度」「仍有空间」。

## 3. 权限与写边界

`/health` READY、`database.integrity=true / HEALTHY`、`marketStream=LIVE`、`privateData=READY`；`settingsVersion=190` 未变；`environment=TESTNET`、`executionMode=READ_ONLY`、`aiExitAuthority=SHADOW`、`tradeEconomics.admissionMode=SHADOW`、`maxGrossExposurePct=1`、`maxDirectionExposurePct=0.5`、`maxPositions=50` 与切换前逐值一致（浏览器只读核对：设置页两栏显示 `100% / 50%`，未点击保存）。

写边界：`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`、`lastWritePath=null`、`lockedToTestnet=true`、`blockedProductionWriteAttempts=0`。本轮未增删改任何交易所委托，未授权有限写。

## 4. e890ed5 新语义线上 readback（关键项）

`/api/v3/pipeline.capacityVisibility` 的键为 `slots, gross, direction, firstBlocker, blockingDimensions, exhaustedReason, exhaustedForNewRisk, evaluatedAt`。当时真实账户事实（`pipeline-capacity-readback-live.json` 与浏览器同刻采样）：

- 槽位 `14 / 50`（`inFlight 0 / reserved 0`）；Gross `$9,752.45 / $10,454.56`，剩余 `$702.11`，已用 93.3%；LONG 剩余 `$702.11`；SHORT 剩余 `$0.00`。
- `firstBlocker=DIRECTION_SHORT`、`blockingDimensions=['DIRECTION_SHORT']`、**`exhaustedReason=null`、`exhaustedForNewRisk=false`**。
- 同一时刻 `eligibility.count=3`、`capital.executableCandidateCount=3`：单侧饱和没有被说成用尽，驾驶舱主解释为 `ENTRY_BLOCKED` 而不是 `CAPACITY_BLOCKED`，页面两行把「首个饱和维度」与「新增风险额度（仍有空间 · 各自剩余额度）」分开展示，逐字数字与 API 相同（10 项 verbatim 断言全真）。
- 派发首因（连续 9 次采样）：有候选且 `executableCandidateCount>0` 时 Primary idle 为 `WAITING_NEW_FACTS` / 文案「等待新的候选事实」，`exec=0` 且尚无路由时为 `WAITING_EXECUTION_CAPACITY` / 文案「当前无资本可执行路由」；全程未再出现「新增风险额度已用尽」。**部署轮那个 P1 在线上已被证伪。**
- 未评估周期不声称用尽：由 `portfolioCapacityVisibility` 的 `evaluatedAt<=0 → NOT_EVALUATED / exhaustedForNewRisk=false` 分支与离线红测共同锁住（线上是已评估周期，`evaluatedAt` 新鲜）。

## 5. AI 是否继续分析

是。新实例上 `brain/runs` 15 条、14 条 COMPLETED，含 `PRIMARY_BRAIN DOGEUSDT COMPLETED decision=PLACE_SHORT tokens 19248/821` 与 `SCOUT COMPLETED`，采样时 `reason=AI_RESOURCE_BUSY`、`active=1`、`正在处理 DOGEUSDT/UNIUSDT`。模型的 PLACE 被 ANALYSIS_ONLY 路径接住：`pendingEntries.count=0`、无 reservation/intent/order、写计数为 0。`analysis.lastAttemptAt=18:34:45`、`lastSuccessAt=18:26:17`。出口闸本轮为 `VERIFIED`（`lastVerifiedAt=18:34:48`，`lastError=null`），按计划第 6 节只读记录，未改该行为。

## 6. AI Run UX 与 Dashboard 交互线上核验

`dashboard-interaction-readback.json` + `dashboard-ai-run-drawer-top-close.png` + `dashboard-overview-capacity-card.png`。真实浏览器（新 bundle `index-ft4LwyYy.js` / `BrainView-CWTkPPLp.js`）DOM 与 computed style 断言：

| 项 | 结果 |
|---|---|
| 顶部 sticky 关闭在加载态即可见并可关闭 | PASS（`position:sticky`、`top:0px`、头部是滚动容器第一个子元素） |
| Escape 关闭 | PASS |
| 焦点移出详情关闭 | PASS |
| 内部焦点迁移 / `relatedTarget=null` 不误关 | PASS |
| 底部关闭保留 | PASS（抽屉内共 2 个「关闭」） |
| 关闭时有在飞详情请求，迟到响应不重开 | PASS（把 `/api/v3/brain/runs/<id>` 的响应延迟 2.5s，先关闭再等 3s，抽屉未重现） |
| 关闭后焦点回到触发按钮 | PASS |

`insufficientUiEvidence` 为空，无需要降格为观察项的交互。

## 7. TP / ownership / UNKNOWN / fatal

持仓 14 个、`symbol/side` 与 14 个 `cycleId` 与切换前逐字一致，全部 `PROTECTED + HUMAN_MANAGED`；止盈 `required=14 / protected=14`，`missing/orphan/duplicate/qtyMismatch/wrongSide/unverified` 全 0。所有权账本只读核验：`user_version=1`、27 行 / 27 周期、无双行、`AI_ACTIVE=0`、状态 `HUMAN_MANAGED 25 + HANDOFF_PENDING 2`、`quantity_claims=0`、outbox 未投递 0；唯一一条 mandate 是 14:12:15 留下的 `XMRUSDT LONG` guardian 记录，早于 17:15 与 18:19 两次启动，非本轮产生。`/diagnostics/p0-entry-integrity.passed=true`，`activeClaims=0`、`activeUnknownClaims=0`，对账 `drift=0`。stderr/stdout 无 fatal/uncaught/unhandled 行（只有 SQLite 实验性警告），`persistence=HEALTHY`。

## 8. 结论

9 项汇报口径全部通过，无新 P0/P1，不需要回滚，也没有触发计划第 7 节任何中止条件。`e890ed5` 的容量新语义已在真实实例上按预期工作：单侧饱和不再被误报为“新增风险额度已用尽”，也不会把仍有可执行候选的静默说成容量阻断。仍未签发的事项不变：PortfolioRisk profile 的人工审批、`ENFORCE`、有限 Testnet 写回合，以及绑定当前实例（18:19:41 起算）的完整 24h soak。
