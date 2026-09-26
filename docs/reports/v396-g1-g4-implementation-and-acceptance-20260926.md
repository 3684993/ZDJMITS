# ZDJ-MITS V3.9.6 — G1–G4 产品实现与本地受控运行验收（2026-09-26）

结论：**V396_G1_G4_LOCAL_ACCEPTANCE_PASS（附一条已记录的 G4 不完整项）**

G1–G4 已作为真实产品提交落在当前分支（`aa06461`），全部门禁与 formal build 本地绿色，唯一一次
`stop → MANUAL_START` 已消费并完成后停止/后启动身份闭环，四项目标在运行实例上均有可审计证据。
本轮 Production 写入 = 0，Testnet 写入 = 0，未放宽任何经济/风险语义。仍存在的真实首因是人工侧容量：
`HUMAN_POTENTIAL_NOTIONAL_LIMIT` 与 `HUMAN_ACK_OVERDUE`。

- 仓库：`3684993/ZDJMITS`　分支：`codex/v396-final-convergence-20260922`
- 工作树：`D:\MITS-WORKTREES\v396-final-convergence-20260922`（运行实例的 `runtimeDataDir` 即此目录）
- PR #9：未切换、未评论、未修改
- GitHub Actions / hosted CI：`NOT_RUN_BILLING_LIMIT`，且本轮按指示禁止作为验收路径；所有测试、typecheck、
  verification、S00、formal build、lifecycle 与在线验收全部在本机完成，未因 hosted CI 不可用而降低、删除或替换任何本地门禁

---

## 1. Git

| 项 | 值 |
| --- | --- |
| 拉取前 HEAD（= 当时远端） | `882eda5489ea4e0d447bce90d4c9d7e087aff618` |
| 实现提交 | `aa06461761dad098449e250127afef3d3695cdc1` |
| 实现提交 subject | `feat(v396): 实现 G1-G4——方向单一权威、AI 合法数量区间、单 symbol 行情隔离、唯一权威首因` |
| 文档/证据提交 | 本报告所在提交（见 `git log -1`；仅含 `docs/`、`scripts/` 只读验收工具，不含产品源码） |
| 推送后远端 HEAD | 与本地 HEAD 一致，普通 `git push`（fast-forward），未使用 force |
| 工作区 | 提交后 clean（`git status --porcelain` 为空） |

`docs/`、`scripts/` 的追加不进入 `contentTreeHash` 的 `src`/`dist` 目录集，因此不改变 source/artifact 身份（见 §7）。

## 2. G1–G4 实现落点（源码 + 测试）

| 目标 | 产品源码 | 测试 |
| --- | --- | --- |
| G1 单一方向硬权威 | `packages/core/src/portfolio.ts`、`packages/contracts/src/portfolio.ts`、`apps/engine/src/config/governanceSettingsMatrix.ts` | `packages/core/src/portfolio.test.ts`（G1-01…G1-05 + CR-01）、`apps/engine/src/services/j5SettingsGovernanceHostile.test.ts` |
| G2 AI 合法数量完整区间 | `apps/engine/src/services/preAiExecutionEnvelope.ts`、`apps/engine/src/services/aiQuantityAllocation.ts`、`apps/engine/src/services/entryCoordinator.ts`、`packages/core/src/compactEntry.ts`、`packages/contracts/src/trading.ts` | `preAiExecutableSides.test.ts`（EP-01、EP-08、EP-09）、`aiQuantityAllocation.test.ts`（QB-01…QB-03） |
| G3 单 symbol 行情隔离 | `apps/engine/src/services/marketDataStaleness.ts`、`apps/engine/src/runtime/appRuntime.ts` | `marketDataStaleness.test.ts`（ST-01…ST-05，原「钉住错误行为」的断言已按隔离语义重写） |
| G4 唯一权威首因 | 新增 `apps/engine/src/services/pipelineVerdict.ts`、`apps/engine/src/runtime/appRuntime.ts`、`apps/dashboard/src/views/OverviewView.vue` | 新增 `pipelineVerdict.test.ts`（PV-01…PV-07）、`OverviewView.capacity.test.ts`（G4-UI、G3-UI） |

## 3. 定向测试（`docs/evidence/v396/g1-g4-implementation-20260926/13-targeted-tests.txt`）

