# V3.9.6 gross 风险额度可见化 + 分析恢复回归 + AI Run 详情 UX 一轮修补（结果记录）

执行基线：`docs/plans/v396/CODEX-V396-RISK-SETTING-AND-AI-RUN-UX-PATCH-20260923.md`；分支 `codex/v396-final-convergence-20260922`，起始 HEAD `2a909f3`（fetch 后 `merge --ff-only`，无 rebase/squash/force，PR #9 未触碰）。2026-09-23，北京时间。状态：`READY_FOR_REVIEW`，不自签 ACCEPTED。

本轮为纯离线代码/测试修补。当前运行的 V3.9.6 Testnet 主实例（PID `31776`，`3.9.6`，READ_ONLY + SHADOW）未启停、未热重载、未改 live Settings/DB；本轮构建**未部署**：`live-readonly-instance-snapshot.json` 显示运行中 payload 的 `capacityVisibilityPresent=false`，且 `apps/dashboard/dist`、`apps/engine/dist` 文件时间仍为本轮开始前的 13:20。

## 1. 实际改动文件

源码（7 个）：

- `apps/engine/src/services/riskReadiness.ts`：`directionBudget` 增加只读派生字段（`equityUsd`、`grossLimitUsd`、`directionLimitUsd`、`grossNotionalUsd`、`longNotionalUsd`、`shortNotionalUsd`、`remainingGrossUsd`、`grossUsedPct`），原有 4 个门输出键与算式不变；新增 `portfolioCapacityVisibility(capacity,budget)` 与 `CapacityBlocker`/`OCCUPIED_CAPACITY_BLOCKERS`。
- `apps/engine/src/services/entryCoordinator.ts`：`processPool()` 空 `ready` 分支改为按同一风险计算结果选首因；`AI_RESOURCE_BUSY`/`BUDGET_OR_COOLDOWN`/诊断阶梯未改。
- `apps/engine/src/runtime/appRuntime.ts`：`pipelineStatus()` 增加 `capacityVisibility` 只读投影（复用同一次 `entryCapacity()` 结果）。
- `apps/engine/src/state/runtimeState.ts`：未评估capital 的 `directionBudget` 占位补齐为同构零值。
- `apps/dashboard/src/views/SettingsView.vue`：新增“组合暴露上限”小组，暴露两个已有字段。
- `apps/dashboard/src/views/OverviewView.vue`：新增槽位/gross/LONG/SHORT/首因事实块与 `firstExplanation` 主解释。
- `apps/dashboard/src/views/BrainView.vue`：AI Run 详情抽屉关闭体验（顶部 sticky 关闭、`closeDetail()`、Escape、焦点外移、焦点回归）。

测试（4 个新文件）：`apps/engine/src/services/grossRiskCapacityVisibility.test.ts`（10 例）、`apps/dashboard/src/views/SettingsView.exposure.test.ts`（4 例）、`apps/dashboard/src/views/OverviewView.capacity.test.ts`（4 例）、`apps/dashboard/src/views/BrainView.auditDrawer.test.ts`（6 例）。

未改：`packages/contracts` schema、`portfolio.maxPositions`、`tradingParameterProfiles.ts`、任何阈值/默认值/live 值。

## 2. 现有 gross 字段语义与暴露位置

`riskGovernance.maxGrossExposurePct`、`riskGovernance.maxDirectionExposurePct` 仍是唯一真字段，本轮没有新建第二套额度：

- 契约：`z.number().positive().max(20)`，默认 `1` / `0.5`；存储为 ratio，`1 = 100% 权益`，技术边界 `20 = 2000%`（边界不等于建议值，本轮未提高任何值）。
- 治理矩阵：`unit:'RATIO'`、`min:0.0001`、`max:20`、`editable:true`、`effectiveAt:'NEXT_ENTRY_CYCLE'`，消费者仍指向 `executableRiskHeadroom.ts` 与 `riskReadiness.ts`（测试把这条元数据钉住）。
- UI 暴露：系统设置 →“策略与执行”→“组合暴露上限”，文案“组合总名义敞口上限（占权益 %）/单方向名义敞口上限（占权益 %）”，按 `%` 编辑、保存时精确 `÷100`，复用既有 `api.saveSettings(draft)` 全量写边界（未新增 API，也未接入模板档位）。
- 驾驶舱暴露：`/api/v3/pipeline` 的 `capacityVisibility`（由 `runtimeControl.capital.directionBudget` 与 `entryCapacity()` 组成），页面只做展示与首因选择，不减敞口、不再算风险账。

