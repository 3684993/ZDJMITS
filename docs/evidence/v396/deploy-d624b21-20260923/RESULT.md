# V3.9.6 d624b21 立即部署与一次受控重启（结果：部署成功，验收因 P1 停止）

计划：`docs/plans/v396/CODEX-V396-DEPLOY-RESTART-D624B21-20260923.md`。2026-09-23，北京时间。
状态：**部署与只读 readback 完成，验收未签发**。新实例健康、写边界完好，但线上暴露一个由 `d624b21` 引入的 P1 语义缺陷（容量首因过度声称），按计划第 2 节停止线立即停止后续验收、保留现场、不重启取绿、不边修边上线。

## 1. 身份与授权动作

- 仓库：fetch 后 `merge --ff-only` 到 `4a9330f`（docs-only 授权提交），历史包含产品源码基线 `d624b21`；工作树在构建前 clean，PR #9 未触碰。
- 生命周期动作恰好两次：1 次停止 + 1 次启动，均用计划指定脚本；未安装 watchdog/supervisor/计划任务/自启动，无第二次重启。
- 停止：`scripts/stop-zdj-lan.ps1` 退出 0，`ZDJ-MITS stopped; port 8080 is free`；启动器记录 `CHILD_EXITED exitCode=-1, pid=31776`（该脚本按设计 `Stop-Process -Force`，不是崩溃）。停止前已三重证明身份（instance 文件 PID+端口、`node.exe`、命令行含 `dist/main.js`）。
- 启动：`scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`（防火墙规则 `ZDJ-MITS Engine 8080` 已存在且 Enabled=True，故不做多余主机安全写）退出 0，`PID=26784 HOST_PID=8592 LAUNCH_ID=20536eae751645aeb7fde2855e0e3a20`。8080 释放与旧 PID 退出现场核验通过后才启动。
- 新实例：`instanceId=2b534955-4bce-4c0f-bb28-a96a289dfaba`，`pid=26784`，`startedAt=1790154943580`（17:15:43），`startReason=MANUAL_START`，READY 用时约 91 秒（等待行情与私有数据暖机），`/health.status=READY`。

## 2. 构建身份（本轮把上一轮的 provenance 缺口补上）

用仓库正式命令生成本机实际产物，退出码真实读取：`npm run verify:deps`=0、`npm run build -w @zdj/engine`=0、`npm run build -w @zdj/dashboard`=0。

用运行期同一函数 `contentTreeHash(['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist'])` 双向核对：

- 部署前重算得 `17b70933748fb230d5b7…`，与旧实例记录完全一致 → 旧实例身份被证实（勘误上一轮的“部分佐证”判断：那次比对针对的是更早的实例与旧的字段口径）。
- 构建后预期 `2fb37e445af4d3d351da89d17899c9597dd3ab2b180b08896c8c5865130f84c8` / sourceHash `501d95e2…`；新实例自行写入的 `engine-instance.json` 与之逐字相同 → `buildId=3.9.6-2fb37e445af4d3d351da` 即本轮新构建，非旧残留。
- 产物内容抽查：`apps/engine/dist` 含 `capacityVisibility`/`portfolioCapacityVisibility`；dashboard chunk 含“组合暴露上限”“首个容量阻断”`data-caps-first-explanation`、`audit-drawer-head`。
- 覆盖前旧产物已备份到 `D:/MITS-backups/deploy-d624b21-20260923/pre-dist`。

## 3. 权限与写边界（未变、未越界）

`settingsVersion=190` 不变；`environment=TESTNET`、`executionMode=READ_ONLY`、`aiExitAuthority=SHADOW`、`tradeEconomics.admissionMode=SHADOW`、`maxGrossExposurePct=1`、`maxDirectionExposurePct=0.5`、`maxPositions=50` 全部与切换前逐值相同（只读核对，未保存任何设置）。

新实例 `productionWriteBoundary`：`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`、`lastWritePath=null`；`blockedProductionWriteAttempts=0` 是新实例自增计数（旧实例累计 9，属历史字段，两者不可混用）。未发出任何交易所写请求。

## 4. d624b21 运行 readback（通过）

`/api/v3/pipeline` 真实出现 `capacityVisibility`，取启动后 4 个样本：

