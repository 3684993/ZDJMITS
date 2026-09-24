# V3.9.6 — PositionRisk V3 单次部署轮：V3 契约已证实，但本轮以我自己引入的 P0 结束（2026-09-24）

计划：`docs/plans/v396/CODEX-V396-POSITION-RISK-V3-ONE-SHOT-ACTIVATION-20260924.md`
执行分支：`codex/v396-final-convergence-20260922`（worktree `D:\MITS-WORKTREES\v396-final-convergence-20260922`）
证据目录：`docs/evidence/v396/position-risk-v3-one-shot-activation-20260924/`

## 0. 结论先行

本轮**没有**达到 `V396_TESTNET_ACTIVE_EXECUTION`。达到的是两件更有用的事：

1. 计划 §A 的前提被真实 Testnet 载荷证实（不是推断）：`/fapi/v3/positionRisk` 可用，并且它才是给出
   `marginAsset` / `maintMargin` / `initialMargin` 的那份契约。12 个持仓的风险事实全部可证明。
2. 部署后 175 秒，新实例因**我引入的** P0 致命退出：V3 契约**不返回** `leverage`（V2 返回），
   `Number(row.leverage)` 对 12 个仓位全得到 `NaN`，`NaN` 传播到 `core.exposure()` 的
   `Math.max(1, NaN)`，`PortfolioExposureSchema.parse` 抛错，`main.ts` 的 `uncaughtException`
   处理器以退出码 1 结束进程。这与 2026-09-23 的 `notionalUsd` P0 是同一失效形状：契约边界上的
   一个 undefined 变成 NaN，再由 250 ms 投影自我触发。

`scripts/stop-zdj-lan.ps1` 与 `scripts/start-zdj-lan.ps1` 各用掉一次（§0 的全部授权）。按 §E 与
AGENTS.md，我不做第二次启动：Engine 现在是**停止**状态，需要用户的一次新的显式启动授权。P0 的根因、
修补、红测、门禁与受损数据的修复都已离线完成并验证。

## 1. §K 逐条回答

1. **HEAD / 产品提交 / buildId / PID / instanceId**
   - 轮初 HEAD `e7116d6`（= 远端 `origin/codex/v396-final-convergence-20260922`，ff 取回，无新提交）。
   - 产品提交：`d477fd9`（持仓风险真值切到 V3 + 方向语义）与 `7020f34`（leverage 修补，即本报告之前
     紧邻的那一个提交）。
   - 真正**运行过**的构建：`buildId=3.9.6-8f800564c40f5ae64f7b`，`artifactHash=8f800564…`，
     `sourceHash=4326684e…`，PID 36200，instanceId `c701ad19-eecc-49e5-b8cf-8214c863573d`，
     `restartCount=176`，`startReason=MANUAL_START`，uptime 175 370 ms 后 `PROCESS_EXIT exitCode=1`。
   - 磁盘上**当前** dist（含 `7020f34`，从未运行过）：`buildId=3.9.6-cbdb0b3dd9a3150342d5`，
     `sourceHash=5ca74a6017024829dc33502ac66eacea536606c035e1e9db7434c790e30fcfea`（`11-on-disk-identity-after-p0-fix.txt`）。
   - 本轮最终 HEAD 是紧随 `7020f34` 的本报告与证据提交；`origin` 分支以 ff-only 更新，PR #9 未触碰。
2. **lifecycle 是否严格 stop=1/start=1**：是。stop 一次（脚本自证“port 8080 is free”）、MANUAL_START
   一次（PID 36200 / HOST_PID 17316 / LAUNCH_ID `9b4f478dd292422181fc497011f72918`）。崩溃之后没有再
   start/restart/hot reload，也没有 watchdog/autostart（`supervisor.status=NOT_RUNNING`）。
3. **live endpoint 是否已为 `/fapi/v3/positionRisk`**：是。证据不是配置项而是数据：崩溃实例写回的
   12 行持仓全部带 `positionRiskSource="V3_VERIFIED"`（`04-p0-durable-position-rows.txt`），且离线经
   同一 dist 的适配器只发一次 v3 GET（`05-p0-live-v3-vs-v2-payload.txt`）。
