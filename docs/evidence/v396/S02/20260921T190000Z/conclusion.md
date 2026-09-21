# S02 结论：READY_FOR_REVIEW（不自签 ACCEPTED）

阶段：S02 管理权、硬期限与人工交接。runId `20260921T190000Z`。审查人：总设计（本提交不作 ACCEPTED，依 README 第 5 节与运行规则第 6 节）。
范围：完全离线。未部署、未启停 Engine、未访问网络与交易所、未读写现网 Settings/数据库、未发单、未迁移现网仓位。

## S02-T01…T08 逐项证据

全部在 `apps/engine/src/services/ownershipS02Acceptance.test.ts`（11 例）与 `ownership-tests.json`（6 文件 / 62 项，0 失败）。

| ID | 断言的事实 | 结果 |
|---|---|---|
| S02-T01 | `deadline−1` 不撤权且 AI claim 仍被接受；`deadline` 当刻 `expire()` 返回 1 并转为 HANDOFF_PENDING；`deadline+1` 不再重复计数，且迟到 AI claim 抛 `AI_AUTHORITY_REVOKED` | PASS |
| S02-T02 | 两个连接竞争同一 `scope/cycle`：人工先落地并抬版，持旧 `ownerVersion` 的 AI 路径抛 `OWNER_VERSION_CONFLICT`；只有当前版本可提交 | PASS |
| S02-T03 | 首笔成交固化 deadline；重开文件后以「更晚补成交 + 更长时长」再 initialize 返回原记录，cycle 不重置、deadline 不延长、版本不变 | PASS |
| S02-T04 | 状态提交后崩溃（丢弃句柄、未投递）：重开仍为 HUMAN_MANAGED（撤权不依赖通知）；outbox 仍待投；投递失败时不标记、成功后 pending=0；再次 drain 为 no-op，`pendingTasks()` 不产生重复待办 | PASS |
| S02-T05 | `acknowledge` 只写 `acknowledgedAt`（重复调用保留首次时间戳、幂等）；HUMAN_MANAGED→AI_ACTIVE 抛 `HUMAN_REAUTHORIZATION_REQUIRED`；回拨时钟的 ack 抛 `INVALID_ACK_CLOCK`；无任何「价格恢复」入口可翻转状态 | PASS |
| S02-T06 | 同域数量漂移（claim 100 > 观测 50）→ 转 HANDOFF_PENDING，原因 `CLAIMED_UNITS_EXCEED_POSITION`，旧版本 claim 立刻被拒；观测来源为 UNKNOWN → `POSITION_FACT_UNVERIFIED` 撤权；无主 cycle 只上报 `unownedCycles`，绝不静默收养 | PASS |
| S02-T07 | mandate 版本 CAS（旧版本写抛 `MANDATE_VERSION_CONFLICT`）；人工撤销后 Guardian 再写抛 `MANDATE_HUMAN_REVOKED`；撤销期间 `unprotected()` 明确列出无保护 cycle；人工可用新版本重建 mandate；Guardian 无价格的 mandate 被拒 | PASS |
| S02-T08 | 迁移 apply 三类旧数据：无计划旧 AUTO→HANDOFF_PENDING（不补期限/权限）、现存 HUMAN 原样保留 HUMAN_MANAGED、带计划者才 AI_ACTIVE；CLOSED 后任何复活抛 `CLOSED_OWNER_IMMUTABLE`；reconcile 对已平仓与人工仓不改动 | PASS |

## 本批另外钉住的性质

