# V3.9.6 Testnet：Entry Quote 资产真值 + SHORT 最小名义容量 + 驾驶舱逐候选解释闭合（2026-09-25）

## 0. 用户授权 / 本轮终点

当前线上已完成资金容量与 Gross/Direction 解耦，处于 `TESTNET_ENABLED + AUTO_RUNNING + Entry Safety AUTO + PortfolioRisk READY + EXECUTION_READY`。

本轮不等待 24h soak，不另开纯审计轮，直接在当前 convergence HEAD 上完成红测→修补→全门禁→build→受控部署→自然 Testnet 流量验证→ff push。

用户已明确授权本轮为已实证 P0/P1/P2 修补进行必要次数的受控生命周期动作：

- `stop-zdj-lan.ps1`
- `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`

无需再次询问授权。每次 restart 必须对应已提交、已有红测或 live 事实支持的实际修补；禁止纯重试、watchdog、autostart、service supervisor、hot reload、`npm run dev`、`tsx watch`。

允许必要的 Testnet Settings/schema/migration/authority 写入与真实 Binance Testnet Entry 写入；Production 写始终必须为 0。

本轮最终状态名：

`V396_TESTNET_ACTIVE_EXECUTION_QUOTE_AND_MIN_NOTIONAL_CLOSED`

---

## 1. 当前已经实证的 live 基线

执行时必须先 fetch 最新 convergence、ff-only 更新并冻结 live baseline；编写本计划时远端 HEAD 为 `0d61cd507dd445ac67f7990580ff9c12a4c1671d`，执行以实际最新 HEAD 为准。PR #9 不触碰。

当前驾驶舱已实证：

- `AUTO_RUNNING`
- `Entry Safety=AUTO`
- `EXECUTION_READY / blockers=[]`
- PortfolioRisk `READY`
- 可执行候选 2
- 路由：`JUPUSDT / USDT`、`ADAUSDC / USDC`
- USDT available ≈ 3.79k
- USDC available ≈ 4.97k
- reservation≈0，USDC execution lease≈466.57
- Entry executable margin 合计≈8.29k
- Gross≈102.7% equity，但 Gross=OBSERVE
- Direction=OBSERVE
- Cluster=ENFORCE
- slots≈24/50
- LONG 最终新增名义≈195.16，`firstBindingConstraint=PLANNED_NOTIONAL`
- SHORT 最终新增名义=0，`firstBindingConstraint=MINIMUM_NOTIONAL`

账户资产表同时存在：BTC≈0.01、USDT、USDC。当前 `capitalCapacity.ts` 的资金账本只从 quote assets 生成，但常量仍包含 `USDT/USDC/BUSD/FDUSD`；本产品当前只允许 USDT/USDC 路由与新 Entry。

---

## 2. 冻结不变量：禁止为了“多下单”改这些

以下保持不变，除非本轮只是修复错误投影/错误取值且测试证明原语义未改变：

- Testnet only；Production writes=0。
- `takeProfit.minNetProfitUsd = 1`。
- `takeProfit.minNetProfitRoiPct = 0.15`。
- PortfolioRisk durable authority、maintenance、liquidation、stress、JIT、private freshness、egress、integrity fail-closed。
- Cluster=ENFORCE 的真实否决权不放宽。
- maxPositions=50 不改。
- 不把 UNKNOWN 当 0，不删除历史 UNKNOWN，不伪造无活动风险证明。
- 不伪造 leverage / margin tier / minQty / minNotional / mark price / stepSize。
- 不人工制造候选、PLACE、fill。
- S06-T02 保留：最小合法 q 真正达不到硬最低净利润时仍 NO_TRADE；不得扩大 q 凑 `$1`。
- 模型不拥有 money / sizing / risk / reservation / JIT / order authority。

本轮修的是“Entry 可使用哪些钱”和“为什么一侧容量为 0”的真值，不是降低安全门槛。

---

## 3. A — 正式锁死 Entry Funding Universe：仅 USDT + USDC

### A1. 语义必须拆成两个对象

明确：

1. `AccountEquity / AccountAssetValuation`
   - 可继续如实展示 Binance 账户全部资产的真实估值（包括 BTC 等）；
   - 用于账户资产事实、对账、健康展示；
   - 不代表该资产可用于本系统新 Entry。

