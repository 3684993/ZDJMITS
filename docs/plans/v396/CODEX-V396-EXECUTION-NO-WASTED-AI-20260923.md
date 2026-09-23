# V3.9.6 执行态收敛：PLACE 必须进入建仓链，无法执行时不得浪费 AI

用户当前目标已经改变：V3.9.6 不应继续长期停留在 ANALYSIS_ONLY。当前是 TESTNET，用户要求“决策后必须建仓”，并明确指出 24 次 PLACE、0 次 Submit 属严重资源浪费。这里的“必须建仓”定义为：**当 Primary 给出 PLACE_LONG/PLACE_SHORT，且所有确定性硬门都通过时，必须进入 reservation → intent → order submit 链，不得再因为 ANALYSIS_ONLY 静默转换为 system WAIT；成交仍由交易所/价格事实决定，不得伪造 fill。**

本轮不要改生产环境，不得放宽 UNKNOWN、阈值或任何风险门来“凑成交”。目标是把“是否值得花模型资源”和“是否真的具备执行资格”绑定起来。

## A. 先做现场事实核对（只读）

在不启停 Engine 的前提下读取并保存当前：

- connections.exchange.environment / connections.executionMode / settingsVersion
- account.status / account.asOf / account.reason / userDataWs / private sync health
- writeBoundary：lockedToTestnet / testnetWrites / productionWrites / lastWriteAt
- portfolioRiskProfile.profileReadback：configured / missingFields / correlationVersion / scenarioVersion / marginTierVersion / maintenanceMarginRatePct
- egress/write admission 状态
- 当前 gross / direction / slots / executableCandidateCount
- 最近 30 分钟 PRIMARY：PLACE / REJECT / Submit / Fill 计数

当前驾驶舱已显示 `TESTNET · READ_ONLY`、`PRIVATE_DATA_UNAVAILABLE`、`PLACE 24 / Submit 0`。不要把缓存资产余额当作 private facts READY。

## B. 修正资源浪费语义

当前源码中 `analysisOnly()` 在 TESTNET+READ_ONLY 下成立，Primary 完成后立即 `completeReadOnlyAnalysis()`，写 `EXCHANGE_WRITE_LOCKED`，`reservationCreated:false/orderCreated:false` 后 return。这个行为允许昂贵模型持续给出 PLACE 但永远不进入建仓链。

新增统一的 execution-readiness 判定，至少包含：

1. environment === TESTNET
2. executionMode === TESTNET_ENABLED（真正要交易时）
3. privateAccountFresh(account) === true
4. write admission / egress VERIFIED
5. runtimeControl RUNNING + executionGovernance AUTO_RUNNING + entrySafety AUTO
6. portfolioRisk profile 已真实 configured 且必要字段/版本/事实齐全
7. 至少一个真实 capital executable candidate

若系统处于“要求执行”的 AUTO_RUNNING 模式，而上述任何硬事实不满足：

- **不得继续调 PRIMARY/SCOUT 去产生不可执行 PLACE**；
- 应在 AI 之前进入明确阻断态，例如 `EXECUTION_FACTS_BLOCKED` / `EXECUTION_WRITE_LOCKED` / `RISK_PROFILE_UNCONFIGURED`；
- 驾驶舱显示第一真实原因与 last-ready 时间；
- 不能把 PRIVATE_DATA_UNAVAILABLE 之后仍显示的缓存余额当作可下单事实；
- facts 恢复后下一调度 tick 自动恢复，无需重启。

保留 ANALYSIS_ONLY 作为显式研究模式是可以的，但 **AUTO_RUNNING 的交易目标下不能一边明确禁止写、一边持续花 27B/9B 生成 PLACE**。

## C. PLACE 的执行不变式

在 `TESTNET_ENABLED` 且所有硬门已通过时：

- PLACE_LONG / PLACE_SHORT 必须继续进入 post-AI deterministic path；
- PortfolioRiskAdmission allowed + ticket 必须成立；
- durable TradePlan 必须先落盘；
- reservation 必须原子成功；
- EntryIntent / EntryOrder 必须建立；
- JIT hard guard 再检查一次；
- 最终调用 Testnet submit；
- 任一失败必须产生明确、可审计 `ENTRY_DECISION_BLOCKED(stage, reason)`，不得回写成模糊 WAIT，也不得继续对同一事实无限重跑模型。

