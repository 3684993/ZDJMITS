# V3.9.6 · Entry quote 资产真值 + SHORT 最小名义容量闭合（2026-09-25）

任务书：`docs/plans/v396/CODEX-V396-ENTRY-QUOTE-ASSET-AND-MINIMUM-NOTIONAL-CLOSEOUT-20260925.md`
分支：`codex/v396-final-convergence-20260922`（PR #9 未触碰）
本轮提交：`095939f`（A/B/C/D 主体）→ `7ad9811`（部署后两缺陷）→ `34f2e76`（容量 room 真值 + pre-AI sizing 拒绝）
部署：`3.9.6-146f7eabad8e7353276d`，pid 28628，`restartCount 187`，`lastRestartReason MANUAL_START`（上一部署 `3.9.6-5f49941cb62fe9cd67fc` / pid 23404）

## 0. 结论

本轮要求的六段（A Entry 资金白名单、B 逐候选首因、C pre-AI envelope、D 驾驶舱、E authority/route 联动、F 敌意测试）全部实现并部署；§G 全部门禁 exit 0；§H 在线验收项 1–4、8 已在自然 Testnet 流量上直接证明，第 6–7 项在本窗口只观察到 dispatch/envelope 层，尚无新的自然 PLACE→submit（见 §7 的诚实边界）。

一句话根因：**`SHORT=$0` 从来不是交易所最小名义问题**。sizing 层取
`min(方向敞口 room, 投机敞口 room, 计价资产保证金 room)`，而
`portfolioIntelligence.maxShortExposurePct = 0.5` 已经被当前 SHORT 敞口（65.3%–70.9% of equity）用满，
room = $0 → `admission = REJECT_EXPOSURE_LIMIT` → 计划名义 0 → 才“顺带”低于 $5 交易所最小名义。
上一轮把 gross/direction 改为 OBSERVE 的是 `riskGovernance`（上限 1.0、只观察不否决）这一套字段；
sizing 用的是另一套（0.5、仍否决）。**同一个“方向敞口”概念有两个权威，且驾驶舱同时显示两者**：
风险门一侧写着 SHORT 还有 $3,058.98 余量，sizing 一侧写着余量 $0。这个不一致是本轮真正挖出的 P1，
但把它统一会**放大**可建仓容量，属于阈值裁决，本轮不自行改（见 §8）。

最终状态：`V396_TESTNET_ACTIVE_EXECUTION_QUOTE_AND_MIN_NOTIONAL_CLOSED`
——条件：direction 敞口双权威（§8-D1）保留为未裁决事实，本轮只把它变成可见、可核对的数字。

## 1. §A Entry 资金白名单（仅 USDT + USDC）

单一真源在 `packages/contracts/src/portfolio.ts`：

- `ENTRY_QUOTE_ASSETS = ['USDT','USDC']`（Entry 资金宇宙）
- `QUOTE_SUFFIXES = ['USDT','USDC','BUSD','FDUSD']`（仅作合约后缀解析）
- `isEntryQuoteAsset()` / `entryFundingEligibleSymbol()` / `quoteSuffixOf()`

消费方全部读同一份：routing（`packages/core/src/capitalAdmission.ts` 在保证金算式之前先拒
`QUOTE_ASSET_NOT_ENTRY_ELIGIBLE`）、`quoteAssetCapitalLedgers`、`entryTradingCapital`、
`candidateCapitalFromState`、reservation/lease（按各自 quote asset 扣）、pre-AI envelope、preflight、
JIT、pipeline API、驾驶舱、margin-tier authority coverage（`appRuntime.portfolioRiskRequiredSymbols()`
由 `entryFundingEligibleSymbol` 驱动，删除了原私有 BUSD/FDUSD 正则）。

Account Equity 与 Entry Trading Capital 分离：BTC 仍作为账户资产事实展示并计入
`accountEquityUsd`，只出现在 `funding.excludedAssets[{asset:'BTC',reason:'NOT_IN_ENTRY_FUNDING_UNIVERSE'}]`，
不进入任何 ledger/capacity/lease/route/sizing 权限。未改写 Binance 原始资产事实。

live 读数（post-deploy `live-sample-2.json`，uptime 213s）：

| 资产 | available | wallet | 保证金资产 | Entry 资金 |
| --- | --- | --- | --- | --- |
| BTC | 0.01（$841.26） | — | YES | **NO** |
| USDT | 3,686.93 | 5,473.87 | YES | YES |
| USDC | 4,970.92 | 4,982.23 | YES | YES |

`totalExecutableMarginUsd = 8,657.85`，`sumCheck = true`（逐分等于 USDT+USDC executable 之和），
`accountEquityUsd = 11,297.35`，`proven = true`。

## 2. §B 逐候选 capacity trace 与 `MINIMUM_NOTIONAL` 收紧

