# Codex：C2 本地验证任务

只负责本地验证/红测/证据，不修改主实现设计。

工作目录：`D:\MITS-worktrees\v396-final-convergence-20260922`
分支：`codex/v396-final-convergence-20260922`

先 `fetch`，确认远端为当前最新 head，再只做 fast-forward；禁止 rebase/squash/force，禁止修改 PR #9，禁止启停 Engine、部署、live Settings/DB、交易所写入。

## 先验证现有补丁

重点文件：
- `apps/engine/src/state/runtimeState.ts`
- `apps/engine/src/config/settingsStore.ts`
- `apps/engine/src/runtime/appRuntime.ts`
- `apps/engine/src/state/reservationConvergence.test.ts`

先运行：
1. `reservationConvergence.test.ts`
2. `runtimeState.test.ts`
3. `entryCoordinator.test.ts`
4. SettingsStore/runtime persistence 相关测试
5. engine typecheck + contracts/core build

如果编译或现有测试失败：不要改产品源码，保留失败输出并停止，报告精确文件/行号/expected/actual。

## 再补 2 个本地敌意红测

仅允许新增/修改测试与证据：

1. **双连接并发 CAS**：两个独立 `SettingsStore` 实例指向同一个临时 dataDir，两个 RuntimeState 从同一 revision 出发竞争额度；必须最多一个成功，另一个 fail-closed；最终 durable ledger 只能存在一个 active reservation，revision 单调且无双花。

2. **重启恢复窗口**：构造 runtime_state 中存在已过期 WORKING reservation，但对应 UNKNOWN/在途 order 只存在 durable entry execution 存储、尚未出现在 runtime_state 的场景；验证恢复过程中 reservation 不得在 durable order 重新挂载前被释放，挂载后 cleanup 仍不得释放 UNKNOWN 风险。

另外确认：
- top-level cleanup 的 reservation + lock 在同一 durable mutation 后可恢复；
- 安装 S05 `entryRiskGate` 后，缺 `riskGeneration`、generation 不一致、snapshotHash 缺失、binding 过期全部拒绝；
- RELEASED reservation 不能被 commit/attach 复活；
- UNKNOWN order 关联的过期 reservation 仍占风险；
- 无实际 reservation/lock 变化时 revision 不应无意义增长。

若新增红测失败：不要修产品源码，不推失败测试，直接报告给我。

若全部通过：跑全 Engine、engine typecheck、contracts/core build、S00 static gate、`git diff --check`；只提交测试和 `docs/evidence/v396/final-convergence-20260922/C2/` 验证证据，fast-forward push convergence 分支。

本轮不得进入 C3/S06，不得把 C2 标 ACCEPTED。最后只回报：验证 head、测试数、双连接/重启窗口结果、门禁结果、测试证据 commit、仍存 blocker。