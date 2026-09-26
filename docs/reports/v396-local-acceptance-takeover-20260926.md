# V3.9.6 · GitHub 接管实现的本地验收（2026-09-26）— 失败结论

任务书：`docs/plans/v396/CODEX-V396-LOCAL-ACCEPTANCE-TAKEOVER-20260926.md`
分支：`codex/v396-final-convergence-20260922`（PR #9 未读取、未修改、未切换）
本地角色：仅拉取、实现存在性核验、既有门禁、（条件满足时）一次受控 lifecycle、只读在线验收。

## 结论（先说结果）

`GITHUB_IMPLEMENTATION_NOT_PRESENT:G1,G2,G3,G4`

四个产品目标在 GitHub 最新 HEAD 上**全部没有实现证据**，且其中三个被仓库**现有测试**正向钉在
目标所禁止的旧语义上。因此本轮：

- **未修改任何产品源码**（`git status --porcelain` 在产品路径上 0 行）；
- **未消费 §6 的 lifecycle 授权**：0 次 stop、0 次 MANUAL_START，运行实例仍是昨天的
  pid 28628 / `3.9.6-146f7eabad8e7353276d`，未中断、未重启；
- 未运行 `npm run build` / `verify:deps`（二者会重写 dist；在无法进入部署环节的前提下，
  在一个正在运行的实例脚下重建产物没有收益、只有身份漂移风险），记为 `NOT_RUN` + 原因；
- Production writes 全程 0。

## 1. Git

| 项 | 值 |
| --- | --- |
| pull 前本地 HEAD | `6f726a13a2c0aa2439f749aaf0880e42f5aa5b10`（= 任务书 §1 的交接前基线） |
| pull 后本地 HEAD | `dd94a2627e5d8a21e792c2a995298fdcc36cdfbe` |
| remote HEAD（`git ls-remote`） | `dd94a2627e5d8a21e792c2a995298fdcc36cdfbe`（与本地一致） |
| 拉取方式 | `git fetch` + `git merge --ff-only`（无 rebase、无 squash、无 force push） |
| `6f726a1..dd94a26` 提交 | 仅 1 条：`dd94a26 docs(v396): hand off local acceptance for GitHub takeover` |
| 该范围改动文件 | 仅 `docs/plans/v396/CODEX-V396-LOCAL-ACCEPTANCE-TAKEOVER-20260926.md`（+361 行，0 个产品文件） |
| 工作区 | clean（拉取前后 `git status --porcelain` 均为空；本轮结束时仅新增本报告与 `docs/evidence/v396/local-acceptance-takeover-20260926/`） |

**关键事实**：交接基线之后，GitHub convergence 分支上没有任何产品实现提交；
`git diff --name-only 6f726a1..dd94a26` 输出里没有一个 `apps/` 或 `packages/` 文件。
其余远端分支（`codex/v396-astra-handoff-20260922`、`codex/v396-design-completion-20260921` 等）
均为本轮不相关的历史分支，未从中取任何代码。

## 2. GitHub 实现存在性（逐目标）

### G1 Direction 单一硬权威 —— 未实现

方向容量在 sizing 层仍有第二套独立硬否决，且完全不读策略开关：

- `packages/core/src/portfolio.ts:392` `longRoom = max(0, p.maxLongExposurePct − before.longExposurePct) × equity`
- `packages/core/src/portfolio.ts:394` 同理 `maxShortExposurePct`
- `packages/core/src/portfolio.ts:445-455` `room < minMargin ⇒ admission = REJECT_EXPOSURE_LIMIT / REJECT_QUOTE_MARGIN`
- `packages/core/src/portfolio.ts:450-451` `after.*ExposurePct > p.maxLong/ShortExposurePct` 参与裁决
- `packages/contracts/src/portfolio.ts:63` 两个字段仍以 `.max(1).default(.5)` 存在（旧第二权威的数据形状未变）
- `grep -rn "exposureCapacityPolicy" packages/core/src` → **0 命中**：策略开关只存在于
  `apps/engine/src/services/{executableRiskHeadroom,riskReadiness}.ts`、
  `apps/engine/src/config/{governanceSettingsMatrix,settingsStore}.ts`，即只覆盖风险门，不覆盖 sizing。

