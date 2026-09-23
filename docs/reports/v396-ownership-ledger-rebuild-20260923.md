# V3.9.6 所有权账本重建与复验（2026-09-23，授权范围内）

授权来自用户 2026-09-23 指令：一次停止 + 一次启动，备份并用修复后的驱动重建 ownership 账本，按运行时 `positionSide` 键读回校验，核验 `notionalUsd` 语义且不得靠 `.nonnegative()` 掩盖，确认 57 行 / 28 双行 / 6 冲突已清除，启动后复验八项，**不含 24h soak、不含生产写入或自动交易、清理与复验通过前不得切 ENFORCE**。

结论：**授权内全部步骤完成，全部验收项通过。** 两次生命周期动作用尽（无第三次），`aiExitAuthority` 保持 `SHADOW`，E 段仍 `NOT_RUN`，未签 `ACCEPTED`。机器可读证据见 [ledger-rebuild](../evidence/v396/runtime-cutover-20260923/ledger-rebuild/post-start-verification.json)。

## 1. 停机前保护核验（允许停机的前提）

PID 51008 运行中，27 笔持仓：`unprotected=[]`、交易所侧 `WORKING` 止盈 27 个符号且与持仓一一对应、46 笔非终态 Entry 订单全部 `VERIFIED_NO_ACTIVE_RISK`（缺证据 0）、`activeRiskUnresolved=0`、`inFlight=0`、行情 `FRESH`、私有账户 age 15.6 s、负 notional 0。停机期间又有 1 笔由交易所侧止盈成交而平仓（28→27），属保护生效而非引擎写入。

## 2. 停止（生命周期动作 1）

`scripts/stop-zdj-lan.ps1` → `ZDJ-MITS stopped; port 8080 is free`；复验 `listeners=0`、`pid51008=0`、`dist/main.js` 进程数 0。未安装任何自启动/看门狗。

## 3. 立即备份

| 对象 | 大小 | sha256 |
|---|---:|---|
| `v396-ownership.sqlite`（缺陷账本原件） | 184,320 B | `886c3327dba3f07271a61e24652ac946ae02e4600fa2748d8f2494edaf70b95a` |
| 一致性备份 `v396-ownership.pre-rebuild.sqlite`（在线备份 API，`integrity_check=ok`） | 184,320 B | `c2396afeb5e7b40c15e33af392ed0dffc5965f28e533b0b0897430fbb5371308` |
| `zdj-settings.pre-rebuild.sqlite`（在线备份 API） | — | 逐表指纹 32 表 / 124,218 行，全表计数记录在 `pre-rebuild-census.json` |

原缺陷账本**未被删除**，仅就地改名为 `v396-ownership.defective-20260923.sqlite` 保留；重建写入全新文件。`nothingDeleted: true`。

停机后对 settings 库执行过一次 `PRAGMA wal_checkpoint(TRUNCATE)` 以合并 WAL，发生在引擎停止之后，页帧被并入主文件、未删除任何数据；合并前状态由 07:38 的在线热镜像保留。

## 4. 用修复后的派生重建

`phase-c-d/ownership-migration-v2-driver.mjs`，全部检查 OK：`one-subject-per-open-position 27/27`、`subjects-use-the-position-side-scope`（样例 `["TESTNET","binance-primary","1000PEPEUSDC","LONG"]`）、`preview-creates-no-ai-authority wouldCreate=27 wouldMutateExisting=0`、`no-human-managed-cycle-granted-ai-authority`、`no-cycle-granted-ai-authority-in-a-shadow-window`、`no-cycle-carries-two-owner-rows`。

## 5. 按运行时键读回（不再手搓 `'ENTRY'`）

驱动用 `journal.get(executionScope(env, cred, SYMBOL, positionSide), cycleId)` 逐持仓读回，`missing=[]`。重建后 `scopeSidesSeen=["LONG","SHORT"]`（`ENTRY` 已不存在），`ownerVersionsObserved=[1,2]`——版本>1 只可能由引擎**沿同一把键写进迁移行**产生，配合"每周期一行"即证明两边口径已一致，而不是各写各的。

