# ZDJ-MITS V3.9.6 — Final Governance Closeout（2026-09-26）

目标状态：**`V396_FINAL_GOVERNANCE_CLOSEOUT_COMPLETE`**

本轮只闭合一个真实运行项：margin-tier authority coverage。A–D 已闭合的产品逻辑未再改动，
`OverviewView.vue` 的「首因」措辞冲突按指示留作 UI 文案 backlog（未为此改源码、未重新部署）。

- 分支 `codex/v396-final-convergence-20260922`，起点 = 远端 = 本地 `9265f35`（fetch 后 `0 0`）
- 唯一动作：既有 `/settings/portfolio-risk-authority` CAS 通道的一次原子权威数据集提交（`07794f2` 的代码，未改产品逻辑）
- **未使用任何 lifecycle**（见 §5）；PR #9 未动；GitHub Actions / hosted CI 未使用（`NOT_RUN_BILLING_LIMIT`）

## 1. 只读 preview：交易所事实确实可得（先验证后提交）

`scripts/v396-authority-coverage-refresh.mjs`（默认 dry-run）用**当前真实 routable universe** 与**现网已批准 profile 原样**
（limits / clusters / scenarios 逐字段回传，服务端派生字段一律不发送）做只读 preview，`persisted:false`。

`docs/evidence/v396/final-governance-closeout-20260926/q01-preview-dryrun.json`：
`collectionFailures=[]`、`compiledOk=true`、`blockers=[]`、`environment=TESTNET`、
`requiredSymbols=71 / pricedSymbols=71`（上限 96 内）、13 个候选全部在请求集内且全部有真实 bracket 行
（`tierCount 6–10`、`highestAnyTierRatio 0.5`、最低档 `initialLeverage 50–75` 均来自交易所响应）：

`1000BONKUSDC COTIUSDT ETCUSDT ETHFIUSDC ETHFIUSDT JUPUSDT POLUSDT RAYSOLUSDT VIRTUALUSDT WIFUSDC WIFUSDT ZENUSDT ZROUSDT`

14 项前置门全部为 true（含 `limitsUnchanged`、`clustersUnchanged`、`scenariosUnchanged`、
`serverDerivedFieldsNotSent`、`uncoveredAllHaveExchangeFacts/TierRows/MaintenanceRatio`）。
脚本在任何条件不满足时以非零退出且不提交；本轮无需触发该路径。**没有任何 symbol 被后缀、默认杠杆、邻近 symbol 或推断值补齐。**

## 2. 原子提交（settingsVersion 只按设计 +1）

`q02-authority-commit.json`：`POST /settings/portfolio-risk-authority`，
`expectedSettingsVersion=218`、`acks=[]`（治理 ack 只在改变权限边界的写入时需要；所有值相同 ⇒ 无需 ack，
也未被用来绕过任何边界）、`operator=codex-v396-governance-closeout` → HTTP 200。

| 项 | before | after |
| --- | --- | --- |
| `settingsVersion` | 218 | **219**（仅此一次；`g11`/审计表确认无额外增长） |
| margin-tier dataset | 58 symbols | **71 symbols** |
| `coverageLag.uncoveredCandidates` | 13 个（点名） | **空**（`uncoveredCoverageCandidates: []`） |
| margin `contentHash` | `0081998e0d49…2846d77` | **`67dee0aca734d8…08bb0fa9`** |
| correlation `contentHash` | `d7ada0f6ba5c…1d2bff65` | **未变**（同值） |
| scenarios `contentHash` | `3b9c016189e3…d1a0749c` | **未变**（同值） |
| coverage 差集 | — | +13 全部为新增，`removed: []`（只宽不窄策略保持） |

`settings_audit` 新增 **1** 行，`source=portfolio-risk-authority`、`218→219`、
summary 写明 `portfolio risk authority dataset commit`（真实变更血缘，非空操作）。

## 3. 提交后只读验证

`q03-post-commit-verification.json`：
- profile **READY**、authority **MATCHED**、`missingSymbols: []`、`mismatchReasons: []`；
  readback 的 `marginTierVersion` 与 durable `portfolio_risk_authority` 三行的 `version/content_hash` 一致
  （margin 新哈希、correlation/scenarios 原哈希），即已提交 hash / version / readback 三者闭环。
- **未放宽任何语义**：`maxGross=maxHuman=maxCluster=$10,811.957`、`maxDirection=$8,649.565`、
  `takeProfit.minNetProfitUsd=1`、`exposureCapacityPolicy={gross:OBSERVE,direction:OBSERVE,cluster:ENFORCE}`、
  `aiExitAuthority=SHADOW`、`aiExitLossLimitUsd=10`、`executionMode=TESTNET_ENABLED`、`entrySafetyMode=AUTO` 全部原值；
  全量 `/settings` 叶子差异只有 `settingsVersion` 与 `riskGovernance.portfolioRisk.marginTierVersion`
  （`settingsChangesOutsideAuthority: []`）。
- 覆盖生效的运行面证明：当前 16 个可路由候选包含 1000BONKUSDC、ZROUSDT、JUPUSDT、RAYSOLUSDT、VIRTUALUSDT、WIFUSDT、
  ZENUSDT、ETHFIUSDT 等此前被拒 symbol，逐候选 trace 现在为 `marginTierProven=true`、`executable=true`、
  `firstBindingConstraint=PLANNED_NOTIONAL`、`plan.admission=ALLOW`、`capacityRoom.source=QUOTE_ASSET_MARGIN`，
  且 `refusedForMarginTierNow=[]` —— 覆盖缺口不再抑制健康候选，也不再有 symbol 需要靠推断补数据。