运行时同图复现（只读 `GET /settings`）：`maxDirectionExposurePct=1` + `direction=OBSERVE`，同时
`portfolioIntelligence.maxLongExposurePct=0.5` / `maxShortExposurePct=0.5`；
`GET /pipeline` 的 `capacityVisibility.entryCapacity.SHORT.firstBindingConstraint` 仍是
`SIDE_PLAN_REJECT_EXPOSURE_LIMIT`（OBSERVE 下照样把一侧压成 0）→ 验收点 1 直接失败。

正向钉住旧语义的现有测试（不允许我改）：`packages/core/src/portfolio.test.ts`
`CR-01 names the direction cap and its used/ceiling numbers when sizing a side comes out zero`
断言 `admission === 'REJECT_EXPOSURE_LIMIT'` 且 `capacityRoom.source === 'SHORT_EXPOSURE'`，
`CR-04` 断言投机档同样 `REJECT_EXPOSURE_LIMIT` —— 两者本轮均通过（见 `t01-core-portfolio.txt`）。

### G2 AI 合法数量完整区间 —— 未实现

- `grep -rn "minQuantityUnits" apps packages` → **0 命中**（全仓不存在该字段）。
- `apps/engine/src/services/preAiExecutionEnvelope.ts:84` 局部变量 `minUnits`
  只参与 `executable` 布尔（`:85`），既不出现在返回对象（`:96`）也不出现在契约
  （`packages/contracts/src/trading.ts:18-23` 只有 `maxQuantityUnits`、可选
  `minimumLegalNotionalUsd`、`legalNotionalRangeUsd`）。
- `packages/core/src/compactEntry.ts:31` 指令文本仍是
  “quantityUnits must be a positive integer **no greater than** the chosen side maxQuantityUnits”
  —— 只有上限，没有下限，正是模型连续产出 `< $5` 数量的直接机制。
- 拒绝侧仍只有一处：`apps/engine/src/services/aiQuantityAllocation.ts:15`
  `throw new Error('AI_QUANTITY_BELOW_MIN_NOTIONAL')`（低于最小名义拒绝 ✓，但超过最大数量的上界拒绝、
  以及“上下界同时进输入”的验收点均无实现/无测试）。

### G3 单 symbol 行情故障只隔离该 symbol —— 未实现（且被测试钉反）

- `apps/engine/src/services/marketDataHub.ts:207` 已经**按 symbol** 统计
  （`if(reasons.some(r=>r.endsWith('_SEQUENCE_INVALID'))) sequenceInvalid++; if(reasons.length) stale.push(s.symbol)`），
  信息足够做隔离；
- 但 `apps/engine/src/services/marketDataStaleness.ts:28`
  `if((input.freshness.sequenceInvalid ?? 0) > 0) return 'MARKET_KLINE_SEQUENCE_INVALID'`
  —— 计数 ≥1（即**一个**坏 symbol）就产出系统级原因；
- `apps/engine/src/runtime/appRuntime.ts:1907`
  `pipelineState = marketDataReason ? "PAUSED_MARKET_DATA_UNAVAILABLE" : "RUNNING"`
  —— 该系统级原因直接把整条 Entry pipeline 全局暂停，健康 USDT/USDC candidate 一起被停；
- `apps/engine/src/runtime/appRuntime.ts:1926`（`else if (marketDataReason) noEntryReason = pipelineState`）
  把这个全局态继续作为 `noEntryReason` 输出。
- 正向钉住该行为的现有测试：`apps/engine/src/services/marketDataStaleness.test.ts:7-10`
  以 `freshness:{fresh:4,total:100,quoteFreshRatio:1,sequenceInvalid:1}` 断言
  返回值恰为 `'MARKET_KLINE_SEQUENCE_INVALID'`，并通过（`t02-engine-targeted.txt`）。
  也就是说 G3 的验收点 1（one-bad + one-good ⇒ 只隔离坏 symbol）在当前 HEAD 上**必然失败**。

### G4 驾驶舱/运行时唯一首因 —— 未实现（且首因优先级在 UI 侧自建）

