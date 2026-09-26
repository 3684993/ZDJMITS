# ZDJ-MITS V3.9.6 — PLACE → Submit 根因闭合报告（2026-09-26）

Runbook：`docs/plans/v396/CODEX-V396-PLACE-TO-SUBMIT-ROOT-CAUSE-EXHAUSTION-20260926.md`
分析阶段报告：`docs/reports/v396-place-to-submit-root-cause-analysis-20260926.md`（`5f7c578`）
分支：`codex/v396-final-convergence-20260922`，本轮提交 `5f7c578 → 78b5750 → c8a469e → cfc90bb`（均已 push，`0 0` 与 origin 同步）
**最终状态：`V396_PLACE_TO_SUBMIT_BLOCKED_BY_VALID_ENFORCED_RISK`**
（③/④ 类阻断已清零并给出可核对数值；剩余阻断是两条真实 ENFORCE 权威，需人工动作，本轮不放宽。）

---

## 1. 一句话结论

264/265 笔 Brain `PLACE` 全部止于 `PORTFOLIO_RISK_ADMISSION`，下游 plan/reservation/intent/submit 在保留窗口内事件数与持久化行都是 0。根因不是资金、不是交易所过滤、不是 JIT，也不是执行链：是**两条真实上限已被现有 22 个仓位穿透**（毛名义 `11,113.54` vs 承诺上限 `10,811.957` ⇒ headroom `−301.59`）加上**22 行人工交接确认超期**（上限 24 h，最旧 `175.2 h`，与名义规模无关）。

本轮把与之共存的 4 处 ③/④ 类缺陷修掉，并让容量视图、逐候选 trace、pre-AI envelope 与首因文案全部回到**同一个准入权威**；两条真实约束原样保留。

## 2. 每道门的临界值（全部可核对，非区间估计）

| 门（权威） | 上限 | 已用（书本级，无候选） | 可新增 | 判定 |
|---|---|---|---|---|
| `MAX_GROSS_NOTIONAL`（profile，ENFORCE） | 10,811.957 | 11,113.54 | **−301.59** | 真实拒绝，任意名义均超 |
| `HUMAN_POTENTIAL_NOTIONAL`（profile，ENFORCE） | 10,811.957 | 11,113.54（22 行全部是交接行） | **−301.59** | 与 gross 同值重述，仍 ENFORCE |
| `MAX_CLUSTER_NOTIONAL`（`correlation.clusters = {}`） | 10,811.957 | 11,113.54（单一 `UNMAPPED_CORRELATED` 桶） | **−301.59** | 同上，仍是独立承诺字段，未删 |
| `MAX_DIRECTION_NOTIONAL` | 8,649.565 | LONG 3,637.25 / SHORT 7,476.29 | **+5,012.31 / +1,173.27** | 通过 |
| `MAX_CAPITAL_AT_RISK`（保证金单位） | 10,811.957 | ≈1,082.6 | ≈+9,729 | 通过 |
| `HUMAN_ACK_OVERDUE` | `maxAckAgeMs=86,400,000`（24 h） | 22 行未确认 | 不适用（规模无关） | 真实拒绝，只能人工确认 |
| 交易所最小合法名义 | `max(minNotional, minQty×ref)` | 5.00（AAVEUSDT 15.493） | — | 模型恰好落在 floor，通过 |
| 资本可执行名义 | 2,508.79–3,639.32 / 候选 | — | — | 通过（资金从来不是瓶颈） |

**人工需要释放多少才能出现第一笔 reservation**（同一候选，书本级 headroom −301.59）：
`5.008 → 306.60`｜`5.024 → 306.61`｜`5.032 → 306.62`｜`5.038 → 306.63`｜`5.051 → 306.64`｜`15.515(AAVEUSDT) → 317.10` USD，**且**必须先把 22 行超期交接确认掉（本轮禁止自动 ack）。
瞬时待证成敞口（`PENDING_RISK_UNVERIFIED`）会把 claim 毛名义再抬高最多约 `+588 USD`（13:04:53 样本：claim `11,701.85` vs 书内 `11,113.54`），因此报告面现在同时给出书内名义、pending 名义与 claim 名义三个数，不再让运维按被放大的数字减仓。

## 3. 根因 → 修复 → 测试（只修 ③/④，①/② 原样保留）