2. `EntryTradingCapital / EntryFundingUniverse`
   - **只允许 USDT、USDC**；
   - 只有这两种 quote asset 的 available balance 才能进入新建仓资金账本；
   - BTC、BUSD、FDUSD、其它资产无论 Binance 是否标 `marginAvailable=true`，都不得给本系统 Entry 提供 funding capacity、reservation、lease、route 或 sizing 权限。

不得因为“账户总资产估值”包含 BTC，就把 BTC 价值隐式加入 Entry 可执行资金。

### A2. 单一真源

将当前 `QUOTE_ASSETS = ['USDT','USDC','BUSD','FDUSD']` 收敛为产品级单一真源，例如：

`ENTRY_QUOTE_ASSETS = ['USDT','USDC']`

名称可按现有代码风格确定，但必须做到：

- Engine routing
- `quoteAssetCapitalLedgers`
- `candidateCapitalFromState`
- reservation
- execution lease
- pre-AI envelope
- preflight
- JIT
- pipeline API
- cockpit

全部读取同一个 Entry quote universe，不允许第二份名单。

### A3. 红测

先在旧实现上证明：

- 账户同时有 BTC/USDT/USDC/BUSD/FDUSD；
- Entry ledger 只能输出 USDT、USDC；
- BTC/BUSD/FDUSD 不能改变 `EntryTradingCapitalUsd`；
- 删除/增加 BTC 数量不能改变相同 USDT/USDC 条件下的 Entry funding capacity；
- 资产总估值仍可变化，说明 Account Equity 与 Entry Trading Capital 已真正分离。

不要为了实现这一点改写 Binance 原始资产事实。

---

## 4. B — `SHORT=$0 · MINIMUM_NOTIONAL` 必须做逐候选根因闭合

当前资金充足而 SHORT 为 0，不能接受一个抽象 `MINIMUM_NOTIONAL` 就结束。本轮必须回答：

> 对每一个当前可路由 SHORT 候选，哪个确定性数字把最终可执行名义压到交易所最小合法名义以下？

### B1. 建立逐候选 capacity trace

对每个 routable candidate + side 输出同一份 Engine 真值对象，至少包括：

- symbol
- side
- quoteAsset
- mark/reference price
- exchange minQty
- stepSize
- exchange minNotional（或由真实 filters 推导的 minimum legal notional）
- verified leverage + leverageFact
- quote available balance
- reserved margin
- execution lease margin
- executable margin
- policy margin cap
- capital executable notional
- current cluster / cluster-direction headroom
- per-trade risk headroom
- PortfolioRisk admission/headroom facts
- plannedNotional
- finalNotional before exchange rounding
- rounded legal qty
- rounded legal notional
- minimumLegalNotional
- executable yes/no
- exact blockers[]
- `firstBindingConstraint`

Dashboard 不得自己重算。

### B2. `MINIMUM_NOTIONAL` 只能在严格条件下出现

只有满足以下条件才允许最终显示 `MINIMUM_NOTIONAL`：

- 所有更高优先级事实完整；
- 真实 exchange filters 已验证；
- 经过资金、风险、cluster、policy、planned notional 后得到的 final notional 是真实有限数；
- 按 tick/step/qty 规则形成的最大合法可下数量仍低于 exchange minimum legal order；
- 或 final notional 明确小于真实 minimum legal notional。

不能把以下情况折叠成 `MINIMUM_NOTIONAL`：

- 没有 SHORT route；
- candidate 被 pool/filter 移除；
- margin tier 未覆盖；
- leverage unproven；
- capital fact missing；
- cluster hard blocked；
- PortfolioRisk denied；
- plannedNotional=0/undefined；
- sizing allocator 根本没分配；
- rounding bug；
- quote asset mismatch；
- symbol filter stale。

这些必须各自拥有明确首因，例如：

`NO_ROUTABLE_SHORT_CANDIDATE`
`MARGIN_TIER_SYMBOL_UNPROVEN:<SYM>`
`LEVERAGE_UNPROVEN`
`AVAILABLE_MARGIN`
`CLUSTER`
`PORTFOLIO_RISK_DENIED`
`PLANNED_NOTIONAL_ZERO`
`EXCHANGE_FILTERS_UNPROVEN`
`BELOW_EXCHANGE_MIN_NOTIONAL`

具体名称可按项目现有枚举统一，但禁止继续误归因。

### B3. 特别检查当前 JUPUSDT / ADAUSDC

用 live 同一套函数对当前路由做只读 probe，输出完整分解：

- JUPUSDT LONG / SHORT
- ADAUSDC LONG / SHORT