- `grep -rn "nextAction|authoritativeBlocker|authoritative_blocker" apps packages` → **0 命中**：
  Engine 没有暴露任何 authoritative blocker / next action 对。
- 唯一存在的“首因”推导在页面里：`apps/dashboard/src/views/OverviewView.vue:30`
  `SUPPLY_SIDE_WAITS = ["WAITING_CANDIDATE","WAITING_NEW_FACTS","NO_SUPPLY","RULE_FILTERED"]`、
  `:91-95` `firstExplanation` 自行在 `capacityBlocked` / `analysis.text` / `noEntryReason` 之间排优先级
  —— 正是 G4 明确禁止的“UI 自己再推导一套优先级覆盖 Engine 真源”。
- 同时 `pipeline.noEntryReason`、`runtimeControl.reasonText`、`analysis.reason`、
  `primaryBrain.resource.idleReason`、`capacityVisibility.firstBlocker`、`executionReadiness.firstBlocker`
  仍是并存的多套状态字段，同一 cycle 可以被呈现成多个同级“下一步原因”；
  `apps/engine/src/runtime/appRuntime.ts:1933` 的 `ENTRY_BACKPRESSURE` 与
  `:1926` 的 `PAUSED_MARKET_DATA_UNAVAILABLE` 只是同一条 if-else 链上的两个互斥输出，
  并没有“一个权威 blocker + 一个 next action + 分层的 secondary diagnostics”这一结构。
- 运行时只读复测（本轮）：`GET /pipeline` 的 `noEntryReason=null`、
  `executionReadiness={mode:EXECUTION_READY, firstBlocker:null, blockers:[]}`，
  而响应中不存在任何 `nextAction` / authoritative blocker 字段可供驾驶舱原样渲染。

## 3. 测试与门禁（在 GitHub HEAD 上，未改动产品码）

| 命令 | exit | 结果 | 证据 |
| --- | --- | --- | --- |
| `npx vitest run src/portfolio.test.ts`（packages/core） | 0 | 10/10 passed（含 CR-01/CR-04 钉住 G1 旧语义） | `t01-core-portfolio.txt` |
| `npx vitest run marketDataStaleness + preAiExecutableSides + entryCapacityTrace`（apps/engine） | 0 | 3 files / 23 tests passed（含钉住 G3 旧语义的 staleness 用例） | `t02-engine-targeted.txt` |
| `npx vitest run`（apps/engine 全量） | 0 | **170 files / 1,362 tests passed** | `g01-engine-full.txt` |
| `npx vitest run`（apps/dashboard） | 0 | 14 files / 58 tests passed | `g02-dashboard-full.txt` |
| `npx vitest run`（packages/core 全量） | 0 | 8 files / 53 tests passed | `g03-core-full.txt` |
| `npm run test`（packages/contracts） | 0 | **0 个测试文件**（`--passWithNoTests`；不声称 coverage） | `g04-contracts.txt` |
| `npm run typecheck`（全仓 `-ws`，全部 `--noEmit`） | 0 | 通过；不写 dist | `g05-typecheck-all.txt` |
| `node scripts/v396-s00-static-check.mjs` | 0 | `blockers=[]`，123 入口逐项复核，`exchangeWrites=0`，`network=NOT_USED`，`engineLifecycle=NOT_USED`，`settingsModified=false` | `g06-s00.json` |
| `git diff --check` | 0 | 无输出 | `g07-git-diff-check.txt` |
| `npm run verify:deps` | NOT_RUN | 会重建 `@zdj/contracts`/`@zdj/core` dist；本轮不进入部署，且在运行实例脚下重建产物只有身份漂移风险 | — |
| `npm run build`（正式 production build） | NOT_RUN | 同上：§6 lifecycle 未被授权消费，产物重建无验收对象 | — |

结论：HEAD 自身健康（全绿），但**绿色只证明“未改动的旧语义仍然自洽”，不证明 G1–G4 达成**。
所有测试均在隔离数据/端口下运行，未产生任何 exchange write（S00 校验器同一轮报告
`exchangeWrites=0`）。未删测试、未 skip、未降断言、未扩 tolerance。

