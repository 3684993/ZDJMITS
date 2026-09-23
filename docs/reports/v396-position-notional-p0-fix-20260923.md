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