如果 SHORT=0 的根因是代码自己造成（例如 plannedNotional 在 side projection 中错误为 0、minNotional 取值单位错误、price×qty 次序错误、rounding 向下过度、route 选择只带 LONG sizing），必须红→绿修复。

如果根因确实是交易所最小合法名义 > 当前独立风险/计划允许名义，则保持 NO_TRADE，不放宽风险，并在 UI 直接展示两个数字：

`final executable notional = X < exchange minimum legal notional = Y`

---

## 5. C — 可执行侧与 Primary：避免再次把 27B 花在确定性不可能执行的侧

不改变 S06-T01：系统不得因为 LONG 可执行而替模型把 SHORT 翻成 LONG。

但 pre-AI envelope 必须发布确定性事实：

- `executableSides`
- 每侧 `sideCapacity`
- 每侧首因
- legal quote asset
- legal notional range

规则：

- 两侧都不可执行 → 不调用 Primary，点名 deterministic blocker；
- 只有一侧可执行 → 仍可调用 Primary，但 prompt 必须明确另一侧当前 `NOT_EXECUTABLE`，不能邀请模型选择一个确定性不可提交的方向；
- 模型若违反 envelope 仍选不可执行侧 → 明确 `MODEL_SELECTION_OUTSIDE_EXECUTABLE_ENVELOPE`，不能静默映射或自动翻向；
- 两侧可执行 → 正常独立选择。

不要用 LLM confidence 改容量。

---

## 6. D — 驾驶舱：账户资产 ≠ Entry 交易资金，逐候选解释一眼可见

### D1. 资产区域

资产表保留 BTC 等真实资产，但新增明确语义：

- `Account Asset`：账户真实资产事实
- `Entry Funding Eligible`：仅 USDT/USDC 为 YES

不要再让 Binance 的 `marginAvailable` 字段被用户误解为“本系统会拿来建仓”。

### D2. Entry Trading Capital

明确显示：

- USDT available
- USDT reserved
- USDT lease
- USDT executable margin
- USDC available
- USDC reserved
- USDC lease
- USDC executable margin
- `Entry Trading Capital Total = USDT executable + USDC executable`

并显示：

`Excluded from Entry funding: BTC / BUSD / FDUSD / others`

若账户不存在这些资产则不需要机械列空项。

### D3. LONG / SHORT 逐候选容量

当前只显示：

`LONG $195.16 · PLANNED_NOTIONAL`
`SHORT $0 · MINIMUM_NOTIONAL`

必须升级为至少可展开：

- selected best executable route for side
- capital capacity
- risk capacity
- planned notional
- exchange minimum legal notional
- final executable notional
- blocker

如果该 side 有多个 route，显示 best executable + 其它候选数量，并允许详情查看各自首因。

### D4. 文案

如果 LONG 可执行、SHORT 不可执行，驾驶舱整体状态不能写成“不会建仓”或“无容量”；应写：

`LONG executable / SHORT blocked`

只有两侧都 0 才是 `NO_EXECUTABLE_SIDE`。

---

## 7. E — Authority coverage 与 route universe 联动

上一轮已暴露 `MARGIN_TIER_SYMBOL_UNPROVEN:<symbol>`。

本轮不要放宽这个门，但要验证：

- routable universe 与 margin-tier authority coverage 是否由同一 symbol set 语义驱动；
- 新加入 USDT/USDC route universe 的 symbol 如果未覆盖，应在 AI 前 fail-closed；
- coverage refresh 只能走既有显式 authority 提交机制，不得自动授予新 hash；
- 不得因为 BUSD/FDUSD 被移出 Entry universe 仍把它们的 symbol 算进“必须可执行”的 route coverage。

如发现 universe/coverage 第二真源，红→绿统一。

---

## 8. F — 敌意测试（至少覆盖）