| # | 缺陷（类别） | 修复 | 测试 |
|---|---|---|---|
| 1 | `portfolioRiskLedger.admit()` 把 reasons `.sort()` 后取 `reasons[0]`，字母序 `HUMAN_ACK_OVERDUE` 长期冒充首因，遮蔽真正 Binding 的美元上限（③ 错误归因） | `rankAdmissionReasons()`：证据缺失 → 与规模无关的拒因 → headroom 最小的门（同额时按 gross/human/cluster/capital/direction 稳定次序）；决策与 `ENTRY_DECISION_BLOCKED` 附 `firstBinding{limit,used,headroom,shortfall}` 与逐门 `gates[]`，所有 reason 仍保留 | PT-01～PT-05、PT-14 |
| 2 | 容量层写死 `portfolioRisk:{allowed:true}`（`entryCapacityTrace.ts:193`、`preAiExecutionEnvelope.ts:114`），显示 `BOTH_SIDES_EXECUTABLE`＋`LONG 可执行 396.28` 与准入 0% pass 并存（③ 隐藏权威 + ④ 展示面驱动派单） | 新增 ledger `capacityFacts(now,symbol)`（书本级、无候选）+ `admissionCapacityReader`（读已安装的那一个权威，缺席＝无判决，绝不等于无限空间）；`computeExecutableRiskHeadroom` 增加 `admission` 维度（refusal 表达为 0 room，不进 blocker 名单以免污染资金语义）；envelope/preflight/JIT 与逐候选 trace 共用同一判决，`sideStatus` 新值 `RISK_ADMISSION_EXHAUSTED`、`firstBlocker/exhaustedReason='RISK_ADMISSION'` | PT-06、PT-07、PT-08～PT-13、PT-15 |
| 3 | 三道门（gross／human／cluster）在 `clusters:{}` 下是同一个数字的三次重述，`PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` 只是逐行 blocker 的摘要标签，却与真门并列（③ 重复/摘要遮蔽） | 三者继续 ENFORCE；归因层把摘要降为其下具体 code 之后，门事实携带 `clusterKey='UNMAPPED_CORRELATED'`、`unit`（NOTIONAL/MARGIN/LOSS）与 `co-binding` 列表，杜绝“四道独立门”的误读 | PT-01、PT-04 |
| 4 | 部署后新暴露：预模型停止派单后 `admit()` 不再被调用，`lastRiskAdmissionVerdict` 5 min 过期 ⇒ 首因回落成 `NONE`“无需处理”，而同一投影已是 `RISK_ADMISSION_EXHAUSTED`（③ 一致性残留） | `authoritativePipelineVerdict` 在没有更新鲜判决时采用容量投影携带的书本级判决（仍低于任何 pipeline 级 code），并带判决年龄与两侧可新增上限；`HUMAN_ACK_OVERDUE` 文案补数值（行数/上限/最旧小时） | PV-11、PV-12 |
| 5 | 部署后再暴露：门拒绝时 idle 首因仍写 `NO_RUNNABLE_CANDIDATE`，而路由报 6–7 个“可执行候选”——把钱的可执行数当权限结论（③ 错误归因） | `processPool` 的标签改读同一 `bookAdmissionSummary`：门在任意名义拒绝 ⇒ 写 `WAITING_EXECUTION_CAPACITY` 并给出门名/临界值/上限；READ_ONLY 分析模式与派单豁免一致（那里无新风险可拒，不得静默市场证据） | grossRiskCapacityVisibility 新例 |

初始假设 “UNKNOWN 无活动风险证明 TTL 与审计节拍错配导致 ~25/30 min 反复占用” 被 `a03` 普查否证（47/47 行证明有效期即其自身阶梯间隔，普查时刻占用行 0），因此**未改 occupancy 判定、未延长任何 TTL、未把 UNKNOWN 当 0**；`PENDING_RISK_UNVERIFIED` 保留为再证明迟到时的瞬时 fail-closed。

## 4. 部署与身份闭环（一次受控 lifecycle，已消费）

- `scripts/stop-zdj-lan.ps1` 一次：`ZDJ-MITS stopped; port 8080 is free`，旧 pid 37996 已消失、8080 探测 `False`。
- `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` 一次：新 pid **30748**，5 s 内健康。
- 闭环核对（部署当时 HEAD `78b5750`，`scripts/v396-g1-g4-identity-closure.mjs`）：`remoteHeadEqualsLocalHead / committedSourceTreeMatchesRuntimeSourceHash / workingDistMatchesRuntimeArtifactHash / buildIdDerivedFromArtifactHash / runtimeApiMatchesInstanceFile / sourceTreeCleanForHashedFolders` **全部 true ⇒ `IDENTITY_CLOSED`**；运行实例 `buildId 3.9.6-3ae58df252aad4155f93`、`artifactHash 3ae58df252aad4155f93…`、`sourceHash e6dd2d4befc6cae09f0cbabbeff211b22d0b6cf34a99cb81515c243f98e352b0`（部署前旧实例为 `e45d2547…/b2e9f84f…`）、`pid 30748`、`restartCount 190`、`startReason MANUAL_START`。
- **未闭环项（须披露）**：随后两个提交 `c8a469e`、`cfc90bb` 已构建进 dist（`3.9.6-fa4fbc8660ef12849644`）但**未部署**，因此运行态 `3ae58df2…` ≠ 当前 HEAD ⇒ 复跑 identity 得 `IDENTITY_BROKEN`（`dirtySourcePaths` 为空，工作树干净，差异只是“运行的产物早于最后两个提交”）。本轮 runbook 只授权一次 `stop → MANUAL_START`，已用于主修复，故**不追加生命周期**；把该产物上线需要一次新的明确授权。

