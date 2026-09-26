# V3.9.6 · G1–G4 最终本地验收（2026-09-26）— 唯一失败首因

请求执行的文件：`docs/plans/v396/CODEX-V396-G1-G4-FINAL-LOCAL-ACCEPTANCE-20260926.md`
分支：`codex/v396-final-convergence-20260922`（PR #9 只读，未切换、未修改、未评论）
本地角色：拉取、以 GitHub 最新 HEAD 为唯一产品真源的存在性核验、本地测试/门禁、（全绿时）唯一 1 次
受控 `stop → MANUAL_START`、身份闭环与在线验收。

## 唯一明确失败首因

`GITHUB_IMPLEMENTATION_NOT_PRESENT:G1,G2,G3,G4`

本轮指令的前提链在第一步就断了：G1–G4 在产品真源上没有实现，因此也不存在可跑的 G1–G4 定向测试；
“全绿后才消费 lifecycle”这一条件永远不成立，所以本轮 **0 次 stop、0 次 MANUAL_START**，
唯一 1 次授权保持未消费。附带事实：本 runbook 文件本身在 GitHub 上不存在（见 §2）。

## 1. Git

| 项 | 值 |
| --- | --- |
| 工作区初始状态 | clean（`git status --porcelain` = 0 行）→ 未做任何 reset/stash/覆盖 |
| `git fetch` 后 remote HEAD | `a83d204c58c71efa69baccd49f5242770449cc0d` |
| 本地 HEAD | `a83d204c58c71efa69baccd49f5242770449cc0d`（`rev-list --left-right --count` = `0 0`） |
| 需要 ff？ | 否：本地已与远端同一提交（该提交是上一轮本地产出的验收结论 `docs(v396): 本地验收结论 GITHUB_IMPLEMENTATION_NOT_PRESENT:G1,G2,G3,G4`，2026-09-26 00:34:29Z） |
| 拉取后远端新增产品提交 | **0 条**（GitHub `list_commits` 顶部三条依次为 `a83d204` / `dd94a26`（仅任务书） / `6f726a1`） |

## 2. GitHub 真源存在性核验

### 2.1 本 runbook 文件不存在

- 工作区：`docs/plans/v396/` 下无 `CODEX-V396-G1-G4-FINAL-LOCAL-ACCEPTANCE-20260926.md`；
- 历史：`git log --all -- <该路径>` 无任何提交；
- GitHub API：对 `refs/heads/codex/v396-final-convergence-20260922` 的 `docs/plans/v396` 目录列表
  （45 个文件，已存入 `e02-github-plans-dir.json`）中，2026-09-26 只有
  `CODEX-V396-LOCAL-ACCEPTANCE-TAKEOVER-20260926.md`（上一轮任务书），**没有本轮所指文件**。

因此本轮按“产品实现以 GitHub 最新 HEAD 为唯一真源 + 不得本地补源码”的约束，只能以该 HEAD 的实际内容验收。

### 2.2 四目标在真源上仍未实现（逐条 file:line + 全仓计数）

本轮重新对 `a83d204` 取证的原始输出在 `e01-existence-check.txt`：

| 目标 | 现状 | 关键证据 |
| --- | --- | --- |
| G1 Direction 单一硬权威 | **未实现** | `packages/core/src/portfolio.ts:392-394` 仍以 `p.maxLong/ShortExposurePct` 计算 room；`:450-451` 仍以 `after.*ExposurePct > p.max*ExposurePct` 参与裁决；`:445-455` 仍产出 `REJECT_EXPOSURE_LIMIT`。`grep -rn exposureCapacityPolicy packages/core/src` = **0 命中** |
| G2 AI 合法数量完整区间 | **未实现** | `grep -rn minQuantityUnits apps packages`（含 `.ts`/`.vue`）= **0 命中**；`compactEntry.ts:31` 指令仍只有 “no greater than … maxQuantityUnits” 上限 |
| G3 单 symbol 行情隔离 | **未实现** | `marketDataStaleness.ts:28` 仍 `if((freshness.sequenceInvalid ?? 0) > 0) return 'MARKET_KLINE_SEQUENCE_INVALID'`（系统级）；`appRuntime.ts:1907` 仍 `pipelineState = marketDataReason ? "PAUSED_MARKET_DATA_UNAVAILABLE" : "RUNNING"` |
| G4 唯一 authoritative 首因 | **未实现** | `grep -rn "nextAction\|authoritativeBlocker" apps packages` = **0 命中**；首因优先级仍写在 `apps/dashboard/src/views/OverviewView.vue`（`SUPPLY_SIDE_WAITS` / `firstExplanation`） |