## 3. 红→绿缺陷

1. `directionBudget` 只输出三个 `*AvailableNotionalUsd`，没有上限/当前值/占用%/剩余，操作员无法判断额度本身；红测 `expected undefined to be 10000`。修复后为同一函数的只读派生字段，门输出逐值不变。
2. 不存在“首个容量 blocker”组合事实；新增 `portfolioCapacityVisibility`，按门实际执行顺序判定 `POSITION_CAPACITY → GROSS → DIRECTION_LONG → DIRECTION_SHORT → NONE`，并把未评估（`evaluatedAt<=0`）单列 `NOT_EVALUATED`，避免启动瞬间把“无上限额度”误报成额度耗尽。
3. `entryCoordinator.processPool()` 在**已有 eligible/routed 候选但风险额度为 0** 时仍写 `WAITING_CANDIDATE`/“等待新的候选事实”（红测复现）。现写 `WAITING_EXECUTION_CAPACITY`，并把首因与规模一起给出：本轮夹具的实测 nextStep 逐字为 `新增风险额度已用尽：GROSS（Gross $10040.00 / $10000.00，槽位 1/50）；继续供给与订单维护`；`routes` 为空的老映射保留，无候选时仍是 `WAITING_CANDIDATE`。
4. 手工减仓后的自动恢复此前没有任何回归锁。
5. 系统设置完全没有这两个字段的控件（红测 4 例：标签不存在 → `expected true to be false`）；现按既有百分数约定暴露，并钉住说明文案与“改额度不改档位”。
6. AI Run 详情只有内容最底部的一个关闭按钮，且迟到响应可重新填充抽屉（红测 9 例失败）。现为顶部 sticky 关闭 + 底部关闭并存、`closeDetail()` 统一清理 `detail/detailError/detailId` 并 `detailSequence++`/`abort()` 使在飞响应作废、Escape 关闭、焦点从详情内部移到外部才关闭（内部按钮/`pre`/重试以及 `relatedTarget=null` 的失焦不误关）、关闭后焦点回到触发行按钮。

## 4. “手工减仓后自动恢复分析且写仍锁定”测试结果

`grossRiskCapacityVisibility.test.ts > resumes PRIMARY on the next tick after a manual reduction, with every exchange write still zero`：同一 `settings` 对象、`READ_ONLY` 不变、阈值 JSON 逐字不变，仅删除一个人工持仓 → `firstBlocker` 由 `GROSS` 变 `NONE`，下一次 tick 发布 `ANALYSIS_DISPATCH_INTENT(mode=ANALYSIS_ONLY)`，`ai.decide` 恰一次，`ANALYSIS_ONLY_COMPLETED` 出现，`entryIntents=0`、`entryOrders=0`，`placeEntry/cancelEntry/setLeverage` 均 0 次。另有纯算式回归：27/50 槽位下 gross 满仍 `GROSS`；提高比例只改未来准入输入，持仓对象逐值不变。

驾驶舱侧 `OverviewView.capacity.test.ts` 用线上同量级 payload 断言页面按投影逐值渲染（改 payload 数字即改显示，未在本机重算），并断言有候选且额度耗尽时主解释是 `CAPACITY_BLOCKED · Gross $x / $limit`，无候选时才回落供应侧文案。

## 5. AI Run 关闭 UX 测试

`BrainView.auditDrawer.test.ts` 6 例全绿：顶部关闭在审计内容之前且 `position:sticky;top:0`；顶部关闭生效；Escape 关闭且底部关闭仍在；焦点移到详情外关闭；详情内部焦点迁移/无 relatedTarget 不误关；关闭后迟到的 `brainRun()` 响应不再打开抽屉；关闭后焦点回到触发行按钮。

抽屉当前没有独立 overlay/backdrop（它自身就是占屏面板），因此未实现“点击外部关闭”，避免与文本选择/内部点击冲突；关闭通道为顶部按钮、底部按钮、Escape、焦点外移四条。

## 6. 全仓门禁（真实 exit code，仓库根/对应 workspace 运行）

