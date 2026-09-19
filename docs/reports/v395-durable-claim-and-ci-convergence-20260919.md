# ZDJ-MITS V3.9.5｜CI 收敛 + durable Entry claim 饥饿修复

- 时间：2026-09-19 10:50–（+08:00）
- 分支：`v395-enforce-readiness-20260919`，基线 `0223be94be41c55b8e85d54a9fed489ac5b94764`
- 代码 HEAD：`351fd47648826c74124e603735cc7f7c64b0154f`（修复）+ `380849f3729793702d6c4a6d85d33256a0c8dfe6`（CI 条件）
- 本轮边界：**未切 ENFORCE、未改 HUMAN_MANAGED cap、未删任何 historical UNKNOWN、未按超时释放不确定订单、未改 minNetProfitUsd / minHistoricalReachProbability、未动 AI 自主权与唯一退出链**
- 取证方式：`D:\MITS\data\zdj-settings.sqlite` 以 **`mode=ro` 只读快照**（`zdj-copy.sqlite`，295,456,768 B，`integrity_check ok`），再用第二份 scratch 副本跑真实 `SettingsStore` 代码；live 库全程未被写

---

## A. workflow branch filter 如何修复

两层硬编码分支名，缺一不可：

1. `on.push.branches` 把 `v395-economics-human-managed-20260919` 换成通配 **`v395-*`**（`branches` 原生支持 glob；`docs/v395-*` 之类带前缀的分支不匹配，未扩大范围）。
2. **真正的坑**：`Apply V3.9.3 autonomous Entry migration` 与 `Persist migration patch` 两个 step 的 `if:` 仍写死两个分支名。通配生效后 run **#370** 立刻失败：

```
V3.9.3 autonomous Entry patch already applied
Error: V393_WIRING_MISSING:pre-primary envelope   ← scripts/v393-fix-entry-wiring.mjs:34
```

即冻结的 V3.9.3 源码迁移脚本被强行套在一个**早已包含该迁移**的 v395 分支上。修复＝把两个 `if:` 改成

```yaml
if: github.ref_name != 'v394-binance-governance-settings-20260918' && !startsWith(github.ref_name, 'v395-')
```

与 branches 的 glob 语义保持一致，`v394` 行为逐字不变。

## B. 远端 CI exact run / PASS

| run | head | 结果 |
|---|---|---|
| **#370** | `351fd47` | failure —— 上面那个迁移 step（修复前） |
| **#371** attempt 1 | `380849f` | failure —— `Test` step：`eipResidentInspection.test.ts` `Test timed out in 5000ms` |
| #371 attempt 2 | 同上 | failure —— `eipService.test.ts > builds seven-timeframe evidence…` 同样 5000 ms 超时 |
| #371 attempt 3 | 同上 | failure —— `tradingQualityIntegration.test.ts > …100 unchanged SHADOW candidates…` 同样 5000 ms 超时 |
| #371 attempt 4 | 同上 | 见下文 K/L 段结论 |

事实判定：**三次失败是三个不同的重 harness 测试、同一类 5000 ms 超时**，正是仓库既有的已知 flake 族（`eipService`/`snapshotReadOnly`/`riskPauseOverride` 一类，根因是 `createTestHarness → createInternal` 的 `market.refresh(120)`）；同一 v395 分支上**早于本轮**的提交 `576e88a`（#368）也 `completed failure`。已排除与本改动的因果关系：

- `createTestHarness` 走 `createInternal`，**从不调用 `start()`** → 本轮新增的开机出口探针在这些测试里不会执行；
- 本机同一套 CI 等价链 `npm run verify` = **`VERIFY_EXIT=0`，Test Files 112 passed，Tests 609 passed**（含本轮新增 12 个用例），且在最后一次代码改动之后重跑过。
- 处理方式遵守既有惯例：**只 `rerun-failed-jobs`，不为了变绿去改测试超时或断言**。

## C. `DURABLE_TASK_EXISTS` 的真实根因

不是 task 状态机、不是重启 re-claim，而是 **缺少终结化 + scope 局部唯一索引**：

