# C3 生产接线 Round 1 结果

时间 2026-09-22T06:10Z。基线：fetch 后 `merge --ff-only` 到 `6eea58e`（含本指示文件与 `v396ExitRuntime.ts` 骨架）。执行依据 `docs/plans/v396/CODEX-C3-WIRING-ROUND1-20260922.md`。无 rebase / squash / force，PR #9 未动。

## 起点（红）

上一轮只读清点的敌意文件在 `6eea58e` 上 22 项 17 失败（记录在 `docs/evidence/v396/final-convergence-20260922/C2/VERIFICATION-20260922T0319Z/` 与其后的清点报告）。本轮先按指示补红，再机械接线，最终把该文件重写为接线验收文件 **25 项全绿**。

## 按条款落地

- **§0 骨架修正**：`PositionExitCoordinator.requestExit` 接受可选 `requestKey`，clientOrderId 种子改为 `scope|cycleId|source|R:requestKey`；无 requestKey 时保留旧 `Q:quantity` 语义（离线 S04 矩阵不变）。`ExitTask` 持久化 `stepSize` 与 `requestKey`。`V396PrepareExitInput.requestKey` 必填，MANUAL/TP 一律校验非空（离线 coordinator 层不强推，避免改写已冻结语义）。
- **§1 adapter**：新增只读 `exitCoordinationCapabilities()`（由 `hedgeMode()` 真实推导，ONE_WAY⇒oneWayReduceOnly、HEDGE⇒hedgePositionSide、`cancelReplaceAtomic:false`）、`proveReduction()`（读 `/fapi/v2/positionRisk`，按真实持仓校验，ONE_WAY 用净持仓方向、HEDGE 必须匹配 `symbol+positionSide` 且 `0<quantity≤live`，超量/无仓抛错）、`findExitByClientOrderId()`（三态：FOUND / 仅 `-2013|-2011` 判 ABSENT / 其它错误抛出）。`placeManualOrder` 不再把 `positionId` 抹成空串。
- **§2 appRuntime**：在 `<dataDir>/v396-ownership.sqlite` 构造 `V396ExitRuntime`（environment+credentialRef 身份、adapter 能力 provider），注入 `TpGuardian`、`ManualPositionService`、`TestnetLowLossCleanupService`；启动后 `convergeRecoveredExits()` 只做 exact 读与 `observe`，绝不重发；shutdown 关闭。未新建第三个库。
- **§3 ManualPositionService**：journal 变为必需且缺失即 `MANUAL_EXECUTION_JOURNAL_UNAVAILABLE`（删除 `this.journal?.claim` 静默退化）；任何人工 action 先 `recordHumanTakeover`（ADD 也撤销 AI 管理权，但不占退出额度）；REDUCE/EMERGENCY_CLOSE 走 fresh position+quote → `proveReduction` → 整数 units → `prepareManual`，不接受即不写交易所；交易所请求使用 coordinator 返回的 clientOrderId；submit 前 `SUBMITTING`，成功后 `observe`，抛错先按同 ID 查实、否则 `markSubmitUncertain`。
- **§4 TpGuardian**：注入 exitRuntime；`place()` 成为唯一 TP 出口：canonical scope（full symbol+positionSide+当前 cycleId，缺失即 `TP_CYCLE_ID_REQUIRED` 不新造）、先读 durable mandate（`revokedAt!=null` 即 `TP_REPAIR_BLOCKED_MANDATE_REVOKED`，force 也不能越过）、无 mandate 时建立 GUARDIAN `FULL_REMAINING`、HUMAN mandate 不被覆盖、`proveReduction` → 稳定 requestKey → `prepareTakeProfit` → 使用返回 clientOrderId → 本地先 UNKNOWN → `SUBMITTING` → 才 `placeTakeProfit`；抛错按同 ID 查实：FOUND 收养并 observe，ABSENT/查询失败保持 UNKNOWN 且禁止下次 sweep 建第二张。ensure() 不再自造 `TP*` clientOrderId。
- **§5 human revoke**：新增 `POST /tp/:positionId/revoke`（要求 `confirm=true`；先写 durable revoke，再尝试撤单，返回 `canceled/unknown` 并广播 `TP_PROTECTION_REVOKED_BY_HUMAN`）；`POST /tp/:positionId/repair` 在 mandate 被人工撤销时默认 409，仅 `confirmRearm=true` 经 `rearmProtectionByHuman`（写 HUMAN mandate，且必须证明 revokedAt 已清空）才放行；临时 suspend/resume 不等于 revoke。
- **§6 cleanup**：Testnet 清理写入口改为 `prepareManual` + adapter proof + coordinator clientOrderId + 抛错 `markSubmitUncertain`，不再自建 `cleanup_*` ID 直接下单。
- **§7 identity 最小范围**：三个退出 writer 统一 `executionScope(environment, credentialRef, FULL_SYMBOL, positionSide)` + 原 `position.cycleId`；未做全仓 cycle 迁移，也未新增 `${symbol}:${side}` 退出 claim 或随机 cycle。

## 接线过程中先红后绿的确定性缺陷