| 范围 | 命令对象 | 结果 |
| --- | --- | --- |
| G1 | `packages/core` → `src/portfolio.test.ts` | 1 文件 / 15 通过，exit 0 |
| G2+G3+G4 | `apps/engine` → `preAiExecutableSides`、`aiQuantityAllocation`、`marketDataStaleness`、`pipelineVerdict` | 4 文件 / 31 通过（9+6+9+7），exit 0 |
| G4 UI | `apps/dashboard` → `OverviewView.capacity.test.ts` | 1 文件 / 14 通过，exit 0 |
| G1/G2 近邻回归 | `apps/engine` → `entryCapacityTrace`、`executableRiskHeadroom`、`j5SettingsGovernanceHostile` | 3 文件 / 42 通过，exit 0 |

## 4. 完整本地门禁（同目录 `00`–`12`）

| 门禁 | 结果 |
| --- | --- |
| Engine 全量测试 | 171 文件 / 1,379 通过，exit 0 |
| Dashboard 全量测试 | 14 文件 / 60 通过，exit 0 |
| core 全量测试 | 8 文件 / 58 通过，exit 0 |
| contracts 测试 | 仓库脚本 `--passWithNoTests`：`No test files found`，exit 0（如实记录为 0 个测试文件，未伪造 PASS） |
| TypeScript typecheck（全 workspace） | exit 0 |
| `verify:deps` / `verify:scripts` | exit 0（含 V3.9.4 脚本契约 PASS 行） |
| S00 静态审计 | `S00_T01…T06` 全 PASS，123 个入口复核（本轮验收脚本加入后重算为 129，见下），`blockers: []`，`network: NOT_USED`，`exchangeWrites: 0`，`engineLifecycle: NOT_USED`，`settingsModified: false`，fixtureHash `295c949a…ab21`；测试隔离：171 文件中 16 个开库、`everyStoreOpeningTestIsolated: true`、仓库数据目录引用 0、生产端口引用 0 |
| S00 入口清单更新 | 本报告的 6 个只读回采脚本被入口选择器识别后，`v396-s00-build-entry-review.mjs` 依文件内容重算分类：`entryCount 123 → 129`，`FORBIDDEN_OR_NOT_RUN 112 → 118`（新脚本全部按保守分类），`CONDITIONAL_NOT_RUN 10`、`ALLOWED_STATIC 1` 不变，规则表本身未改动；随后 `v396-s00-static-check.mjs` 逐条比对派生结果并重新全绿（`14-s00-after-acceptance-scripts.json`） |
| 存储覆盖 | `gate=S08_STORAGE_COVERAGE_PASS` |
| `git diff --check` | 仅 CRLF 转换警告，无空白错误 |
| formal build | exit 0；提交后再次 build 亦 exit 0（`12-formal-build-after-commit.txt`） |
| hosted CI | `NOT_RUN_BILLING_LIMIT`（禁止项，见文首） |

## 5. Lifecycle（唯一一次授权的使用）

| 项 | 值 |
| --- | --- |
| stop 次数 | 1（`scripts/stop-zdj-lan.ps1`） |
| MANUAL_START 次数 | 1（`scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`） |
| 旧 PID / 新 PID | 28628 → **8732** |
| 端口释放证据 | 停止脚本输出 `port 8080 is free`；`netstat` 对 8080 监听数 0 |
| startReason | `MANUAL_START`（`lastRestartAt = 1790389890187`，`restartCount = 188`） |
| 第二次 restart | 无；未使用 hot reload、watchdog、autostart |

门禁与 build 全绿之后才消费该授权；授权此后已用尽，§9 的 G4 不完整项因此留到下一次授权轮。

## 6. 运行身份闭环

