# Codex C3 Round 1.1 — HUMAN mandate / manual TP 收口

先 `git fetch`，并在 `codex/v396-final-convergence-20260922` 上 `merge --ff-only` 到最新远端 HEAD。禁止 rebase/squash/force，禁止改 PR #9。

本轮允许修改产品源码，但**只允许**修下面列出的 C3 Round 1.1 缺口；不要进入 C3 Round 2，不启用 AI exit。

安全边界：不启停/热重载 Engine，不部署，不改 live Settings/DB，不做 migration，不访问交易所写接口。

## 已由主实现方在线修复，先验证不要回退

1. `OwnershipService.revokeMandateByHuman()`：即使此前没有 mandate，也必须持久化 `source=HUMAN + revokedAt!=null` tombstone，不能返回“无记录所以不撤销”。
2. `OwnershipService.putMandate()`：`allowedPrice=null` 只允许 HUMAN tombstone 场景；非 null 必须有限且 >0。
3. `V396ExitRuntime.prepare(TP)`：active mandate 不只是“未 revoke”，还必须绑定实际写入：
   - `allowedQuantityRule === FULL_REMAINING`
   - `mandate.allowedPrice === submitted limitPrice`（按 tick 极小容差）
   - `quantityUnits === remainingUnits`
   不满足必须 fail-closed，不得 exchange submit。

## 先写红测，再改剩余产品代码

在 `c3RuntimeWiringHostile.test.ts` 增加至少这些用例：

### R1 无历史 mandate 的 revoke
- 新建 legacy/open position，不先调用 Guardian 建 mandate；
- 执行 human revoke；
- 必须得到 durable HUMAN tombstone；
- 重开同一 SQLite 后 tombstone 仍存在；
- `tp.ensure(..., true)` 和 `sweep()` 都不得 `placeTakeProfit`。

### R2 HUMAN rearm 的价格是绑定指令
- revoke 后 `rearmProtectionByHuman(subject, 101)`；
- 若 101 满足 tick/side/economic validation，则 Guardian repair 必须提交 **101**；
- 不允许重新算出 101.x/102 等其它价格；
- 若 HUMAN price 不合法，可 fail-closed，但绝不能静默改成 Guardian 自选价。

### R3 直接价格漂移必须拒绝
- durable HUMAN mandate price=101；
- 构造 TP order price=102；
- `tp.place` / `prepareTakeProfit` 必须在任何 exchange write 前拒绝，原因包含 `MANDATE_PRICE_MISMATCH`。

### R4 人工 REPLACE_TP / REBUILD_TP 回归
真实走 `ManualPositionService.execute()`：
- 必须不再出现 `TP_STEP_SIZE_UNPROVEN`；
- 显式 HUMAN TP 修改在 place 前写 HUMAN mandate，price 等于用户提交价；
- 调用 `TpGuardian.place` 时传真实 quote `stepSize/tickSize`；
- PREPARED/claim 仍先于 exchange submit；
- position/cycle/clientOrderId 不丢。

### R5 FULL_REMAINING
- 默认配置 `takeProfit.quantityPercent=100` 应可通过；
- 临时设为非 100% 时，如果 mandate 仍是 `FULL_REMAINING`，必须 fail-closed 且 0 次 exchange submit；不要偷偷把 mandate 改成部分数量规则。

## 产品修改限定

### `tpGuardian.ts`
自动 `ensure()` 在生成目标前读取 durable mandate：
- revoked => 保持现有阻断；
- active `source=HUMAN` => 该 `allowedPrice` 是目标价格真源，优先级高于 AI/STRUCTURE/FIXED；不得自动改价；
- 仍执行既有 tick、方向可达、经济有效性和减仓 proof；不合法就 fail-closed/告警。

### `manualPositionService.ts`
`REPLACE_TP/REBUILD_TP` 是显式 HUMAN TP 指令：
- 在 `tp.place` 前调用 `exitRuntime.rearmProtectionByHuman(subject, price, now)`，失败则拒绝；
- `replaceTakeProfit` 接收当前 quote/filter（或至少 `stepSize/tickSize`），调用 `tp.place(order,{stepSize:q.stepSize,tickSize:q.tickSize})`；
- 不允许重新创建第二套 clientOrderId/claim/cycle 语义。

不得修改 S03 policy、不得启用 AI exit、不得放宽 coordinator quantity claim。

## 验证

从仓根执行并记录真实 exit code：
- Round1.1 targeted tests
- C3 全部测试
- C2 reservation tests
- S04/S03 targeted
- Engine 全仓
- engine typecheck
- contracts/core build
- S00 static gate
- `git diff --check`

若出现产品缺陷可在本轮范围内修；若需要改变上述 mandate 语义，停止并报告，不自行重新设计。

全绿后：
- evidence 写到 `docs/evidence/v396/final-convergence-20260922/C3/ROUND1-1/`
- 独立 commit
- 仅 fast-forward push convergence 分支。

最后只回报：HEAD、红测缺陷、产品改动、targeted/full/typecheck/build/static gate、是否仍有 P0/P1、工作树是否 clean。
