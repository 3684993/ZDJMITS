# V3.9.6 立即部署 e890ed5 最终修补（2026-09-23）

用户已再次明确授权：不再追加部署前确认，立即把当前 convergence 最新全绿 HEAD `e890ed572a7f11fd46e240639089d6a1dbd27886` 部署到当前 Testnet 主实例。上一份 `CODEX-V396-DEPLOY-RESTART-D624B21-20260923.md` 的生命周期授权在本文件中被更新：部署目标改为 e890ed5；只要没有新的 P0/P1，不得因为又发现可讨论的 P2、设计改进、观察项或未授权功能而停下来再次询问用户是否部署。

## 1. 权威身份

- 分支：`codex/v396-final-convergence-20260922`
- 部署目标源码：`e890ed572a7f11fd46e240639089d6a1dbd27886`
- 该提交已离线全绿：Engine 153 files / 1168 tests、Dashboard 12 / 40、core 46、typecheck/build/verify:deps/verify:scripts/S00/storage coverage/git diff --check 均 exit 0。
- 当前线上仍是旧构建 `3.9.6-2fb37e445af4d3d351da`；它包含已知 P1 文案/容量判断缺陷，不能再把“继续观察旧构建”当成完成。

## 2. 本次授权的动作

本轮直接连续执行到底：

1. fetch 并 `merge --ff-only` 到 convergence 最新 HEAD；若 HEAD 在执行前只增加 docs/evidence 提交而产品源码仍包含 e890ed5，可继续；若出现新的产品源码提交，必须先确认它是否已经全绿且不扩大权限，否则部署 e890ed5 对应产品源码，不得偷偷带入未验收产品变更。
2. 记录 pre-deploy 只读快照：旧 PID/buildId、settingsVersion、TESTNET/READ_ONLY/SHADOW、写计数、持仓/TP、ownership、inFlight、activeRiskUnresolved、egress 状态。
3. 使用正式构建流程生成实际 `apps/engine/dist` 与 `apps/dashboard/dist`。不得改源码、阈值、Settings、DB 来让构建通过。
4. 使用 `scripts/stop-zdj-lan.ps1` 受控停止当前已证明身份的 Engine 一次。
5. 确认 8080 释放、旧 PID 退出后，使用 `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START` 人工启动新构建一次；按现有环境需要可用 `-SkipFirewall`。
6. 不热重载、不自动重试、不 watchdog/autostart、不循环 stop/start。
7. 新实例 READY 后立刻做运行 readback 和 Dashboard 交互核验。

除新的 P0/P1、进程身份不匹配、schema/integrity 错误、fatal/crash、生产写边界异常外，不得中途停下向用户再次申请“是否部署”。

## 3. 权限边界保持不变

- 仅 TESTNET。
- `connections.executionMode=READ_ONLY`。
- `aiExitAuthority=SHADOW`，禁止 ENFORCE。
- 不修改 `maxGrossExposurePct`、`maxDirectionExposurePct`、`maxPositions`。
- 不配置尚未人工审批的 PortfolioRisk profile。
- `testnetWrites=0`、`productionWrites=0`；本轮不授权有限写。
- 不增删改任何交易所订单作为测试；现有 TP/保护只读核验。

## 4. e890ed5 线上验收

必须证明运行 payload 已是新语义：

- `/api/v3/pipeline.capacityVisibility` 存在。
- 同时有 `firstBlocker`、`blockingDimensions`、`exhaustedReason`、`exhaustedForNewRisk`。
- 单侧方向额度为 0、另一侧仍有空间时，`exhaustedForNewRisk=false`，不得显示“新增风险额度已用尽”，不得因此把可执行候选误报为 `WAITING_EXECUTION_CAPACITY`。
- 只有 `POSITION_CAPACITY` 真满、Gross 真无余量、或 LONG/SHORT 两侧同时无余量时，才可 `exhaustedForNewRisk=true`。
- 未评估周期不声称已用尽。
- 驾驶舱把“首个饱和维度”和“新增风险额度”分开展示，数字逐字来自 Engine 投影，不在 Vue 重算风险账。
- 若当前资本候选 >0，READ_ONLY 下 Primary 可继续分析；交易所写仍为 0。

## 5. AI Run UX 同轮线上核验

不再另开一轮：

- 打开“大脑 → AI Run 完整审计 → 详情”。
- 顶部 sticky 关闭按钮实际可见可用。
- Escape 可关闭。
- 焦点移出详情能关闭；内部焦点迁移不误关。
- 底部关闭仍保留。
- 关闭时有在飞详情请求，迟到响应不得重新打开抽屉。

如果自动化浏览器无法可靠证明某一交互，只把该项记为 `INSUFFICIENT_UI_EVIDENCE`；不得因此回滚或拒绝部署已全绿产品代码。

## 6. 出口闸与分析派发耦合

本轮不把“出口闸是否应与 ANALYSIS_ONLY 派发完全解耦”作为部署 blocker。当前 egress 已恢复 VERIFIED，且 e890ed5 未修改该行为。部署后只读记录其状态即可；若现场真实再次出现 egress 写侧闸导致 READ_ONLY 分析停止，把它登记为独立问题并保留证据，除非它构成新的 P0/P1，否则不得撤销本次部署。

## 7. 失败即停

以下才允许中止：

- 新构建无法构建/启动；
- `/health` 非 READY 且构成真实 P0/P1；
- SQLite/schema/integrity 异常；
- fatal/crash；
- TESTNET/READ_ONLY/SHADOW 边界漂移；
- 新实例出现任何生产写，或本轮出现未经授权 Testnet 写；
- 持仓/TP/ownership 出现新的未保护或冲突事实。

出现上述情况：停止后续动作、保留现场、不得自行第二次重启取绿。

## 8. 证据与最终汇报

建立 `docs/evidence/v396/deploy-e890ed5-20260923/`，保存 pre-deploy、正式 build、stop、start、health、identity、write-boundary、pipeline-capacity、AI dispatch、Dashboard/AI Run readback、TP/ownership/UNKNOWN/fatal 核验和 lifecycle 记录，并 ff push。

最终只汇报：

1. 最终 HEAD、实际 buildId、新 PID/instance、启动时间；
2. stop/start 是否各一次；
3. e890ed5 的 `capacityVisibility` 新字段和当时真实首因；
4. 单侧饱和是否已不再误报“已用尽”；
5. READ_ONLY 下 AI 是否继续分析；
6. AI Run 顶部关闭/Escape/焦点交互线上证据；
7. testnetWrites / productionWrites；
8. TP / ownership / UNKNOWN / fatal；
9. P0/P1 是否为 0。

全绿则状态继续为 `V396_TESTNET_ACTIVE_ANALYSIS_ONLY`，并明确“当前运行实例已部署 e890ed5”。无需再次向用户询问是否部署。