## 5. 在线 Testnet 回读（自然流量，未制造 PLACE、未制造成交）

| 项 | 部署前（pid 37996 / `e45d254…`） | 部署后（pid 30748 / `3ae58df2…`） |
|---|---|---|
| 容量视图 sideStatus | `BOTH_SIDES_EXECUTABLE`（“LONG 与 SHORT 均可新增”） | **`RISK_ADMISSION_EXHAUSTED`** |
| capacity firstBlocker / exhaustedReason | `NONE` / `null` | **`RISK_ADMISSION` / `RISK_ADMISSION`** |
| 容量视图携带的门判决 | 无该字段 | `admission={exhausted:true, code:'HUMAN_ACK_OVERDUE', ceilingUsdBySide:{LONG:0,SHORT:0}, detail:…}` |
| 资金数（仍单独可见，未被冒充为权限） | LONG 396.28 / SHORT 459.48 | LONG 395.39 / SHORT 453.01（同屏标注“资金”） |
| 一致判定（同一投影同时刻） | 矛盾成立 | `b02`（刚启动，pipeline 级 code 在位）`consistent:true`；`b04`（14:50:57，pipeline 级 code 清空后）`consistent:false` —— 容量面已是 `RISK_ADMISSION_EXHAUSTED / RISK_ADMISSION / ceiling 0,0`，而权威首因回落成 `NONE`。这正是修复 4 处理的内容，尚未部署 |
| 模型请求 | 24 次/小时（24 envelope、24 PLACE、24 拒绝） | 启动后 26 min：**AI_RUN_TERMINAL 0、envelope 0、PLACE 0、admission 评估 0**（`lastRequestAt=null`） |
| reservation / intent / submit / fill | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0（窗口内） |

诚实归因：启动后 0 次派单的**直接**原因是 `ready` 池为空（`NO_RUNNABLE_CANDIDATE`，`capitalExecutable 6–7`），即本轮修复的“首因标签必须写成容量”这一 ③ 类缺陷的现场表现；由于没有构建 envelope，本轮**未能**在线上直接观察到“pre-AI envelope 以门的临界值拒绝且 `modelCallConsumed:false`”这一条，它目前只有 PT-08/PT-09 的本地证明。部署 `cfc90bb` 后该时刻应显示为 `WAITING_EXECUTION_CAPACITY` 并附门名与数值。

未观察项（明确标注，不算通过）：
- 自然 `PLACE → reservation → intent → submit` 的第一笔（被两条真实 ENFORCE 权威禁止，本轮不得人工 ack、不得减仓、不得放宽）；
- 部署后新构建（`3ae58df2…`）下带 `firstBinding/gates` 数值的 `ENTRY_DECISION_BLOCKED` 事件（启动后无候选被评估，故 0 条）；
- 修复 4/5 的线上效果（未部署）。

## 6. 边界与冻结项复核（全部保持）

`productionWrites=0`、`blockedProductionWriteAttempts=0`、`lockedToTestnet=true`、`environment=TESTNET`、`executionMode=TESTNET_ENABLED`、本进程 `testnetWrites=0`（重启后计数归零，部署前该进程累计 9）；`settingsVersion=219`（本轮**未**变更任何设置：既未放宽也未新增治理写入）；`entrySafetyMode=AUTO`；`aiExitAuthority=SHADOW`；`tradeEconomics.admissionMode=SHADOW`（267 次经济评估 `wouldBlock=true` 仍只是遥测，未被升级成 veto）；保护状态 `required 22 / protected 22 / missing 0 / positionFactUnresolved 0`；PR #9 未修改、未评论、未切换（本全程仅 `git push` 当前分支，fast-forward）。

## 7. 本地门禁（GitHub Actions 不使用：`NOT_RUN_BILLING_LIMIT`）