## 4. Lifecycle

| 项 | 值 |
| --- | --- |
| stop 次数 | **0** |
| MANUAL_START 次数 | **0** |
| old PID / new PID | 28628 / 28628（未变更，实例连续运行 732 分钟未中断） |
| port release 证据 | 不适用（未停止；8080 持续由同一实例服务，`GET /api/v3/diagnostics/closeout` HTTP 200） |
| startReason | 沿用昨日 `MANUAL_START`（`restartCount 187`，本轮未增加） |

原因：§6 的授权前提是“§4 所有必须门禁与正式 build 绿色后”，而 §0 更上位地规定
“GitHub HEAD 未包含目标 ⇒ 停止该目标的本地实施、不打产品补丁、明确报告”。
G1–G4 全缺，因此不进入 lifecycle，也不做在线四目标验收（做了只会度量旧行为，且可能被误读为新实现已上线）。

## 5. 运行身份（未消费 lifecycle 的原样事实）

| 项 | 值 |
| --- | --- |
| buildId | `3.9.6-146f7eabad8e7353276d` |
| pid / instanceId | 28628 / `ca211970-015d-44e3-9181-68d4cef3f257` |
| 部署来源 | 上一轮 `34f2e76`。`git diff --name-only 34f2e76..dd94a26` = 33 个文件，**全部落在 `docs/` 与 `scripts/` 下，0 个 `apps/` 或 `packages/` 文件** ⇒ 运行实例的产品码与 HEAD 的产品码逐文件同集合（这是“未重新部署也不影响源码一致性”的度量，不等于 §7.1 的身份闭环） |
| 与 local/remote HEAD 是否闭环 | **不闭环**：`running build provenance = 34f2e76 构建产物`，buildId 由该次构建产生；HEAD 是 `dd94a26`。§7.1 要求的四段等式需要一次受控重启才能成立，本轮按 §0/§6 不消费该授权 |

## 6–9. G1–G4 运行时验收

§7.2 的四目标**通过/失败验收未执行**（前提不成立：实现不存在，且未做受控重启）。
但同一实例上 12 小时自然运行的只读 readback 已经把关键事实测出来（`s08b-pipeline.json`、
`s09-capacity-sample.json`、`s08c-settings.json`，采样时刻 2026-09-26 08:31 本地 / uptime 732 分钟）：

### G1 运行时事实 —— 第二权威在当前流量里全面生效

7 个可路由 candidate（`1000BONKUSDC ZROUSDT TAOUSDT WIFUSDC CRVUSDC ETHFIUSDC COTIUSDT`）的
SHORT 侧 trace **全部**带同一个 `capacityRoom`：

```
{source: SHORT_EXPOSURE, ceilingUsd: 5,648.74, usedUsd: 7,421.14, roomUsd: 0,
 limitPct: 0.5, usedPct: 0.6569, equityUsd: 11,297.48}
```

其中 2 个（TAOUSDT、CRVUSDC）首因 `SIDE_PLAN_REJECT_EXPOSURE_LIMIT`，另 4 个首因
`MARGIN_TIER_SYMBOL_UNPROVEN:<SYM>`（authority 覆盖未含新 symbol，fail-closed 保留）。
同一时刻 `capacityVisibility.limits.policy = {gross:OBSERVE, direction:OBSERVE, cluster:ENFORCE}`、
`maxDirectionExposurePct = 1` —— 即**在方向策略只是观察的情况下，0.5 的 intelligence 上限仍在把
SHORT 侧全部压成 0**。§2-G1 的静态结论在运行数据上成立，验收点 1 失败。

### G2 运行时事实 —— 未实现的下界仍造成真实浪费

同一 12 小时窗口：`ANALYSIS_DISPATCH_INTENT=31`、`AI_RUN_TERMINAL=30`、
`PRE_AI_TRADE_PLAN_FEASIBILITY=31`、`ENTRY_RESERVATION_CREATED=0`、`ENTRY_INTENT_CREATED=0`、
`ORDER_SUBMISSION_ACCEPTED=0`、`ENTRY_FILL_RECORDED=0`、`ENTRY_DECISION_BLOCKED=20`
（全部 `HUMAN_POTENTIAL_NOTIONAL_LIMIT`）。窗口内模型连续产出 `PLACE_LONG` 而 0 笔到达 reservation，
机制定位见 §2-G2（envelope/契约没有 `minQuantityUnits`，指令只有上限）。

