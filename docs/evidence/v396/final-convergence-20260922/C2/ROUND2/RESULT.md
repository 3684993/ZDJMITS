# C2 修复 Round 2 结果

时间 2026-09-22T04:10Z。基线：`codex/v396-final-convergence-20260922` fetch 后 fast-forward 到 `16ed2c67105d2ebcf9e91fd4a8b307f9712c4109`（含本 round 指示文件），未使用 `codex/v396-astra-handoff-20260922`。执行依据 `docs/plans/v396/CODEX-C2-FIX-ROUND2-20260922.md`，无 rebase / squash / force。

## 起点（修复前红测）

同一 `c2ReservationAtomicityHostile.test.ts` 的 Round-1 版本在 `16ed2c6` 上 **18 项 11 失败**；完整红测记录保留在 `docs/evidence/v396/final-convergence-20260922/C2/VERIFICATION-20260922T0319Z/`（RESULT.md + red.json）。本轮按指示先修产品源码，再按必测清单重写敌意测试。

## 已修内容（按指示条款）

### D1 权威事实进入 reservation 原子事务
`RuntimeState.reserveEntry()` 现在在 `SettingsStore.mutateEntryReservations()` 持有的同一 `BEGIN IMMEDIATE` 窗口内、写预留之前 fail-closed 复验：

- `privateAccountFresh(account, now)`（`READY` + 有限 `asOf` + 60 秒内 + 未来不超过 5 秒）；否则 `PRIVATE_ACCOUNT_STALE` / `PRIVATE_ACCOUNT_NOT_CONFIGURED` / `PRIVATE_ACCOUNT_UNAVAILABLE`；
- `runtimeControl.capital` 必须为正整数 `generation`、有限且不晚于 now 的 `evaluatedAt`、非空非 `'0'` 的 `capitalVersion`、`nextRecheckAt > now`（`CAPITAL_GENERATION_REQUIRED` / `CAPITAL_EVALUATION_UNPROVEN` / `CAPITAL_VERSION_REQUIRED` / `CAPITAL_FACTS_EXPIRED`）；
- 调用方若声明 `riskGeneration` / `riskCapitalVersion`，与权威事实不一致即 `RISK_GENERATION_STALE` / `CAPITAL_VERSION_STALE`；
- 预留必须绑定 `riskBinding{riskGeneration,snapshotHash,evaluatedAt,expiresAt}`，`expiresAt=min(capital.nextRecheckAt, account.asOf+60_000)` 且严格大于 now；缺字段、hash 为空、时间倒挂一律 `RISK_BINDING_INVALID`；
- `entryRiskGate` 降为 S05 完整压力模型扩展：装了就必须通过并被绑进 binding，不装也仍有上面的基础闸（基础闸不再依赖它是否被安装）。`snapshotHash` 复用 S05 的 `stableRiskHash`（唯一的哈希口径），未安装 gate 时按 `{riskGeneration,capitalVersion,evaluatedAt,nextRecheckAt,accountAsOf}` 生成。

### D2 事务外直写清零
`RuntimeState` 新增两个原子 API：`markEntryReservationWorking(id, intentId?, exchangeFact?)`（唯一合法 RESERVED→WORKING；RELEASED/过期行只允许携带远端订单凭据 `exchangeFact{orderId,reason}` 才重开，并写入 `reopenedBy:'EXCHANGE_FACT'`/`reopenOrderId`/`reopenedFromStatus` 审计字段；COMMITTED 永不重开）与 `upsertRecoveredEntryReservation(row)`（启动合并）。改造点：`entryCoordinator.ts` 3 处、`reconciliationService.ts` 3 处、`appRuntime.ts` 启动合并 1 处。机械 grep：`apps/engine/src` 内除 `state/runtimeState.ts` 外，运行期 `entryReservations.set/delete` 命中数 **0**（由测试 8 钉住）。revision 只在 map/lock 真变化时递增；无变化的拒绝走 `RESERVATION_NO_CHANGE` 回滚，既不涨 revision 也不写 payload。

### D3 重启不再分叉 revision
`restore()` 只装载（不 cleanup、不开事务，已在测试中钉住）。`appRuntime` 顺序：`loadRuntime` → `restore` → 安装事务钩子 → 装载 durable entry/order → `upsertRecoveredEntryReservation` 原子合并 → 在途/UNKNOWN 恢复完成后才执行一次显式 `state.cleanupReservations()`（同一持久 mutation，内存 revision 与库 revision 保持一致）。测试覆盖：持久 revision=1 + 过期 RESERVED + 仅存于 `entry_execution_tasks` 的 UNKNOWN 订单 → 合并装载后仍占用、cleanup 返回 false、durable 状态保持 `RESERVED`；订单证实终态后才释放，且重启后首次合法预留不再因 revision 错位永久失败。

### D4 状态读纯净化
`reservationSummary()` 不再调用 cleanup、不再开 `BEGIN IMMEDIATE`；过期项以 `expiredReservations` 诊断字段暴露（`expiredLocks` 保留）。store 钩子抛错时状态读不冒异常。释放改由明确 mutation 路径承担：`reconciliationService.run()` 开头调用 `cleanupReservations()`（注释指明这是 C2/D4 的命名 mutation），加上 `reserveEntry` 事务内的原子 reaping 与启动显式一次。

