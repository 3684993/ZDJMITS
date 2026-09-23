# V3.9.6：立即部署 e284a1a Anti-Waste 闸 + 只读核验 Pending Risk（2026-09-23）

用户已明确要求“继续下一步”。本轮不是继续讨论，也不是再次询问是否部署；本轮必须把已经离线全绿的 `e284a1a4a2571fffea2f84dec76d687533e67d7a` 正式部署到当前 Testnet 主实例，使“不可执行时禁止调用大模型”的 executionReadiness 闸在线生效，然后在新实例上完成只读 readback，并对已登记的 `PENDING_RISK_UNVERIFIED` 与 `VERIFIED_NO_ACTIVE_RISK` 矛盾做只读根因核验。

## 0. 执行原则

- 分支：`codex/v396-final-convergence-20260922`
- 产品源码必须包含并以 `e284a1a` 为已验收产品基线；本授权文档之后若只有 docs/evidence/report 变化，不得把它误认为未验收产品变化。
- fetch 后只允许 `merge --ff-only`；禁止 rebase/squash/force；PR #9 不得触碰。
- 除非出现新的 P0/P1、身份不匹配、schema/fatal/DB integrity/write-boundary 异常，否则不得中途停下来询问用户“是否部署”。
- 本轮目标是**停止无效模型消耗**，不是开放交易写权限。

## 1. 明确授权的生命周期动作

仅授权一次完整切换：

1. 只读记录当前实例身份、buildId、PID、settingsVersion、executionMode、write boundary、持仓/TP/ownership、当前 Primary/Scout 最近 30 分钟调用计数。
2. 正式构建 `apps/engine/dist` 与 `apps/dashboard/dist`，必须真实包含 `e284a1a` 的 `executionReadiness`、profile status 投影和 Dashboard readback；不得修改源码或 Settings 以让构建通过。
3. 使用仓库正式停止脚本对**已证明身份**的当前 Engine 停止一次；不得 kill 身份不明进程。
4. 确认 8080 释放、旧 PID 退出后，使用正式人工启动脚本启动一次，`StartReason=MANUAL_START`；可按现有环境使用 `-SkipFirewall`。
5. 禁止热重载、watchdog、supervisor、autostart、计划任务、自动二次重启和失败重试循环。

若必须修改产品源码才能启动，本授权立即停止在现场报告，不得边修边再次部署。

## 2. 本轮绝对禁止项

本轮不得：

- 修改任何 Settings；尤其不得修改 `executionMode`、`riskGovernance.portfolioRisk`、`maxGrossExposurePct`、`maxDirectionExposurePct`、`maxPositions`、private freshness 60s、REST timeout、reachability、UNKNOWN 规则。
- 切 `TESTNET_ENABLED`；必须保持 `READ_ONLY`。
- 切 `aiExitAuthority=ENFORCE`；保持现状（SHADOW/OFF 以线上事实为准）。
- 创建、撤销、替换任何真实 Testnet/Production 交易所订单作为测试。
- 伪造 PortfolioRisk profile、margin tier、correlation/scenario 或 cash-flow 事实。
- 为了“看到模型运行”绕过 anti-waste 闸。

## 3. 部署后 Anti-Waste 在线验收

新实例 READY 后连续观察多个调度周期，至少证明：

### 3.1 构建身份

- 新 PID 与旧 PID 不同；`startReason=MANUAL_START`。
- build/artifact/source identity 与本次正式构建一致，源码明确包含 `e284a1a`。
- `/health` READY；fatal/uncaught/unhandled = 0；persistence HEALTHY；SQLite `integrity_check=ok`。

### 3.2 executionReadiness 真源上线

`/api/v3/pipeline` 必须真实出现 Engine 投影的 `executionReadiness`，至少包括：

- `intent`
- `ready`
- `modelSpendPermitted`
- `blockers`
- `firstBlocker`
- `profileStatus`
- `mode`
- `lastReadyAt`（若实现中存在）

当前本轮保持 `READ_ONLY`，因此在 AUTO_RUNNING + entrySafety=AUTO 下，预期：

- `intent=true`
- `ready=false`
- `modelSpendPermitted=false`
- blockers 中包含 `EXECUTION_WRITE_LOCKED`
- `firstBlocker` 按代码既定顺序应优先反映写锁（若线上事实不同，记录实际值，不得篡改顺序）
- PortfolioRisk readback 必须继续如实显示 `PROFILE_NOT_CONFIGURED`，不得显示通用 READY。

### 3.3 不可执行时模型调用必须归零

从新实例启动后单独计数，排除旧实例历史：

- 在 `executionReadiness.modelSpendPermitted=false` 的整个观察窗口内，新的 `PRIMARY_BRAIN` dispatch/request/terminal 应为 **0**。
- SCOUT 若属于同一执行意图，也必须为 0；若产品定义有显式 RESEARCH_ONLY 研究态，必须证明当前线上不处于该模式后才能接受任何调用。
- 不得再出现旧行为：`PLACE_* -> ANALYSIS_ONLY_COMPLETED -> EXCHANGE_WRITE_LOCKED` 持续烧 27B。
- `ANALYSIS_DISPATCH_INTENT` 不得在被硬闸拒绝后继续出现；应有 `EXECUTION_READINESS_BLOCKED` 或等价单一事实事件。