`apps/engine/src/services/entryCapacityTrace.ts` 为每个可路由候选 × 两侧产出一份 trace，字段覆盖任务书
B1 全表：symbol/side/quoteAsset/entryFundingEligible/referencePrice/exchangeFilters(tickSize,stepSize,
minQty,minNotional,factsComplete,reasons)/minimumLegalNotionalUsd/leverage/leverageFact/funding(available,
reserved,lease,executableMargin,policyMarginCap,executableNotional,bindingConstraint)/risk(gross+mode+
enforced、direction、cluster、clusterDirection、perTradeRisk、portfolioRiskAllowed、marginTierProven、
portfolioRiskBlockersSeen)/plan(present,admission,reasons,recommendedNotionalUsd,minExecutableMarginUsd,
**capacityRoom**)/plannedNotionalUsd/finalNotionalBeforeRoundingUsd/rounded(quantityUnits,legalNotionalUsd,
stepSize,minQty)/executable/blockers/firstBindingConstraint/actualUsd/requiredUsd/explanation/evaluatedAt。
驾驶舱只渲染，不重算。

B2 前置优先级（`classifySideCapacityBinding`）：
`QUOTE_ASSET_NOT_ENTRY_ELIGIBLE` → `NO_ROUTABLE_{SIDE}_CANDIDATE` → 门自身 executable 裁决直通 →
`PORTFOLIO_RISK_DENIED` → `MARGIN_TIER_SYMBOL_UNPROVEN:<SYM>` → `LEVERAGE_UNPROVEN` →
门点名的余量维度（`CLUSTER`/`AVAILABLE_MARGIN`/…）→ `EXCHANGE_FILTERS_UNPROVEN` → `SIDE_PLAN_ABSENT` →
**`SIDE_PLAN_<admission>`（本轮新增）** → `PLANNED_NOTIONAL_ZERO` → `FINAL_NOTIONAL_ZERO` →
`AVAILABLE_MARGIN`/`MARGIN_POLICY_CAP` → `BELOW_EXCHANGE_MIN_NOTIONAL` → `MINIMUM_NOTIONAL`。
`sizing 未落地` 一类的计划名义为 0 绝不再借用交易所最小名义。

`capacityRoom` 是本轮补上的“压零的那个确定数字”，在唯一计算点 `packages/core/src/portfolio.ts`
`buildAllocationPlan()` 产出（`{source, ceilingUsd, usedUsd, roomUsd, limitPct, usedPct, equityUsd}`；
投机来源只在投机档参与，计价来源只在余额可读时参与；全为无界时不声称有界），经
`CapitalSidePlanFactsSchema` → 路由样本 → trace → API → 驾驶舱，一路不被二次计算。

B3 live 分解（HYPEUSDT/USDT，uptime 213s；同函数、同一次评估）：

- LONG：`executable=true`，`admission=ALLOW_REDUCED_SIZE`，`capacityRoom={QUOTE_ASSET_MARGIN,
  ceiling 2,949.54, used 1,057.49, room 1,892.06}`，`planned=final=193.35`，
  filters `{stepSize 0.01, minQty 0.01, minNotional 5}` → `minimumLegalNotionalUsd 5`，
  `rounded={209 units, $192.81}`，首因 `PLANNED_NOTIONAL`。
- SHORT：`executable=false`，首因 **`SIDE_PLAN_REJECT_EXPOSURE_LIMIT`**，
  `capacityRoom={SHORT_EXPOSURE, ceiling 5,648.68, used 7,359.36, room 0.00}`，
  `planned=0`，`minimumLegalNotionalUsd=5`。驾驶舱原文：
  > HYPEUSDT 的 SHORT 侧被 sizing 以 REJECT_EXPOSURE_LIMIT 拒绝：SHORT_EXPOSURE 上限 5648.68 已用 7359.36，剩余 0.00；计划名义被容量压成 0，不是交易所最小名义问题

  → §10(4) 要的“哪个真实数值小于哪个交易所最小”成立：`0 < 5`，且 0 的来源是 `5,648.68 < 7,359.36`。

JUPUSDT / ADAUSDC：本轮署期这两个合约已不在 16 行候选全集内（`/api/v3/universe` 实测无 JUP/ADA 行；
routed 集合轮换为 WLDUSDT → HYPEUSDT → SOLUSDT/LINKUSDC）。它们当前首因是“本轮无可路由候选”
（`entrySideStatus = NO_EXECUTABLE_SIDE / 本轮没有可路由候选`，side 汇总 `NO_CAPITAL_ROUTE`），
不是最小名义；只读读回 durable `allocationPlans` 可见其历史 SHORT 计划（ADAUSDC SHORT
`admission=ALLOW, notionalUsd=3,729.74, shortExposurePct=0.640`），见 §8-D1 的双权威证据。

## 3. §C pre-AI envelope 与模型消耗

S06-T01 保持：系统永不替模型翻向。envelope 现在发布确定性事实
`executableSides / noExecutableSide / sideAuthorization{LONG,SHORT}`，每侧带
`firstBindingConstraint`、`minimumLegalNotionalUsd`、`legalNotionalRangeUsd=[floor,ceiling]`、
`maxMarginUsd/maxNotionalUsd/maxQuantityUnits`。