| 层 | 值 |
| --- | --- |
| 远端 HEAD（推送后）= 本地 HEAD | `aa06461`（§1） |
| 运行时 `buildId` | `3.9.6-642a976eea2f65033c2c` |
| 运行时 `artifactHash` | `642a976eea2f65033c2c6070d84dc0e48aabfed61ba76e77275bb320c0d82684` |
| 运行时 `sourceHash` | `294d7b9173f25752ddec32724136e3c5b894b34ddb01c0a95c838941e3b4892d` |
| `instanceId` / PID | `edfeb7b5-7cd2-4c08-bef7-01d8447713f0` / 8732 |
| 闭合方法 | `scripts/v396-g1-g4-identity-closure.mjs` 以与 `runtimeIdentity.ts` 相同算法重算 `contentTreeHash`：`src` 目录集得到 `sourceHash`，`dist` 目录集得到 `artifactHash`，并校验 `buildId == version + '-' + artifactHash[0..20)` |
| 结果 | `IDENTITY_CLOSED`（证据 `11-identity-closure.json`：6 项检查全 true，含 `committedSourceTreeMatchesRuntimeSourceHash`、`workingDistMatchesRuntimeArtifactHash`、`buildIdDerivedFromArtifactHash`） |

`11-identity-closure.json` 记录的 HEAD 是其采集时刻（`960b63f`）；仅把该证据文件本身入库的后续提交不再改变任何被哈希目录，
故 `sourceHash`/`artifactHash`/`buildId` 与运行实例仍逐项相等。

## 7. 冻结语义未被改动（深比对）

`scripts/v396-settings-provenance-diff.mjs` 比对停机前快照（`settingsVersion 217`）与运行实例（`218`）：
**917 个叶子字段，除 `settingsVersion` 外 0 项变化**（`SEMANTICALLY_IDENTICAL_EXCEPT_VERSION`）。

`settings_audit` 显示每次启动固定产生 `migration(n→n)` + `api(n→n+1)` 一对（215→216、216→217、217→218 同签名），
因此版本递增不是「有人改了风险设置」的证据。关键值原样：`entryMarginUsd 200`、`maxPositions 50`、`maxPendingEntries 6`、
`maxDirectionExposurePct 1`、`gross/direction=OBSERVE`、`cluster=ENFORCE`、`aiExitAuthority=SHADOW`、
`aiExitLossLimitUsd 10`、`aiExitMinNetProfitUsd 0.2`、`maxSpeculativeExposurePct 0.2`、`maxQuoteAssetMarginUsagePct 0.8`、
`minHistoricalReachProbability 0.5`、`entry.minReachability 0.48`、`executionMode=TESTNET_ENABLED`。

## 8. G1–G4 在线验收

### G1 — 方向单一硬权威

- `capacityVisibility.limits.policy = {gross: OBSERVE, direction: OBSERVE, cluster: ENFORCE}`，槽位 23/50。
- `exposure.SHORT = {notionalUsd 7,490.74 / limitUsd 10,413.15, usedPct 0.7194, mode OBSERVE, enforced false}`。
- 停机前遗留的 `portfolioIntelligence.maxLong/ShortExposurePct = 0.5` **仍在 settings 里、值未改**，但已不再是第二套 veto。
- 决定性证据（`07-g1-direction-authority-since-restart.json`）：本轮 10 个 AllocationPlan 中 **4 个的方向敞口 > 0.5，
  全部 `admission=ALLOW`，`REJECT_EXPOSURE_LIMIT` 次数 0**。
- `capacityRoom.source = QUOTE_ASSET_MARGIN`、`limitPct 0.8`、`enforced true`、`authority = portfolioIntelligence.maxQuoteAssetMarginUsagePct`：
  唯一仍在否决的敞口权威是计价资产保证金上限；`sideStatus = BOTH_SIDES_EXECUTABLE`。
- 驾驶舱逐候选 trace 文本：`容量上限 …（已用 …，剩余 …）来自 QUOTE_ASSET_MARGIN｜可执行`，两侧均不再出现 DIRECTION_*  ceiling。

### G2 — AI 合法数量完整区间

- 本轮 12 个 `PRE_AI_EXECUTION_ENVELOPE_CREATED`，每侧都带 `minQuantityUnits`、`maxQuantityUnits`、
  `legalQuantityRangeUnits=[min,max]`、`legalNotionalRangeUsd`、`minimumLegalNotionalUsd`、`firstBindingConstraint`。
- 边界来自确定性交易所事实（示例 `06-g2-quantity-chain-since-restart.json`）：
  - TAOUSDT `stepSize 0.001, minNotional 5, last≈315.9` → `min=16, max=11402`
  - WLDUSDT `stepSize 1, minNotional 5, last≈0.4847` → `min=11, max=7441`
  - ZROUSDT `stepSize 0.1` → `min=32`；1000BONKUSDC → `min=1355`；AAVEUSDT → `min=1, max=162`