### 3.4 供给不能被冻结

Anti-Waste 闸只禁止模型支出，不得冻结确定性供给：

- Market/universe/pool/eligibility/capital precheck 仍持续刷新；
- candidate lifecycle 可继续确定性维护；
- private data 若发生 TIMEOUT/RECOVER，状态按真实事实变化；
- 当 facts 恢复时，不需要重启即可更新 executionReadiness。

注意：本轮仍是 READ_ONLY，因此即使 private data 恢复、资本候选存在、profile 后续被用户另行配置，当前本轮也不应调用模型，因为写锁仍在。

### 3.5 写边界

整个本轮必须保持：

- environment = TESTNET
- executionMode = READ_ONLY
- `testnetWrites=0`
- `productionWrites=0`
- `lastWriteAt=null`（若是累计结构，区分本实例计数）
- 不产生新的 reservation / entry intent / entry order / exchange submit 作为本轮验收手段。

## 4. PRIVATE_DATA_UNAVAILABLE 只读观察

已知上一轮证据显示私有 REST 经代理会出现 15–20s TIMEOUT 抖动。本轮：

- 只记录新实例上的 `PRIVATE_SYNC_FAILED` / `PRIVATE_SYNC_RECOVERED`、duration、errorCode、consecutiveFailures、account.asOf/status；
- 不放宽 60 秒新鲜度；不调 timeout；不使用旧缓存放行写；
- 若它恢复，executionReadiness 其他 blocker 仍应如实存在；
- 若出现连续不可恢复失败，则作为独立 P1 报告，但不得因此自行改网络/代理配置。

## 5. 部署后立即只读核验 47 条 Pending Risk 矛盾

在不改 DB、不写 Settings、不创建订单的前提下，对上一轮登记的：

`PENDING_RISK_UNVERIFIED:order:entry_intent_*`

与同一批 orderId 的：

`VERIFIED_NO_ACTIVE_RISK + occupancyReleased=true + activeRiskExposure=false`

做一一关联核验。

必须输出：

1. 当前仍存在多少条 `PENDING_RISK_UNVERIFIED`；
2. 每条对应的 durable `entryOrder` 当前 status、exchangeOrderId、filledQuantity、expiresAt、intentId/reservationId；
3. reconciliation/remote-status evidence 对同一 orderId 的最终事实；
4. 哪个模块仍把它们计入 `PortfolioRiskAdmission.inputs().pending`；
5. 是否属于“历史 UNKNOWN/未提交订单已经通过权威远端证据释放，但 PortfolioRisk pending 投影仍按本地 status 继续占风险”的 stale projection；
6. 是否存在任何一条其实仍有真实 active exchange risk；UNKNOWN 不得转成 0，必须逐条有权威证据；
7. 给出精确根因文件/函数/谓词和最小修补建议，但**本轮先不修改该逻辑**，除非它导致部署后 P0（例如真实风险被错误释放）。

目标是把下一轮是否需要代码修补一次定清，不要只报“47 条”。

## 6. Dashboard readback

部署后的驾驶舱必须显示来自 Engine 的：

- executionReadiness 当前首因/阻断集合/是否允许模型支出；
- PortfolioRisk profile `PROFILE_NOT_CONFIGURED`；
- 不得在 `modelSpendPermitted=false` 时继续显示“正在分析”或让用户误以为模型会继续烧资源；
- 原有 Gross/LONG/SHORT/slots/capacityVisibility 数字继续与 Engine 同源。

如果 UI 文案有轻微显示问题但 Engine 真源正确，只记录，不在本部署轮临时改产品后再次重启。

## 7. 证据与报告

建立：

`docs/evidence/v396/deploy-e284a1a-anti-waste-20260923/`

至少保存：

- pre-deploy identity/write boundary/model-spend baseline
- build identity
- stop/start transcript
- post-start health/readiness
- execution-readiness-readback.json
- no-model-spend-window.json（按新实例时间窗）
- supply-maintenance-readback.json
- private-data-flap-readback.json
- pending-risk-crosscheck.json
- TP/ownership/write-boundary readback
- dashboard readback
- RESULT.md

最终 ff push，工作树必须 clean。

## 8. 最终汇报只回答这些问题

1. 最终 HEAD / 产品源码基线 / buildId / 新 PID / instance / startedAt；
2. stop/start 是否严格各一次；
3. `executionReadiness` 线上真实值；
4. 在 `modelSpendPermitted=false` 窗口内 Primary/Scout 新调用是否为 0；
5. 候选供给是否仍持续维护；
6. private data 抖动实际情况；
7. testnetWrites / productionWrites / lastWriteAt；
8. TP / ownership / persistence / fatal 状态；
9. 47 条 pending-risk 当前剩余数量及精确根因；
10. 下一步是否需要 pending-risk 产品修补，还是可以直接等待用户批准 PortfolioRisk profile。

若全部通过，状态仍是 `V396_TESTNET_ACTIVE_ANALYSIS_ONLY` 的**交易写权限意义**，但应明确标注：在 AUTO 执行意图下由于 executionReadiness 不满足，模型支出已被硬闸抑制；这不是模型故障，而是 Anti-Waste 正常工作。