### G3 运行时事实 —— 机制仍是聚合级，但当前未触发全局暂停

当前 readback：`freshMarkets.status=RECOVERING`、`sequenceInvalid=26`、`stale.length=27`，
而 `marketDataReason=null`、`pipelineState=RUNNING`、`poolStatus=POOL_READY`、`eligibility.count=7`
—— 因为聚合 `marketInsufficient` 此刻为假，全局暂停没有触发（这是运气，不是隔离实现）。
按 §2-G3 的代码路径，只要 `marketInsufficient` 变真且**至少 1 个** symbol 序列无效，
26 个坏 symbol 与 7 个健康 USDT/USDC candidate 会被同一句 `PAUSED_MARKET_DATA_UNAVAILABLE` 一起停掉；
`marketDataDetail`（`appRuntime.ts:2052`）只在已暂停时给出 stream/quotes 聚合值，不含 symbol 级隔离集合。
验收点 1（one-bad + one-good ⇒ 只隔离坏 symbol）无任何实现或测试支撑。

### G4 运行时事实 —— 同一 cycle 存在多套并存原因字段

同一份 `GET /pipeline` 响应里并存：
`noEntryReason=null`、`pipelineState=RUNNING`、`marketDataReason=null`、
`freshMarkets.status=RECOVERING`（26 序列无效）、`pool.status=POOL_READY`、`eligibility.status=READY/count=7`、
`runtimeControl.mode=RUNNING` + `reasonText=运行中`、
`primaryBrain.resource.idleReason=AI_RESOURCE_BUSY`、`analysis.reason=AI_RESOURCE_BUSY`、
`capacityVisibility.firstBlocker=NONE`、`executionReadiness.firstBlocker=null`、
`capacityVisibility.sideStatus=LONG_ONLY_EXECUTABLE` —— 12 个同级状态字段，
响应中不存在 `nextAction` / authoritative blocker 字段；“首因”由页面自行挑选（§2-G4）。
验收点 1/2/3 均无实现支撑。

## 10. 风险事实（本轮未被放宽，逐项 readback）

只读 `GET /api/v3/settings`（settingsVersion 217，本轮未写过 settings）：

- `takeProfit.minNetProfitUsd = 1`、`takeProfit.minNetProfitRoiPct = 0.15` —— 未动；
- `portfolio.maxPositions = 50` —— 未动；
- `riskGovernance.exposureCapacityPolicy = {gross:OBSERVE, direction:OBSERVE, cluster:ENFORCE}` —— 未动；
  `maxDirectionExposurePct = 1`；`portfolioIntelligence.maxLong/ShortExposurePct = 0.5`（G1 待统一对象，本轮**不**擅自改）；
- `riskGovernance.entrySafetyMode = AUTO`、`connections.executionMode = TESTNET_ENABLED`、
  `exitCoordination.aiExitAuthority = SHADOW` —— 未动；
- `ACCOUNT_ASSET_UNVERIFIED:BTC`：仍是 PortfolioRisk 侧真实诊断，未被删除、未被当 0；
  BTC 依旧只在 `capacityVisibility.funding.excludedAssets`（本轮实测
  `{asset:BTC, usdValue:839.61, reason:NOT_IN_ENTRY_FUNDING_UNIVERSE}`，
  `totalExecutableMarginUsd=8,259.52` 且 `sumCheck=true`），不提供任何 Entry 资金；
- `HUMAN_POTENTIAL_NOTIONAL_LIMIT`：仍是真实硬约束，且在当前 12 小时窗口内就是**唯一**的
  `ENTRY_DECISION_BLOCKED` 原因（20/20 次），未被放宽、未被改名、未被隐藏。

## 11. 写入边界

