# ZDJ-MITS V3.9.5｜CI 收敛 + durable Entry claim 饥饿修复 + 受控部署验证

- 时间：2026-09-19 11:00–13:20 (+08:00)，分两段执行（上半段取证与修复，下半段 CI 收敛与 live 部署）
- 正式分支：`v395-economics-human-managed-20260919` **`4770a21698b3193ded5b45f213bff9e20721ef60`**（自 `0223be9` 纯 fast-forward，无 force）
- live：**`3.9.5-57b2843729dff7a298a9` @ `4770a21`**，SHADOW 保持，**未切 ENFORCE、未改 HUMAN_MANAGED cap、未删任何 historical UNKNOWN、未按超时释放不确定订单**
- 取证方式：live SQLite 只读快照（`mode=ro` + online-backup，`integrity_check ok`），replay 在第二份 scratch 副本上跑真实生产代码；live 库从未被以写方式打开

---

## A. CI-only timeout 如何实现；本地 / CI 各是多少

发现前提：`apps/engine` 的测试脚本就是 `vitest run`，**仓库内不存在任何 vitest 配置文件**，因此用的是 vitest 默认 `testTimeout=5000`。

最小实现（3 个新文件，无一处改动业务逻辑、断言、并发、retry）：

- `apps/engine/src/config/testTimeoutBudget.ts`

```ts
export const engineTestTimeoutMs = (ci: unknown) => (String(ci ?? '') === 'true' ? 20_000 : 5_000);
```

- `apps/engine/vitest.config.ts`：`defineConfig({ test: { testTimeout } })`，并在解析时 `console.log('VITEST_TEST_TIMEOUT=… CI=…')`，把最终生效预算打进日志（避免"配置没作用到入口"这类误判）
- `apps/engine/src/config/engineTestTimeout.test.ts`：断言 `undefined/''/'false' → 5000`、`'true'/true → 20000`

实测两侧：本机 `VITEST_TEST_TIMEOUT=5000 CI=`（本地仍 5 秒）；GitHub Actions `VITEST_TEST_TIMEOUT=20000 CI=true`。**未改 `hookTimeout`**（现有失败签名明确是 test timeout）。

## B. 新开发分支 exact HEAD

`v395-enforce-readiness-20260919`，HEAD **`4770a21`**（提交链：`edfe074` silent clamp → `911986f` 开机出口验证 + 期望 IP 变更作废旧证明 → `7beaa0b` 旧仓 TP 隔离用例 → `269fbbc` 校准报告 → `351fd47` durable claim 修复 → `380849f` CI 分支条件 → `079a087` 取证报告 → `4770a21` CI-only timeout）。

## C. 开发分支 GitHub Actions

run **#373**（id `35422294383`）→ **`completed success`**，步骤逐项：`Diff check from V3.9.3 frozen baseline` / `Build workspace type prerequisites` / `Verify scripts` / `Typecheck` / `Test` / `Build` **全部 success**。此前 #370、#371(attempts 1-3) 的失败签名与定位见"CI 收敛过程"一节。

## D. 正式 v395 分支新 exact HEAD

**`4770a21698b3193ded5b45f213bff9e20721ef60`**。快进前先验证 `0223be9` 是其祖先（`merge-base --is-ancestor` = YES），用 `git push origin 4770a21:refs/heads/v395-economics-human-managed-20260919` 完成 **non-force fast-forward**（`0223be9..4770a21`）。正式分支现含：V3.9.5 economics/reachability/HUMAN_MANAGED 全量、silent clamp 修复、开机+周期出口验证、期望出口 IP 变更作废旧证明、旧仓 TP 隔离回归、`v395-*` CI 支持、durable UNKNOWN claim 饥饿修复、CI-only 20 s 预算及全部对应回归测试。

## E. 正式分支 GitHub Actions

run **#374**（id `35422533611`，head `4770a21`，branch `v395-economics-human-managed-20260919`）→ **`completed success`**，10 个非 skip step 全 success，日志含 `VITEST_TEST_TIMEOUT=20000 CI=true`、`Test Files 113 passed (113)`。同时证明 `v395-*` glob 对正式分支本身也生效（不再需要逐分支手工加白名单）。

### CI 收敛过程（四连败的真因，已修）

