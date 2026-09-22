# Codex C3 Wiring Round 1 — 2026-09-22

你是本地机械接线/验证执行器；设计裁决由主实现方负责。目标分支 `codex/v396-final-convergence-20260922`。先 fetch + `merge --ff-only` 到含本文件和 `apps/engine/src/services/v396ExitRuntime.ts` 的最新远端 HEAD。禁止 rebase/squash/force；PR #9 不动。

本轮允许修改产品源码，但不得自行扩架构。禁止启停/热重载 Engine、部署、live Settings/DB、现网迁移、交易所写请求。测试只能 mock/fake/mkdtemp SQLite。

## 0. 先修主实现方骨架的两个已知边界

`V396ExitRuntime` 是主实现方提供的生产桥，保留其设计方向，只做以下必要修正：

1. `PositionExitCoordinator.requestExit` 增加可选 `requestKey`（或等价明确字段），仅用于 clientOrderId 稳定身份；无 requestKey 时保持现有 S04 测试语义。clientOrderId seed 必须覆盖 `scope|cycleId|source|requestKey`，不能再只靠 quantity。这样同一 request retry 恒定，同一 cycle 后续新的 manual/TP intent 可以合法得到新 ID。
2. `V396PrepareExitInput` 增加 `requestKey:string`，MANUAL/TP 调用必须非空并传入 coordinator。
3. `ExitTask` 持久化 `stepSize`（以及恢复查询所需的 side/positionSide 若 scope 解析不足）；旧离线测试生成的新 task 从 JIT stepSize 填入。不得伪造历史 runtime task。

先补红测：同 requestKey retry ID 相同；terminal 后新 requestKey 可以建立新 PREPARED；不同 source/requestKey 不得读到别人的 submitRequired。

## 1. ExternalTradeAdapter：先证明“减仓不会变增仓”

新增只读能力（名称可微调，但语义不可变）：

- `exitCoordinationCapabilities()`：通过现有 `hedgeMode()` 返回真实 `AdapterCapabilities`；ONE_WAY 必须 `oneWayReduceOnly=true`，HEDGE 必须 `hedgePositionSide=true`，`cancelReplaceAtomic=false`。
- `proveReduction({symbol,positionSide,quantity})`：在任何 exit submit 前读取真实持仓；ONE_WAY 返回 `ONE_WAY_REDUCE_ONLY`；HEDGE 必须存在匹配 `symbol+positionSide` 的真实仓位且 `0 < quantity <= live quantity`，否则拒绝；返回 proof.checkedAt。不得靠调用方声明。
- `findExitByClientOrderId(...)`：统一只读 exact `/fapi/v1/order?origClientOrderId`，返回三态所需事实：FOUND（normalized state + executed qty + original qty + positionSide）、ABSENT（仅明确 -2013/-2011）、UNKNOWN/throw（网络/其它错误）。不能把 ABSENT 与查询失败合并。

`placeTakeProfit` / reduce-only `placeManualOrder` 在 HEDGE 下仍使用 `positionSide`；同时必须经过上面的 fresh proof。返回 ManualOrder 时保留调用方 positionId，不再返回空字符串。

## 2. AppRuntime：真正构造 runtime exit store，但不启用 AI exit

在 `<dataDir>/v396-ownership.sqlite` 构造 `V396ExitRuntime`，exchangeIdentity 使用当前 environment + credentialRef，capability provider 使用 adapter 的真实方法。注入 `TpGuardian`、`ManualPositionService`、`TestnetLowLossCleanupService`。EngineRuntime 暴露只读/内部属性均可，但 shutdown 必须 close。

启动后读取 `exitRuntime.recoveryPlan()`：只做 QUERY/事件记录，绝不能 resend。若 adapter 可用，按 task 原 clientOrderId 做 exact read 后 `observe`；查询 UNKNOWN 就保持 task UNKNOWN/PREPARED，不提交任何新单。

继续保留现有 `OwnershipRuntime` 事件/通知职责；两者共享同一个 sqlite 文件是真源，不另建第三套数据库。

## 3. ManualPositionService：durable PREPARED 无条件成立

- `ManualExecutionJournal` 在生产构造必须为必需；删除 `this.journal?.claim` 的静默退化。journal 不可用时 exchange submit 前 fail-closed。
- 任意人工 action（ADD/REDUCE/PLACE_LIMIT/EMERGENCY_CLOSE/TP 修改）先 durable `recordHumanTakeover`，使旧 AI ownerVersion 立即失效；ADD 不占 exit quantity claim，但也必须撤销 AI 管理权。
- REDUCE/EMERGENCY_CLOSE：fresh position + quote 完成后，用 stepSize 转为整数 quantityUnits，调用 adapter `proveReduction`，再 `exitRuntime.prepareManual({requestKey:idempotencyKey||intent.id,...})`。prepare 不接受则不得写交易所。
- exchange request 的 clientOrderId 必须使用 coordinator 返回的 clientOrderId，而不是另造第二身份。
- submit 前 `transitionByClientOrderId(...,'SUBMITTING')`。
- submit 成功用 exact/returned fact `observe` 到 WORKING/PARTIALLY_FILLED/FILLED；submit throw 后立即 `findExitByClientOrderId`：FOUND→observe；ABSENT/UNKNOWN→`markSubmitUncertain`，不得自动二发。retry 必须先查原 clientOrderId。
- 保留 SettingsStore manual journal 作为请求/订单审计，但 quantity/owner/UNKNOWN 真源为 v396 exit runtime。