- 模型确实使用完整区间：TAOUSDT 的 `PRIMARY_DECISION_NORMALIZED.reason` 原文含
  “Capacity allows 16 units (min).”，其 AllocationPlan `notionalUsd=5.0552`（=16×0.001×价）；
  AAVEUSDT 则选了区间内大额 `notionalUsd=2,508.894`（区间 [1,162] 单位）。
- 确定性侧：10/10 plan 带 `AI_QUANTITY_UNITS_FROZEN`；`quantityMutated=0`、`targetMutated=0`、
  `AI_SIZING_ERROR` 事件 **0 次**、低于最小合法名义 **0 次**、越出合法名义区间 **0 次**。
- 反向（低于下界/越出上界）由单元测试钉住：`AI_QUANTITY_BELOW_ENVELOPE`、`AI_QUANTITY_EXCEEDS_ENVELOPE`、
  `AI_QUANTITY_BELOW_MIN_NOTIONAL`；EP-09 证明 `availableBalance=0.01` 时 `executableSides=[]` 且首因写为 `AVAILABLE_MARGIN`（不静默放宽）。
- 已知呈现瑕疵（非本轮引入、不影响判定）：`projections.ts:20` 的密钥脱敏正则会匹配字段名 `authorization`，
  因此持久事件里逐侧 `authorization` 显示为 `[REDACTED]`；同一裁决在未被脱敏的顶层 `sideAuthorization`
  与 `executableSides` 中完整可读（示例均为 `EXECUTABLE`）。

### G3 — 单 symbol 行情异常只隔离该 symbol

- 运行中自然样本（`01-pipeline-after-deploy.json`，02:36:10）：
  `marketDataIsolation = {candidateCount 6, isolatedCount 1, healthyCandidates 5, isolated:[{BNBUSDC, TECHNICAL_5m_MISSING_LATEST_CLOSED}]}`，
  同时 `pipelineState=RUNNING`、`marketDataReason=null`、`noEntryReason=null`，且 `authoritativeBlocker.evidence.isolatedSymbols=["BNBUSDC:TECHNICAL_5m_MISSING_LATEST_CLOSED"]`。
- 稍后（02:55:18）行情全清：`candidateCount 14, isolatedCount 0, healthyCandidates 14`，`freshMarkets.status=FRESH, sequenceInvalid=0`，仍 `RUNNING`。
- 全局 market-data pause 未发生：整轮 `marketDataReason` 恒为 null。
- 系统性故障与全候选失效仍会全局暂停：`marketDataStaleness.test.ts` 的 ST 全坏例 + 系统级 `MARKET_WS_*`/`MARKET_QUOTES_STALE` 标签优先于隔离。
- 未为掩盖坏数据增加任何模型调用：本轮 `ANALYSIS_DISPATCH_*` 只覆盖健康候选，`AI_SIZING_ERROR=0`。

### G4 — 唯一权威首因与 next action

- Engine 单次评估产出 `authoritativeBlocker = {code, stage, nextAction, evidence, secondary[], evaluatedAt}`，
  驾驶舱直接渲染，不再自行排序。
- 在线渲染（`09-dashboard-dom-proof.json`、截图 `08-…png`）：
  - 首因卡：`NONE · 无需处理：Entry 管线可用，继续由确定性硬门决定是否建仓`，说明行含「stage NONE」。
  - 次级区：`次级诊断 3 项（不作为第二个首因）` → `CAPACITY_DIAGNOSTIC:BOTH_SIDES_EXECUTABLE`、
    `SUPPLY_DIAGNOSTIC:ELIGIBILITY · READY 3（可执行 3）`、`MODEL_DIAGNOSTIC:ANALYSIS_REASON · AI_RESOURCE_BUSY`。
  - 页面不存在第二处自算优先级：`[data-market-isolation]` 在 `isolatedCount=0` 时不渲染（数据驱动），
    隔离面板在有隔离时按 §G3 样本出现；系统性横幅未出现。