| 样本 | 槽位 | Gross 当前/上限（剩余） | LONG 剩余 | SHORT 剩余 | firstBlocker |
|---|---|---|---|---|---|
| t0 | 14/50 | $9,776.52 / $10,453.74（$677.21） | $677.21 | $0.00 | DIRECTION_SHORT |
| t1 | 14/50 | $9,757.18 / $10,465.88（$708.70） | $708.70 | $0.00 | DIRECTION_SHORT |
| t2 | 14/50 | $9,757.18 / $10,470.10（$712.92） | $712.92 | $0.00 | DIRECTION_SHORT |
| t3 | 14/50 | $9,748.00 / $10,468.21（$720.21） | $720.21 | $0.00 | DIRECTION_SHORT |

- `slots` 与 `entryCapacity()` 同源（切换前后 `capacity` 均为 `{positions:14,inFlight:0,reserved:0,used:14,max:50}`）；gross/LONG/SHORT 的当前值、上限、剩余全部可读；`firstBlocker` 取值始终落在允许枚举内。
- 真实数据正面验证了本轮要修的表达问题：槽位 14/50 只占 28%，但 SHORT 方向已无余量 → “槽位未满”不等于“仍有新增风险额度”。
- AI 在 READ_ONLY 下确实继续分析：新实例 `brain/runs` 共 16 条、16 条 COMPLETED，最后一条为 17:30:28 的 `PRIMARY_BRAIN DASHUSDT`；其中含 `PRIMARY_BRAIN UNIUSDT COMPLETED decision=PLACE_SHORT` 与 `SCOUT COMPLETED tokens 3716/355`。该次 PLACE 被只读分析路径接住，未产生 reservation/intent/order（`pendingEntries.count=0`，写计数为 0）。`analysis.lastAttemptAt=17:30:10`、`lastSuccessAt=17:31:28`。
- 17:31:28 之后新派发暂停，原因是出口复验失败触发既有 R16 双层 fail-closed（见第 8 节），与本轮代码无关，写计数仍为 0。

## 5. 风险资产连续性（通过）

- 持仓：切换前后同为 14 个、`symbol/side` 集合与 `cycleId` 集合逐字一致，名义值差仅来自标记价漂移（最大 +$13.60）。
- 止盈：`required=14 / protected=14`，`missing/orphan/duplicate/qtyMismatch/wrongSide/unverified` 全 0，切换前后一致；本轮未新增、撤销或替换任何交易所委托。
- 所有权与未知风险：`/diagnostics/p0-entry-integrity.passed=true`，`crossSymbolOrderMismatch=0`、`activeRemoteEntryWithNewPrimary=0`、`unverifiedRemoteTerminalReleasedOccupancy=0`、`BrainRunMisattribution=0`、`verifiedOrderFactMismatch=0`，`durableClaims.activeClaims=0`、`activeUnknownClaims=0`；对账 `unresolvedDriftCount=0`。
- 稳定性：`database.integrity=true / HEALTHY`，`marketStream.state=LIVE`，`privateData=READY`，stderr 仅 SQLite ExperimentalWarning，无 fatal/uncaught/unhandled 行（`post-deploy-log-scan.json`）。
- 占用连续性：本轮 pre-deploy 快照与新实例的 `capacity` 完全相同（`{positions:14,inFlight:0,reserved:0,used:14,max:50}`）。更早的 16:30 只读抽样曾出现 `inFlight=1 / used=15` 与 `pendingEntries.count=1`（只读切换前遗留的在途行），部署后为 0；该变化发生在本次授权窗口之前，本轮未做任何清理或写操作。

## 6. Dashboard 部署可见性（部分完成，验收已停）

- 设置 → 策略与执行确实渲染“组合暴露上限”：两个输入 `value=100 / 50`，`min=0.01 max=2000 step=1`，档位下拉仍为 `CUSTOM`（未被本轮改动），说明文案逐字可见。未点击保存。
- 驾驶舱确实渲染容量卡与主解释卡，数字与同一时刻 pipeline 一致（槽位 14/50、Gross $9,748.00 / $10,468.21 剩余 $720.21、已用 93.1%、LONG 剩余 $720.21、SHORT 剩余 $0.00、首因 DIRECTION_SHORT）。
- AI Run 详情抽屉的交互核验（顶部 sticky 关闭、Escape、焦点移出、迟到响应不重开）在 P1 停止点之后未继续执行；离线 6 例已覆盖，`NOT_OBSERVED_ON_LIVE` 记录在案。

## 7. P1：容量首因过度声称（本轮停止验收的原因）