本轮补上第二块真值缺口：pre-AI 两侧探测用 `plannedNotional = MAX_SAFE_INTEGER` 问“有多少余量”，
所以它看不见 sizing 已经拒绝的一侧。现在 envelope 回读该路由自己的 side plan facts：
sizing 以 `REJECT_*` 拒绝的一侧 → `executable=false` + `NOT_EXECUTABLE:SIDE_PLAN_<admission>`，
且不再声称可有名义；门自己报了 blocker 时仍以门为第一因（`CLUSTER` 等优先，MN-12/EP-06 双向钉住）；
无路由样本一律不臆造拒绝（EP-07）。

live 证明（自然流量，uptime 10m→13m）：`PRE_AI_EXECUTION_ENVELOPE_CREATED` 共 2 条，每条
`sideAuthorization = {LONG: 'EXECUTABLE', SHORT: 'NOT_EXECUTABLE:SIDE_PLAN_REJECT_EXPOSURE_LIMIT'}`，
同窗口 `ANALYSIS_DISPATCH_INTENT=2`、`AI_RUN_TERMINAL=2`、`PRE_AI_TRADE_PLAN_FEASIBILITY=2`、
`PRE_AI_NO_EXECUTABLE_CAPACITY=0` —— 一侧可执行时仍正常调用 Primary，另一侧被点名 NOT_EXECUTABLE。
两侧都不可执行时不调用 Primary 由 EP-02（离线）+ 上一轮 `PRE_AI_NO_EXECUTABLE_CAPACITY` 路径覆盖；
模型越界选择不可执行侧 → `MODEL_SELECTION_OUTSIDE_EXECUTABLE_ENVELOPE`（EP-04，不重映射、不建仓）。

## 4. §D 驾驶舱

- 资产表拆列：`交易所保证金资产`（Binance `marginAvailable` 事实）与 `可用于新建仓（Entry）`
  （仅 USDT/USDC 为 YES）。BTC 实测 `YES / NO`。
- Entry Trading Capital 块：逐资产 available/reserved/lease/executable + `Total Entry Trading Capital`
  + `不参与新建仓资金：BTC（估值 $841.49）`。
- 两侧块新增 `data-side-status`（实测 `LONG executable / SHORT blocked`，两侧为 0 才写
  `NO_EXECUTABLE_SIDE`）与 `data-capacity-trace` 逐候选 `<details>`。浏览器实测展开文本
  （`07-dashboard-render-proof.json`，uptime≈13m，同期 `routed=[WLDUSDC]`）：
  > WLDUSDC LONG：资金容量 $3,980.00｜风险后 $199.43｜交易所最小合法名义 $5.00｜计划 ALLOW_REDUCED_SIZE｜容量上限 $5,649.26（已用 $3,668.74，剩余 $1,980.52）来自 LONG_EXPOSURE｜可执行
  >
  > WLDUSDC SHORT：资金容量 $3,980.00｜风险后 $0.00｜交易所最小合法名义 $5.00｜计划 REJECT_EXPOSURE_LIMIT｜容量上限 $5,649.26（已用 $7,422.00，剩余 $0.00）来自 SHORT_EXPOSURE｜首因 SIDE_PLAN_REJECT_EXPOSURE_LIMIT

  同页 `Total Entry Trading Capital $8,576.42 · 不参与新建仓资金：BTC（估值 $842.43）`，
  资产表 `可用于新建仓（Entry）` 列自上而下 `NO / YES / YES`。
- §D4 文案：一开一关不再被写成“不会建仓/无容量”。

## 5. §E authority coverage 与 route universe

margin-tier coverage 的路由需求集合改为与 Entry 资金宇宙同一谓词（`entryFundingEligibleSymbol`），
BUSD/FDUSD 合约即便账户里存在资产也不再算进“必须可执行”的覆盖需求；新加入 USDT/USDC 路由但未覆盖的
symbol 仍在 AI 之前 fail-closed（`MARGIN_TIER_SYMBOL_UNPROVEN:<SYM>`，live 仍有
JUPUSDT/COTIUSDT/WIFUSDT/RAYSOLUSDT/WIFUSDC 五个未覆盖，本轮**未放宽**，只是点名）。
coverage 刷新仍只走既有显式 authority 提交通道，本轮未自动授予任何 hash。

## 6. §F/§G 敌意测试与门禁