| run | 失败点 | 事实 |
|---|---|---|
| #370 | `Apply V3.9.3 autonomous Entry migration` | glob 生效后 branches 与 step `if:` 两处分支白名单不同步，冻结的 V3.9.3 源码补丁被重复套到已含迁移的分支：`V393_WIRING_MISSING:pre-primary envelope`。改为 `!startsWith(github.ref_name,'v395-')` |
| #371 a2/a3/a4 | `Test` | 四次尝试命中**四个不同**重 harness 测试（`eipResidentInspection`→`eipService`→`tradingQualityIntegration`→`api/projections`），签名一律 `Test timed out in 5000ms`、其余 ~610 全绿；本机这些用例最慢 491 ms（10 倍余量），且 `createTestHarness→createInternal` 不调用 `start()`（排除开机探针干扰）→ 判定为共享 runner 争用型计时假失败 |

处置遵守约束：**没有为通过而弱化断言、没有 skip、没有加 retry、没有关并行**。

## F. 是否部署 live —— **是**

既有脚本一次受控重启（`stop-zdj-lan.ps1` 身份三重证明后停止 → 备份 → 快进 checkout → 4 棵 dist 树替换 → `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`）。切换前用**成熟的 entry-only pause**（`PAUSED_MANUAL / autoResume=false`；TP Guardian 每 5 s 无条件扫描、reconciliation、私有同步、WS 全程未停），验证完成后 `resume`。8081、8084、SOCKS/HTTP 代理（PID 12732 / 9704 / 18216 / 20300）全程未动。

快进 checkout 时 `git merge --ff-only` 先**主动中止**：与两个本地未跟踪报告同名冲突。核对二者与工作树内容与已提交 blob **逐字节相同**后，仅把它们可逆移动到 `dryrun/held-untracked/`（未删除任何文件），快进完成后再由 git 以受跟踪形式还原。

## G. 新 buildId / PID / instanceId

| 项 | 部署前 | 部署后 |
|---|---|---|
| buildId | `3.9.5-f93676140a441bc0199c` | **`3.9.5-57b2843729dff7a298a9`** |
| PID | 26520 | **9680**（launcher host 9636，`LAUNCH_ID=f5e52135…`） |
| instanceId | `1c6cc310`… 之前为 `f38e3dec…` | **`1c6cc310…`** |
| checkout | `0223be9` | **`4770a21`**（tracked 干净，未跟踪项未删） |
| dataDir | `D:\MITS\data` | `D:\MITS\data`（未变，无第二数据根） |

身份闭环（不是命名约定）：worktree `4770a21` 构建 → `contentTreeHash(4 dist 树)=57b2843729d…` → 复制进 `D:\MITS` 后重算**同一哈希** → 运行实例自报 `3.9.5-57b2843729dff7a298a9`。回滚基线：`D:\MITS-WORKTREES\backup-live-dist\20260919-125853`（811 文件 / 3,742,874 B，重算哈希 = `f93676140a441bc0199c` ⇒ 可位级还原部署前那个构建）。

## H. startup egress 自动 VERIFIED 用时

**Engine start `12:59:52.166` → egress `lastVerifiedAt 12:59:54.969` = 2.80 秒**，`status=VERIFIED`、`lastVerifiedEgressIp=172.104.186.174`，全程**未调用任何人工探针**（本轮明令禁止）。对比上一轮：同一路径需人工 `POST …/binance-proxy/test`，造成 **238 秒**（09:46:27→09:50:25）的写阻塞窗口 —— 该窗口已消失。`reconnects=0`、`gaps=0`、代理与 routeIdentity 未变。

## I. 是否出现 `TESTNET_WRITE_EGRESS_NOT_VERIFIED`

**0 次**。自 12:59:52 启动至今的完整事件流里该字符串出现 0 次；`blockedProductionWriteAttempts=0`、`productionWrites=0`、`lockedToTestnet=true`、REST `demo-fapi.binance.com`。

## J. historical UNKNOWN 数量

**15 → 15（保留，未删、未改写）**。`reconciliation.historicalUnknownCount=15`、`verifiedNoActiveRiskUnknownCount=15`、entry 账本 `UNKNOWN=15`、`p0.verifiedNoActiveRiskReleaseCount=15`，`durableTasks` 行数只增不减（219 → 222）。按你的要求：不追求下降，审计记录原位保留。