这里的“必须建仓”不等于强制成交。交易所拒单、价格未触及、TTL 到期、事实变化、风险票失效都可以不成交，但必须有明确执行链事实，而不是 PLACE 后 0 reservation/0 intent/0 submit。

## D. 当前 PRIVATE_DATA_UNAVAILABLE

`privateAccountFresh` 要求 account.status=READY 且 asOf 年龄 <=60s。先查明 private data 为何 UNAVAILABLE：

- user-data websocket/REST 私有同步是否断线
- credential/recvWindow/time sync/egress 是否异常
- PrivateAccountSync 最近成功/失败时间与错误
- 是否只是瞬时状态切换

允许正常的连接恢复/重新订阅逻辑；**不允许用旧缓存事实放行订单**。若 private facts 无法恢复，本轮不要继续烧模型，直接保持执行阻断并记录根因。

## E. PortfolioRisk profile

不要相信驾驶舱一个笼统的 `portfolioRiskProfile READY` 就等于“已批准”。以 `profileReadback()` 为权威。代码当前在 `configured!==true`、缺字段、marginTier/correlation/scenario 未证明时都会 fail-closed。

- 若当前 live profile 已经 configured 且字段完整：继续执行。
- 若仍为 configured=false：**禁止伪造默认值或自动替用户决定风险参数**；停止昂贵模型派发并输出缺失字段清单。该 blocker 必须在驾驶舱直接显示 `PROFILE_NOT_CONFIGURED`，不能显示 READY 误导。

## F. 启用 Testnet Entry 写

只有当 D/E 和所有 execution-readiness 条件都真实通过后，才允许通过既有受控 Settings 边界把：

`connections.executionMode: READ_ONLY -> TESTNET_ENABLED`

这次用户已经明确要求 Testnet 决策后进入建仓链，因此该 **Testnet Entry 写目标已授权**；但本授权不包含：

- PRODUCTION
- `aiExitAuthority=ENFORCE`
- 修改已有退出权限
- 放宽 maxGrossExposurePct / maxDirectionExposurePct / maxPositions
- 修改 0.15、aiExitLossLimitUsd、reachability/economics 门
- 伪造 PortfolioRisk profile

设置切换后立即服务端 readback，必须仍 environment=TESTNET、lockedToTestnet=true、productionWrites=0。

## G. 红→绿测试

至少新增/更新以下敌意回归：

1. READ_ONLY + AUTO_RUNNING + 可执行候选：execution-mode blocker 在 AI 前生效，Primary 调用 0（不再 24 PLACE/0 submit 浪费）。
2. PRIVATE_DATA_UNAVAILABLE：Primary 调用 0，facts 恢复后下一 tick 自动恢复，无重启。
3. profile configured=false：Primary 调用 0，驾驶舱明确 PROFILE_NOT_CONFIGURED，不得显示 READY。
4. TESTNET_ENABLED + private fresh + profile allowed + PLACE_LONG：必须出现 reservation → intent → order submit；exchange placeEntry 恰一次。
5. PLACE_SHORT 同上。
6. 任一 post-AI JIT guard 失败：不得 submit，必须有具体 stage/reason，且同一 factVersion 不反复烧模型。
7. production 环境永远 0 写。

## H. 现场执行与部署纪律

先离线修补并跑定向测试 + 必要全仓门禁。**本文件不额外授权 Engine stop/start 生命周期动作。** 若代码修补需要新构建上线，先完成代码/测试并 push；当前 live 设置若能通过现有 API 热更新到 TESTNET_ENABLED，可在满足全部前置后执行，不需要为了设置切换重启。

若仅通过设置切换即可恢复正常建仓，则不要无意义重启。

## I. 最终汇报只回答这些

1. 24 PLACE / 0 submit 的直接根因是否已关闭；
2. PRIVATE_DATA_UNAVAILABLE 的根因与是否恢复；
3. portfolioRisk profile 当前真实 configured 状态；
4. executionMode 最终值；
5. 第一个自然 PLACE 是否真实进入 reservation/intent/order submit；
6. testnetWrites / productionWrites；
7. 是否还存在“不可执行却继续调用大模型”的路径；
8. 若仍不能交易，唯一剩余硬 blocker 是什么。