```sql
-- settingsStore.ts:371
CREATE TABLE entry_execution_tasks(intent_id TEXT PRIMARY KEY, scope TEXT NOT NULL, active INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX entry_execution_scope ON entry_execution_tasks(scope) WHERE active=1;   -- 一个 scope 只能有一个活动 claim
```

- `scope = JSON([environment, credentialRef, resolveUnderlying(symbol), 'ENTRY'])` → **一个 underlying 一个坑位**（`binance-primary`，`ENTRY`）。
- `active` 是**派生量**：`saveEntryExecution` 原来写 `active = activeOrderStatus(order.status) ? 1 : 0`，而 `activeOrderStatus` 把 `UNKNOWN` 算作活动。
- 而 `reconciliationService.ts:77` 对已证明无风险的提交**故意保留** `status:'UNKNOWN'`（审计不变量），只在订单上写下 `activeRiskExposure:false` + `activeRiskEvidence{status:'VERIFIED_NO_ACTIVE_RISK', sources:[5 项交易所证据], checkedAt, validUntil, identityTombstone}`。
- 于是同一个 proof 被 `entryOrderOccupiesRisk()`（→ `activeRiskUnresolvedCount=0`）**承认**，却没被 `saveEntryExecution()` 承认 —— 这个不对称就是全部 bug。

新 intent 命中唯一索引 → `claim.acquired=false` → `entryCoordinator.ts:206` 抛 `ENTRY_SUBMISSION_UNKNOWN_DURABLE_TASK_EXISTS`，并把**旧 intent/旧订单重新塞回内存**、释放新 intent 的 reservation，然后进入 `WAIT_EXECUTION_WAIT`，最终 `ENTRY_EXECUTION_WAIT_TERMINATED reason=RESERVATION_INVALID`。

## D. 当前 15 个 historical UNKNOWN 分类（真实数据，非样例）

| 事实 | 数 |
|---|---|
| `entryOrders` 中 `status='UNKNOWN'` | **15** |
| 其中存在 durable claim 行的 | 14（第 15 条 `entry_intent_mu4rcjw2…` XRPUSDC 无 task 行） |
| `active=1` 的 claim | **14**（14 个不同 underlying：XRP NEAR AVAX ZEC INJ BTC ARB APT TUT BNB LTC DASH FIL VVV） |
| `released_at>0` | 0（新列） |
| 15 条全部具备 `activeRiskEvidence.status='VERIFIED_NO_ACTIVE_RISK'` | **是**（含 5 源：exact-order-not-found / open-orders-absent / user-trades-absent / all-orders-absent / position-zero） |
| `exchangeOrderId` 非空 / `filledQuantity>0` / 对应 symbol 有持仓 | **0 / 0 / 0** |
| `entry_execution_tasks` 总行数 | 214（active 14 + inactive 200） |

`historicalUnknownCount=15`、`activeRiskUnresolvedCount=0`、`verifiedOrderFactMismatchCount=0`、p0 `passed=true` —— 与副本一致。

## E. 哪些 claim 必须继续 BLOCK

**判据（全部复用系统既有 reconciliation 事实，不新增状态机）：**

```ts
// entryRiskOccupancy.ts（新增，复用既有 hasVerifiedNoActiveRisk）
entryClaimReleasedByExchangeFacts(order, now) =
     order.status === 'UNKNOWN'
  && !order.exchangeOrderId
  && Number(order.filledQuantity ?? 0) === 0
  && hasVerifiedNoActiveRisk(order, now)        // activeRiskExposure===false
                                                // ∧ evidence.status==='VERIFIED_NO_ACTIVE_RISK'
                                                // ∧ checkedAt 有限 ∧ validUntil > now（5 分钟 TTL 内）
                                                // ∧ evidence.identityTombstone === entryIdentityTombstone(order)
durableEntryClaimActive(order, now) = ACTIVE_ORDER.has(order.status) && !entryClaimReleasedByExchangeFacts(order, now)
```