本轮新增/扩充测试（不含沿用）：QA-01…QA-13（Entry 资金宇宙与逐资产扣减）、
MN-01…MN-12（首因优先级与 room 真值）、EP-01…EP-07（envelope 两侧与越界）、
CR-01…CR-04（sizing capacityRoom 来源归属）、CC-01…CC-12（资金容量模型），
并保留上一轮全部 UNKNOWN/capacity/conversion 回归（NR-01…NR-08、J1–J6、execution outcome 漏斗）。
任务书 F 的 20 项逐条对应：BTC 不变性→QA-03；BUSD/FDUSD 排除→QA-04、QA-12/13；USDT/USDC 可用性→QA-02/QA-07；
逐资产扣减→QA-05/QA-10/QA-11；杠杆未证→CC + MN-06；真实 filter 单位→CR + MN-09；round 后合法不误报→MN-09；
final<min→MN-04 `BELOW_EXCHANGE_MIN_NOTIONAL`；plannedNotional=0→MN-02/MN-11/MN-12；无 SHORT 路由→MN-06
`NO_ROUTABLE_SHORT_CANDIDATE`；cluster→MN-05；PortfolioRisk→MN-06；MARGIN_TIER 在 AI 前阻断→MN-06 +
既有 readiness 闸；单侧可执行→EP-03/EP-06；双侧不可执行不烧 Primary→EP-02；账户资产仍显示 BTC 且
Entry 总额不含→QA-01 + 驾驶舱双列；三处总额逐分一致→QA-02 + `sumCheck` + 驾驶舱“不重算”测试；
Run outcome 阶段准确→沿用 conversion 测试；Production 边界不被暗改→沿用 production-boundary 门禁 +
本轮未新增任何写路径。

§G 实测（`docs/evidence/v396/entry-quote-asset-minimum-notional-20260925/gates/00-summary.txt`，逐条 exit code）：

| 门禁 | 结果 |
| --- | --- |
| `verify:deps` | exit 0 |
| contracts 测试 | **0 个测试文件**（`--passWithNoTests` exit 0；本轮不声称任何 contracts coverage） |
| core 测试 | 8 files / 53 tests passed |
| engine 测试 | 170 files / 1,362 tests passed |
| dashboard 测试 | 14 files / 58 tests passed |
| `typecheck`（全仓 `-ws`） | exit 0 |
| `verify:scripts` | exit 0 |
| V3.9.6 S00 静态门禁 | exit 0，`blockers=[]`，`entrypointReviewCount=122`（新增 2 个只读采样脚本逐项复核），`everyStoreOpeningTestIsolated=true`，`repositoryDataDirReferences=0`，`productionPortReferences=0` |
| storage coverage | exit 0，`gate=S08_STORAGE_COVERAGE_PASS` |
| `git diff --check` | exit 0（无输出） |
| `npm run build` | exit 0 |

## 7. §H 部署与自然 Testnet 流量在线验收

生命周期动作只有一次，且对应已提交、有红测/live 事实支持的修补（`34f2e76`）：
`stop-zdj-lan.ps1`（"port 8080 is free"）→ `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`
（PID=28628）。无 watchdog/autostart/service/hot reload/`npm run dev`。

部署前后身份与边界：