### D6 非法 status 保守占用
`reservationHoldsRisk(row)` = 未被显式终态化即占用；用于 `reservationSummary.active` 与预留保证金 `committed` 累计（含已过期但未释放的行，保持 Round-1 已修好的“过期不等于释放”语义）。`reservationOccupiesRisk(row, now)` = 未终态且未过期，用于 `entryCapacity` 与 `reserveEntry` 的同 underlying 判定，并把 underlying 统一大写比较（非规范 underlying 不再绕过）。restore/启动合并遇到未知 status 一律转 `WORKING` + `recoveryReason:'RESERVATION_STATUS_UNKNOWN'`，绝不作为空闲容量。

### D7 陈旧私有账户
5 种边界全部拒绝并保留 0 条预留：`NOT_CONFIGURED+asOf=null`、`UNAVAILABLE`、61 秒前、未来 6 秒、余额 NaN；只有新鲜 `READY` 才继续。

## 保留（未回退，全部有测）

RESERVED+WORKING 共同占 quote 保证金；UNKNOWN 订单存续时过期预留不释放、显式 release 被拒；`VERIFIED_NO_ACTIVE_RISK` 才允许释放对应 UNKNOWN；嵌套事务 fail-closed 且内存回滚；stale revision 不能覆盖较新 payload（`STALE_RESERVATION_CHECKPOINT`）；无 map/lock 变化的拒绝不涨 revision、不写 payload。

## 必测对照

| Round2 必测 | 测试 | 结果 |
|---|---|---|
| 1 两个 RuntimeState / 同一 SettingsStore 旧 revision 并发 | `two revision-current writers compete once…` | PASS（胜者 1 条 active，durable revision 单调） |
| 2 A reserve → B restore → A mark WORKING → B reserve 不丢更新 | `an API-marked WORKING transition survives a second writer…` | PASS（durable 仍为 WORKING + intentId） |
| 3 restart + expired reservation + UNKNOWN order | `restore loads only…` / `the startup sequence releases provably expired risk durably…` / `an expired reservation whose UNKNOWN order is only in the durable entry store stays occupied` | PASS |
| 4 reservationSummary 纯读且 hook 抛错不冒 | `reservationSummary is a pure read even with expired rows and a failing store` | PASS（transactions 计数不变） |
| 5 陈旧账户 5 种边界 | `…cannot size a reservation`（it.each 4 例）+ `a non-numeric balance is refused…` | PASS |
| 6 非法持久 status 仍占风险 | `an unrecognised persisted status occupies margin and capacity…` | PASS |
| 7 risk binding 非 null 且 generation/version/expiry 任一不匹配即拒 | `an admitted reservation carries a non-null risk binding…` / `a caller claim that disagrees…` / `stale capital facts cannot authorise…` / `the S05 gate stays an extension…` | PASS |
| 8 grep 守卫：运行期无 API 外直接写 | `no production module outside RuntimeState writes the reservation maps at runtime` | PASS（命中 0） |
| 额外（指示文件另两条建议） | 双 SettingsStore 连接同 dataDir 竞争、终态行不被普通重试复活、读路径源码位置守卫 | PASS |

## 门禁

| 门禁 | 结果 |
|---|---|
| targeted（C2 23 项 + reservationConvergence + runtimeState + 3 个 reconciliation + v370 + tradingQuality + sideNeutral + s05PortfolioTailRisk） | 215 / 215 PASS（`targeted.json`） |
| 全 Engine | 139 文件 / 926 测试 PASS（`full.json`） |
| `npm run typecheck -w @zdj/engine` | exit 0，`error TS` 0 |
| `npm run build -w @zdj/contracts` / `-w @zdj/core` | exit 0 / exit 0 |
| `node scripts/v396-s00-static-check.mjs` | T01–T06 PASS、blockers 0、139 测试文件、11 个开库测试全部隔离（`s00-static-gate.json`） |
| `git diff --check` | 干净 |

## 本轮改动文件

产品源码：`apps/engine/src/state/runtimeState.ts`、`apps/engine/src/runtime/appRuntime.ts`、`apps/engine/src/services/entryCoordinator.ts`、`apps/engine/src/services/reconciliationService.ts`。
测试与夹具：`apps/engine/src/state/c2ReservationAtomicityHostile.test.ts`（新增，23 项）、`apps/engine/src/state/reservationConvergence.test.ts`、`apps/engine/src/state/runtimeState.test.ts`、`apps/engine/src/services/tradingQualityTestHarness.ts`、`apps/engine/src/services/v370Contract.test.ts`（后三个是夹具：补齐 D1 要求的权威 capital 事实，并把一处“generation 不匹配”断言的原因码从 `RISK_BINDING_INVALID` 更正为更早、更精确的 `RISK_GENERATION_STALE`；未删除任何风险守恒断言）。

## 需要 review 的一处删除

C1 提交 `14b34e6` 删除了我 Round-1 S05 文件里的 “modules stay pure and **unwired**” 守卫（其断言包含“除彼此与测试外无生产消费者”）。删除理由可理解（无消费者不等于安全），但随着 `runtimeState.ts` 现在 import `stableRiskHash`，这条守卫已不可能原样保留，也无人替代它记录“谁可以消费 S05 纯模块”。建议 C3 之前把它恢复成白名单形式（显式列出允许的生产消费者 + 禁止触达下单路径），避免纯计算模块被无声接进写路径。

## 边界与未达成项

未启停 Engine、未部署、未改 live Settings/DB、未访问交易所写接口、未发单；测试只用 `mkdtemp` 下的临时 SQLite。S05-G2/S04 并发写路径端到端（C3）、真实账户下的 `entryRiskGate` 完整压力模型接入，仍未完成；本文件不声明整版 ACCEPTED。