因此**必须继续 BLOCK** 的恰是：证据缺失、证据已过期（`validUntil ≤ now`）、tombstone 与当前订单身份不符、存在 `exchangeOrderId`、存在成交量、或订单状态本身仍是 `NEW/SUBMITTING/WORKING/PARTIALLY_FILLED` 的提交。

**明确不采用的释放依据**（用户禁止项，代码里也未出现）：时间超过 N 分钟、重启次数、单纯 `exchangeOrderId===null`、单纯 `activeRiskUnresolvedCount===0`。

副本快照里的 15 条：按 `now=快照时刻` 其证据 TTL（`validUntil=checkedAt+300 s`）**全部已过期** → 修复后的代码对 **15/15 仍判定 active**（replay 里 `blockReleaseNeedsFreshProof=true`）。只有当运行中的引擎用 60 s 复核环把证据刷新后，claim 才释放 —— 这正是 fail-closed 期望。

## F. 哪些 claim 可以安全 release

同一批 14 个 active claim：一旦由 60 s `unknownRiskScan` 重新证明（`checkedAt` 前移、`validUntil>now`），**14/14 满足全部客观条件**（无交易所订单号、无成交、无持仓、五源齐备、身份墓碑匹配）→ 可释放。第 15 条 UNKNOWN 没有 claim，不占任何坑位。

**结论：0 个 claim 属于"仍有真实不确定风险"，14 个属于"已被客观证据终结但仍占位"。** 这是由副本里的真实证据算出来的，不是按名字猜的。

## G. 修复后 7（实为 16）个历史失败 replay 结果

先纠正上一轮口径：`7` 来自单个轮转日志文件的窗口；**durable 事件库才是权威**：

| 指标（自 09:46 启动至 10:50 快照） | 数 |
|---|---|
| `ENTRY_ECONOMIC_ADMISSION_EVALUATED` | **65**（wouldBlock 65 / passed 0；blockers：HUMAN 65、REACH_PROB 41、NET_PROFIT 14、REACH_HARD 5） |
| `ENTRY_INTENT_CREATED` | **40** |
| `ENTRY_ORDER_SUBMISSION_UNKNOWN`（reason=`…DURABLE_TASK_EXISTS`，16 个不同 intentId） | **16** |
| 另外 16 条 `CANDIDATE_LIFECYCLE_CHANGED` 只是同一原因的等待态回显（不是额外拒绝）；全库 lifetime 113 条、跨 3 天 | — |
| `ENTRY_ORDER_CREATED`（订单确实建成） | **6**；`POSITION_CLOSED_USER_DATA` 4 |

replay（scratch 副本上跑真实 `SettingsStore`）：

- **修复前**：14 个 underlying 的 scope 各被一个 stale-evidence UNKNOWN 占住，任何新 intent `acquired=false` → 复现线上 16 次拒绝。
- **修复后**：对每个 incumbent 写入一条**新鲜**证据（引擎 60 s 环本来就会做的事）→ `saveEntryExecution` 立即 `active=0, released_at=now`；随后同一 scope 的**新 intent `acquired=true`**，14/14 全通；`entryExecutionClaimStats()`：`activeClaims 14→0`、`releasedUnknownClaims 0→14`，而 `entryOrders` 里 `status='UNKNOWN'` **仍是 15**（审计未动）。
- 反向不变量：证据**不新鲜**时 `acquired=false`（`blockReleaseNeedsFreshProof=true` 14/14）；对已释放的旧 intent 以 `retryRejected=true` 再次 claim → `acquired=false`，行仍 `active=0`（不会重发旧单）。

## H. 是否存在重复提交风险 —— **不存在**，四条独立保证