- 事务与崩溃边界：`initialize` 每笔独立提交；`recordTakeoverFromHuman` 中途崩溃只会停在 HANDOFF_PENDING（已撤权态），即「崩溃只能少授权，不能多授权」。
- 时钟回拨：`INVALID_TRANSITION_CLOCK`、`INVALID_ACK_CLOCK`、`MANDATE_CLOCK_ROLLBACK` 三处拒绝过去时间戳。
- outbox 与状态同事务：`OWNERSHIP_CHANGED` / `HANDOFF_ACKNOWLEDGED` / `PROTECTION_MANDATE_CHANGED` 落同一库、同一 `BEGIN IMMEDIATE`；投递失败只记 `failed`，不回滚已提交的撤权。
- 记账不得阻塞交易：journal 打不开时 `recordHumanTakeover`/`acknowledge` 返回 false 且 `recorded` 计数不增，仅发 `V396_OWNERSHIP_JOURNAL_DEGRADED{affectsTradingPath:false,authorityGranted:false}`。本批修掉一处该文件早期的静默成功缺陷：`?.` 使「无 journal 时的记录」被当作成功返回 true。
- 迁移可复现：`preview` 只读（断言落库前后 owner 数为 0）；`rehearsal` 在隔离副本上跑两遍，第二遍 `created=0/preserved=N`；`backupTo` 使用 SQLite online backup 并拒绝备份到自身路径；备份→复制→`verify`→在原句柄上重放 apply，全部为幂等 no-op。
- 撤权原因命名优先：journal 的 `transition` 现在先抛 `CLOSED_OWNER_IMMUTABLE` / `HUMAN_REAUTHORIZATION_REQUIRED`，再落到泛化 `INVALID_OWNER_TRANSITION`（此前两者都被泛化错误吞掉，证据不可辨）。
- S04-A 仅原语：claim 崩溃后仍在、幂等键同 id 返回原 claim、改数量抛 `IDEMPOTENCY_CONFLICT`、无正向终局证明的释放抛 `CLAIM_RELEASE_UNPROVEN`、释放幂等。**未接入任何下单路径**。

## 尚未完成（S02 保持 PARTIAL 的原因）

1. 读端消费者缺：ownership 目前不被 runtime 投影、API、快照或对账读取，仪表盘与 `tradeRecords` 看不到 ownerState/ownerVersion/deadline（阶段文件要求的「不再造第二份仓位真源」需以读端合并来证明）。
2. 交接包（阶段文件 §5）未组装：原计划、剩余仓位、费用/funding、预计净退出值、TP mandate、在途单/UNKNOWN、强平风险与触发证据的单一持久包仍未实现；现有只是其组成部分。
3. 人工失联的幂等告警/升级待办（§6）未实现；是否阻断新仓属 S05 配置，本批未触碰准入。
4. 交接后取消/去重例行模型任务（§6）未实现（涉及 AI 调度，与 S07 预算耦合）。
5. `authorizeAiManagement()` 这条**授予**权限的路径刻意不做：需要明确人工授权 + 新计划（S06）+ S03 成本口径，且不得擦除 cycle 历史。
6. 兼容投影仍是双轨：`managementStatus`/`humanManagedAt` 是既有真源，本批只写入 ownership，未做双读一致性校验与降级顺序定义。
7. 生产迁移：无 preview→现网 apply 的授权与执行，`v396-ownership.sqlite` 在现网不存在；隔离副本演练不等于迁移完成，回退仍按「关闭新授权并保留 ownership」。
8. S03 未开始：`ExitEstimate`/`estimateHash`/报价过期/完整 fee+funding/`-9.99·-10·-10.01`/tick 取整/UNKNOWN 与 CONSERVATIVE_BOUND/部分成交累计周期损益与性质测试都还没有，因此任何退出判定与 G2 都不成立。

## 全仓验证

- 全仓 Engine 测试：132 文件通过、0 失败、退出码 0。
- `npm run typecheck -w @zdj/engine`：通过。
- S00 静态门禁：6 项 PASS，108 条内容推导记录（98 禁止 / 9 边界可用 / 1 执行），规则表未放宽；`s00-static-gate.json` 为本轮输出。
- `git diff --check`：干净。工作树在提交后应无未跟踪产品文件残留。

## PR #9 独立审查（第 2 批：基线整理 + 八项定点检查）

base 已改为 `codex/v396-s00-reviewed-baseline-20260921` → `1b7e38f`（不 rebase、不 squash、head 不变）。