| 指标 | 重建前 | 重建后 |
|---|---:|---:|
| 所有权行数 | 57 | **27** |
| 不同周期数 | 29 | 27 |
| 双行周期 | 28 | **0** |
| `HUMAN_MANAGED`+`AI_ACTIVE` 冲突周期 | 6 | **0** |
| `AI_ACTIVE` 行 | 7 | **0** |
| 状态分布 | ENTRY:HUMAN 27 / ENTRY:HANDOFF 2 / LONG:HANDOFF 11 / SHORT:HANDOFF 10 / LONG:AI 7 | **HUMAN_MANAGED 25 / HANDOFF_PENDING 2** |
| quantity claims / mandates | 0 / 0 | 0 / 0 |

25 = 当前 27 笔中的 25 笔人工持仓，2 = 2 笔 AUTO_MANAGED 因无计划/无期限保守落 `HANDOFF_PENDING`，与 `managementStatus` 分布完全一致。

## 6. `notionalUsd` 语义核验（未用 `.nonnegative()` 掩盖）

- 契约行未改动：`trading.ts:125 notionalUsd: z.number().nonnegative().nullable().default(null)`；本轮 git diff 不含该文件。
- 约束仍然生效（关键反证）：`PositionSchema.safeParse({notionalUsd:-742.1})` **仍被拒绝**，`code=too_small`；同时 0 / 正值 / null 可通过。也就是说没有靠放宽 schema 让坏数据过关。
- 真实数据形态：27 笔持仓 `negative 0 / null 0 / zero 0`，且 `maxAbsoluteDeviationFromUnsignedMagnitude = 0` —— 每个存储值都精确等于 `|quantity| × markPrice`，没有被清零、填默认或改符号凑数。
- 修复位置在生产边界：适配器取金额幅度（缺字段仍 `null`）+ `RuntimeState.restore` 归一化历史行。

## 7. 启动（生命周期动作 2）与复验

`scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` → PID **26896**，实例见 `post-start-verification.json`，`version 3.9.6`，`buildId 3.9.6-e8b14777527e28bd3b80`（含两项修复的干净构建）。

| 要求 | 结果 |
|---|---|
| READY | `status=READY ready=true`，uptime 7.0 min 稳定 |
| READ_ONLY + SHADOW | `executionMode=READ_ONLY`、`aiExitAuthority=SHADOW`、`positionReviewEnabled=false`、`tradeEconomics.admissionMode=SHADOW`、`environment=TESTNET`、`settingsVersion=190`（未变） |
| `testnetWrites=0` | 0 |
| `productionWrites=0` | 0（`blockedProductionWriteAttempts=0`） |
| `lastWriteAt=null` | null，`lastWritePath` 亦 null |
| 账本与交易所事实一致 | 27 所有权行 = 27 持仓；HUMAN_MANAGED 行数 = 库里人工持仓数；`unprotected=[]`；TP 保护 `27/27`；46 笔 UNKNOWN 全部无风险证据（缺证据 0）；`activeRiskUnresolved=0`；账本 `integrity_check=ok`、outbox `52/52` 已投递 |
| 无 fatal / crash | 本次启动以来 `ENGINE_FATAL_ERROR/RUNTIME_STOP*` 计数 **0**；订单生命周期事件 **0**；`persistence=HEALTHY integrity=true` |
| 保持非 ENFORCE | `aiExitAuthority != ENFORCE` = true |

## 8. 仍未闭合

- **AI 依旧静默且驾驶舱仍误报**：`capitalExecutableCount=0`、`reasonCode=NO_EXECUTABLE_CONTRACT`、文案仍是"持续扫描中：当前没有合格可执行机会"、`lastRunAge` 已 429 分钟、AI 面板仍 `READY / IDLE_NO_DISPATCHABLE_CANDIDATE`——即审计报告的 P1-1，本次授权不含修复它。
- **E 段不执行**：权限记账已单值化，但账户仍无资本可执行候选，要产出"自然候选写链"只能放宽阈值，被明确禁止；且 `ENFORCE` 是另一层权限。
- 24h soak 未计时（本授权不含）。
- V3.9.5 未回滚、未恢复；回滚点仍是 `cold/zdj-settings.sqlite`（settingsVersion 189，`88c8ed2e…`）。
