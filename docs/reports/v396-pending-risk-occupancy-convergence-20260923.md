# V3.9.6 Pending Risk 单一占用事实源收敛（2026-09-23）

计划：`docs/plans/v396/CODEX-V396-PENDING-RISK-OCCUPANCY-CONVERGENCE-20260923.md`
基线：分支 `codex/v396-final-convergence-20260922`，`fetch` 后 `merge --ff-only` 到 `0c87cf2`（相对 `32feb03` 仅多一个 docs/plans 提交，产品代码未变）。
本轮性质：离线产品修补 + 只读对账。**零 Engine 生命周期动作、零构建写 live dist、零 Settings 写、零交易所写。**

## 1. 改了什么

删除 `PortfolioRiskAdmission` 自建的第二套 active-order 判定（原 `portfolioRiskLedger.ts:153-163`）：

```ts
[...state.entryReservations.values()].filter(row=>['RESERVED','WORKING'].includes(String(row.status))&&Number(row.expiresAt)>now)   // 旧
[...state.entryOrders.values()].filter(row=>['NEW','PARTIALLY_FILLED','UNKNOWN','SUBMITTING'].includes(String(row.status))
  &&(!row.expiresAt||Number(row.expiresAt)>now))                                                                                    // 旧
```

其危害有两处：`EntryOrder` 契约里根本没有 `expiresAt`（真实字段是 `absoluteExpiresAt`），所以 `!row.expiresAt` 对全部 46 条 UNKNOWN 恒真，永久计入；并且它完全不看权威释放证明。

现在只有一行：

```ts
const builtPending:PortfolioPendingRiskFact[]=collectPortfolioPendingRiskFacts(state,{now});
```

`collectPortfolioPendingRiskFacts` 放在 `entryRiskOccupancy.ts`（与占用语义同一模块），成员资格**只**来自 `collectPendingEntryRiskExposures`（其内部用 `entryOrderOccupiesRisk`），本函数只补 PortfolioRisk 快照需要的字段，不再决定"是否占风险"：

- `dedupeKey = id = order:<orderId> | reservation:<reservationId>`：lineage 由单一投影保证互斥（order 代表其 reservation 时不再另出 reservation 成员），键稳定、重启后相同；
- `notionalUsd`：剩余数量 × 价格（partial fill 只计未成交部分），reservation-only 用其自身经验证的 notional；
- `marginUsd`：reservation 用其契约验证的 `marginUsd`；order 用剩余 notional / 自身 leverage；leverage 不可证时保留 `NaN` 让快照拒绝，**不填 0、不编默认杠杆**；
- `quoteAsset`：`pendingEntryQuoteAsset()` 按 lineage 顺序取权威值 —— reservation → allocation plan → symbol suffix（最后手段，有测试与理由）→ `UNKNOWN`；USDC 不再落进 USDT 桶；
- `source`/`factStatus`：order 状态为 `UNKNOWN` 或终局交换状态未证时强制 `source='UNKNOWN'` 且 `factStatus='UNKNOWN'`，即继续 fail-closed。

`grep` 复核：`portfolioRiskLedger.ts` 中已不存在 active-order 状态枚举，余下的 `'UNKNOWN'` 全是 `factStatus` 值域。

## 2. 红→绿

新文件 `apps/engine/src/services/pendingRiskOccupancyConvergence.test.ts`（11 例）。修补前在旧实现上 **7 failed / 4 passed**，修补后 11 passed；受影响面 `j2PortfolioAdmissionHostile`、`finalRiskConvergence`、`s05PortfolioTailRisk`、`grossRiskCapacityVisibility`、`executionReadiness` 全绿。

计划要求的 7 类：

| 案例 | 结果 |
| --- | --- |
| T1 `UNKNOWN` + 有效 `VERIFIED_NO_ACTIVE_RISK`（exposure=false、tombstone 匹配、未过期） | 不在 pending、无该 order 的 `PENDING_RISK_UNVERIFIED`、durable 行仍为 `UNKNOWN`（未改写） |
| T2 `UNKNOWN` 无证明 | 仍占风险、`factStatus=UNKNOWN`、blocker 存在 |
| T3 过期 / tombstone 不匹配 / evidence 非 VERIFIED（参数化 3 例） | 全部继续占风险 |
| T4 reservation→order lineage | 只有 `order:o1` 一个键，reservation 不再另计，notional=600 |
| T5 partial fill（20 中成交 15，价 100） | pending=500、`pendingNotionalUsd=500`，不是 2000 |
| T6 USDC lineage | `quoteAsset=USDC`、margin=剩余/杠杆；reservation-only 分支保留其经验证的 margin 100 |
| T7 线上型 46 行（44 有效证明 + 2 未证） | 只剩 `keep1`/`keep2` 两条，`pendingNotionalUsd=110_000`（44×$150 幻影不再计入），且 membership 逐行等于 `entryOrderOccupiesRisk` 真值集合 |
| 额外：裸 `UNKNOWN`（无 exchangeOrderId、无成交） | 仍占风险 —— 证明"缺 id/零成交"单独不构成无风险 |
| 不变式：任意混合集合 | `pending` 中 order 成员 === `entryOrderOccupiesRisk` 真值集合；`source` 只在 `RESERVATION/ORDER/UNKNOWN` 内；被代表的 reservation 不出现第二次 |

