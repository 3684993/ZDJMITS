# V3.9.6 运行期操作清单与证据模板（S08–S10）

状态：`READY_FOR_TESTNET_AUTHORIZATION`。本文件描述**如何做**这些运行，并给出证据模板；它本身不构成执行授权，本轮也未执行其中任何一项。每一项都写明前置条件、失败即停的判据与必须落盘的证据，缺证据就保持 `NOT_RUN` / `INSUFFICIENT_EVIDENCE` / `PENDING_WINDOW_INCOMPLETE`。

前置总则（对全部条目生效）：

1. Engine 只允许人工启停（见 `AGENTS.md`）。任何清单步骤都不得自动重启、热重载或安装自启动。
2. 先跑一次整仓门禁并把 `HEAD`、`git status --porcelain` 输出与 `docs/evidence/.../J6/release-manifest.json` 的 hash 一起写进证据目录：运行证据必须能对应到一个确定的构建。
3. 任何一步失败：保留现场、停止后续步骤、把失败写进证据；不得为了拿绿而放宽阈值、删测试或改配置。

---

## 1. 隔离临时库迁移演练（preview → migrate → readback → restore → rerun）

前置：OS 临时目录里的副本，**不得**指向 `data/`。命令模板：

```
cp <snapshot>/zdj-settings.sqlite      <tmp>/zdj-settings.sqlite
cp <snapshot>/v396-ownership.sqlite    <tmp>/v396-ownership.sqlite
node scripts/v394-stage6-preflight.mjs --data-dir=<tmp> --out-dir=<tmp>/evidence --skip-engine-check
```

步骤与判据：

| 步 | 动作 | 必须通过 | 失败即停信号 |
|---|---|---|---|
| 1 | `OwnershipMigration.preview(subjects, journalBefore, now)` 只读 | 不产生任何写入；`wouldMutateExisting` 与实际一致 | preview 后行数变化 |
| 2 | 备份：`scripts/v394-stage6-preflight.mjs` 逐 durable 文件 `sqliteBackup` | 每个文件 `integrity_check=ok` 且逐表行数指纹等于源 | `BACKUP_FINGERPRINT_MISMATCH` |
| 3 | `apply` 迁移 | 人工持有周期迁移后仍为 `HUMAN_MANAGED`；无计划/无期限仍 `HANDOFF_PENDING` | 出现新的 `AI_ACTIVE` |
| 4 | readback：`OwnershipMigration.verify(image, cycles)` | `missing=[]`，ownerVersion/deadline/outbox 与迁移前逐条相等 | 任一周期缺失或版本回退 |
| 5 | restore：把镜像放回新目录并只读打开 | `OwnershipJournal.schemaInfo()` 版本受支持；再次 verify 一致 | `OWNERSHIP_SCHEMA_*` |
| 6 | 重跑 apply（幂等） | `created=0, preserved=N`，行数不变 | 任何新行或版本变化 |
| 7 | 新版本账本被旧构建打开 | 拒绝启动：`OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME`，且不写任何 DDL | 旧构建成功打开并建表 |

证据模板：`docs/evidence/v396/<runId>/migration-rehearsal.json` = `{tmpDir, sourceHashes, steps:[{id,command,exit,evidence}], verdict}`。

## 2. 生产迁移（真实库）——需明确授权

只有第 1 节全绿后才可申请。额外判据：迁移前后 `SELECT COUNT(*)` 与 owner 版本清单一致；`settingsVersion` 单调；失败时按备份镜像回退，且回退后 Engine 以**原**授权档位（`aiExitAuthority=OFF`）启动。禁止用迁移顺带开启任何 AI 权限。

## 3. SHADOW / canary 窗口

前置：`aiExitAuthority=SHADOW`、`positionReviewEnabled=false`、`tradeEconomics.admissionMode=SHADOW`、`connections.executionMode=READ_ONLY`。
观察项（每项都要有事件计数，不允许只写“正常”）：`AI_EXIT_SHADOW_DECISION`、`AI_MANAGEMENT_DEADLINE_FIXED`、`POSITION_FACT_UNVERIFIED`、`RISK_*` 拒绝码、`TRADE_PLAN_PERSISTED`、复核台账行数、`usageStatus='UNKNOWN'` 比例。
判据：SHADOW 阶段交易所写请求数必须为 0；出现任何非零即 `FAIL` 并立即停窗口。

## 4. Testnet 有限写回合

前置：第 3 节通过 + 人工明确授权 + `aiExitAuthority=ENFORCE` 需 `PATCH /settings/governance` 带 `ack=AI_EXIT_ENFORCE_AUTHORITY`（记录返回的服务端回读，不接受前端自述）。
每回合必须留证：计划 → intent → reservation → 成交的 `planId/planVersion/candidateId` 链路；`ExecutedPlanRecord.predictionMutated=false`；退出侧 `clientOrderId` 与 JIT 复核结论；失败/超时/ACK 丢失都要有用量台账行（缺 usage ⇒ `UNKNOWN`，不得记 0）。

## 5. 24 小时连续 soak

窗口未满时状态一律 `PENDING_WINDOW_INCOMPLETE`，中途重启则时钟重新开始并记录原因。最小观测集：

- 账户：全账户净值曲线、最大回撤、未平仓年龄分布、人工接管积压；
- 安全：`AI_MANAGEMENT_DEADLINE_ELAPSED`、`HANDOFF`、mandate 撤销、退出任务未确认滞留；
- 真值：任何 `UNKNOWN` 的数量与占比（必须显式列出，不得并入 0）；
- 成本：token 台账 `computable` 比例、`transportAttempts` 未证明的行数、复核预算耗尽次数；
- 稳定性：Engine 未被任何自动化启停（`engineLifecycle=NOT_USED` 的静态复核 + 运行期 PID 不变）。

## 6. 样本外回放与统计

命令：`node scripts/v396-replay-report.mjs --manifest docs/evidence/v396/final-convergence-20260922/J6/experiment-manifest.json --bundle <frozen-bundle.json>`。
判据：泄漏或跨切分违规 ⇒ `FAIL`；缺门槛数值、覆盖不足、成本不全、CI 跨 0、任一预注册组缺失 ⇒ `INSUFFICIENT_EVIDENCE`；只有全部满足才允许 `ECONOMIC_SUPPORTED`。失败组与未成交候选必须出现在报告里，不得删除 manifest。

## 7. 发布

`node scripts/v396-release-manifest.mjs` 只有在 `source.worktreeClean=true`、`historyContainsBaseline=true`、`storageCoverage.gate=S08_STORAGE_COVERAGE_PASS` 且全部运行期项都有明确状态时才有效。发布文件的 `state` 上限是 `READY_FOR_TESTNET_AUTHORIZATION`；`ACCEPTED` 由验收方单独签署，不由实现方填写。