1. 释放只改 `entry_execution_tasks.active/released_at`，**绝不**向交易所发任何请求；释放路径的唯一调用点是 checkpoint 写入。
2. `claimEntryExecution` 的 re-arm 语句加了 `AND released_at=0`，因此被证据释放的旧 intent **无法**再把自己的行激活；`retryRejected` 命中已释放行时改为返回 `acquired:false`（旧行为是抛 `JOURNAL_CONFLICT`），coordinator 走"未获取"分支，不发单。
3. 释放后的 claim 是**粘滞**的：只要该订单仍是同一个未提交 UNKNOWN（无 `exchangeOrderId`、无成交），即使 5 分钟 TTL 到期或引擎重启，也不会复活；真实风险出现（拿到交易所单号 / 成交 / 活动状态）才重新占位。
4. 新 Entry 永远携带**新** `intent_id` 与新 `clientOrderId`（`ml_*`）：replay 断言两行 `clientOrderId` 集合大小为 2，PK 是 `intent_id`、唯一索引按 scope，无复用路径；`runtime_entities` 里的历史 UNKNOWN 行不删不改。

容量口径：释放使行变为可 trim（`STORAGE_ROW_CAPS.inactiveEntryExecutions=10000`），当前总行 214，**远低于阈值**；且 UNKNOWN 审计记录本身存于 `runtime_entities('entryOrders')`，不受该 trim 影响。

## I. full tests / build / CI 结果

- 本机 `npm run verify`（`verify:deps` → `verify:scripts`（含 4 个 PowerShell 契约测试）→ `typecheck` 4 workspace → `build` → `test`）：`VERIFY_EXIT=0`，**Test Files 112 passed (112) / Tests 609 passed (609)**；较上一轮 +12 用例，全部为本轮新增。
- 新增测试（`executionLifecycle.integration.test.ts`，9 个 `it`，覆盖用户要求的 Test 1–7）：真实未决 UNKNOWN 继续 BLOCK；有新鲜证据即释放且**保留 UNKNOWN 行**；已释放旧 intent 不得 re-arm（含 scope 空闲时返回 collision 而非抛错）；重启 + TTL 过期不复活；真正不确定的 task 重启后仍占位且不重复下单；terminal 状态仍保留既有 reprice re-arm 行为（防回归）；新 Entry 获得新 identity/新 clientOrderId；`historicalUnknownCount` 与 `activeUnknownClaims` 分列。
- `git diff --check 0223be9..HEAD` 干净（whitespace gate 是 CI 首道闸）。
- 远端 CI 状态与处置见 B（本轮最后一段）。

## J. 正式 `v395-economics-human-managed-20260919` 新 HEAD

**未收敛，正式分支 HEAD 仍是 `0223be94be41c55b8e85d54a9fed489ac5b94764`（远端与本地一致）。**

原因：本轮设定的门是"远端 CI 必须绿才收敛/部署"，而远端 CI 目前被下述计时问题挡住。收敛本身是纯 fast-forward（`0223be9` 是 `380849f` 的祖先，无冲突、无需 force），一旦 CI 绿即可一步完成。

### B-补：远端 CI 四次尝试的完整事实

| attempt | 失败 step | 失败测试 |
|---|---|---|
| 1 | Apply V3.9.3 autonomous Entry migration | 迁移脚本对本已含迁移的分支重复打补丁（已按 A 段修好） |
| 2 | Test | `eipResidentInspection.test.ts` — `Test timed out in 5000ms` |
| 3 | Test | `eipService.test.ts > builds seven-timeframe evidence…` — 同 5000 ms |
| 4 | Test | `api/projections.test.ts > projects exchange-complete trading PnL…` — 同 5000 ms，**`Tests 1 failed | 610 passed (611)`** |

判定为**争用型计时 flake、而非本轮改动引入的逻辑失败**，三条独立证据：

1. 四次里失败测试每次都换（4 个不同文件），且每次其余 610 项全绿；根因签名相同（vitest 默认 `testTimeout=5000ms`，仓库无任何 `testTimeout/hookTimeout` 覆盖）。
2. **本机实测**被点名的文件：`projections/eipService/tradingQualityIntegration/eipResidentInspection` 四文件合跑 **3.41 s**，单个最慢用例 **491 ms**，距 5 s 约 10 倍余量。
3. CI 引擎套件总时长 `99.88 s(597 tests, 绿) → 132.93 s(611 tests)`，与 windows-latest 共享 runner（2 核 + 112 文件并行 worker）的争用一致；本轮新增用例只占 14 个。同时 `createTestHarness → createInternal` 不调用 `start()`，故本轮新增的开机出口探针不可能进入这些测试路径。