## 3. 只读现场对账（`gates/`、`reconciliation-live-durable.json`、`released-count-change.json`）

以 `0c87cf2` 删除的谓词为 "before"（逐字转录），以隔离 `build-check/` 编译出的真实新权威为 "after"，对同一批 durable 行、同一 `now` 重放：

| 指标 | before（旧 status-only） | after（单一权威） |
| --- | --- | --- |
| pending order 数 | **46** | **0**（当前采样时刻全部已重新证明） |
| pending notional | **$31,236.33** | **$0**（gross 差值 −$31,236.33） |
| quote 资产分桶 | USDT `$31,236.33`（含 10 条 USDC 后缀 order 被硬写 USDT） | 无 pending 行；USDC 正确性由 T6 锁定 |
| reservation/order 双计 | 当前无活跃 reservation，故 0 | 0（结构上不可能双计，见 T4/T5） |
| durable UNKNOWN 行数 | 46 | 46（id 集合与上一轮 21:42 快照完全相同，未删除、未改写） |

**为什么这次是 46/0 而不是上一轮的 44/2**：不是本轮放宽任何东西。那两条当时仍占风险的行（`BTCUSDT`、`VVVUSDT`）在 22:33:27 与 22:35:21 被周期性远端复核重新证明（`remoteAudit.tier=2`、`consecutive=6`、`verifiedCount=6`，evidence `checkedAt` 22:33/22:35、`validUntil` 23:03/23:05、tombstone 匹配、`activeRiskExposure=false`），于是权威判定释放。远端复核对同一事实不再重复发事件（`shouldEmitNoRiskEvent` 把重复证明折叠成汇总），所以"21:42 之后没有新事件"不等于"没有再核"。释放判据一字未改：任何行一旦证明过期就重新占风险（T3 与既有 `reoccupies risk automatically when verified UNKNOWN evidence expires` 测试都钉住这点）。

fail-closed 复核（`reconciliation-live-durable.json` 的 `failClosedProperties`）：被释放行中 `entryOrderOccupiesRisk=true` 的 **0** 条、无有效证据却释放的 **0** 条、带 `exchangeOrderId` 的 **0** 条、有成交量的 **0** 条。

## 4. 门禁（真实退出码，`gates/exit-codes.txt`）

`verify-deps=0`、`s00-static=0`、`storage-coverage=0`、`engine-affected-tests=0`、`engine-typecheck=0`、`engine-tests=0`、`engine-build-check=0`（输出仅到隔离 `build-check/`，随后删除）、`core-typecheck=0`、`core-tests=0`、`contracts-typecheck=0`、`contracts-tests=0`（`--passWithNoTests`，**contracts 仍为 0 例，不代表任何契约层覆盖**）、`git-diff-check=0`。
计数：Engine **155 files / 1194 tests**（上一轮 154/1183，本轮 +1 文件 +11 例）、core 8 files / 46 tests、`pendingRiskOccupancyConvergence` 11 例。Dashboard 未改，故不重跑无关 UI 浏览器验收。

## 5. 现场未被触碰的证据

`live-boundary-unchanged.json`：仍是 PID `50996` / `buildId=3.9.6-dc8fb58b578c25d10726`（即 `e284a1a` 构建，**不含本补丁**）、`READ_ONLY`、`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`、`settingsVersion=191`、caps `1 / 0.8 / 50`、`aiExitAuthority=SHADOW`、`entrySafetyMode=AUTO`、`portfolioRisk.configured=false`、持仓 14、`executionReadiness.firstBlocker=EXECUTION_WRITE_LOCKED`。

## 6. 停止线：下一轮只做什么

1. 一次经授权的部署让本补丁上线，然后只读复核 `PORTFOLIO_RISK_ADMISSION_EVALUATED` 中 `PENDING_RISK_UNVERIFIED` 是否归零、gross 求和是否只剩权威占用集合。
2. 部署复核通过后，才进入 `riskGovernance.portfolioRisk` 的人工数值审批（Agent 不代填、不猜值）。
3. profile 批准后在只读验收中确认剩余 blocker 集合是否为空 —— **本轮不承诺"配好 profile 就能建仓"**：仓位级事实（margin tier / maintenance / liquidation / ownership 读回）是否全部转为 `VERIFIED` 只有真实 profile 求值后才知道。
4. 仍不处理：`executionMode`、`aiExitAuthority`、两个敞口上限与 `maxPositions`、私有 60 秒窗与 REST timeout、proxy/egress 抖动、P3 驾驶舱文案。
5. 登记但**不改**（越出本 scope）：`candidateSupplyHealth.ts` 与 `appRuntime.ts` 仍有各自的 active-status 枚举，用于供给健康与快照保护计数，不是 pending 名义风险账；它们会把已释放的 UNKNOWN 仍算作"该标的在途"，方向保守，属独立议题。