4. **真实 Testnet 非零仓位 fieldNames（20 个，逐字）**：
   `adl, askNotional, bidNotional, breakEvenPrice, entryPrice, initialMargin, isolatedMargin,
   isolatedWallet, liquidationPrice, maintMargin, marginAsset, markPrice, notional,
   openOrderInitialMargin, positionAmt, positionInitialMargin, positionSide, symbol,
   unRealizedProfit, updateTime`。
   与 V2 的关键差异：V2 另有 `leverage, maxNotionalValue, marginType, isAutoAddMargin, isolated,
   adlQuantile` 且返回 1,484 行（含零仓），V3 只返回 12 行非零仓但**没有 `leverage`**。
   取得通道需说明：§F 的 preview 端点没能用上新实例（它在 175 秒就退了），因此这份原始载荷是经
   `p0-postmortem.mjs --live` 在**同一份已部署 dist** 上以签名 GET 直接读取的（零写、无第二网络路径、
   无自建签名实现），不是对官方文档的转述。
5. **`marginAsset` 与 `maintMargin` 实际可证明数量：12/12**。保证金资产不是猜的：BNBUSDC 为
   `USDC`，其余 11 个为 `USDT`。`maintMargin` 从 0.0235（BCH）到 41.276（AVAX）都是交易所自报值。
6. **每个 `liquidationPrice=0` 的 side / 原始值 / 语义**：3 个，全部 LONG —— BTCUSDT、ETHUSDT、
   BCHUSDT，交易所原始字符串 `"0"`；按 §C3 得到 `liquidationBufferPct = 1`（有限 100 %，非 Infinity），
   provenance `EXCHANGE_REPORTED_ZERO`。其余 9 个 SHORT 为正的、方向合理（> mark）的价格，例如
   ZECUSDT mark 1518.74 / liq 7583.39，ONDOUSDT 0.5056 / 319.102。
7. **是否仍有 `MAINTENANCE_MARGIN_UNPROVEN` / `POSITION_MARGIN_ASSET_UNPROVEN` /
   `LIQUIDATION_BUFFER_UNPROVEN`**：这三类阻塞的前提高度是仓位行没有 `marginAsset` /
   `maintenanceMarginUsd` / 可用强平价；上面第 5、6 条证明该前提在 V3 下已消失（12/12 具备，且方向
   合理）。**但我不能在 live 上声称“快照已无这三类 blocker”**：崩溃实例在产出第一次
   portfolioRisk 投影 readback 之前就退出了，所以这一条只有离线证据支撑
   （`positionRiskV3Facts.test.ts` 的 D.1/D.13 断言快照 `factStatus=VERIFIED`、
   `liquidationPriceFact=EXCHANGE_REPORTED_ZERO`，且这三类 blocker 不出现）。这是待复验项，不是已完成项。
8. **authority profile**：`profileStatus=READY`，`configured=true`，`authorityStatus=MATCHED`，
   `marginTierVersion=TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_c8ac0070d479834cfc23febd5507ba083e6e1c64e66064558092bb0701791bbe`，
   `contentHash=c8ac0070…`，coverage 14 symbols，`missingSymbols=[]`，`mismatchReasons=[]`，
   `derivedMaintenanceMarginRatePct=0.025`，`rateDerivation=ENTRY_BOUND_TIERS`（`00-pre-deploy-live-baseline.txt`）。
   §G 的刷新**没有执行**：在激活被 P0 打断的情况下重新 commit 一份权威只会掩盖真正要复验的事实。
9. **executionMode 最终是否 TESTNET_ENABLED**：否。终态 `READ_ONLY`。§H 的一次 CAS **未做**——它的
   前置条件（§C4 的仓位级事实在 live 上 VERIFIED、且实例健康）没有同时成立。
10. **executionReadiness 是否在健康窗口 READY**：否。轮初 live：
    `blockers=[EXECUTION_WRITE_LOCKED, MARGIN_TIER_NO_COVERED_CANDIDATE]`，`profileStatus=READY`，
    `executableCandidateCount=4..9`，`modelSpendPermitted=false`。崩溃前新实例：
    `blockers=[EXECUTION_WRITE_LOCKED]`。注意 `MARGIN_TIER_NO_COVERED_CANDIDATE` 的含义：committed
    coverage 的 14 个 symbol 与当时可执行候选集合不相交 —— 这是 §H 之后、第一批 PLACE 之前的下一个真实
    阻塞（见第 15 条）。
11. **第一批自然 PLACE 的 allowed/blocked 原因**：本轮**没有**自然 PLACE 发生（Engine 在 175 秒内退出，
    且 Anti-Waste 闸在 `EXECUTION_WRITE_LOCKED` 下拒绝模型消耗）。没有 ANALYSIS_ONLY 记录被产生。