| # | 现象（红） | 根因 | 处理 |
|---|---|---|---|
| W1 | 人工退出在 journal 缺失时仍直达交易所 | `this.journal?.claim` 可选退化 | 必需参数 + `MANUAL_EXECUTION_JOURNAL_UNAVAILABLE` fail-closed |
| W2 | 每个 TP 提交都被 `REDUCTION_PROOF_UNPROVEN` 拒 | `proof.checkedAt` 晚于 prepare 里用的 `now`（先取时间后取证据） | prepare 的 `now` 在 proof 之后重取 |
| W3 | TP 提交报 `PRICE_NOT_TICK_ALIGNED` | guardian 用 stepSize 兜底当 tickSize | `ensure()` 把真实 quote tickSize 传入 `place()` 上下文 |
| W4 | 同一 TP 存在两个候选身份 | `ensure()` 自建 `binanceClientOrderIdFactory.create('TP',…)` | 交由 coordinator 单一生源，本地先置 null |
| W5 | 未成交的本地合成 UNKNOWN 行被 observe 成 WORKING（伪造交易所事实） | 成功路径统一 observe 了 `stored` | 只 observe 交易所返回/查实的行 |
| W6 | 离线 S04 矩阵 4 项被 `REQUEST_KEY_REQUIRED` 打破 | 在 coordinator 层强推新字段 | requestKey 约束移到生产桥（V396ExitRuntime），离线路径保持旧语义 |
| W7 | engine typecheck 在 HEAD 即为红（我上一轮的假绿） | 我在 round 2 末尾从 `apps/` 目录跑 `npm run typecheck -w`，workspace 未命中却 exit 0 | 修正 C2 测试里 4 处 `loadRuntime()` 的 unknown 访问；本轮所有门禁一律从仓根执行并复核 exit 码 |

## 被改动的既有测试语义（需 review，未删除任何风险守恒断言）

`executionLifecycle.integration.test.ts` 的 “protects real remainder and joins new keys for UNKNOWN/WORKING/PARTIALLY_FILLED”：原断言“人工平仓后 guardian 仍补一张覆盖余量的 TP”，与新共享 claim 不变量冲突（同一 scope+cycle 上会出现两张全量退出单）。改为断言：在途平仓 claim 未终态前 **不产生第二张全量退出**，并且拒绝原因必须是 `QUANTITY_BUDGET_EXCEEDED` 或 `TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT`，同时余量仍被真实持仓覆盖。其余 TP/人工测试只补了新契约要求的事实（`cycleId`、adapter 只读证明、共享同一 exitRuntime 实例），断言未放宽。

## 门禁

| 门禁 | 结果 |
|---|---|
| targeted（C3 25 + S04 11 + 人工/TP/对账/execution 集成 + S05 76 + C2 23） | 225 / 225 PASS（`targeted.json`） |
| 全仓 Engine | 141 文件 / 954 测试全绿（`full.json`） |
| `npm run typecheck -w @zdj/engine`（仓根执行） | exit 0，`error TS` 0 |
| `npm run build -w @zdj/contracts` / `-w @zdj/core` | exit 0 / exit 0 |
| `node scripts/v396-s00-static-check.mjs` | T01–T06 PASS，blockers 0，141 测试文件、11 个开库测试全隔离（`s00-static-gate.json`） |
| `git diff --check` | 干净 |

## C3 测试对照（指示 §8）

1 一 claim 拒第二全量退出 ✓；2 无 manual journal ⇒ 0 次交易所调用 ✓；3 TP PREPARED 先于 exchange（并断言事件顺序）✓；4 抛错后按同 clientOrderId 查实、UNKNOWN 不二发 ✓；5 人工接管后旧 AI ownerVersion 被拒 ✓；6 revoke 后 sweep/force 均不重建，`rearmProtectionByHuman` 显式放行才恢复 ✓；7 ONE_WAY 带 reduceOnly、HEDGE 证明必须匹配 positionSide+live 数量、超量 0 提交 ✓；8 adapter 保留 positionId ✓；9 部分成交只留真实余量 ✓；10 重启只 query、FOUND 才收敛、绝不重发（含跨文件重开同一 sqlite）✓；11 同 requestKey 恒定、终态后新 requestKey 可建 ✓；12 cleanup 不再绕过 coordinator ✓。另加：engine 构造/注入/启动收敛/shutdown 关闭的来源断言。

## 剩余 blocker（不在本轮范围）

- AI 退出仍未生产启用：`EntryCoordinator` 未接 `prepareAiExit`，`V396ExitRuntime` 也没有 AI 入口；`s03AiExitPolicy` 的 verdict 未被任何写路径消费 ⇒ S04/G2 与 S05/G3 仍未达成，AI 新退出保持 OFF。
- `hedgeMode()` 60 秒缓存意味着模式变更最坏 60 秒后才反映；本轮按既有读取路径实现，未加主动失效。
- `EntryExecutionJournal`/entry 侧仍用 `resolveUnderlying` claim key（属 C3 Round 2 的 canonical identity 统一）。
- `reconciliationService` 只做了 claim/owner 的读端补齐（经 `markEntryReservationWorking` 与 TP 的 `REMOTE_ORDER_FACT_ACTIVE`），全写路径审计仍属 Round 2。
- Testnet 真实写路径、Engine 生命周期、现网迁移与部署：一律未执行，需用户单独授权后在 S10 前完成。