- **G4 不完整项（须如实记录，不掩盖）**：当管线本身未受阻而每一轮 Entry 尝试都被确定性风险门拒绝时，
  `authoritativeBlocker.code` 仍为 `NONE`，「为什么现在不能建仓」的首因只出现在 `entryConversion`
  （`topDropStage=PORTFOLIO_RISK`、`topDropReason=HUMAN_ACK_OVERDUE`）与逐轮事件中，未被提升为带 nextAction 的权威 blocker。
  修复需要新增 `RISK_ADMISSION` stage（自清除、只取当轮拒绝）并重启部署；本轮 lifecycle 授权仅 1 次且已消费，
  因此留到下一次授权轮，未在本轮以「本地偷偷改代码 + 不再重启」的方式假装闭合。

## 9. 写入与资产边界

| 项 | 停机前 | 本轮运行实例 | 说明 |
| --- | --- | --- | --- |
| environment / executionMode | TESTNET / TESTNET_ENABLED | 同左，`lockedToTestnet true` | 未放宽 |
| Production writes | 0 | **0** | `blockedProductionWriteAttempts 0` |
| Testnet writes | 见说明 | **0**（`lastWriteAt null`） | 计数器是 `ExternalTradeAdapter` 的进程内字段，重启即归零，跨重启不可比；本轮 0 次提交/0 次成交与 `submitAttempted=0` 一致 |
| 持仓 | 23（17 SHORT / 6 LONG） | **23（17 SHORT / 6 LONG）** | 全部 `managementStatus=HUMAN_MANAGED`；毛名义 ≈ $11,117，浮动盈亏 ≈ −$884 |
| TP 覆盖 | 15 PROTECTED / 8 MISSING | **15 / 8** | 未清仓、未撤已有保护 |
| 所有权 | 23 条 HUMAN_HANDOFF | 同左（12 条已超 `maxAckAgeMs`） | 未删除任何人工持仓 |
| UNKNOWN 建仓单 | 47 持久，其中 1 条当时无续证 | **47 持久 / 47 条活跃无风险续证 / 0 条占用 pending risk** | 未把 UNKNOWN 当 0：`activeRiskExposure false` 且 `VERIFIED_NO_ACTIVE_RISK` 未过期且 tombstone 匹配 |
| 对账 | DEGRADED | DEGRADED（`driftCount 23`，`unresolvedDriftCount 4`，`activeRiskUnresolvedCount 1`） | 未通过改事实掩盖 |

## 10. 仍存在的真实 blocker（保持原语义，不放宽）

1. `HUMAN_POTENTIAL_NOTIONAL_LIMIT` + `STRESS_LIMIT:MAX_GROSS_NOTIONAL` / `MAX_CLUSTER_NOTIONAL`：
   毛名义 $11,116.14 vs `maxHumanNotionalUsd = maxGrossNotionalUsd = $10,811.957` → **headroom −$304.19**。
   任何规模的新 Entry 都不存在；唯一释放方式是人工减仓（`10-human-capacity-stopline.json`）。
2. `HUMAN_ACK_OVERDUE`：23 条全为 `HUMAN_HANDOFF`，其中 **12 条超 24h 未确认**（最长约 165h）。
   确认只解除本项，不解除第 1 项。
3. 经济门（SHADOW 呈现，ENFORCE 语义未改）：`ECONOMIC_MIN_NET_PROFIT_UNMET`（要求 $1，最小合法数量处预期 $0.02–0.10）、
   部分候选 `TP_REACH_PROBABILITY_UNMET`。这是「最小合法规模 ≈ $5 名义」与「$1 净收益下限」的既有张力，须人工裁决，不改阈值。
4. `MARGIN_TIER_SYMBOL_UNPROVEN:ZROUSDT`、`MARGIN_TIER_SYMBOL_UNPROVEN:1000BONKUSDC`：margin-tier 权威缺行，容量不成立（不用全局默认杠杆凑数）。
5. 手动单 `manual_order_manual_intent_mufgan4j_qkas7dya`（XRPUSDT SELL 10 @1.47，clientOrderId `ec1_mufgan4j_001350f`）状态 UNKNOWN 未决 →
   `activeRiskUnresolvedCount=1`，本轮 `MANUAL_ORDER_REMOTE_STATUS_UNVERIFIED` 重试 10 次。