12. **第一笔允许的 PLACE 是否走到 reservation→intent→submit**：不适用，未发生。
13. **写归因**：新实例（PID 36200，本轮唯一启动）`testnetWrites=0 productionWrites=0
    lastWriteAt=null`。旧实例（PID 14200，本轮之前那一次部署）的 `testnetWrites=6`、
    `lastWritePath=/fapi/v1/order`、`lastWriteAt=1790249456650`（≈ 20:30 本地，早于本轮 22:15 的 stop），
    归因于上轮激活窗口，**不是本轮产生**。本轮自始至终 `productionWrites=0`。
14. **新仓若成交的 ownership/TP/protection**：不适用（无新仓）。既有 12 仓在本轮期间 TP 覆盖保持
    12/12 `PROTECTED`（`00-pre-deploy-live-baseline.txt`），未取消、未改动。
15. **当前剩余的唯一阻塞（若仍无新仓）**：按顺序两条真实事实，都不是“风险未通过”这种含糊话——
    (a) 修复后的构建尚未运行：需要一次**新的**人工 `MANUAL_START` 授权（本轮授权已消耗）；
    (b) 一旦执行权打开，`MARGIN_TIER_NO_COVERED_CANDIDATE` 仍会拒绝模型消耗，直到 committed margin
    coverage 覆盖当时可 sized 的候选宇宙（§G 的那一次显式 authority 重新 commit 就是为它准备的）。

## 2. P0 的机制、修补与为什么 1,256 个测试没抓到

链条（每一步都有证据文件，不是推断）：

1. `fetchPositions()` 用 `leverage:Number(row.leverage)`；V3 行没有该字段 ⇒ `NaN`（12/12）。
2. 对账合并 `merged={...remote, …}` 把 NaN 写进 `state.positions`，并持久化为 JSON `null`
   （`04-p0-durable-position-rows.txt` 显示 12 行 `lev=object:null`，其余字段完全健康）。
3. `packages/core/src/portfolio.ts` 的 `quoteMargin()` 计算 `Math.max(1, p.leverage)`；
   `Math.max(1, NaN) = NaN` ⇒ `usdtMarginUsd`/`usdcMarginUsd` 为 NaN。
4. `api/router.ts` 的 250 ms 投影 `publishSnapshot()` 里 `PortfolioExposureSchema.parse` 抛出
   ZodError（`data/runtime-logs/engine.stderr.log` 两条 `invalid_type / nan`，路径正是这两个字段）。
5. `main.ts` 的 `uncaughtException` 记录 `UNCAUGHT_EXCEPTION exitCode=1` 并退出。
6. 同一 NaN 还污染了派生事实：`requiredNetProfit()` 里的 `Math.max(1, NaN)` ⇒
   持久化 `tpEconomics.requiredNetProfit = null`（契约要求非负 number），以及
   `minProfitableExitPrice` 退化（ARBUSDT 从 0.17807 变成 0.2118 = entryPrice，因为
   `solveExit` 的比较恒为 false）。对照 `D:\MITS-backups\cutover-20260923\cold` 里同一批仓位，
   旧值是 `requiredNetProfit:1`，说明这是本轮 NaN 的后继损伤，不是独立缺陷。

修补（`d477fd9` + `7020f34`）：

- `positionRiskFacts.ts` 新增 `positionLeverageFact()` 与 `validPositionLeverage()`：优先交易所声明值；
  否则取**同一行** `|notional| / initialMargin` 的精确整数商（相对容差 1e-6，交易所自己按 8 位小数
  舍入）；两者都不成立即 `UNPROVEN`，绝不猜测。交叉验证：ONDOUSDT 的 V2 声明 `leverage=8`，V3 无此
  字段，派生值得到 8（`red-02-leverage-nan.txt` / `positionLeverageV3.test.ts`）。
- 映射器只输出可支撑的整数或 `null`，不再有 NaN。
- 对账合并：`validPositionLeverage(remote) ?? validPositionLeverage(local) ?? remote`；两边都不可支撑时
  **跳过本次刷新**并发出 `POSITION_LEVERAGE_UNPROVEN`——既不写入契约拒绝的值，也不因“远端没出现”
  把持仓误判为已平（`exchangeKeys` 在跳过前已登记）。
- 人工持仓刷新同样不用品外值覆盖 `leverage`。

为什么全绿测试没抓到：`positionRiskV3Facts.test.ts` 里我手写的 V3 夹具**替交易所补上了
`leverage`**——正是 §B 红测要防的那种“按想象的载荷写测试”。现在的红测夹具是当轮真实回传的行，
且断言穿过真正死去的接缝（映射 → `PositionSchema` → `core.exposure()` → 合并写回），
红→绿过程与失败逐条记录在 `red-02-leverage-nan.txt`（1 passed / 5 failed → 6 passed）。