另：`grep -rln "minQuantityUnits|authoritativeBlocker|nextAction" --include=*.test.ts` → **无任何测试文件**，
即 G1–G4 的“定向测试”本身也不存在于真源。既有 `packages/core/src/portfolio.test.ts` CR-01/CR-04 与
`apps/engine/src/services/marketDataStaleness.test.ts:7-10` 仍在**正向钉住**目标所禁止的旧语义
（这是实现方的断言改动项，本地不得代改）。

### 2.3 其它分支/PR 也没有实现（避免“实现在别处”误判）

`git for-each-ref --sort=-committerdate refs/remotes/origin`：最新分支即本收敛分支（`a83d204`）；
次新为 2026-09-22 的 `codex/v396-astra-handoff`、2026-09-21 的 `codex/v396-design-completion-20260921`。
`refs/pull/{6..13}/head` 逐一只读 fetch：#6 `12b4e68`(09-15)、#7 `da3225e`(09-15)、#8 `08487ca`(09-17)、
#9 `2b502ec`(09-21)。**没有任何分支或 PR 头包含 G1–G4 实现**。

## 3. 本地测试与门禁（不依赖 hosted CI；全部本地执行）

| 命令（本地） | exit | 结果 | 证据 |
| --- | --- | --- | --- |
| `npx vitest run`（packages/core） | 0 | 8 files / 53 tests passed | `g01-core.txt` |
| `npx vitest run --passWithNoTests`（packages/contracts） | 0 | **0 个测试文件**（如实记录，不声称 coverage） | `g02-contracts.txt` |
| `npx vitest run`（apps/engine 全量） | 0 | **170 files / 1,362 tests passed** | `g03-engine-full.txt` |
| `npx vitest run`（apps/dashboard） | 0 | 14 files / 58 tests passed | `g04-dashboard.txt` |
| `npm run typecheck`（全仓 `-ws`，各包 `--noEmit`） | 0 | 通过 | `g05-typecheck.txt` |
| `node scripts/v396-s00-static-check.mjs` | 0 | `blockers=[]`，123 入口，`exchangeWrites=0`，`network=NOT_USED`，`engineLifecycle=NOT_USED`，`settingsModified=false` | `g06-s00.json` |
| `git diff --check` | 0 | 无输出 | `g07-diffcheck.txt` |
| G1–G4 定向测试 | **NOT_RUN** | 真源上不存在这些实现与测试（§2.2） | `e01-existence-check.txt` |
| `npm run verify:deps` / `npm run build`（正式产物） | **NOT_RUN** | 前置“全绿→lifecycle”链在第一环即断；在一个正在运行的实例脚下重建 dist 只带来 provenance 漂移风险而无验收对象 | — |

绿色含义必须说清：以上全绿只证明**未被改动的旧语义仍然自洽**，不构成 G1–G4 的任何验收。
未删测试、未 skip、未降低断言、未替换或缩小任何本地门禁。测试全程使用隔离数据/端口。

## 4. Hosted CI / GitHub Actions

- `GitHub Actions / hosted CI`：**NOT_USED**（本轮明令禁止作为验收路径；未触发、未复用任何 workflow run）。
  所有产品测试、typecheck、verification 与门禁均在本地 Codex 环境执行（§3）。
- 对 GitHub 的调用仅限只读 REST：`list_commits`（分支提交列表）与 `get_file_contents`（目录/文件存在性），
  属于“实现存在性核验”，不是 CI 验收路径。
- 账户 Actions 额度/账单不可用：属外部基础设施状态，按指令登记为 `NOT_RUN_BILLING_LIMIT`，
  本轮未据此降低、删除或替换任何本地门禁。

## 5. Lifecycle 与身份闭环

| 项 | 值 |
| --- | --- |
| stop 次数 | **0**（授权保持未消费） |
| MANUAL_START 次数 | **0** |
| 运行实例 | pid 28628 / instanceId `ca211970-015d-44e3-9181-68d4cef3f257` / `restartCount 187` / `startReason MANUAL_START`（上一轮，未中断，本轮采样时 uptime≈13.8 小时） |
| 运行 buildId | `3.9.6-146f7eabad8e7353276d` |
| remote HEAD == local HEAD | 成立（均 `a83d204`） |
| local HEAD == formal build provenance == runtime identity | **不成立**：本轮未做正式 build（§3），运行实例仍是上一轮 `34f2e76` 产物。差值仅为 `docs/` 与 `scripts/`（`git diff --name-only 34f2e76..a83d204` 中 0 个 `apps/`/`packages/` 文件），但这不等于 §7.1 的闭环 |

## 6. 在线只读验收事实（同一实例连续运行，采样 2026-09-26 01:29:04Z）

完整原样输出：`s08-runtime-readback.json`。要点：

- 权限与边界：`environment=TESTNET`、`executionMode=TESTNET_ENABLED`、`entrySafetyMode=AUTO`、
  **`aiExitAuthority=SHADOW`**、**`productionWrites=0`**、`blockedProductionWriteAttempts=0`、
  `executionReadiness.mode=EXECUTION_READY`、PortfolioRisk profile `READY`、`settingsVersion=217`。