## 4. TpGuardian：mandate + PREPARED + UNKNOWN 恢复

构造注入 `V396ExitRuntime`。

每次准备新 TP 前：
1. 解析完整 canonical scope（full symbol + LONG/SHORT + current cycleId）；cycleId 缺失不得新造随机 cycle，记录 fail-closed 证据并不提交。
2. 查询 durable mandate。若 `revokedAt != null`，Guardian 不得重建，即使 `force=true`；发 `TP_REPAIR_BLOCKED_MANDATE_REVOKED`。
3. 没有 mandate 时由 Guardian 建立 versioned `FULL_REMAINING` mandate；HUMAN active mandate 不得被 Guardian 覆盖。
4. `proveReduction` → integer units → `prepareTakeProfit({requestKey: stable key from cycleId + mandate.version + target price + qty units,...})`。
5. 使用 coordinator 返回的 clientOrderId，先把本地 order 标 UNKNOWN/PREPARED，再 transition SUBMITTING，最后才可 `placeTakeProfit`。
6. place throw：立即按同 clientOrderId exact query。FOUND→adopt + observe；ABSENT 或查询失败→保持 UNKNOWN + coordinator UNKNOWN，不允许下一 sweep 建第二张。
7. restart 后 coordinator recovery task 优先查询；没有 terminal positive proof 前 claim 不释放。

现有 `unknownAbsenceProof` 可以继续作为二次缺席证据，但它不能再是唯一真源；进程重启丢失计数只能导致更保守等待，不能导致重发。

## 5. 人工撤销 mandate 的真实生产入口

当前仓库没有 durable human revoke 消费者。增加最小 HTTP/API 入口或复用已有明确的人为 TP 删除入口：

- 用户明确确认撤销 TP 时，先记录 `revokeProtectionByHuman`（即使 cancel 结果 UNKNOWN，Guardian 也不得自动重建），再尝试 cancel 当前 TP；返回中明确 canceled/unknown。
- `/tp/:positionId/repair` 在 mandate 已 human-revoked 时不得静默复活；只有请求显式 `confirmRearm=true` 才能写一个 HUMAN mandate（OwnershipService `putMandate` 可用于 HUMAN re-arm），然后 Guardian 才能 repair。
- 临时 suspend/resume（例如人工减仓期间）不得等价于永久 revoke。

## 6. TestnetLowLossCleanupService：去掉第二写入口

其 reduce-only submit 必须复用同一 `V396ExitRuntime.prepareManual` + adapter proof + coordinator clientOrderId + exact query recovery；不能继续自建 `cleanup_${symbol}_${ts}` 后直接 `placeManualOrder`。这是 TESTNET-only，也不能绕过统一 claim。

## 7. canonical identity 本轮必须做到的最小范围

所有**退出 writer**（Manual/TP/Cleanup）必须统一：
`executionScope(environment, credentialRef, FULL_SYMBOL, positionSide)` + 原 position.cycleId。

不要在本轮擅自做全仓 cycle migration。`positionLifecycleTracker` 的历史随机 cycle、entry 的 legacy `ENTRY/resolveUnderlying` claim 另列 C3 Round 2；但本轮不得新增新的 `${symbol}:${side}` exit claim 或新随机 cycle。

## 8. 敌意测试（先红后绿）

把上轮未跟踪 `c3RuntimeWiringHostile.test.ts` 正式纳入本轮，至少覆盖并新增：

1. MANUAL vs TP 同 scope/cycle 全量 claim 只有一个成功；
2. no manual journal → 0 exchange calls；
3. TP PREPARED 持久化先于 exchange call；
4. TP/manual submit throw 后同 clientOrderId query，UNKNOWN 不二发；
5. HUMAN takeover 后旧 AI ownerVersion 请求失败；
6. human revoke 后 sweep/force repair 均不重建；confirmRearm 后才允许；
7. ONE_WAY request 带 reduceOnly；HEDGE proof 必须匹配 positionSide+live qty，超量 0 submit；
8. adapter 返回 ManualOrder positionId 不丢；
9. partial fill 后 coordinator 只保留真实 remainder claim；
10. crash/restart PREPARED/UNKNOWN 只 query、不 resend；
11. terminal old requestKey 不阻塞同 cycle 新 requestKey；同 requestKey retry 不生成新 ID；
12. Testnet cleanup 不再直接绕过 coordinator。

## 9. 门禁与提交

先跑 targeted；有红则修本轮确定性缺陷，不改变上述语义。然后：engine typecheck、contracts/core build、全 Engine、S00 static gate、`git diff --check`。

只在全绿后 commit + fast-forward push convergence 分支。证据写 `docs/evidence/v396/final-convergence-20260922/C3/ROUND1/`。

最后只报告：HEAD、改动文件、红→绿缺陷、C3 tests、全仓 tests/typecheck/build/S00、仍存 blocker。不要宣称 G2/G3/S04/S05 ACCEPTED；AI exit 仍未生产启用；不做任何真实 Engine/Testnet 写操作。