## 3. 受损持久化数据的修复（已执行，附备份）

崩溃实例把 12 行持仓写成契约无效（`leverage` null、`tpEconomics.requiredNetProfit` null），
下一次启动在投影解析上仍会炸。因此执行了最小修复（工具与转录随证据提交）：

- `repair-position-rows.mjs`：默认 dry run；`--apply` 要求无进程持有 store（`8080` 无监听）、
  TESTNET、并先做冷备份。
- 只改两件事：`leverage` ← 交易所对**同一仓位**（symbol+side+quantity 精确匹配）支撑的值；
  若修完杠杆仍只剩 `tpEconomics.*` 契约失败，则把 `tpEconomics` 置 `null`（契约自身的“尚未计算”，
  产品下一轮 TP 对账会重算）。其他任何失败一律整体拒绝、回滚、零写入。
- 结果：`# after: rows=12 contractRejected=0`，12 行杠杆 12/8/8/8/14/8/8/16/12/8/8/12
  （`09-row-repair-dryrun.txt`、`10-row-repair-applied.txt`），并由
  `check-position-contract.mjs` 用真实 `PositionSchema.safeParse` 复验为 `rejected=0`。
- 备份：`D:\MITS-backups\position-row-repair-2026-09-24T14-46-37Z`（冷副本 + `repair-result.json`），
  另有较早的 `position-leverage-repair-2026-09-24T14-42-07Z`（捕获受损态）。

## 4. 门禁（全部离线，真实退出码见 `gates/`）

修复合入后复跑：engine typecheck 0；engine 全量 **159 文件 / 1,262 用例全绿**；S00 静态 0 blockers；
storage coverage `S08_STORAGE_COVERAGE_PASS`；dashboard 12/44；core 8/46；contracts 测试
**0 用例**（这是既有限制，因此任何“契约层已覆盖”的说法无效，本报告不据此声称）；
`verify:scripts` 0；`git diff --check` 0。

需要如实记录的一处偏差：门禁序列里的 `npm run verify:deps` 会重建
`packages/{core,contracts}/dist`，而当时旧 Engine 仍在运行，因此**四目录合并树 hash 在部署前就从
旧实例记录的 `65ee704a…` 变成 `cdd6884d…`**（`00-pre-gate-live-dist-identity.txt`、
`15-post-gate-live-dist-identity.txt`）。`apps/engine/dist` 与 `apps/dashboard/dist` 在那一刻未被触碰
（mtime 证明），所以线上服务的资产没变；但“树 hash 变了”这一事实记录在此，不粉饰为“线上身份未变”。
正式的 `apps/engine/dist` 重建发生在 §E 授权范围内（一次部署），随后 8080 释放、一次启动。

## 5. 下一轮该做的（≤5 条，以及不该做的）

1. 一次新的 `MANUAL_START`，验证 `buildId=3.9.6-cbdb0b3dd9a3150342d5` 与自写 identity 双向闭合，
   并确认 12 仓在 live 上 `marginAsset/maintMargin/liquidationPrice` 齐备、投影不再退出、
   `POSITION_FACT_*` / 三类 margin blocker 在 portfolioRisk readback 中确实消失。
2. 健康窗口内先跑 §F 的 preview/probe（同一 v3 endpoint，零写），再决定是否按 §G 做一次
   显式 authority 重新 commit 以覆盖当时的可 sized 候选宇宙（消掉 `MARGIN_TIER_NO_COVERED_CANDIDATE`）。
3. 只有 (1)(2) 成立后做 §H 的一次 CAS `READ_ONLY → TESTNET_ENABLED`，并逐笔归因 testnet 写。
4. 验收第一批自然 PLACE 到 reservation→intent→admission→JIT→`placeEntry`→submit。
5. 24 h soak 的锚点必须落在 (1) 的新实例上；崩溃前的 175 秒窗口不算任何时长证据。

不该做的：不要为了让 `MARGIN_TIER_NO_COVERED_CANDIDATE` 消失而放宽 coverage 判定或提高
`maxGrossExposurePct / maxDirectionExposurePct / maxCluster* / maxPositions`；不要把
`leverage` 缺失再当作 0/1/默认值；不要在 `packages/contracts`（0 用例）之上声称契约已被覆盖；
不要在没有真实读回的情况下宣布 §K7 已闭合；不要为“拿到一次成功投影”而手工造候选或 PLACE。
