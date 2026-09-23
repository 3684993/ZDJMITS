# V3.9.6 P0 修复：`Position.notionalUsd` 语义裁决与实现（2026-09-23）

针对 [v396-testnet-cutover-20260923](./v396-testnet-cutover-20260923.md) §9 的 P0。**本轮只改离线代码并复跑门禁；未启动、停止或重启任何 Engine，未修改现网 Settings/DB，未向交易所发出任何请求。**

## 1. 语义裁决

`Position.notionalUsd` = **无向名义金额幅度**（`≥0` 或 `null`），方向只由 `side` 表达；需要带符号敞口处必须显式派生。三条依据：

1. **同一行数据自相矛盾**：`ExternalTradeAdapter.fetchPositions` 写入 `quantity: Math.abs(amount)` 与 `side = amount>0?'LONG':'SHORT'`，却把交易所原样带符号的 `notional` 存进 `notionalUsd`。同一对象里一个字段已归一化、另一个没有。
2. **权威风险数学根本不读这个字段**：`executableRiskHeadroom.ts:18` 用 `Math.abs(p.quantity*p.markPrice)` 重算持仓敞口；`portfolioRiskSnapshot.ts:197` 与 `economicEntryFeasibility.ts:23` 同样用 `Math.abs`。因此把字段改成幅度不会改变任何 gross/direction/cluster 数值（红测第 3 项已把这一点钉住）。
3. **放宽契约比崩溃更危险**：`portfolioRiskSnapshot.ts:223` 写作 `nonNegative(row.notionalUsd)?row.notionalUsd:0`，而 `humanCapacityPolicy.ts:38`、`portfolioStress.ts:73`、`portfolioRiskLedger.ts:205` 都以 `notionalUsd>0` 作为筛选条件，`portfolioRiskLedger.ts:216` 更把 `<=0` 判为无效候选。若把 `.nonnegative()` 改成允许负数以求启动，空头会被这些过滤器当成"零敞口"静默剔除，gross/cluster/压力损失与人工容量全部被低估。红测第 4 项记录的正是这个失效模式（10 笔空头里只数到 1 笔）。

## 2. 改动

| 文件 | 改动 |
|---|---|
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 新增 `magnitudeOrNull`，`notionalUsd` 与 `maintenanceMarginUsd` 在**生产边界**取幅度（`null` 语义保持不变，缺字段仍为 `null`，不补 0） |
| `apps/engine/src/state/runtimeState.ts` | 新增模块级 `normalizeRestoredPosition`，在 `restore()` 的 `positions` 分支归一化**已落盘的旧数据** |
| `apps/engine/src/services/positionNotionalSemantics.test.ts` | 新增 4 项行为测试（红→绿） |

只改这两处生产代码，是因为崩溃有两条入口：新同步数据与重启时读取的历史数据。被终止的那次运行已把 29 条持仓（含 10 条负值）写入 `runtime_entities`，只修适配器仍会在下次启动复现同一崩溃。契约、投影与 J2 求和均**未放宽**：契约继续要求非负，投影继续原样透传，聚合继续用绝对值重算。

## 3. 红测证据

`positionNotionalSemantics.test.ts` 修改前 **2 failed | 2 passed**（失败正是适配器与 restore 两条路径），修改后 **4 passed**。四项分别钉住：交易所空头映射为无符号且保留 `side`/`quantity`；历史带符号行经 `restore()` 后非负且 `dashboardProjection()` 不再抛错；带符号与无符号两种存储形态下 `gross/long/short` 完全相等且 `gross = long + short`（不互相抵消）；`>0` 过滤器会把空头静默读成零敞口的反证。

## 4. 真实数据启动路径验证

对**当前迁移后 Testnet 库的副本**跑实际启动路径（`SettingsStore.loadRuntime()` → `RuntimeState.restore()`）：

```
positionsPersisted 29  persistedNegative 10
positionsHydrated  29  hydratedNegative    0
everyShortNonNegative true   everyShortKeepsPositiveQuantity true
AVAXUSDT SHORT: 存储 -4516.200524 -> 读回 4516.200524（quantity 400 不变）
```

现网磁盘上的负值本轮**未改写**（不属于本轮授权范围）；下次 Engine 正常持久化时会写成幅度值。冷镜像 `88c8ed2e…` 仍是干净的 V3.9.5 回滚点。

## 5. 门禁（仓库根目录，裸命令读真实退出码）