| 项 | 部署前（`live-sample-pre-restart.json`） | 部署后（uptime 213s → 22m，窗口 26.3 分钟） |
| --- | --- | --- |
| buildId / pid | `3.9.6-5f49941cb62fe9cd67fc` / 23404 | `3.9.6-146f7eabad8e7353276d` / 28628 |
| restartCount / reason | 186 / MANUAL_START | 187 / MANUAL_START |
| settingsVersion | 216 | 217（本轮未主动写 settings；见下方“启动写版本”说明） |
| 权限 | `TESTNET_ENABLED` + Entry Safety `AUTO` + `aiExitAuthority SHADOW` | 同左 |
| executionReadiness | `EXECUTION_READY`，`blockers=[]`，profile READY，privateFresh true | 同左 |
| productionWrites / blocked | 0 / 0 | 0 / 0（`lockedToTestnet=true`） |
| 持仓 | 24（槽位 24/50） | 24，全部 `HUMAN_MANAGED`，名义 $11,064.44；TP：16 PROTECTED / 7 REPAIR_FAILED / 1 MISSING（沿用状态，post-deploy `TP_REPAIR_STARTED` 仍在写入，本轮未改 TP/持仓/所有权） |
| UNKNOWN 订单 | durable 47，占用 pending risk 0 | durable 47，占用 0；`ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 继续运行 |
| Entry funding | USDT 3,601.59 + USDC 4,970.57 = 8,572.16，BTC 846.45 排除 | USDT 3,686.93 + USDC 4,970.92 = 8,657.85，BTC 841.26 排除，`sumCheck=true` |
| 两侧状态 | `LONG_ONLY_EXECUTABLE`，SHORT 首因 `PLANNED_NOTIONAL_ZERO` | `LONG_ONLY_EXECUTABLE`，SHORT 首因 `SIDE_PLAN_REJECT_EXPOSURE_LIMIT` + room 数字 |

任务书 §H 的 8 条：

1. Entry funding 总额 = USDT+USDC executable —— 成立（多次采样 `sumCheck=true`）。
2. BTC 不改变 Entry funding —— 成立（BTC 只在 `excludedAssets`/`accountEquityUsd`；离线 QA-03 钉住“翻倍 BTC 一分不动”）。
3. 逐候选 LONG/SHORT 首因可展开 —— 成立（`data-capacity-trace` 实测每侧 1 候选，浏览器展开见 room 三数，见 §4）。
4. `SHORT=0` 的真数值 —— 成立（`5,648.68 < 7,359.36` ⇒ room $0 ⇒ planned $0 < 交易所最小 $5；
   13m 时同一结构在 WLDUSDC 上复现：`5,649.26 < 7,422.00`）。
5. 若修复后 SHORT 实际可执行应自然转正 —— **未发生**：本轮未放宽 sizing 上限，SHORT 仍被 $0.5 方向 room 拒绝，
   因此仍为 0；没有任何人工造候选/造 PLACE。
6. 硬门 PASS 的自然 PLACE 直接进 reservation→intent→JIT→submit —— 新部署窗口
   （`lastRestartAt` 1790338526779 起，采样至 26.3 分钟）**没有一条自然 PLACE 通过全部硬门**：
   `ENTRY_RESERVATION_CREATED=0`、`ENTRY_INTENT_CREATED=0`、`ORDER_SUBMISSION_ACCEPTED=0`、
   `ENTRY_FILL_RECORDED=0`。到达 `PORTFOLIO_RISK_ADMISSION` 的 5 次决策全部被真实门拒绝
   （4× `HUMAN_POTENTIAL_NOTIONAL_LIMIT`、1× `ACCOUNT_ASSET_UNVERIFIED:BTC`），其余在更早阶段失败（见 7.7）。
   注意窗口口径：`entryConversion` 的 30m/1h 漏斗窗口跨越本次重启（其 12–13 次 place 与 5–7 次
   `HUMAN_POTENTIAL_NOTIONAL_LIMIT` 有一部分发生在**上一个 pid 23404**，见 `engine-launch-lifecycle.jsonl`
   的 `CHILD_EXITED 1790338501496` / `CHILD_STARTED 1790338525718`），不能整段记在新部署头上；
   本轮也未改该写路径，故不声称本窗口重放了 reservation→submit 链路。
7. 一批自然 Primary Run —— 新 build 窗口 26.3 分钟：`ANALYSIS_DISPATCH_INTENT=12`、
   `PRE_AI_EXECUTION_ENVELOPE_CREATED=12`、`PRE_AI_TRADE_PLAN_FEASIBILITY=12`、`AI_RUN_TERMINAL=11`、
   `PRE_AI_NO_EXECUTABLE_CAPACITY=0`；envelope 的 `sideAuthorization` 全程
   `{LONG: EXECUTABLE, SHORT: NOT_EXECUTABLE:SIDE_PLAN_REJECT_EXPOSURE_LIMIT}`。
   11 次 run 之后未 submit 的真实首因有两个，且都是点名数字而非标签：
   (a) `ENTRY_ANALYSIS_FAILED · AI_QUANTITY_BELOW_MIN_NOTIONAL · policy=FAIL_CLOSED` 6 次
   ——模型给出的数量 × stepSize × price 低于该合约交易所最小名义（根因与量化见 §8-D2）；
   (b) `ENTRY_DECISION_BLOCKED · PORTFOLIO_RISK_ADMISSION` 5 次
   ——4 次 `HUMAN_POTENTIAL_NOTIONAL_LIMIT`、1 次 `ACCOUNT_ASSET_UNVERIFIED:BTC`（BTC 估值未验证拖低
   PortfolioRisk 的账户资产验证覆盖，属既有 fail-closed 组合门，本轮未放宽；BTC 本身仍不提供任何 Entry 资金）。
   另：`EXECUTION_READINESS_BLOCKED(NO_EXECUTABLE_CANDIDATE)` 与 `EXECUTION_READINESS_RESUMED` 各 2 次成对出现
   —— routed 掉到 0 时预模型闸立刻停烧模型，恢复后自动继续。除此之外无新的自阻断 P0/P1。
8. Production 写 0 —— 成立（`productionWrites=0`、`blockedProductionWriteAttempts=0`）。

### 7.9 settingsVersion 216 → 217 的来源（不是本轮写的）

只读 `settings_audit` 显示：id=122 `changed_at=1790338530762 source=api 216→217`，
summary `{"message":"non-secret system settings updated","maxPositions":{"before":50,"after":50}}`，
时间点是 `CHILD_STARTED 1790338525718` 之后 5.0 秒。上一次启动有完全同构的一条
（id=120 `215→216`，`CHILD` 起来后 3.7 秒），且两条都夹着一条 `source=v3.2-migration`、版本不变的写。
所以这是**启动路径既有的幂等 settings PUT 顺带 bump settingsVersion**、语义 diff 为空（maxPositions 50→50），
不是本轮的任何授权写入；本轮没有调用过 governance/settings/authority 写接口。

部署后 `GET /settings`（version 217）冻结不变量逐项 readback 与部署前一致：
`takeProfit.minNetProfitUsd=1`、`minNetProfitRoiPct=0.15`、`maxPositions=50`、
`exposureCapacityPolicy={gross:OBSERVE,direction:OBSERVE,cluster:ENFORCE}`、
`entrySafetyMode=AUTO`、`executionMode=TESTNET_ENABLED`、`aiExitAuthority=SHADOW`、
`tradeEconomics.admissionMode=SHADOW`、`perTradeRiskPctEquity=0.01`。
遗留事实（未放宽）：`MARGIN_TIER_SYMBOL_UNPROVEN` 的 5 个 symbol 仍在 AI 前 fail-closed；
`HUMAN_POTENTIAL_NOTIONAL_LIMIT` 在新窗口继续真实否决（4 次）；UNKNOWN 订单 47 条保留，占用 pending risk 0。

## 8. 未闭合项与停止线（D1/D2 是动作，D3–D6 是事实说明；均不在本轮擅自改阈值）

- **D1（P1，需人工裁决，本轮未改）**：方向敞口有两个权威 ——
  `riskGovernance.maxDirectionExposurePct = 1` + `exposureCapacityPolicy.direction = OBSERVE`（风险门，
  现显示 SHORT 余量 $3,058.98）与 `portfolioIntelligence.maxLong/ShortExposurePct = 0.5`（sizing 与
  envelope，实际把 SHORT 压成 $0）。此外 `aiQuantityAllocation.ts` 把 Primary 选定数量物化成
  `admission:'ALLOW'` 的执行计划，所以 0.5 只在“预算/包线/容量视图”这一层生效。
  三条统一路线（提高/降低 sizing 上限、让 sizing 尊重 OBSERVE、或让门重新 ENFORCE 并把 0.5 写进
  governance）都会**改变可建仓容量**，必须显式 governance PATCH + ack，不能由本轮顺手做。
- **D2（P1，反浪费，本轮未改）**：新部署 26 分钟窗口 12 次 dispatch、11 次 run 全部 `status=COMPLETED`
  且选择 `PLACE_LONG`（envelope 允许的那一侧），其中 6 次在物化阶段被
  `AI_QUANTITY_BELOW_MIN_NOTIONAL` 失败关闭（`apps/engine/src/services/aiQuantityAllocation.ts:15`：
  `quantityUnits × stepSize × price < snapshot.quote.minNotional`），另外 5 次到
  `PORTFOLIO_RISK_ADMISSION` 被真实门拒绝，0 次 submit，每次约 19.8k input tokens。
  同一失败在上一 build 的 13 分钟窗口出现 5 次、更早 8 小时窗口出现 27 次 —— **本轮之前就存在，不是新引入**。
  原因不是缺事实（envelope 已发布 `legalNotionalRangeUsd=[5, ~193]`），而是**指令文本只给了上限**：
  `compactEntry.ts:31` 的 “quantityUnits must be a positive integer no greater than the chosen side maxQuantityUnits”，
  没有给该侧最小合法数量。补上这个下界只是把一个已存在的交易所事实说清楚，不动任何阈值，
  但它改 prompt 契约（`promptHash` 变化、J4/J6 相关测试需复验），故留给下一轮单独红→绿。
- **D3（P2，观察到的启动副作用）**：每次 `MANUAL_START` 后 3–5 秒，启动路径都会做一次
  `source=api` 的幂等 settings PUT，把 `settingsVersion` +1（本轮 216→217），而语义 diff 为空
  （`maxPositions 50→50`）。这不是本轮引入（`settings_audit` id=118…122 显示每次重启都同构复现），
  但它让“版本号变化”失去作为写审计信号的意义。建议改成无 diff 即不写；属审计卫生，不动阈值。
- D4：5 个 `MARGIN_TIER_SYMBOL_UNPROVEN` symbol 与 7 个 `TP_REPAIR_FAILED` 持仓仍是事实，未放宽；
  新 build 窗口内 `TP_REPAIR_STARTED/TP_REPAIR_FAILED` 各 32 条（维护在跑，失败是沿用状态，非本轮引入）。
- D5：side 汇总在无路由时叫 `NO_CAPITAL_ROUTE`，与 B2 建议名 `NO_ROUTABLE_{SIDE}_CANDIDATE` 不同义同名；
  属命名整理，不改语义。
- D6：contracts 包仍 0 测试文件；本轮新契约字段的验证全部在 core/engine 侧完成。
- D7：本部署窗口的自然流量太短（26 分钟、12 次 dispatch、0 次 submit）。**不**为此重启引擎、
  **不**放宽任何门来“凑”一次 submit；继续观察走只读 sampler。

不做的事：不为让 SHORT 变正而调 `maxShortExposurePct`；不为制造 PLACE 而放宽 Cluster=ENFORCE、
`minNetProfitUsd=$1`/`minNetProfitRoiPct=0.15`、`maxPositions=50`、UNKNOWN 占用与续证、JIT/private freshness/
egress/integrity fail-closed；不新增 watchdog/autostart；不触碰 PR #9；不改 Production 写边界。

## 9. 任务书 §11 十八问逐条回答

1. **Entry funding universe 是否只剩 USDT/USDC？** 是。`ENTRY_QUOTE_ASSETS=['USDT','USDC']` 是唯一真源，
   路由/ledger/candidateCapital/reservation/lease/pre-AI/preflight/JIT/API/驾驶舱/margin-tier coverage 全部读它；
   `BUSD/FDUSD` 只留在 `QUOTE_SUFFIXES`（合约后缀解析）。live ledger 只有 USDT、USDC 两行。
2. **BTC/BUSD/FDUSD 是否只是账户资产事实？** 是。BTC 在 `excludedAssets[{reason:NOT_IN_ENTRY_FUNDING_UNIVERSE}]`
   与 `accountEquityUsd` 里，不参与 capacity/reservation/lease/route/sizing；BUSD/FDUSD 有余额也被
   `QUOTE_ASSET_NOT_ENTRY_ELIGIBLE` 在保证金算式之前拒绝（QA-04/QA-12/QA-13）。
3. **Account Equity 与 Entry Trading Capital 是否分离？** 是：live `accountEquityUsd=11,297.35`（含 BTC 841.26）
   对比 `totalExecutableMarginUsd=8,657.85`（=USDT 3,686.93+USDC 4,970.92，`sumCheck=true`）。
4. **两侧 executable margin？** 213s 采样：USDT `3,686.93` + USDC `4,970.92` = `8,657.85`。
   部署后 7 次定时采样（uptime 4/7/10/13/16/19/22 分钟）总额依次为
   8,657.16 / 8,616.82 / 8,132.19 / 8,576.42 / 8,119.17 / 8,097.92 / 8,093.02，
   每一次 `sumCheck=true`（总额逐分等于该次 USDT+USDC executable margin 之和，波动来自
   USDT/USDC 可用与 lease 的真实变化，最后一次 ledger 为 USDT 3,579.12 + USDC 4,513.89）。
5. **JUPUSDT LONG/SHORT 完整 trace？** 本部署周期 JUPUSDT 不在 16 行候选全集内（`/api/v3/universe` 实测无 JUP 行），
   因此其正确首因是“无可路由候选”，不是最小名义；上一轮它的首要事实是
   `MARGIN_TIER_SYMBOL_UNPROVEN:JUPUSDT`（本轮保持未放宽）。它被路由时的完整分解已由
   `live-sample-pre-restart.json` 的 WLDUSDT 行与 `live-sample-2.json` 的 HYPEUSDT 行以同一函数给出。
6. **ADAUSDC LONG/SHORT 完整 trace？** 同上：本周期未路由（universe 无 ADA 行）；durable `allocationPlans`
   里其历史 SHORT 计划是 `admission=ALLOW, notionalUsd=3,729.74, shortExposurePct=0.640`，
   该记录来自 `aiQuantityAllocation.ts`（把 Primary 数量物化，恒 `ALLOW`），正是 §8-D1 双权威的证据之一。
7. **SHORT=0 的真正根因？** `buildAllocationPlan` 取的 room 最小项是
   `SHORT_EXPOSURE = max(0, portfolioIntelligence.maxShortExposurePct(0.5) − 当前 SHORT 敞口) × equity`，
   当前 SHORT 敞口已 65%–71% ⇒ room `$0.00` ⇒ `REJECT_EXPOSURE_LIMIT` ⇒ 计划名义 0。
   风险门那侧（`riskGovernance.maxDirectionExposurePct=1` + `direction=OBSERVE`）同时显示 SHORT 还有
   `$3,058.98` 余量：两套上限、两个结论，驾驶舱此前只显示后者。
8. **若仍是 minimum notional，两个数各是多少？** 不再是 minimum notional 归因：
   `planned/final = $0.00` 对比 `交易所最小合法名义 = $5.00`（HYPEUSDT：ceiling 5,648.68 < used 7,359.36；
   WLDUSDC：ceiling 5,649.26 < used 7,422.00）。首因名 `SIDE_PLAN_REJECT_EXPOSURE_LIMIT`。
9. **是否发现 plannedNotional/rounding/filter/unit/side projection bug？** 发现三类投影缺陷并已红→绿：
   (a) sizing 只把 room 的 `min` 用于缩放，从不交出被绑住的那一项（现 `capacityRoom` 单一计算点产出）；
   (b) 门裁决被“容量之前的前置事实”改名（`7ad9811` 修，executable 直通）；
   (c) 资金块取自 durable 路由摘要，重启后首轮前显示旧 ledger 数组（`7ad9811` 改为投影时读活账户）。
   另发现 pre-AI 两侧探测看不见 sizing 已拒绝的一侧（本轮 `34f2e76` 修，EP-06）。
   未发现 rounding/单位/price×qty 次序错误：`rounded` 行显示 step/minQty 与 final 一致（MN-09）。
10. **`MINIMUM_NOTIONAL` 是否只在真实条件成立时出现？** 是。分类器优先级见 §2；`MINIMUM_NOTIONAL` /
    `BELOW_EXCHANGE_MIN_NOTIONAL` 只能在 filters 全验证、plan 存在且不 `REJECT_*`、planned>0、final>0 之后到达，
    并由 MN-01…MN-12 逐条钉住（含“无路由/未覆盖/风险拒绝/cluster/计划为 0 都不得借用最小名义”）。
11. **pre-AI 是否停止为两侧都不可执行的候选调用模型？** 是：两侧都不可执行 →
    `PRE_AI_NO_EXECUTABLE_CAPACITY` + 不调用 Primary（EP-02 断言 `h.ai.decide` 未被调用、无 intent、无 place）；
    live 本窗口 `PRE_AI_NO_EXECUTABLE_CAPACITY=0`（因为始终至少 LONG 一侧可执行）。
12. **一侧不可执行时是否发布 envelope 而不自动翻向？** 是，且 live 直接证明：两条自然 run 的 envelope
    `sideAuthorization={LONG:EXECUTABLE, SHORT:NOT_EXECUTABLE:SIDE_PLAN_REJECT_EXPOSURE_LIMIT}`；
    `PRIMARY_DECISION_NORMALIZED` 里模型自述 “…Short side is not executable due to exposure limits” 后独立选择 LONG。
    模型若仍选不可执行侧 → `MODEL_SELECTION_OUTSIDE_EXECUTABLE_ENVELOPE`（EP-04，不重映射、不建仓）。
13. **margin-tier coverage 是否与 USDT/USDC route universe 同语义？** 是：`portfolioRiskRequiredSymbols()`
    改用 `entryFundingEligibleSymbol`，删除了私有 BUSD/FDUSD 正则；未覆盖 symbol 仍在 AI 前 fail-closed
    （live 仍有 5 个 `MARGIN_TIER_SYMBOL_UNPROVEN:<SYM>`，本轮未放宽、未自动授予 hash）。
14. **驾驶舱是否区分 Account Assets 与 Entry Trading Capital？** 是：资产表两列
    （`交易所保证金资产` / `可用于新建仓（Entry）`，BTC 实测 `YES / NO`）+ 独立 Entry Trading Capital 块
    + `不参与新建仓资金：…`。
15. **每个 side 能否逐候选看到 capital/risk/planned/minimum/final/binding？** 能，实测展开文本见 §4；
    侧级汇总保留 best executable + `executableRoutes` 计数。
16. **部署后自然 PLACE→reservation→intent→JIT→submit 是否继续工作？** 本部署窗口未走通该链：
    11 次自然 run 中 6 次在数量物化处 `AI_QUANTITY_BELOW_MIN_NOTIONAL` 失败关闭、5 次到达
    `PORTFOLIO_RISK_ADMISSION` 被真实门拒绝（4× HUMAN 上限、1× BTC 估值未验证），
    `reservation/intent/submit/fill` 全为 0（§7.6–7.7）。本轮未改该写路径，
    上一次真实走通属于更早的“Entry 转化与执行可见性”轮（3 次 submit / 2 次成交），不据此背书。
17. **Production writes 是否仍为 0？** 是：`productionWrites=0`、`blockedProductionWriteAttempts=0`、
    `lockedToTestnet=true`、`environment=TESTNET`、`executionMode=TESTNET_ENABLED`；本轮未新增任何写路径。
18. **可否声明 `V396_TESTNET_ACTIVE_EXECUTION_QUOTE_AND_MIN_NOTIONAL_CLOSED`？** 可以，按本轮口径：
    A–F 六段实现+部署+门禁全绿，§10(1)(2)(3)(4)(8) 已在自然流量上直接证明，(5)(6)(7) 已给出真实数值与真实
    blocker 而非标签。**限定条件**：§8-D1（方向敞口双权威）与 §8-D2（模型数量低于 $5 仍被调用）是本轮新暴露、
    未改阈值的两项事实，需要下一次显式裁决；本状态名不声称它们已闭合。

## 10. 证据清单

`docs/evidence/v396/entry-quote-asset-minimum-notional-20260925/`：
`gates/00-summary.txt` 与 `gates/01…11`（逐门禁原始输出 + exit code：verify-deps、contracts、core、
engine、dashboard、typecheck、verify-scripts、s00 json、storage-coverage、git-diff-check、build）、
`live-baseline-freeze.json`（本轮起点冻结；注意 stdout 前 2 行是 node SQLite ExperimentalWarning，
已在报告口径中剔除，身份字段未受影响）、
`live-sample-pre-restart.json`（旧 build 3.9.6-5f49941 的部署前事实，含 WLDUSDT 双侧完整 trace）、
`post-deploy-identity.json` / `post-deploy-identity-34f2e76.json`、
`live-sample-1.json` / `live-sample-2.json`（213s 全量 trace）、
`live-sample-flow-1…7.json` + `live-flow-timeline.json`（uptime 4/7/10/13/16/19/22m 的
资金、两侧状态、逐候选首因、envelope 授权、事件计数与漏斗时间线）、
`07-dashboard-render-proof.json`（浏览器展开态实测文本：sideStatus、Entry Trading Capital、
资产表两列、两侧逐候选行含 capacityRoom 三数）。
只读采样脚本：`scripts/v396-quote-minnotional-{baseline,sample,flow}.mjs`（全部 GET + readOnly sqlite，
已逐项进入 S00 entrypoint review）。