| 门禁 | exit | 结果 |
|---|---|---|
| Engine `vitest run`（全仓） | 0 | 153 files / 1165 tests 全绿 |
| Engine `src/services/grossRiskCapacityVisibility.test.ts` | 0 | 10/10（红测见 `red-01`） |
| Dashboard `vitest run`（全仓） | 0 | 12 files / 39 tests 全绿 |
| Dashboard 本轮 3 个新文件 | 0 | 4+4+6 全绿（红测见 `red-02`、`red-03`） |
| `@zdj/core` typecheck / test | 0 / 0 | 8 files / 46 tests |
| `@zdj/contracts` typecheck / test | 0 / 0 | `--passWithNoTests`，仍 0 例：不得声称契约层覆盖 |
| Engine typecheck / build | 0 / 0 | build 输出重定向到 `build-check/engine` |
| Dashboard typecheck(`vue-tsc --noEmit`) / build | 0 / 0 | vite `--outDir ../../build-check/dashboard` |
| `npm run verify:deps` | 0 | contracts+core 构建 |
| `npm run verify:scripts` | 0 | 16 个 node 测试 + 4 个 ps1 契约 |
| `node scripts/v396-s00-static-check.mjs` | 0 | S00_T01..T06 全 PASS，114 entrypoints，`blockers:[]`，153 测试文件隔离，`repositoryDataDirReferences=0`、`productionPortReferences=0` |
| `node scripts/v396-storage-coverage.mjs --check` | 0 | `STORAGE_COVERAGE_CHECK_PASS gate=S08_STORAGE_COVERAGE_PASS` |
| `git diff --check` | 0 | 干净 |

偏差说明：计划第 4 节的 `typecheck/build` 全部执行，但 **两个应用 build 的产物写到 `build-check/` 临时目录**，没有覆盖 `apps/engine/dist` 与 `apps/dashboard/dist`。原因是运行中的 Engine 直接从这两处加载/回源服务，就地重建等于未经授权的部署并复现上一轮记录过的资产漂移。因此未运行会替换产物的 `npm run build`/`npm run verify` 整条链，改为等价的 `tsc --outDir` 与 `vite build --outDir` + `verify:deps` + `verify:scripts` + 四包 typecheck/test。

## 7. 运行实例只读复核（未启停）

`/health`：`status=READY`、`ready=true`、`releaseVersion=3.9.6`、PID `31776`、uptime 约 186 分钟；`checks`：`database=HEALTHY`、`privateData=READY`、`marketSnapshots=51`。`/diagnostics/closeout`：`environment=TESTNET`、`executionMode=READ_ONLY`、`lockedToTestnet=true`、`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`、`blockedProductionWriteAttempts=9`（历史累计，本轮未发出任何写请求）。`/api/v3/pipeline`：`eligibility.count=10`、`executableCandidateCount=10`、`analysis.reason=AI_RESOURCE_BUSY` 且 Primary 正在处理 `ADAUSDC`（资本候选已恢复、AI 正在跑，符合裁决不是缺陷）、`capacity={positions:14,inFlight:1,reserved:0,used:15,max:50}`、`pendingEntries={count:1,max:6}`（该在途建仓单为只读切换前遗留的行，本轮只观察不处理）。

同一 payload 里运行版 `directionBudget` 仍只有 `grossAvailableNotionalUsd=651.5992`、`longAvailableNotionalUsd=651.5992`、`shortAvailableNotionalUsd=0`，且 `capacityVisibilityPresent=false`：既证明本轮代码确未部署，也说明按新增投影的判定顺序，这组现值会给出 `DIRECTION_SHORT` 首因（gross/long 尚有约 $651.60 余量，SHORT 方向为 0）。原始读数见 `live-readonly-instance-snapshot.json`。

## 8. 证据清单

`evidence-index.json` 逐个记录 21 份工件的字节数与 LF 规范化后 sha256：`red-01..03` 为修复前失败转录（Engine 9 失败/1 通过、Dashboard 容量与抽屉 9 失败/1 通过、设置页 4 失败），`gate-01..16` 为最终代码下的门禁转录，`live-readonly-instance-snapshot.json` 为运行实例只读快照。

## 9. 停止线（本轮之后仍生效）

不提高 `maxGrossExposurePct`/`maxDirectionExposurePct`/`maxPositions`；不为增加候选放宽风险算法或把 UNKNOWN 记 0；不配置 `configured=false` 的 PortfolioRiskProfile；不切执行模式、不开放 Testnet 写、不切 `aiExitAuthority=ENFORCE`；不启停当前 Engine、不部署本轮构建；`packages/contracts` 0 例覆盖不得写成已覆盖；24h soak 计时仍不属本轮。