- Entry 资金仍只由 USDT/USDC 构成：`totalExecutableMarginUsd=8,207.91`、`sumCheck=true`，
  BTC 仍在 `excludedAssets`（`usdValue 839.44`，`NOT_IN_ENTRY_FUNDING_UNIVERSE`）。
- G1 的第二权威仍在真实裁决：`sideStatus=LONG_ONLY_EXECUTABLE`，
  SHORT 首因 `SIDE_PLAN_REJECT_EXPOSURE_LIMIT`，
  `capacityRoom={SHORT_EXPOSURE, ceiling 5,648.66, used 7,472.37, room 0, limitPct 0.5, usedPct 0.6614}`
  —— 同期 `exposureCapacityPolicy.direction` 仍是 `OBSERVE`。
- 自 restart 累计：`ANALYSIS_DISPATCH_INTENT=77`、`AI_RUN_TERMINAL=73`、
  `PRE_AI_TRADE_PLAN_FEASIBILITY=77`、`PRE_AI_NO_EXECUTABLE_CAPACITY=0`，
  `ENTRY_RESERVATION_CREATED / ENTRY_INTENT_CREATED / ORDER_SUBMISSION_ACCEPTED / ENTRY_FILL_RECORDED = 0`。
- 真实 blocker 分布（未放宽、未改名）：`HUMAN_ACK_OVERDUE` 11、`HUMAN_POTENTIAL_NOTIONAL_LIMIT` 10、
  `AI_DIRECTION_NOT_EXECUTABLE` 3、`CASH_FLOW_COVERAGE_UNPROVIDED` 1。
  其中 `AI_DIRECTION_NOT_EXECUTABLE` 是 §C 包线越界的 fail-closed 拒绝（模型选择不可执行侧），
  说明不可执行侧被点名后仍有越界尝试被挡住，而不是被静默翻向。
- UNKNOWN 与占用：durable UNKNOWN 47、当前占用 pending risk **1**（该行续证窗口过期，正被探针重试；
  `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED=160`、`ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED=0`）。
  未删历史 UNKNOWN、未把 UNKNOWN 当 0。
- `ENTRY_DECISION_BLOCKED` 里没有 exchange 写：`testnetWrites` 与 `productionWrites` 全程 0，
  所有拒绝都发生在任何交易所调用之前。没有自然 PLACE 归因于
  `HUMAN_POTENTIAL_NOTIONAL_LIMIT` 等真实容量约束与人工确认逾期，本轮**未强迫成交**。

## 7. 交回实现方（GitHub）的最小动作

1. G1：`packages/core/src/portfolio.ts` 的 `longRoom/shortRoom` 与 `after.*ExposurePct` 裁决必须改由
   `riskGovernance.maxDirectionExposurePct` + `exposureCapacityPolicy.direction` 单一权威驱动；
   `OBSERVE` 时只产观测、不得 `REJECT_EXPOSURE_LIMIT`；同步改写 `portfolio.test.ts` CR-01/CR-04。
2. G2：把由真实 `minNotional/minQty/stepSize/参考价` 推出的 `minQuantityUnits` 纳入
   `SideExecutionCapacity` + `EntryExecutionEnvelopeSideSchema` + `compactEntryFacts`，
   指令改为上下界双约束；上下界外各有确定性拒绝，禁止 silent clamp。
3. G3：以 `marketDataHub.freshness().stale[]` 做 symbol 级隔离（移出本轮可执行集合并留诊断），
   只有 systemic 源故障或全部可执行候选失效才允许 `PAUSED_MARKET_DATA_UNAVAILABLE`；
   同步改写 `marketDataStaleness.test.ts:7-10`。
4. G4：Engine 侧暴露单一 authoritative `{blocker, nextAction}`（按 pipeline cycle），
   其余 reason/status 字段降为分层 secondary diagnostics；删除页面自建优先级
   （`OverviewView.vue` 的 `SUPPLY_SIDE_WAITS` / `firstExplanation` 推导）。
5. 为本轮 runbook 落一个真实文件（当前 GitHub 上不存在），或指定其等价路径后再交接验收。

## 8. 结论

- 本轮结论：`GITHUB_IMPLEMENTATION_NOT_PRESENT:G1,G2,G3,G4`（唯一首因，见上）。
- `V396_G1_G4_LOCAL_ACCEPTANCE_PASS`：**未达成**，且不可通过本地补丁达成。
- 唯一 1 次 `stop + MANUAL_START` 授权：**保持未消费**，留给 GitHub 实现落地后的验收轮。
- 本地未修改任何 `apps/`、`packages/`、`config/`、`.github/` 文件；本轮新增内容仅为本报告与
  `docs/evidence/v396/g1-g4-final-local-acceptance-20260926/` 下的测试输出与只读 readback。