## K. active durable claims 部署前 → 部署后

新增遥测把两件事彻底分开：`/api/v3/diagnostics/p0-entry-integrity` 现在返回 `durableClaims{durableTasks, activeClaims, activeUnknownClaims, releasedClaims, releasedUnknownClaims}`。

| 指标 | 部署前（旧构建，只能读 SQL） | 部署后（新构建遥测） |
|---|---|---|
| activeClaims | **15** | **1**（一笔真实活动提交，属应继续 BLOCK 的那一类） |
| activeUnknownClaims | **14** | **0** |
| historicalUnknownOrders | 15 | 15 |

即：15 个历史审计记录 ≠ 15 个活动 claim；旧构建把二者混为一谈正是本轮 bug。

## L. releasedUnknownClaims

**14**。60 秒 `unknownRiskScan` 复核环在启动后把 14 个旧 UNKNOWN 的证据刷新为新鲜（`activeRiskEvidence.checkedAt` 前移、`validUntil>now`、`identityTombstone` 与订单身份相符），`saveEntryExecution` 据此写入 `active=0, released_at=now`，`releasedClaims=14 / releasedUnknownClaims=14`；`durableTasks` 保持 221→222（**没有删除任何行**）。那 1 个仍活动的是真实在途订单（状态非 UNKNOWN），继续占位 —— 说明释放**不是无差别放行**。

## M. 是否有旧 intent / clientOrderId 被重放 —— **没有**

- 事件流里 `ENTRY_ORDER_SUBMISSION_UNKNOWN` = 0、无任何旧 intent 被重新提交的痕迹；`durableTasks` 只增不减且旧行 `active=0`。
- 新挂上的 TP 使用**全新**身份（DOTUSDT：`tp_mu7xbhca_t5tdst86` / clientOrderId `tp_mu7xbhca_000aa19` / exchangeOrderId `619478841`），旧 `tp_mu53q3gs_sd2qu66n` 保持 `CANCELED` 历史态。
- 结构保证：re-arm SQL 加 `AND released_at=0`；空闲 scope 上对被释放 intent 的 claim 返回 `acquired:false`（不再抛 `JOURNAL_CONFLICT`）；释放对"同一未提交 UNKNOWN"粘滞（TTL 过期、重启均不复活）；回归测试逐条固化（含 terminal 状态仍保留原 reprice 行为的防回归用例）。

## N. 新 Entry 是否仍被"已终结旧 UNKNOWN"错误阻塞 —— **否**

自 12:59:52 启动至今（13:20 复核）：`DURABLE_TASK_EXISTS` 提及 **0 次**，`ENTRY_SUBMISSION_UNKNOWN` **0 次**，而 **3 个自然 intent → 3 次 submit → 3 个订单建成**、`TP_PROTECTED` 4 次、`ENTRY_ECONOMIC_ADMISSION_EVALUATED` 5 次、`durableTasks` 由 221 增至 224（**只增不减，无删除**）、`activeClaims=0`、`activeRiskUnresolvedCount=0`、`p0.passed=true`。对照：修复前同一台机器同一账户在 09:46–10:50 的 50 分钟内有 **16 次** intent 因该原因被拒。DOTUSDT（正属修复前被 stale claim 占住的 15 个 underlying 之一）在启动后完成开仓并在 8 秒内重新挂上 TP。真正 unresolved 的新 UNKNOWN 仍会 fail-closed（K 表部署后一度出现的 1 个 active claim 就是它）。

## O. 旧仓 / TP 是否无损 —— **无损**

