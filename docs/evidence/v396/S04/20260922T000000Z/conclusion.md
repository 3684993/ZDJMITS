# S04 结论：READY_FOR_REVIEW（离线协调与故障矩阵，未接线）

阶段：S04 统一减仓执行与故障恢复。runId `20260922T000000Z`。base `b7f8cf7`（冻结收敛分支）。
状态 **READY_FOR_REVIEW**，未自签 ACCEPTED；**未接入 EngineRuntime**，未接发单路径，未部署，未启停 Engine，未访问交易所与外网，未改现网 Settings/DB，未发单，未做现网迁移。

## 实现

- `s04ExitCoordinator.ts`：`PositionExitCoordinator`
  - `requestExit`：单一入口，在同一事务里完成 verdict 有效性 → JIT 复验 → 适配器能力闸 → 同 scope+cycle 共享数量预算 → PREPARED 落盘 + claim + outbox；返回 `submitRequired` 只告诉调用方「可以发」，不发。
  - clientOrderId = hash(scope, cycle, **source**, quantityUnits)，故同一意图重试幂等、不同来源不共享身份。
  - `transition`（本地状态机）与 `observe`（交易所事实收敛）分离：见 P1-2。
  - `recoveryPlan`：只产出「按原 clientOrderId 查询」的清单与告警，不重发、不复活已失效授权、不重启 Engine。
- 复用 `OwnershipJournal` 的同一 DB 文件与事务原语（`transact/query/write`），使 ownership、outbox、claim、task 处于同一 SQLite 事务域。

## S04-T01…T10 证据（`s04-tests.json`，11 项全通过）

| ID | 注入 | 结果 |
|---|---|---|
| T01 | claim 前后两个退出并发（AI 100 / MANUAL 100 / MANUAL 50 / TP 100 / AI 1） | 只有一份 100 的 ACTIVE claim（`openClaimUnits=100`）；同来源重试幂等且 `submitRequired=true` 仅限 PREPARED；进入 SUBMITTING 后重试 `submitRequired=false`；TP 撞未确认退出被拒；MANUAL 只能受数量预算约束而非授权规则拦截 |
| T02 | 请求已到但 ACK 丢失 | 状态 UNKNOWN、clientOrderId 不变；本地猜测（WORKING/FILLED/CANCELED/REJECTED）全部 `null`；查询事实返回 WORKING→FILLED 后 claim 归零、`mustQuery` 清空；重复意图不再产生第二单 |
| T03 | TP 在撤销前/期间成交 | 部分成交后剩余量以事实为准：在途单仍持有 40 未成交额度时第二张 40 被预算拒绝；确认后 `filledUnits=120 > 100` 触发 OVER_FILL 跳过，任务状态不被坏事实污染 |
| T04 | 撤单超时、旧 TP 仍 WORKING | 存在 SUBMITTING/UNKNOWN 在途时 TP 全量退出被拒（`TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT`），收敛为 CANCELED 后 TP 才可重新挂保护 |
| T05 | 部分成交后跨 -10 / 到期 / 转人工 | 结算事实改变估值身份 → `JIT_ESTIMATE_STALE` 拒绝；越限后的 verdict 本身为 HANDOFF → `VERDICT_NOT_ALLOW`；在途 claim 保留（50），不被重置 |
| T06 | PREPARED/SUBMITTING/WORKING 各点崩溃 | 重开文件后任务状态、clientOrderId、claim 数量、`mustQuery` 全部一致；同意图重放仍幂等 |
| T07 | WS 乱序/重复、REST 迟到旧数量 | 事件按 `event_id` 去重；低于水位线 `STALE_WATERMARK` 跳过；成交回退跳过；终态任务不可复活（`TERMINAL_TASK`）；未绑定订单 `UNBOUND_ORDER`；数量单调不被坏事实倒退 |
| T08 | One-way / Hedge、精度、余额 | HEDGE 无 positionSide → `HEDGE_MODE_UNSUPPORTED`；ONE_WAY 无 reduce-only → `REDUCE_ONLY_UNPROVEN`；AI 在两者都不可证明时 `ADAPTER_CANNOT_PROVE_NO_EXPOSURE_INCREASE`；超过剩余量、0 量、名义额过小、价格未对齐 tick、非有限/负可用量一律拒绝，绝无增仓路径 |
| T09 | 新风险暂停、模型离线、出口未验证 | 非 ALLOW 判定（BLOCKED_FACTS / HANDOFF）不可下单；无法产出的估值（tick 非有限）→ 判定 BLOCKED_FACTS → claim 保持 0；授权窗口耗尽 `AUTHORIZATION_EXPIRED_OR_EMPTY`；协调器无 fetch/signed/placeOrder 能力 |
| T10 | 人工撤 TP 后恢复旧 journal | 带 `revokedAt` 的 mandate 被 `MANDATE_REVOKED_BY_HUMAN` 拒绝；mandate 缺失时 TP 可重新挂保护；重复请求幂等且不复活已撤 mandate |
| 性质 | 版本与终态 | 版本严格递增、终态不可逆（三种非法转移全 `null`）、重开账本后状态/版本一致、无未结算 open 态残留、clientOrderId 稳定 |

## 本轮发现并修复的确定性 P1（ hostile review ）

- **P1-1 重放可被别的来源当作发单许可**：原实现同一 `(scope,cycle,quantity)` 共用 clientOrderId，且命中重放时返回 `submitRequired` 只看状态；TP 重试有可能把 AI 在途单再发一次。修复：身份纳入 source；重放只回给同来源，且仅 PREPARED 才 `submitRequired=true`；跨来源冲突先返回 `BOUND_SOURCE=<source>`。
- **P1-2 UNKNOWN 没有出口**：`TRANSITIONS.UNKNOWN=[]` 使本地与查询都不允许离开 UNKNOWN，一次 ACK 丢失后 claim 永久占用、恢复清单永远清不掉。修复：区分「本地猜测」与「交易所事实」——`transition` 仍禁止离开 UNKNOWN，`observe` 允许被查询事实收敛并记 `EXCHANGE_FACT_RESOLVED_UNKNOWN`（不谎称旧单绝不成交：仅按事实推进）。
- **P1-3 协调检查与幂等捷径顺序颠倒**：先判 UNKNOWN 会让 TP 冲突被泛化原因吞掉；先判幂等又会把「别人的在途单」当自己可发。最终次序：身份重放 → TP 未确认冲突 → 其它来源 UNKNOWN 未收敛 → 预算/精度/价格。

## 尚存真正 blocker（不在本阶段解决）

1. **未接线**：`positionExitCoordinator` 尚无生产调用者；现有 TP/人工/重试路径尚未改为经同一 claim（S04-B 的「接缝」需与 S08 读端、S10 授权一起做）。G2 因此**不成立**。
2. `availableReduceUnits`、`positionVersion`、`riskGeneration` 由调用方提供，尚未接到真实持仓/风险快照（S05/S08）。
3. 适配器能力矩阵目前是声明值，未与 `ExternalTradeAdapter` 的实测能力（reduceOnly/positionSide/cancel-replace）绑定取证。
4. `mandate` 读端仍属 S02/S08 接缝；本阶段只做拒绝。
5. EXIT_TASK_UPDATED 的投递消费者与 outbox 持久重试属 S08；恢复不自动启动 Engine（本阶段无启动路径）。