`finding-p1-capacity-first-cause-overclaim.json`。要点：`entryCoordinator.processPool()` 用 `OCCUPIED_CAPACITY_BLOCKERS.includes(firstBlocker)` 判定“容量挡住”，但 `firstBlocker` 只代表第一个饱和维度；LONG 与 SHORT 相互独立。线上 t1/t2 实际状态是 SHORT 为 $0.00 而 Gross 与 LONG 各仍有 $708.70/$712.92 余量、资本预检有 1/3 个可执行候选，页面却显示 `WAITING_EXECUTION_CAPACITY` 且文案写“新增风险额度已用尽”。同一时刻驾驶舱卡片（要求 `executableCandidateCount===0`）显示的是 `ENTRY_BLOCKED`，两个界面对同一事实结论相反。

危害定级理由：它会向操作员伪造“组合已无额度”的压力，而计划第 3 节与既有停止线恰恰禁止为提高额度以外的目的放宽阈值；真实阻断层是单候选可运行性，不是组合预算。

离线测试为何没抓到：红测覆盖了 gross 满、单方向满的投影值和 gross 满时的文案，缺“一侧满 + 另一侧有余量 + 存在资本可执行候选”时对 idle 文案的断言。

按授权边界处理：未改源码、未改阈值、未改 Settings/DB、未再次停启。下一轮需离线红→绿修谓词与文案，再单独申请一次部署。

## 8. 现场新增观测：出口复验失败使新派发暂停（非本轮引入）

17:31:28 之后 `analysis.lastBlockedReason` 持续为 `BINANCE_EGRESS_UNAVAILABLE`：`/diagnostics/binance-governance` 显示 `egress={routeIdentity:proxy-a087cc91667b, expectedEgressIp:172.104.186.174, lastVerifiedEgressIp:172.104.186.174, lastVerifiedAt:17:15:49, status:"UNAVAILABLE", lastError:"The operation was aborted"}`。即启动时出口证明成功过，之后复验请求被中止，R16 的写前双层 fail-closed 因此停止新 Entry 派发（行情、私有同步、持仓/TP 维护继续，`privateSync.lastSuccessAt=17:37:45`，`consecutiveFailures=0`）。

这是既有安全闸按设计工作，不是本轮部署造成的回归；证据见 `post-deploy-egress-gate-state.json` 与 `finding-obs-egress-gate-couples-analysis-dispatch.json`。到本轮观察结束（17:43:46 仍有 tick，但 `lastAttemptAt` 停在 17:30:10）该状态持续约 28 分钟，期间行情、私有同步、TP 与对账正常（`driftCount=0`、`protected=14/14`）。它同时暴露一处既有耦合值得单独裁决：`processPool()` 开头的写侧出口闸一旦命中就整体 return，因此在 ANALYSIS_ONLY 下也停掉了分析派发——这与上一轮“分析链与写许可解耦”的意图不完全一致。本轮未重启、未改代理或 Settings、也未尝试人工验证出口；是否解耦由下一轮离线红→绿决定。

## 9. 遗留观测（P3，不作结论）

一次浏览器读取出现句子“无可执行容量：当前没有新的风险额度；持仓槽位与新增风险额度是两条独立限制。”该句在任一提交、本轮新旧 dist、备份产物和持久化表检索中均不存在，随后同一页面渲染正常。评估为浏览器缓存/页面残留类观测，不构成运行事实，保留待复现。

## 10. 结论与状态

- 部署事实成立：运行实例已切换为 `buildId=3.9.6-2fb37e445af4d3d351da`（源码基线 `d624b21`），TESTNET + READ_ONLY + SHADOW，`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`，持仓/TP/ownership/UNKNOWN 与切换前逐值一致；AI 在只读下确实完成过 16 次 run（17:16–17:31，含一次 PRIMARY `PLACE_SHORT` 被写锁接住），17:31 之后新派发因第 8 节的出口复验失败按既有 fail-closed 暂停。
- 验收状态：因第 7 节 P1 未完成，**不签发** `ACCEPTED`，也不按“全部通过”表述；计划第 6 节的可写条件不成立。项目运行状态仍为 `V396_TESTNET_ACTIVE_ANALYSIS_ONLY`，并注明“已部署 d624b21，存在 1 个待修 P1（容量首因文案）”。
- 本轮不签发 ENFORCE、有限 Testnet 写或 24h soak 完成；24h 连续性锚点仍为当前实例启动时刻 17:15:43，且需 P1 修完后重新绑定。