| 门禁 | 命令 | 退出 | 结果 |
|---|---|---|---|
| 定向新增 | `npx vitest run placeToSubmitCapacityTruth / pipelineVerdict / grossRiskCapacityVisibility / entryCapacityTrace / finalRiskConvergence / j2PortfolioAdmissionHostile / preAiExecutableSides` | 0 | 全绿（含新增 15+2+1 例） |
| Engine 全量 | `apps/engine: npx vitest run` | 0 | **1413 passed / 173 files** |
| packages/core | `npx vitest run` | 0 | 58 passed / 8 files |
| Dashboard | `npx vitest run` | 0 | 60 passed / 14 files |
| contracts | `npx vitest run` | — | **NO_TEST_FILES**（按原样记录，不声称覆盖） |
| 工作区 typecheck | `npm run typecheck` | 0 | 全部 workspace 通过 |
| verify:deps | `npm run verify:deps` | 0 | contracts+core 重建 |
| verify:scripts | `npm run verify:scripts` | 0 | 16 node:test + 4 PowerShell 契约 PASS |
| S00 T01–T06 | `node scripts/v396-s00-static-check.mjs` | 0 | 6/6 PASS，`blockers:[]`，entrypoints 138（新脚本后重生成清单），测试隔离 173/173，`exchangeWrites=0`、`engineLifecycle=NOT_USED`、`settingsModified=false` |
| 存储覆盖 | `node scripts/v396-storage-coverage.mjs` | 0 | `gate=S08_STORAGE_COVERAGE_PASS` |
| 空白/尾随 | `git diff --check` | 0 | 无（仅 autocrlf 提示） |
| formal build | `npm run build` | 0 | engine tsc + dashboard vite 全绿 |
| hosted CI | — | — | `NOT_RUN_BILLING_LIMIT`（未触发任何 hosted job） |

## 8. 修改文件清单

新增：`apps/engine/src/services/admissionCapacityReader.ts`、`apps/engine/src/services/placeToSubmitCapacityTruth.test.ts`、`scripts/v396-place-to-submit-chain-audit.mjs`、`scripts/v396-place-threshold-counterfactual.mjs`、`scripts/v396-unknown-occupancy-census.mjs`、`scripts/v396-place-to-submit-live-check.mjs`；证据 `docs/evidence/v396/place-to-submit-root-cause-20260926/{a01,a02,a03,b01,b02,b03}.*`。
修改：`portfolioRiskLedger.ts`（`capacityFacts`/`gateFacts`/`reasonsOf`/`rankAdmissionReasons`/`correlationClusterOf`/`admit` 返回 `firstBinding+gates`）、`executableRiskHeadroom.ts`（`admission` 维度与 `observed.admission`、`factVersion` 绑定该判决）、`riskReadiness.ts`（`RISK_ADMISSION` 维度与 `admission` 投影）、`entryCapacityTrace.ts`（真实门判决、`RISK_ADMISSION_EXHAUSTED`、`PORTFOLIO_RISK_DENIED` 与门名/数值）、`preAiExecutionEnvelope.ts`、`preflightFeasibility.ts`、`runtimeControlService.ts`、`entryCoordinator.ts`（verdict 数值化、书本级标签、reader 接入）、`pipelineVerdict.ts`、`state/runtimeState.ts`、`packages/contracts/src/trading.ts`（envelope 侧 `admission` 持久字段）、`grossRiskCapacityVisibility.test.ts`、S00 entrypoint 清单、storage-coverage 证据。

## 9. 下一步（≤5，含明确“不再做什么”）

1. 申请一次新的受控 lifecycle，部署 `cfc90bb`（dist `3.9.6-fa4fbc8660ef12849644`），复跑 identity 至 `IDENTITY_CLOSED`。
2. 部署后只做一次只读复验：自然首因必须写成 `WAITING_EXECUTION_CAPACITY`＋门名＋两侧上限，且 `ENTRY_DECISION_BLOCKED` 带 `firstBinding/gates` 数值。
3. 人工动作二选一（都由人决定，不由系统代做）：确认 22 行交接，或把毛名义降到 `10,811.957` 以下（≥ `306.60` USD，按最大候选 `317.10`）；两者完成后才可能出现第一笔 reservation。
4. 若之后仍被拒，只报告新的**具名门＋数值**，不再新增聚合标签。
5. 保持 `clusters:{}` 现状；把它填成真实相关性簇是“新增风险权威”，需要独立治理决定。

不再优化：`/order` 请求数与 UNKNOWN 审计节拍（R15/R17 停止线）；不为获得 submit 而调阈值、ack、减仓或制造 PLACE；不再为 V3.9.6 做功能性“完善”——本轮之后只处理新的真实运行事实。

---

**最终状态：`V396_PLACE_TO_SUBMIT_BLOCKED_BY_VALID_ENFORCED_RISK`** — ③/④ 类阻断（字母序归因、两处 `portfolioRisk.allowed=true` 硬编码、摘要标签遮蔽真门、书本级拒绝被写成“无候选”、瞬时 pending 放大临界值）已修复并有本地证据；剩余阻断是 `HUMAN_ACK_OVERDUE`（规模无关）与 `maxGrossNotionalUsd/maxHumanNotionalUsd = 10,811.957` 对 `11,113.54` 的 `−301.59` 缺口，两者均为真实 ENFORCE 权威，只能由人工消除。