| 门禁 | exit | 结果 |
|---|---|---|
| `npm run verify` | 0 | deps+scripts+typecheck+build+test；engine **1,139**/150 文件、core 46/8、dashboard 25/9 |
| `node scripts/v396-s00-static-check.mjs` | 0 | `blockers: []` |
| `node scripts/v396-storage-coverage.mjs --check` | 0 | `STORAGE_COVERAGE_CHECK_PASS gate=S08_STORAGE_COVERAGE_PASS` |
| `git diff --check` | 0 | 无空白问题 |

测试数从 1,135 增至 1,139，即新增的 4 项行为测试，没有删除或跳过任何既有用例。

## 6. 第二次启动前仍缺的运行证据

本修复只覆盖已确证的 P0 崩溃路径，以下仍是 `NOT_RUN`，不能由离线绿灯推断：SHADOW 观察窗及其事件计数（`AI_EXIT_SHADOW_DECISION`、`AI_MANAGEMENT_DEADLINE_FIXED`、`POSITION_FACT_UNVERIFIED`、`RISK_*`、`TRADE_PLAN_PERSISTED`、复核台账与 `usageStatus=UNKNOWN` 比例）、SHADOW 期交易所写请求数为 0 的判据、E 段自然候选写链、24h soak、以及 >30 分钟 AI 静默告警（P1-1，属 V3.9.5/V3.9.6 共同缺口，本轮未改）。**不签 ACCEPTED。**

下一次启动需要一次新的具体授权；本轮不自行启动。

---

# 追加：所有权 scope 键修复（同日，D 段后发现）

D 段第二次启动后确认 P0 已修，但发现我在 C2 引入的 P1：迁移主体用 `executionScope(env, cred, SYMBOL, 'ENTRY')`，而 `OwnershipRuntime.identity()` 按持仓方向 `positionSide` 推导 scope，两把键永不相撞。裁决是**运行时为准、迁移写错了**：`OwnershipSubject` 本身就是 `{symbol, positionSide, cycleId}`，`'ENTRY'` 属于建仓订单占用域（`executionLifecycle.ts:10-13` 明确区分），持仓周期的权威必须按方向记账；反过来改运行时键会孤立既有 claim，正是那段注释警告的事。

**修法**：把派生收进产品代码，调用方不能再手搓 scope——`OwnershipMigration.subjectsForPositions(positions, identity)` 用与运行时同一个 `executionScope(env, account, SYMBOL, side)`，并在身份缺失、cycleId 为空、方向不在持久词表、管理状态未知时直接抛错（不补默认、不静默跳过）。新增驱动 `phase-c-d/ownership-migration-v2-driver.mjs` 的关键不同是**用运行时自己的键读回**（`journal.get(executionScope(...side), cycleId)`）再判定不变式，而不是检查迁移写了什么；Engine 运行中会先被 `engine-is-stopped` 拒绝（已实测拒绝并落 FAIL 记录）。

**测试**：`ownershipScopeIdentity.test.ts` 3 项——红测先失败（helper 不存在），随后因我对迁移版本语义的误解再次失败（人工持仓迁移是 initialize + takeover，起点就是 version 2 而非 1，这是产品行为、不是缺陷；断言因此改为"同一行且被推进"而不是钉死版本号）。现在 3 项全绿：共享派生下 Engine 落在**同一行**；`'ENTRY'` 键产生**两条并行行且迁移行永不被读取**（正是现网账本的形状，留作回归护栏）；派生守卫按预期抛错。

**门禁**：`npm run verify` exit 0（engine 1,142/151 文件、core 46、dashboard 25），S00 exit 0 且 `blockers: []`，storage coverage `S08_STORAGE_COVERAGE_PASS`，`git diff --check` 0。测试数 1,139 → 1,142 为新增 3 项，未删或跳过任何既有用例。

**仍未闭合，且需要单独授权**：现网 `v396-ownership.sqlite` 里 57 行 / 28 个双行周期 / 6 个 `HUMAN_MANAGED`+`AI_ACTIVE` 冲突不会因代码修好而消失——引擎在运行且持有该文件，清理必须"停机 → 备份 → 用 v2 驱动重建 → 读回校验 → 再启动"。在该清理完成前**不得**把 `aiExitAuthority` 切到 `ENFORCE`（那会给 6 笔人工持仓授予 AI 退出权限），E 段因此仍为 `NOT_RUN`。`AI_MANAGEMENT_DEADLINE_FIXED`/`V396_OWNERSHIP_OUTBOX` 仍在正常记录，`READ_ONLY` 下交易所写入累计仍为 0。