| 计数器 | before | after | delta | 解释 |
| --- | --- | --- | --- | --- |
| `productionWrites` | 0 | 0 | **0** | 本轮零写操作；`blockedProductionWriteAttempts=0` |
| `testnetWrites` | 0 | 0 | **0** | 该实例自昨日 `MANUAL_START` 起 12 小时窗口内 `ANALYSIS_DISPATCH_INTENT=31`、`AI_RUN_TERMINAL=30`、`ENTRY_DECISION_BLOCKED=20`（全 `HUMAN_POTENTIAL_NOTIONAL_LIMIT`）、`ENTRY_RESERVATION_CREATED=0`、`ORDER_SUBMISSION_ACCEPTED=0` —— 所有拒绝都发生在任何 exchange 调用**之前**，因此 0 写是“被正确挡住”，不是“没在工作”；本轮自身零写 |
| `settingsVersion` | 217 | 217 | 0 | 本轮无 governance/settings 写；`settingsModified=false`（S00 校验器同轮输出） |
| `lastWriteAt / lastWritePath` | null / null | null / null | — | 无写路径被触发 |

## 12. 资产与保护

本轮未停止实例、未写任何 domain，因此 before/after 是同一连续运行状态上的两次只读采样
（间隔为整个验收窗口），差值恒为 0：

| 项 | before | after | 说明 |
| --- | --- | --- | --- |
| 持仓数 | 23 | 23 | 本轮零写。（与昨日快照 24 的差发生在**本轮之前**、由引擎外人工处置产生，本轮未参与也未追溯其成交） |
| 管理状态 | 23 × `HUMAN_MANAGED` | 同左 | ownership 未重建、未清仓、未改管理归属 |
| TP/protection | 15 `PROTECTED`、8 `MISSING` | 同左 | 未触发任何 TP 写；8 笔未保护为沿用状态（昨日同集合是 7 `REPAIR_FAILED` + 1 `MISSING`，本轮未重试也未关闭维护） |
| durable UNKNOWN 订单 | 47 条，全部 47 条携带有效期内 `VERIFIED_NO_ACTIVE_RISK` 证明，**占用 pending risk 0**；`ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED=62`（自 restart 起累计） | 同左（同实例连续运行） | 未删历史 UNKNOWN、未把 UNKNOWN 当 0；两次独立只读复测（本轮开始时与写本节时）都给 47/47/0 |
| executionReadiness | `EXECUTION_READY`，`blockers=[]` | 同左 | PortfolioRisk profile `READY`，`capacityVisibility.sideStatus=LONG_ONLY_EXECUTABLE` |

symbol/side 摘要（23 笔）：`APTUSDT:S ARBUSDT:S AVAXUSDT:S BCHUSDT:L BNBUSDC:S BTCUSDT:L DASHUSDT:S
DOGEUSDC:L DOTUSDT:S ENAUSDT:S ETHUSDT:L FETUSDT:S FILUSDT:S INJUSDT:L LTCUSDT:S NEARUSDT:S ONDOUSDT:S
PENGUUSDT:S SUIUSDC:S UNIUSDT:S VVVUSDT:S XRPUSDC:L ZECUSDT:S`。

## 13. 回交 ChatGPT 的最小修复清单（本轮不实施）

1. **G1**：让 sizing 只接受权威方向规则 —— `packages/core/src/portfolio.ts` 的 `longRoom/shortRoom`
   必须与 `riskGovernance.maxDirectionExposurePct` + `exposureCapacityPolicy.direction` 同一裁决；
   OBSERVE 时 `capacityRoom.source` 仍可为观测值，但不得再产出 `REJECT_EXPOSURE_LIMIT`。
   同步改写 `packages/core/src/portfolio.test.ts` 的 CR-01/CR-04（现在是钉住旧语义的正向证据）。
2. **G2**：把 `minQuantityUnits`（由 `minNotional`、`minQty`、`stepSize`、参考价真实推出）纳入
   `SideExecutionCapacity` + `EntryExecutionEnvelopeSideSchema` + `compactEntryFacts`，并把
   `compactEntry.ts:31` 的指令改成上下界双约束；上界外/下界外各有确定性拒绝，禁止 silent clamp。