## K–P：因未过 CI 门而未执行的动作（明确记录）

| 项 | 状态 |
|---|---|
| K. 是否部署 live | **否**。live Engine 未被触碰：仍 PID 26520、instanceId `f38e3dec…`、`buildId 3.9.5-f93676140a441bc0199c @ 0223be9`、`admissionMode=SHADOW`、`settingsVersion=178`；新构建（预期 `buildId 3.9.5-0524a97eda5ea70e9f8a`）已就绪但**未安装**（`D:\MITS\apps\*\dist` 一字未改，42+ 个 untracked 项未动） |
| L. startup egress 自动 VERIFIED | 未验证（需部署后才能验）。代码事实：`appRuntime.start()` 现在 `await verifyBinanceTransportEgress()` + 每 15 分钟一次；上一节手工探针造成的 238 s 写阻塞窗口应由其消除 |
| M. 旧仓 TP 是否无损 | 部署前基线已固化：`pre-restart-snapshot.json` 记录 9 仓（HUMAN 7 / AUTO 2）、`takeProfit READY 9/9 PROTECTED`、逐单 orderId/价格；另有 15 个 historical UNKNOWN、`productionWrites=0`、`testnetWrites=71` |
| N. 429/418 | 截至最后一次只读复核仍 `http429=17 / http418=3`，与本轮开始一致（零新增）；本轮未向交易所写任何东西 |
| O. live DURABLE_TASK_EXISTS | 未修复到 live（未部署）。缺陷事实在 live 仍然存在：14 个 underlying 被已证明无风险的 UNKNOWN claim 占位，自 09:46 起造成 **16 次** intent 拒绝 |
| P. 是否具备受控 ENFORCE Canary 工程条件 | 代码侧的两项前提（silent clamp 修复、claim 饥饿修复、开机出口验证）**已实现并通过本机全量测试**，但**尚未生效于 live**；cap 冻结行为（HUMAN notional 91% vs 20%）按你的指示本轮保持不动，仍是 ENFORCE 的独立决策项 |

### 待你确认的解决方案（我的反建议）

远端 CI 目前不会因重跑而稳定变绿：这族重 harness 测试一直贴着 vitest 默认 `testTimeout=5000ms`，共享 runner 争用时随机有人掉队。三个选项：

1. **（建议）在 `apps/engine` 的 vitest 配置里显式设 `testTimeout: 20_000`（必要时加 `hookTimeout`）**。这不弱化任何断言、不跳过任何测试、不改任何阈值，只是把"CPU 争用导致的假失败"从判定里去掉；本机最慢用例 491 ms，20 s 留 40 倍余量，仍能抓住真正的挂死。
2. 继续 `rerun-failed-jobs` 赌一次绿（每轮约 6 分钟，已 4 连败，且绿了也不稳定，后续每个 v395 分支都会重演）。
3. 降 CI 并行度（`fileParallelism:false` 或限制 worker 数）——改动更大、CI 更慢，但不动测试预算。

在你选定前，我不会碰测试配置（项目记忆里有"不要为了让测试通过而改测试"的既定约束），也**不会**部署 live 或收敛正式分支。

### 证据清单

`D:\MITS-WORKTREES\dryrun\`：`zdj-copy.sqlite`（live 库只读快照）、`claim-forensics.json`、`claim-classification.json`、`claim-replay.json`（15 UNKNOWN × before/after 逐条 + claim 统计）、`claim-replay.mjs`、`copy-db.py`、`pre-restart-snapshot.json`、`ci370.log`/`ci371.log`/`ci371a2.log`/`log_35419914324.log`（四次 CI 原始日志）、`log_35410419630.log`（绿色基线对照）、`v395-enforce-verify3.log`（本机全链 `VERIFY_EXIT=0`）。