- 部署前 11 仓逐仓与部署后比对：`symbol/side/quantity/tpStatus/tpOrderId/managementStatus` **全部相同，0 处变化**，无 lost。
- 当前 15 仓 **15/15 `PROTECTED`**，`takeProfit READY`，`missing=0 / unverifiedTp=0 / orphanTp=0 / duplicateTp=0 / qtyMismatch=0 / wrongSide=0`（13:20 复核；部署时点为 12 仓 12/12）。
- HUMAN_MANAGED / AUTO_MANAGED 比例随自然开仓变化，无自动亏损退出；`POSITION_HUMAN_HANDOFF` 保持 `tpRetained=true` 语义。
- 过程中一次可见抖动：DOTUSDT SHORT 因**自然加仓**（qty 0.1→10，成交归因 `EXCHANGE_FILL_RECONCILED`/`ORDER_FILL_RECONCILED`，非迁移）导致旧 TP 按数量失配被 `CANCELED` 并进入重建，`13:05:06 TP_REPAIR_STARTED → TP_TARGET_SELECTED → 13:05:14 TP_PROTECTED`（8 秒闭环）。该事件同时留下两条重要事实：`fullPositionCanaryMinMovePct=1.2, aiMinMovePct=1.2` ⇒ **SHADOW 期 legacy 1.2% 距离门槛在 live 上确实仍然生效**；`aiPlanValid=false → source=FIXED_PROFITABLE` ⇒ AI 计划不达标时回落到确定性保护，不追价。
- 说明一处方法学瑕疵以免误读：上一版比对脚本用错键名（读 `orderId` 而非 `id`）打印出 `orderId: None` 的假差异；按 `tpOrderId` 字段的严格比对结论是"零变化"，价格逐项亦相同。

## P. 429 / 418 前后

`http429 17 → 17`、`http418 3 → 3`，**零新增**；本实例 governor `admitted 701 / queued 701 / blocked 0 / queueTimeout 0`，`budgetStatus=AVAILABLE`、`observationTrust=TRUSTED`、`usedWeight1m` 处于个位数百分比区间；`testnetWrites` 为实例内新计数（本轮部署后 0 → 有自然写入），`productionWrites=0` 全程不变。

## Q. 是否具备下一轮"受控 ENFORCE Canary"的**工程**条件 —— **具备**

工程侧此前挡路的三件事本轮全部关闭并在 live 证实：

1. silent clamp 取消（越界改为 fail-closed 拒绝，5 个迁移用例 + 幂等 + 防回归锁定）；
2. 重启造成的交易所写阻塞窗口（开机 2.8 s 自动出口证明，0 次 `TESTNET_WRITE_EGRESS_NOT_VERIFIED`）；
3. durable claim 饥饿（14 个占位释放、`DURABLE_TASK_EXISTS` 归零、审计与遥测分离、无重放路径）。

其余仍是**决策项而非工程项**，且本轮按指示一律未动：`HUMAN_MANAGED notional/equity ≈ 91%` vs `maxHumanManagedNotionalPctEquity=0.2` ⇒ ENFORCE 仍会按设计冻结新建仓；`minHistoricalReachProbability` 尚未经真实结果校准（live 自然样本窗口内仅 1 条 admission）；`minNetProfitUsd=1` 保持。下一轮若要 ENFORCE，需要先在这三者中至少给出 cap 的人工处置或明确授权 —— 本报告不替你做这个决定。

### 本轮未做的事

未切 ENFORCE；未 `caps=false`；未调 `maxHumanManagedPositions` / `maxHumanManagedNotionalPctEquity`；未改 margin/notional 口径；未自动平任何 HUMAN_MANAGED；未下调 reachability 阈值；未上调/下调 `minNetProfitUsd`；未删除任何 historical UNKNOWN；未按时间释放不确定订单；未动 AI 自主 side/quantityUnits/acceptablePriceRange、Maker Entry、quantity 不 clamp、side-neutral envelope、唯一退出链、Binance request governance 架构；未安装任何自启动/守护；未 force push 任何分支。

### 证据

本机 CI：`v395-enforce-verify4.log`（`VERIFY_EXIT=0`，113 files / 612 tests，含 `VITEST_TEST_TIMEOUT=5000 CI=`）。远端日志：`logDev.log`(#373)、`logOff.log`(#374)、失败取证 `log_35419914324.log`、`ci370.log`。取证：`zdj-copy.sqlite`、`claim-forensics.json`、`claim-classification.json`、`claim-replay.json`、`claim-replay.mjs`、`claim-probe.py`、`pre-restart-snapshot.json`（部署前逐仓/逐 TP 基线）。回滚：`backup-live-dist/20260919-125853`（哈希 `f93676140a441bc0199c`）、`D:\MITS-WORKTREES\v394-rollback`、`20260919-094000`。被移开的两个同名未跟踪副本在 `dryrun/held-untracked/`（内容与 git 还原版逐字节相同，未删除）。