| 检查点 | 结论 |
|---|---|
| degraded 路径是否可能误授予 authority | 否。当前无任何消费者读取 ownership（grep 证实）；journal 以名字拒绝 `HUMAN_MANAGED→AI_ACTIVE` 与 `CLOSED` 复活；新增静态护栏断言 service/runtime 里不存在任何把状态写成 `AI_ACTIVE` 的转移。**发现并修复一处真实缺陷**：`identity()` 用 `catch{return null}` 吞掉解析器与 scope 抛错，静默少记 → 改为发 `V396_OWNERSHIP_JOURNAL_DEGRADED{stage:SUBJECT_RESOLVER|SCOPE_RESOLUTION}`。 |
| ownerVersion/CAS 是否有漏网写路径 | 只有 `acknowledge` 用裸 upsert，且不抬版本，且整段在 `BEGIN IMMEDIATE` 内；其余写入均经 `initialize/transition`（带 CAS）。`reserve` 校验 `expectedOwnerVersion`。残余（非放宽）：`activeClaimUnits(scope)` 按域而非按 cycle 聚合，跨 cycle 的 claim 会让 reconcile 过度撤权——方向保守，S04 需把 claim 绑定到 cycle。 |
| outbox 与 ownership 是否同事务、崩溃恢复是否安全 | 同事务（ack/迁移/mandate/撤权均在同一 `BEGIN IMMEDIATE` 内写状态与 outbox）；`drainOutbox` 刻意在事务外投递，失败只计数、不回滚已提交撤权。所有服务方法都只在一个事务层里包一次，未出现嵌套 BEGIN（各方法均有测试执行到）。崩溃只会停在 `HANDOFF_PENDING`（已撤权态）。 |
| mandate 与 TP Guardian 是否形成第二套真源 | 目前不会：`putMandate/revokeMandateByHuman/unprotected` 无任何外部调用者，TpGuardian 未读取 mandate。但 `unprotected()` 只看 journal，会在「旧字段仍有在效 TP」时误报无保护 → 读端接线时必须与 `tpStatus/tpOrderId` 合并，属残余风险。 |
| reconcile 是否可能错误收养/覆盖 ownership | 否，且有测试：无主 cycle 只进 `unownedCycles` 不落库；`CLOSED` 与人工态跳过；只有 AI_ACTIVE 会被抬版收窄。 |
| migration/backup/appRuntime shutdown 失败边界 | **P1（已登记为发布阻断，不在本检查点修）**：`v396-ownership.sqlite` 不在备份/留存清单内（`scripts/maintain-storage.mjs:11` 只认 `zdj-settings.sqlite`），一次还原会丢掉所有权与 outbox 记录。已用 `storage-coverage.json` + `ownershipStorageCoverage.test.ts` 把该缺口变成机器强制的门禁项，并断言 ownership 代码永不打开现网设置库（现网 DB 迁移未被授权）。`backupTo` 拒绝备份到自身路径；关停链在 `settingsStore.close()` 之前关闭 journal。`rehearsal` 的隔离副本目录不做清理（OS 临时目录），已知非缺陷。 |
| executionScope 与历史 claim key 是否完全兼容 | 兼容：三个调用点分别传 `'ENTRY'` 与 `position.side`（zod 限定 LONG/SHORT），越界抛错只可能来自编程错误，且发生在任何交易所调用之前。既有不对称如实记录：entry 用 `resolveUnderlying(symbol)`、manual 用完整 `symbol`，因此两条路径历史上从未共享 claim 键——这是 S04 的前置条件，不是本批引入。 |
| `${symbol}:${side}` 非 canonical scope 是否已影响消费者 | 未影响：该串是 `positionLifecycleTracker`/`reconciliationService`/`executableRiskHeadroom` 既有的**仓位身份**约定；本批唯一新用法是 `humanManagedProjection.riskSnapshot`，其消费者数为 0（grep 证实）。S05 读取前必须换成 canonical scope，否则才是第二真源。 |

本批修复：`identity()` 静默吞错、新增 `ownershipStorageCoverage.test.ts`（3 例：不碰现网设置库、备份缺口必须处于「已登记阻断」状态、journal 不出现授予态）与 `storage-coverage.json`。

复跑结果：contracts/core build 通过；engine typecheck 0 错误；全仓 Engine **133 文件通过 / 退出 0**；S00 静态门禁 6 项 PASS；`git diff --check` 干净。

