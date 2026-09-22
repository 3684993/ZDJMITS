# Codex C2 修复 Round 2

目标分支：`codex/v396-final-convergence-20260922`。

先 `git fetch`，确认远端 HEAD 是包含本文件的最新提交；**不要继续在 `codex/v396-astra-handoff-20260922` 上工作**。本轮允许修改产品源码，但只能按下面已确定设计机械修复，不自行扩范围。

## 必修缺陷

### D1 — 风险事实必须在 reservation 原子事务内复验

`RuntimeState.reserveEntry()` 在进入 durable reservation transaction 后、真正写 reservation 之前，必须 fail-closed 检查：

- private account 必须 `READY` 且 `privateAccountFresh(account, now)`；未来时间 >5s、超过 60s、NOT_CONFIGURED/UNAVAILABLE 全拒绝；
- 当前 `runtimeControl.capital` 必须有正整数 `generation`、有限 `evaluatedAt`、非空 `capitalVersion`、未过 `nextRecheckAt`；
- reservation 绑定当前 generation/version，不允许 null binding；
- 如果调用方传了 generation/version，与当前权威事实不一致必须拒绝；
- `riskBinding` 至少包含 `riskGeneration/snapshotHash/evaluatedAt/expiresAt`；`expiresAt=min(capital.nextRecheckAt, account.asOf+60000)`，必须严格 > now；
- 这些判断必须发生在 `SettingsStore.mutateEntryReservations()` 所持有的同一 `BEGIN IMMEDIATE` 窗口中。不要只在 EntryCoordinator 外层预检。

可继续保留 `entryRiskGate` 作为 S05 完整压力模型扩展，但基础 freshness/version gate 不得依赖它是否被安装。

### D2 — 消灭 reservation 事务外直写

仓库内所有 `entryReservations.set/delete` 的运行期写必须收敛到 RuntimeState 的原子 API。至少修掉已知位置：

- `appRuntime.ts` durable entry 恢复；
- `entryCoordinator.ts` execution wait / submit success 等直接把 reservation 改成 WORKING 的路径；
- `reconciliationService.ts` UNKNOWN/active remote facts 把 reservation 改 WORKING 的路径。

新增/完善 RuntimeState API，例如 `markEntryReservationWorking()`、`upsertRecoveredEntryReservation()`，要求：

- 只允许合法状态机；
- map/lock 变化才递增 `entryReservationRevision`；
- 写失败回滚内存；
- 有 transaction hook 时同步持久化；
- RELEASED/COMMITTED 不得被普通重试复活。

修完后机械 grep：除 RuntimeState 内部、纯 restore 装载外，不得剩运行期直接 `entryReservations.set/delete`。

### D3 — 重启恢复不得产生 revision 分叉

`restore()` 只装载，不得 cleanup/释放或启动 durable transaction。

`appRuntime` 启动顺序必须：
1. load runtime；
2. 装载 durable entry/order facts；
3. 以原子 RuntimeState API 合并 reservation；
4. 安装/使用 reservation transaction 时保证 DB revision 与内存 revision 同步；
5. UNKNOWN/在途订单恢复完成之前不得释放其 reservation。

针对 persisted revision=1 + expired RESERVED + UNKNOWN order，重启后必须继续占用，且下一次合法 reservation 不得因 revision mismatch 永久失败。

### D4 — 状态读路径绝不写数据库

`reservationSummary()` / `runtimeControlStatus()` 必须纯读：

- 不调用 cleanup；
- 不开启 `BEGIN IMMEDIATE`；
- store busy/disk error 不得从状态 GET 因 reservation cleanup 冒出。

expired reservation/lock 可以作为诊断字段显示，但释放只能由明确 mutation/scheduler/reconciliation 路径执行。

### D6 — 非法 reservation 状态 fail-closed

restore/恢复遇到未知 reservation status，不得把它当空闲容量。保守转换为占用态（建议 `WORKING` + recovery reason）或明确 blocker；绝不能漏算 capacity/margin。

### D7 — 陈旧私有账户不能 reserve

新增测试：NOT_CONFIGURED、UNAVAILABLE、`asOf=null`、61 秒旧、未来 >5 秒全部 `reserveEntry().ok=false`；新鲜 READY 才可能继续。

## 保留已正确行为

不得回退：
- RESERVED + WORKING 共同占保证金；
- UNKNOWN order 不释放 reservation；
- 显式 release 对仍占风险订单拒绝；
- VERIFIED_NO_ACTIVE_RISK 才允许释放对应 UNKNOWN；
- nested transaction fail-closed；
- stale revision 不能覆盖较新 runtime payload；
- 无 map/lock 变化的拒绝不应无意义增加 revision。

## 必测

更新/新增 `c2ReservationAtomicityHostile.test.ts`，至少覆盖：

1. 两个 RuntimeState/同一 SettingsStore 并发旧 revision，只一个额度内成功；
2. A reserve 后 B restore，A mark WORKING，再 B reserve，不能丢失 A 更新；
3. restart + expired reservation + UNKNOWN order；
4. reservationSummary 在 store hook 抛错时仍纯读成功且 transaction count=0；
5. stale/private account 五种边界；
6. invalid persisted reservation status 仍占风险；
7. risk binding 非 null，generation/version/expiry 任一不匹配即拒绝；
8. grep guard：运行期不得有 RuntimeState API 外 reservation 直接写。

然后跑：targeted C2、全 Engine、engine typecheck、contracts/core build、S00 static gate、`git diff --check`。

若全绿：提交一个独立 C2 修复 commit 并 fast-forward push convergence 分支；证据放 `docs/evidence/v396/final-convergence-20260922/C2/ROUND2/`。

若失败：保留红测，不为了全绿降低断言；只回报失败，不进入 C3。

安全边界：不启停 Engine、不部署、不改 live Settings/DB、不访问交易所写接口、不发单。