1. BTC 增减不改变 EntryTradingCapital。
2. BUSD/FDUSD 有余额也不进入 Entry funding。
3. USDT/USDC available 变化准确影响 Entry funding。
4. reservation/lease 只扣自己的 quote asset。
5. USDC lease 不应错误扣 USDT。
6. leverage unproven 不得产出虚假 executable notional。
7. exchange minQty / stepSize / minNotional 用真实单位计算。
8. finalNotional > minimum，但 round 后 qty 合法 → 不得误报 MINIMUM_NOTIONAL。
9. finalNotional < minimum → 明确 BELOW_EXCHANGE_MIN_NOTIONAL。
10. plannedNotional=0 → 不得误报 minimum；应点名 planned/sizing 原因。
11. no SHORT route → 不得显示 MINIMUM_NOTIONAL。
12. cluster hard blocker → 不得显示 MINIMUM_NOTIONAL。
13. PortfolioRisk denial → 不得显示 MINIMUM_NOTIONAL。
14. MARGIN_TIER unproven → AI 前阻断且不烧 Primary。
15. only LONG executable → prompt/envelope 不邀请不可执行 SHORT，但不得自动替模型翻向。
16. 两侧不可执行 → Primary spend=0。
17. Account equity 仍能展示 BTC，但 Entry funding total 不含 BTC。
18. Engine/API/Dashboard 的 EntryTradingCapital 总额逐分一致。
19. Run outcome 仍准确显示已挂单/未挂单/阻断 stage。
20. Production 默认与写边界不被 Testnet 修补暗改。

另外保留上一轮所有 UNKNOWN、capacity、conversion 回归测试。

---

## 9. G — 全门禁

至少真实执行并记录 exit code：

- Engine 全测
- Engine typecheck
- Dashboard tests/typecheck/build（若修改）
- Core tests
- Contracts tests（如 0 tests 必须如实写 0，不声称 coverage）
- `verify:deps`
- `verify:scripts`
- V3.9.6 S00/static blockers
- storage coverage
- `git diff --check`

任何 P0/P1 在本轮内红→绿，不另开等待轮。

---

## 10. H — Build / 部署 / 在线验证

门禁全绿后立即受控 build + deploy，不等待 24h。

部署前后记录：

- HEAD/sourceHash/artifactHash/buildId/PID/instanceId/startReason
- settingsVersion/diff
- TESTNET_ENABLED/AUTO_RUNNING/AUTO/SHADOW
- PortfolioRisk READY/version
- positions/TP/ownership/pending risk
- production/testnet write counters
- Entry quote ledgers
- LONG/SHORT candidate capacity trace

在线必须验证：

1. Entry funding total 只等于 USDT executable + USDC executable。
2. BTC 不改变 Entry funding total。
3. 当前 routable candidate 的 LONG/SHORT 首因可逐候选展开。
4. `SHORT=0` 若继续存在，必须证明是哪个真实数值小于哪个 exchange minimum；不得只剩抽象标签。
5. 若修复后 SHORT 实际可执行，必须自然恢复为正数，不人工造候选。
6. 所有硬门 PASS 的自然 PLACE 继续直接进入 reservation→intent→JIT→submit。
7. 至少观察一批自然 Primary Run；若仍长期 PLACE 但无 submit，Run execution outcome 必须点名新的真实 blocker。
8. Production writes=0。

如果 live 又暴露新的确定性自阻断 P0/P1，继续本轮红→绿、提交、build、受控重启、验证，无需再次询问 lifecycle 权限；但不得为“必须成交”放宽冻结门槛。

---

## 11. 最终报告必须回答

1. Entry funding universe 最终是否只有 USDT/USDC？
2. BTC/BUSD/FDUSD 是否仅作为账户资产事实而完全不参与 Entry funding？
3. Account Equity 与 Entry Trading Capital 是否已分离？
4. 当前 USDT/USDC executable margin 各是多少，总和是多少？
5. JUPUSDT LONG/SHORT 的完整 capacity trace 是什么？
6. ADAUSDC LONG/SHORT 的完整 capacity trace 是什么？
7. 之前 SHORT=0 的真正根因是什么？
8. 若仍是 minimum notional，finalNotional 与 exchange minimum 分别是多少？
9. 是否发现 plannedNotional/rounding/filter/unit/side projection bug？如何修？
10. `MINIMUM_NOTIONAL` 是否现在只在真实 minimum 条件成立时出现？
11. pre-AI 是否停止为两侧都不可执行的候选花模型调用？
12. 一侧不可执行时，prompt 是否正确发布 envelope 而不自动翻向？
13. margin-tier coverage 是否与 USDT/USDC route universe 同语义？
14. Dashboard 是否明确区分 Account Assets 与 Entry Trading Capital？
15. 每个 side 是否能逐候选看到 capital/risk/planned/minimum/final/binding？
16. 部署后自然 PLACE→reservation→intent→JIT→submit 是否继续工作？
17. Production writes 是否仍为 0？
18. 当前最终状态是否可声明 `V396_TESTNET_ACTIVE_EXECUTION_QUOTE_AND_MIN_NOTIONAL_CLOSED`？

最终必须 ff push、工作树 clean、PR #9 不触碰，并提交报告与 evidence。