3. **G3**：`marketDataHub.freshness()` 已有 per-symbol `stale[]`，据此把
   `MARKET_KLINE_SEQUENCE_INVALID:<symbol>` 降级为 candidate 级隔离（把该 symbol 移出本轮可执行集合并留诊断），
   只有 systemic（WS 源故障 / 全部可执行 candidate 都失效）才允许 `PAUSED_MARKET_DATA_UNAVAILABLE`；
   同步改写 `marketDataStaleness.test.ts:7-10` 的期望。
4. **G4**：Engine 侧新增单一 authoritative `{blocker, nextAction}`（含 cycle 标识），
   `noEntryReason / runtimeControl.reasonText / analysis.reason / idleReason / capacityVisibility.firstBlocker`
   降级为分层 secondary diagnostics；删除 `OverviewView.vue:30/91-95` 的页面自建优先级，
   改为原样渲染 Engine 裁决。
5. §3 的硬事实（`ACCOUNT_ASSET_UNVERIFIED:BTC`、`HUMAN_POTENTIAL_NOTIONAL_LIMIT`、
   `0.15`、TP/reachability/JIT/freshness/egress、`aiExitAuthority=SHADOW`、Production 锁定）
   在实施上述四项时不得被放宽来换取绿色。

本轮结束后：本地与远端 HEAD 一致且 clean，实例未中断，Production writes = 0，
lifecycle 授权剩余 1 次未消费（保持未消费状态，直到 GitHub 实现落地）。

## 14. 证据清单

目录 `docs/evidence/v396/local-acceptance-takeover-20260926/`：

| 文件 | 内容 |
| --- | --- |
| `t01-core-portfolio.txt` | `packages/core` `portfolio.test.ts` 定向跑（10/10，含钉住 G1 旧语义的 CR-01/CR-04） |
| `t02-engine-targeted.txt` | engine 定向跑 3 文件 / 23 tests（含钉住 G3 旧语义的 `marketDataStaleness`、G2 相关 `preAiExecutableSides`） |
| `g01-engine-full.txt` | engine 全量 170 files / 1,362 tests，exit 0 |
| `g02-dashboard-full.txt` | dashboard 14 files / 58 tests，exit 0 |
| `g03-core-full.txt` | core 8 files / 53 tests，exit 0 |
| `g04-contracts.txt` | contracts `No test files found, exiting with code 0`（0 测试文件，如实记录） |
| `g05-typecheck-all.txt` | 全仓 `typecheck`（各包 `--noEmit`），exit 0 |
| `g06-s00.json` | S00 静态门禁 JSON：`blockers=[]`、123 入口、`exchangeWrites=0`、`network=NOT_USED`、`engineLifecycle=NOT_USED`、`settingsModified=false` |
| `g07-git-diff-check.txt` | 空文件 = 无空白错误 |
| `s08a-closeout.json` | 运行时身份、持久化与写边界全量（`/diagnostics/closeout`） |
| `s08b-pipeline.json` | 全量 pipeline 投影（G1/G3/G4 并存字段原样） |
| `s08c-settings.json` | 冻结不变量与两套方向上限原样（settingsVersion 217） |
| `s08d-positions.json` | 23 笔持仓、管理归属与 TP 状态原样 |
| `s08e-account-assets.json` | 账户资产事实（BTC/USDT/USDC） |
| `s09-capacity-sample.json` | 结构化验收采样（身份、权限、Entry funding `sumCheck`、逐候选 SHORT `capacityRoom`、自 restart 事件计数、UNKNOWN 占用） |
| `s09-capacity-sample.stderr` | 同次采样的 stderr（仅 node SQLite ExperimentalWarning 两行）；JSON 本体在 `s09-capacity-sample.json` 中完好，未受影响 |

本轮**新增/改动文件仅限** `docs/reports/` 与 `docs/evidence/`；`apps/`、`packages/`、`config/`、
`scripts/` 与 `.github/` 在产品路径上 0 变更（`git status --porcelain` 见提交记录）。
采样脚本复用上一轮既有的只读工具 `scripts/v396-quote-minnotional-sample.mjs`，本轮未新增脚本，
因此 S00 入口清单仍为 123 项、无需重生成。
