基于当前机器执行一次完整的“本地环境收敛 + GitHub main 同步 + 最新版本重启”。

本轮用户明确授权：

- 将当前实际开发/部署环境统一到最新 `origin/main`；
- 清理不相关、过期、重复的旧 worktree / clone / build / deployment 环境；
- 停止当前正在运行的 Engine / 交易系统；
- 使用最新 `main` 构建并启动一次最新 Engine；
- start reason 使用 `MANUAL_START`；
- 完成启动后的只读 runtime 验收。

当前 GitHub `main` 预期至少为：

`48b3d8c4a438218367642879af7efb455dddede5`

但不要硬编码该 SHA。先 `git fetch --all --prune`，以执行时最新 `origin/main` 为准。

## 1. 先做完整环境盘点

在任何删除、切换、停止 Engine 之前，先记录：

- 所有 ZDJMITS/MITS 本地 Git clone 和 worktree；
- 每个 worktree：
  - 路径
  - branch
  - HEAD
  - dirty/clean
  - `git status --short`
- 当前哪个目录是真正的运行/部署源；
- 当前 Engine PID / instanceId / buildId / sourceHash / artifactHash / dataDir；
- 当前 Settings version；
- TESTNET / Production lock；
- 当前仓位、TP/protection；
- 当前 rollback artifact；
- 所有旧 build/deployment 路径。

禁止一上来直接 `reset --hard`、`git clean -fdx` 或删除目录。

## 2. 处理旧 v395 / 脏 worktree

旧的：

`v395-economics-human-managed-20260919`

历史上有 48 条未提交状态。

本轮用户授权**最终移除这个旧环境**，因此旧 runbook 中“必须永久保留 v395 worktree”的要求，本轮由本授权覆盖。

但是：

**禁止直接丢失有价值的未提交源码。**

先把 48 条内容分类：

1. 有价值但尚未进入 `main` 的源码/config/docs/scripts；
2. main 已经包含或已经淘汰的旧代码；
3. build/cache/log/runtime/generated；
4. credentials/secrets/runtime DB/private data。

处理原则：

- main 已包含或旧版本废弃内容：可以不迁移；
- build/cache/log：可以删除；
- secrets/private runtime data：绝对禁止提交 GitHub；
- 若仍存在真正有价值且 main 没有的源码修改，先保全后再删除旧 worktree。
  - 优先使用一个最小 archive commit/tag/ref 保存；
  - 不要创建新的长期开发分支；
  - 在报告里写清 archive ref/commit。
- 如果其中存在无法安全放入 GitHub 的敏感文件，不要为了清理而删除；可以移动到一个明确的本地 archive 目录，但它不能继续作为 active worktree/runtime source。

完成保全后，允许删除旧 v395 worktree 和其它不再使用的旧工作环境。

## 3. 建立唯一 canonical 本地开发目录

本机最终必须只有一个明确的主开发/部署 checkout。

要求：

- branch = `main`
- `HEAD == origin/main`
- `git status --short` 无输出
- future development 只使用这个 canonical checkout
- 不再用旧 convergence / v395 / audit worktree 作为正式工作环境

如果 `main` 当前被另一个 worktree 占用：

- 先找出它；
- 选择一个作为 canonical main；
- 将其它无独有修改的重复 worktree 安全移除。

禁止 rebase / squash / force push。

## 4. 同步最新 GitHub main

在 canonical checkout：

- `git fetch --all --prune`
- 切换到 `main`
- fast-forward only 到 `origin/main`
- 确认：
  - `git branch --show-current` = `main`
  - `git rev-parse HEAD == git rev-parse origin/main`
  - worktree clean

本机和 GitHub 后续统一只认 `main`。

## 5. 构建最新 main

从**精确的最新 main**构建正式 Engine。

如果最新 main 相比上一次全量验证仅增加 docs，则可以复用已验证产品源码门禁，但必须重新确认 build-input 没变化。

如果任何产品代码 / test / build-input 有变化，则运行完整本地验证：

- focused tests
- full Engine tests
- core/dashboard/contracts
- typecheck
- verify:deps
- verify:scripts
- `npm run verify`
- formal build
- S00
- storage coverage
- diff check

禁止 GitHub Actions：

`NOT_RUN_BILLING_LIMIT`

生成并记录：

- Git SHA
- source/tree hash
- buildId
- artifact SHA256
- artifact path
- build timestamp

同时保留当前正在运行的旧 artifact 作为 rollback。

## 6. 重启前只读安全快照

当前 Engine 停止前必须记录：

