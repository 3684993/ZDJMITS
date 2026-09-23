# V3.9.6 立即部署/重启授权（2026-09-23）

用户已明确授权：立即把当前 convergence 中已经离线验收通过的 V3.9.6 修补构建部署到正在运行的 Testnet 主实例，并执行一次受控人工重启。该授权只覆盖本文件定义的生命周期动作与只读验收，不扩展任何交易权限。

## 1. 身份与范围

- 分支：`codex/v396-final-convergence-20260922`
- 必须包含已验收源码提交：`d624b21a2fd2455fbc78bee3f7a27c65d700b653`
- 当前已知运行实例：PID `31776`，V3.9.6，TESTNET，`READ_ONLY + aiExitAuthority=SHADOW`
- 当前实例尚未包含 `d624b21` 的 `capacityVisibility` / Gross UI / AI Run UX 修补。
- 本文件自身是 docs-only 授权提交；若构建身份绑定最新仓库 HEAD，报告必须同时记录“产品源码基线 d624b21”和“实际部署 HEAD/buildId”，不得混淆。

## 2. 明确授权的生命周期动作

仅授权一次完整切换：

1. fetch，`merge --ff-only` 到最新 convergence；确认历史包含 `d624b21`、工作树 clean、PR #9 不变。
2. 在停止 Engine 前记录只读 pre-deploy 快照：PID/buildId/settingsVersion/executionMode/aiExitAuthority/testnetWrites/productionWrites/持仓/TP/ownership/inFlight/activeRiskUnresolved。
3. 用仓库正式构建命令生成实际 `apps/engine/dist` 与 `apps/dashboard/dist`。不得改源码、阈值、Settings、DB 来让构建或运行通过。
4. 只允许用 `scripts/stop-zdj-lan.ps1` 停止当前已证明身份的 Engine 一次；身份不匹配则中止，不得 kill 未证明进程。
5. 确认 8080 已释放、旧 PID 已退出后，只允许用 `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START`（可按既有环境决定 `-SkipFirewall`）人工启动新构建一次。
6. 不安装/启用 watchdog、supervisor、任务计划、autostart；不得自动二次重启或热重载。

本授权不允许为了失败重试而循环 stop/start。新实例出现 P0/P1、身份错、schema 错、fatal、写边界异常时：立即停止后续验收，保留现场并报告；不要自行改阈值、改 DB 或再重启取绿。

## 3. 权限停止线

部署后必须保持：

- exchange environment = `TESTNET`
- `connections.executionMode = READ_ONLY`
- `aiExitAuthority = SHADOW`，禁止切 `ENFORCE`
- 不修改 `maxGrossExposurePct`、`maxDirectionExposurePct`、`maxPositions`
- 不配置/伪造尚未人工审批的 PortfolioRisk profile
- `productionWrites = 0`
- `testnetWrites = 0`；本轮只是部署+分析态验收，不授权有限 Testnet 写回合
- 不新增、撤销、替换任何真实交易所订单作为“测试”；已有 TP/保护只做只读核验

## 4. 启动后必须验收的运行事实

新实例 READY 后连续只读观察，至少覆盖多个刷新周期，并落盘证据：

### A. 构建/实例身份

- `/health` READY；PID 与旧实例不同；`startReason=MANUAL_START`。
- buildId/source/artifact identity 指向本次新构建，且源码包含 `d624b21`。
- fatal/crash/persistence error = 0；SQLite `integrity_check=ok`。

### B. 写边界

- TESTNET + READ_ONLY；`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`（如历史累计字段存在，区分本实例/历史累计）。
- 未产生新的 Entry/Exit 交易所写生命周期事件。

### C. d624b21 运行 readback

`/api/v3/pipeline` 必须真实出现 `capacityVisibility`，且：

- slots 与 `entryCapacity()` 同源；
- gross / LONG / SHORT 当前值、上限、剩余可读；
- `firstBlocker` 只能来自 `NOT_EVALUATED | POSITION_CAPACITY | GROSS | DIRECTION_LONG | DIRECTION_SHORT | NONE`；
- 结合当时真实账户事实验证：持仓槽位未满不能再被解释成“仍有 Gross 空间”；有候选但容量耗尽时不得显示 `WAITING_CANDIDATE`。
- 若自然候选存在，允许在 READ_ONLY 下继续 AI 分析；必须仍然无 reservation/intent/order exchange write。

### D. Dashboard

确认浏览器实际由新 dashboard dist 提供：

- 设置 → 策略与执行存在“组合暴露上限”，当前值只读核对即可，本轮禁止修改保存；100% 语义仍对应 ratio=1。
- 驾驶舱显示仓位槽位、Gross、LONG、SHORT 和首个容量阻断，数字与 pipeline readback 一致。
- 大脑 → AI Run 完整审计详情：顶部 sticky 关闭可见；Escape 可关闭；焦点移出关闭；底部关闭仍在；关闭后迟到请求不重开。

### E. 现有风险资产

- 当前真实持仓/TP 数量与切换前事实可解释一致；不得因部署产生新的未保护持仓。
- ownership 周期不产生双行；不得新增 `AI_ACTIVE`；claims/mandates 不应因本轮部署无故出现。
- 非终态 UNKNOWN/风险占用按真实交易所事实核验，禁止 UNKNOWN=>0。

## 5. 测试/资源纪律

`d624b21` 已有完整离线门禁证据，本轮为立即部署，不要无意义再跑整仓 1,000+ 测试浪费时间。停止前只需确认：

- 工作树 clean；
- HEAD 历史包含 `d624b21`；
- 上一轮 `docs/evidence/v396/gross-risk-ai-run-ux-patch-20260923/RESULT.md` 门禁证据存在；
- 正式 build 命令成功且退出码真实为 0。

若在部署过程中必须修改任何产品源码才能启动，则本授权立即失效：不要边修边上线，先报告 blocker。

## 6. 证据与最终汇报

建立 `docs/evidence/v396/deploy-d624b21-20260923/`，至少保存：pre-deploy、build、stop、start、health、write-boundary、pipeline-capacity、dashboard-readback、TP/ownership/UNKNOWN 核验与 lifecycle 记录。随后提交一份简洁报告并 ff push。

最终只汇报：

1. 最终 HEAD、实际 buildId、新 PID/instance、启动时间；
2. stop/start 各一次的真实结果；
3. `capacityVisibility` 线上 readback 与首因；
4. AI 是否在 READ_ONLY 下继续分析；
5. Dashboard 三项修补是否实际部署可见；
6. testnetWrites / productionWrites；
7. TP / ownership / UNKNOWN / fatal 状态；
8. P0/P1 是否为 0。

若上述全部通过，状态保持 `V396_TESTNET_ACTIVE_ANALYSIS_ONLY`，但可注明“运行实例已部署 d624b21 修补”。本轮不签发 ENFORCE、有限写或 24h soak 完成。