- 未制造 Entry、未强制成交、未为验收调用模型：提交只做交易所 GET；
  `testnetWrites` 仍为 **8**（上一轮那 8 笔 reduce-only 止盈单，`lastWriteAt/lastWritePath` 未变），本轮新增交易所写 **0**。
- **Production writes = 0、`blockedProductionWriteAttempts = 0`、`lockedToTestnet = true`、环境 TESTNET**（同一份 closeout 快照）。
- 持仓与保护：**23/23 PROTECTED**，`tpMetrics {required:23, protected:23, missing:0, positionFactUnresolved:0}`，
  23 条仍全部 `HUMAN_MANAGED`。
- UNKNOWN 保守语义未变：durable 47 条 UNKNOWN 建仓单仍 47 份活跃无风险续证、0 占用；
  对账 `historicalUnknown 48 / verifiedNoActiveRisk 47 / activeRiskUnresolved 1`（即那笔 XRP 手动单）保持原样。
- 权威首因仍是 A 的真实结论：`HUMAN_ACK_OVERDUE / RISK_ADMISSION`（未因覆盖收敛而消失——负 human/gross 额度仍在）。

**如实标注的残留覆盖事实**：`AAVEUSDC` 在 preview 之后新进入 routable 视图，因此不在这 71 个已提交 symbol 内。
提交后它又离开了 watch 集合，所以 `coverageLag` 当前为空；若它再次可路由，会按 B 的路径以
`MARGIN_TIER_SYMBOL_UNPROVEN:AAVEUSDC` 符号级 fail-closed 出现在 lag 中，而不是被伪装成已覆盖。
未做第二次提交去追一个每 tick 轮动的集合（那会让 `settingsVersion` 增长两次，违反第 4 条要求）。

## 4. 一个未归因清楚的观测（不本轮修改，仅记录）

对账 `unresolvedDriftCount` 从 4 变为 12、`driftCount` 23 → 28，时间上与本地上线的 8 笔 reduce-only 止盈单一致：
本地账本里这 8 条 `tpOrders` 均为 `WORKING` 且带 `clientOrderId`（23/23 持仓因此 `PROTECTED`），
但 reconciler 把 remote 侧这些reduce-only 开放单计入未匹配 `remoteEntries/remoteTps`（其定义见 `reconciliationService.ts:131`）。
这是**归因/呈现**问题，不是保护缺失；本轮按指示不动 A–D 之外的代码，故只登记事实与定位点，留待独立轮次处理。

## 5. 身份闭环（无需 lifecycle，也未使用 lifecycle）

`q04-identity-closure.json` → **`IDENTITY_CLOSED`**，6 项检查全 true。

| 层 | 值 |
| --- | --- |
| remote HEAD = local HEAD | `9265f35`（本轮未改产品源码，只有新增只读脚本与证据提交） |
| 提交源码树 `sourceHash` | `b2e9f84f7868d11f…` = 运行实例 `sourceHash` |
| 工作树 `dist` `artifactHash` | `e45d25472c241b412be7…` = 运行实例 `artifactHash` = `buildId 3.9.6-e45d25472c241b412be7` 前缀 |
| 运行实例 | pid **37996**、`instanceId 5ff8ed85-bbde-42a7-94de-fb60896ad507`、`restartCount 189`、`lastRestartReason MANUAL_START`（本轮未新增 restart） |
| stop / start 次数（本轮） | **0 / 0** |

不使用 lifecycle 的原因（读码确认，非猜测）：`commitPortfolioRiskAuthority` 在同一请求里
把新权威装回进程（`this.portfolioRiskAuthority=…`）并经 `mirrorMarginTierCoverage` 刷新覆盖镜像，
因此预模型拒因、容量 trace 与 readback 立即反映新数据集；重启既非必要也不被允许用于制造"看起来生效"。

## 6. 明确不处理项（真实运营/风险事实，非缺陷）

`HUMAN_ACK_OVERDUE`（12 条超 `maxAckAgeMs=24h`）、human/gross 名义 headroom（毛名义 ≈ $11.1k 对 $10,811.957 ⇒ ≈ −$300）、
XRP 手动单 UNKNOWN（`ec1_mufgan4j_001350f`，`activeRiskUnresolvedCount=1`）、
`OverviewView.vue` 的「首因」措辞冲突（UI 文案 backlog）。本轮未自动确认、未减仓、未消解 UNKNOWN、未放宽任何阈值。

## 7. 证据与脚本

`docs/evidence/v396/final-governance-closeout-20260926/`：
`q01-preview-dryrun.json`（14 门全绿、13 symbol 交易所事实）、
`q02-authority-commit.json`（CAS 提交 + before/after + 不变量 + 写入计数）、
`q03-post-commit-verification.json`（authority/settings/routed/capacity/protection/UNKNOWN/identity）、
`q04-identity-closure.json`（IDENTITY_CLOSED 6/6）、
`q05-s00-static-check.json`（本轮新增只读脚本后，S00 入口清单按既有确定性机制重算 131 → 134，
`T01–T06` 全 PASS、`blockers=[]`、`exchangeWrites=0`、`engineLifecycle=NOT_USED`、`settingsModified=false`，
新脚本按保守分类 `FORBIDDEN_OR_NOT_RUN`；规则表未修改）。
脚本：`scripts/v396-authority-coverage-refresh.mjs`（默认 dry-run，`apply` 才提交；逐字段防漂移）、
`scripts/v396-governance-closeout-verify.mjs`（GET-only + readOnly）。

## 8. 收尾边界

本轮之后不再对 V3.9.6 做功能性"完善"。后续只处理新的真实生产事实或独立版本需求；
本轮唯一持久变更是那一次 PortfolioRisk 权威数据集提交（218 → 219，coverage 58 → 71，风险数值零变化）。