6. 8 条 TP MISSING 的修复被 `REDUCTION_PROOF_NO_LIVE_POSITION` 阻断（attempt 4/5，`submissionOutcome=NOT_ATTEMPTED`）→
   交易所真实持仓与持久行不一致，须在人工侧核对。
7. `ACCOUNT_ASSET_UNVERIFIED:BTC` 本轮未触发：BTC 估值已验证（$839.93），其被排除于新建仓资金的原因是
   `NOT_IN_ENTRY_FUNDING_UNIVERSE`（Entry 资金白名单仅 USDT/USDC）。偿付/抵押品语义与 Entry 资金语义仍分层，
   fail-closed 路径仍在 `portfolioRiskSnapshot.ts:168`，并由 `j2PortfolioAdmissionHostile.test.ts` 覆盖。
8. `PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` 与 `PENDING_RISK_UNVERIFIED:order:entry_intent_mubl212x_z8fndm8t` 各出现 1 次
   （后者随后已取得活跃无风险续证，不再占用）。

## 11. 下一阶段（≤5 项）与明确不该做的

1. G4 补 `RISK_ADMISSION` stage：管线可用但被确定性风险门逐轮拒绝时给出唯一权威首因 + nextAction（需一次新 lifecycle 授权）。
2. 人工侧裁决：确认 12 条超期 handoff、处置 XRP 手动 UNKNOWN 单、决定是否减 ≈$307 名义以恢复新增风险。
3. 8 条 TP MISSING 的 `REDUCTION_PROOF_NO_LIVE_POSITION` 根因（交易所持仓真值 vs 持久行）。
4. margin-tier 覆盖扩到 ZROUSDT / 1000BONKUSDC（只读采集 + 原子权威提交）。
5. `authorization` 字段与密钥脱敏正则的命名冲突：把逐侧裁决字段改为不与凭据正则碰撞的名字（保持 `sideAuthorization` 兼容读法）。

不该做的：不再以「请求数 / UNKNOWN 行数」为优化目标（R17 结论：该行数是 `-2013` 循环的副产品，收敛无关）；
不放宽 $1 净收益、reachability 阈值、`aiExitLossLimitUsd=10`、human/gross/cluster/maxPositions 上限、JIT/freshness/egress 门；
不把 UNKNOWN 折算为 0；不改 `aiExitAuthority=SHADOW`；不解锁 Production 写入；不为了让 `authoritativeBlocker` 好看而重命名真实拒绝原因。

## 12. 证据清单

- 实现轮门禁与 build：`docs/evidence/v396/g1-g4-implementation-20260926/00…13*`（`13-targeted-tests.txt` 为本轮补跑）
- 在线验收轮：`docs/evidence/v396/g1-g4-final-acceptance-20260926/`
  `01-pipeline-after-deploy.json`（G3 自然隔离样本）、`02-closeout-after-deploy.json`、`03-settings-after-deploy.json`、
  `04-readback-after-deploy.json`（身份/写入/资产/UNKNOWN/G1–G4 汇总）、
  `05-settings-provenance-217-to-218.json`（917 字段深比对）、
  `06-g2-quantity-chain-since-restart.json`、`07-g1-direction-authority-since-restart.json`、
  `08-dashboard-g4-authoritative-verdict.png`、`09-dashboard-dom-proof.json`、
  `10-human-capacity-stopline.json`、`11-identity-closure.json`、`14-s00-after-acceptance-scripts.json`
- S00 入口清单再生：`docs/evidence/v396/S00/20260921T145000Z/entrypoint-review.json`（派生重算，非手工编辑）
- 只读回采工具（无写操作，仅 GET + `readOnly` 打开 SQLite）：
  `scripts/v396-g1-g4-acceptance-readback.mjs`、`scripts/v396-g1-g4-identity-closure.mjs`、
  `scripts/v396-g1-direction-authority-readback.mjs`、`scripts/v396-g2-quantity-chain.mjs`、
  `scripts/v396-settings-provenance-diff.mjs`、`scripts/v396-human-capacity-stopline.mjs`
- 验收细则：`docs/plans/v396/CODEX-V396-G1-G4-FINAL-LOCAL-ACCEPTANCE-20260926.md`（本轮实现后补齐）、
  `docs/plans/v396/CODEX-V396-LOCAL-ACCEPTANCE-TAKEOVER-20260926.md`