- PID
- instanceId
- build/source/artifact identity
- Settings version
- TESTNET / Production lock
- positions
- TP/protection
- Entry UNKNOWN
- manual UNKNOWN
- TP UNKNOWN
- pending entry/reservation/order
- authoritative BOOK risk readback
- 当前 gross / limit / headroom
- dataDir
- rollback artifact

如果：

- 当前仓位保护状态不明确；
- dataDir 不明确；
- Production boundary 没锁；
- 有未落盘的执行状态可能因为停止而丢失；

则不要停止 Engine，报告 blocker。

## 7. 用户已明确授权一次 lifecycle

本轮允许：

**一次 stop → 一次 MANUAL_START**

执行：

1. 正常停止当前 Engine / 交易系统一次；
2. 确认旧 PID 已退出；
3. 确认没有第二个 Engine 实例仍在运行；
4. 使用刚才从最新 main 构建并 hash 的 artifact；
5. 使用仓库批准的：

`scripts/start-zdj-lan.ps1`

启动一次；
6. start reason 必须是：

`MANUAL_START`

禁止：

- 自动 restart loop；
- watchdog；
- guardian；
- service；
- autostart；
- hot reload；
- 连续反复 kill/start。

如果启动失败或 READY 失败，停止自动操作并报告，不允许连续重启。

## 8. 新 Engine 启动后验收

确认：

- 只有一个正式 Engine 实例；
- 新 PID / instanceId；
- `startReason=MANUAL_START`；
- runtime buildId/sourceHash/artifactHash 与刚才构建的 manifest 完全一致；
- dataDir 正确；
- canonical Git checkout：
  - branch = main
  - HEAD == origin/main
  - clean
- Settings version 没有意外变化；
- TESTNET 保持；
- Production writes = 0；
- 所有当前仓位仍有 TP/protection；
- UNKNOWN strict proof / scoped readback 正常；
- BOOK admission readback 能给出真实 first blocker/capacity；
- 不要为了验证制造 PLACE/submit/fill；
- 不要修改 gross/risk/economic thresholds。

自然产生的 Testnet 行为可以观察和记录。

## 9. 清理旧环境

**只有新 main Engine READY 且 identity 完全匹配后**，再清理旧环境。

允许删除：

- 已确认无独有修改的旧 worktree；
- 旧 audit/convergence/v395 worktree；
- stale local clones；
- 旧 build/cache；
- 已废弃 deployment 目录；
- stale worktree metadata。

必须保留：

- 当前 canonical `main` checkout；
- 当前正式 artifact；
- 当前 runtime data directory；
- 明确指定的 rollback artifact；
- 必要运行日志；
- 若存在不能安全提交 GitHub 的敏感 legacy archive。

不要为了“目录看起来干净”删除当前 data DB、UNKNOWN history 或 rollback artifact。

最终本机目标：

**一个 canonical main checkout + 一个当前 Engine + 一个 rollback artifact。**

## 10. 所有持久化结果必须在 GitHub

所有 Codex 生成并需要保留的：

- REPORT.md
- JSON
- TXT
- cleanup manifest
- worktree before/after inventory
- build identity
- lifecycle receipt
- test results
- runtime before/after
- final conclusion

必须 commit/push 到 GitHub `main`。

禁止最终只给：

`C:\...`
`D:\...`
或 Codex 临时 worktree 路径。

建议报告目录：

`docs/reports/v396-local-main-sync-cleanup-restart-20260928/`

## 最终必须明确报告

不要只返回一个状态码。

至少输出：

- canonical 本地路径；
- final branch；
- final Git SHA；
- `HEAD == origin/main`；
- worktree clean；
- old/new PID；
- old/new instanceId；
- buildId；
- sourceHash；
- artifactHash；
- Settings version；
- position / TP protection；
- scoped UNKNOWN；
- 当前 authoritative Entry blocker/capacity；
- Production writes / Testnet writes；
- 删除了哪些旧 worktree / clone / build / deployment；
- v395 的 48 条修改最终如何处理；
- 是否保留 archive，以及 archive ref；
- GitHub 最终报告路径；
- final GitHub commit SHA。

成功状态：

`V396_LOCAL_MAIN_SYNC_CLEANUP_RESTART_COMPLETE`

若失败：

`V396_LOCAL_MAIN_SYNC_CLEANUP_RESTART_BLOCKED`

并给出精确 blocker，禁止用 destructive fallback 强行完成。

补充：用户要求 D 盘只保留 MITS 文件夹，清理其它不再需要的 MITS 开头目录。
