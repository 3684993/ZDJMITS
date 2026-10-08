# Current closure — V3.9.8 RUNNING / 2026-10-09 06:17 +08

用户另行明确授权的当前TESTNET升级启动完成：代码3327c84，CI37850135010 success，remote217hash通过。PID8524/build3.9.8-7271c941c2cdec049610；/health READY、closeout200、identity6/6、TP13/13。生产写0、Engine自然TP写1、任务人工交易0；Settings247/digest与原dirty checkout未变。仅一次实际MANUAL_START，无退出定时器/自动重启。风险函数仅影子、formal calibration/new-origin natural evidence UNKNOWN。额外在线native GET备份超界已取消；临时私有copy因policy拒绝删除而本机保留。详见IMPLEMENTATION_REPORT.md / RUNTIME_CLOSEOUT.json。下方为原分阶段历史，旧NOT_DEPLOYED不能作为当前状态。

---

# I2 实施状态 — 2026-10-09

R2 在 `2b0143e5dc112266437da2e14c7eb808f51d9869` 完成 152 项远端 hash 核验后才修改代码。确定性 no-add、SQLite 原始授权、人工 ADD 拒绝、版本 3.9.8 与纯 shadow risk bounds 已实施；完整本地 verify 240 files / 2063 tests PASS。新增工具后的 S00 清单再次机械验证 PASS。细节及保留的两轮失败见 `docs/reports/v398-entry-sizing-quality-review/IMPLEMENTATION_REPORT.md`。

新 live risk multiplier 不启用，原周线/portfolio/funding 覆盖缺口仍阻断正式参数校准。用户另行授权的当前停止 TESTNET 实例启动，需先完成 I2 远端与 CI，之后只允许一次 MANUAL_START，真实 health/closeout/identity 待验收。不能由此次授权重试失败启动或制造测试交易。

---

# V3.9.8 R2实施计划 — no separate add / shadow risk bounds

基线3242a79，2026-10-08。先研究/计划GitHub readback后改source；用户最后一句另行明确授权最终升级启动当前停止的TESTNET8080，不授权改Settings/models/proxy/人工交易。旧计划在下方保留，本节覆盖其需重新授权offline/lifecycle的默认。

## Gate及范围

物理数量已用boundednative历史守恒：ETH4orders/3adds/1.467，AVAX18/17/1263，全部localintent/runrefs。当前sourceauthority逐行可审计。no-add不借旧runarchive创造权利：任何legacy库存/unknown/pending保持occupied，已有HUMAN不得自动加仓，未来origin按当下冻结candidate/Primary授权cap守恒。新链authority不证就停止实施。174fundingUNKNOWN、oldPRIMARY缺失、AVAXrawrecord288/lot1074与1263矛盾阻塞新live风险阈值，不能补0/写回history/放宽canonical。

## 文件与函数修改表

|文件/函数|最小化修改|
|---|---|
|新services/noSeparateAdd.ts|TESTNET同symbol/sideinventory/pending/lifecycle边界，unknownhold，originexactpartial/recovery累计cap，native scope|
|preAiExecutionEnvelope.buildPreAiExecutionEnvelope|冻结candidate前sidecapacity声明NO_SEPARATE_ADD，oppositeside按自己physicalcycle，不恢复portfolio主观veto|
|entryCoordinator.executionHardBlock/submitExactlyOnce|与prefreeze同一physicalpolicy，JIT验证durableorigin和exactcap，collision不改已选qty/target，不重新审判交易质量|
|新originledger+settingsStore.claimEntryExecution|同SQLiteBEGINIMMEDIATE：scope/side/intent/client/cap独占，submissionidentity与cycle授权分离，旧history不改|
|runtime/appRuntime/reconciliationService|注入durableoriginprefreeze读取；完整freshfullpositions/openorders+exactterminal/qtyconservedclosed才能释放filledorigin；UNKNOWN/−2013/TTL不释放；activeclaimbounded，不hot全historyscan|
|manualPositionService.executeLocked|任何owner/TP清除/submit之前拒绝ADD；PLACE_LIMIT按现有reduceonly语义；TPprice不能成为增量旁路|
|pure/shadowboundshelper|nativeasset独立boundsmin，unknownnull，whole-step/floor冲突；不接live阈值、不造默认|
|workspacepackages/lock/contracts version/releasecheck|release3.9.8一致，保留V397冻结候选协议兼容，APIversion单独明确|
|targetedtests/IMPLEMENTATION_REPORT|quantity/identity/race/restart/manualHUMAN/TP/PIT/nativebounds/unknown/TESTNET，保留全部stdoutstderr|

## no-add与竞态

scope=environment/account/symbol/positionSide。originalorderpartialfills不是独立add，cap是最大累计fill而非每次retry重新budget。不同intent/plan/run不能借symbol继承；lostACK只查询原exactclient，UNKNOWN不duplicatewire。已有人管/handoff库存不申请origin；legacyunknown不默认清除。

两个Primary同时freeze：prefreeze库存/pending/durableorigin阻止新menu；最终sameSQLite事务排他挡住既已freeze后的physicalauthorizationcollision，不是subjectivepostPLACEveto。claim失败/DBcommit失败不wire，未知保持occupied。接管与freshposition到达时不能新增权利；privatefreshness/quote/JIT保持原硬事实。

terminalorder不等于physicalcycleclosed。filledorigin释放需完整freshflatpositions/openorders、originalexactterminal、对应entryIntent/qty守恒closedrecord、观察时间晚于submit/close；zero-fill也需确证unsent/terminal0fill。scope错/clockfuture/缺数据/unknown一律hold。持久cap/客户端身份不可改，restart重建；不靠TTL清空。

TP价格调整保持同protectedinventory/ownerVersion/identity/durability/qty，无增量；reduce/close权限原样。禁止新增TP%、trailing、maxhold、ReviewEntryveto及Reactivity/F04/F10/F11。

## Shadow风险与科学gate

Qmax=min(Qfunds,Qcycle,Qstress,Qportfolio,Qfactor)，每bound留nativeasset/scope/time/hash/coverage/scenario。缺输入不猜；live只已有真实funds/exchange及no-addphysical。location/trend/volsoftmapping保持experimentonly，不直接相乘相关haircuts。

Qcap低于exchangeqty/notional、100quote业务margin或absoluteprofitfloor→NO_FEASIBLE_EXECUTABLE_QUANTITY，分类exchangelegal/funds/strategyeconomic；不加量/抬leverage/混asset。周线closed、availableAt<=decisioncutoff、26/52coverage齐全、freshsource；firstfillanchor不冒充PRIMARYcutoff。参数locationresponse/voltarget/stressES/cycle$/portfolio$/factor/correlation/FX/holding仍未确定，不修改Settings。

## 两次发布与最终运行

1.R2普通FFcommit/push研究/计划/脱敏原始证据/manifest；fetch逐blobSHA256核验。远端推进先兼容FF集成，冲突停，不force/rebase他人。source不能早于远端R2成功。

2.I1先targeted：inventorybothsides/pending/HUMANhandoff/partial/rejected/postonly/UNKNOWN/lostACK/capoverfill/2DBconnectionconcurrency/restart/fakeflat/TPpriceqty/native/PIT/floor。新authority不闭合停止。verify:deps后按仓库tempfixture隔离运行认可checks；生产entrypoints不跑。

3.一次候选local scripts/release/S00/typecheck/build/fulltests/diffcheck；新增offline工具机械更新S00inventory/currentidentity，不松historical锁。失败不promotion/启动。I2普通提交source+完整成功失败logs+实施报告，远端hash回读。Actions只读实际状态，不继承baseline，不dispatch。

4.最终用户已授权的currentTESTNET8080升级启动：保留dirtycanonical，独立worktree真实source/build复用existingdata/config，不改Settings/models/proxy；无既有Engine不stop，仅一次MANUAL_START隐藏detach，无exittimer/auto-restart。先localgate，后health/closeout/identity6/6/TESTNET/Production0/TP确认；只有PID/HTTP_LISTENING是INCOMPLETE。没有freshno-add边界不启动旧允许adds代码。观察长运行不等于保证未来存活。

回滚触发：TESTNET越界、duplicatewire、cap错误、人管越权、TPcoveragegap、UNKNOWN清除、durableorigin失效或新全historyhotpath。保留no-add及全部history/evidence，不以删ledger/开adds回滚；任何额外lifecycle遵守本轮scope。

---

# Historical design-only plan (superseded by R2 above)
Status: DESIGN_ONLY / NOT AUTHORIZED FOR LIVE STRATEGY OR ORDER CHANGE
Baseline: cf7007a5c6d722a4c86354f3405c7565be3a8236

## Objective
Keep Primary as Entry authority. Prevent excessive initial quantity/notional under higher-timeframe direction-extremity, volatility and correlated portfolio exposure. New user instruction: **prohibit all separate add-ons / averaging**; do not permit auto risk-increasing orders after initial authorization. Study TP reprice separately and respect HUMAN_MANAGED authority.

## Phase 0 — read-only source and fact contract
Confirm main and CI with workflow runs (commit-status endpoint alone insufficient). Map all callers around allocation, candidate envelope, frozen trade plan, Primary PLACE, pre-submit reservation, exchange order, execution fill, owner/TP, and any legacy/add-on flows. Audit minimum-initial-margin and absolute minimum-profit floors: smaller risk-adjusted quantity may fall below the currently hard economic floor; DO NOT silently escalate size above risk bound to clear profit target. Collect TESTNET read-only snapshots with bounded scripts, redacted outputs, content SHA256, source times, exact quote assets, safe no-write proof, preserving SQLite. Commit all approved nonsecret scripts/evidence to repository.

## Phase 1 — immutable point-in-time exposure reconstruction
For every open/closed physical cycle: origin and each historical add, order/intent/PRIMARY run/time/plan-version/fill-stage, quantity, execution price, leverage, source price, fees/funding coverage, TP/owner change, open inventory and gross/net/asset/factor exposure *as of each decision*. Use completed weekly candles only, no current unfinished weekly bar leakage. All exchange and private snapshots carry asOf, observedAt, freshness/coverage. Protect canonical vs noncanonical eligibility.

## Phase 2 — rule/parameter-free research design
Eight arms: baseline original, uniform haircut, linear location, nonlinear regime-aware location, vol targeted, stress-loss constrained, cycle budget, directional portfolio budget, hybrid. Treat all historical adds under no-add policy counterfactual as quantity 0 for separate add authorizations, while distinguishing same-origin partial fills/retries. Research two alternative hybrids: min of independent stress/capital/factor upper bounds with soft risk-pref adjustment vs multiplicative approach with carefully checked dependence/double counting. Build stress scenarios by adverse side, horizon and regime; use conservative missing-data bounds, don't label estimated stress as certain maximum.

## Phase 3 — constrained executable candidate design (requires new authorization)
Compute risk-adjusted feasible quantity envelope BEFORE candidate set freezing / PRIMARY decision. Do not re-introduce Direction/Cluster/Historical/Stress subjective post-PLACE veto. Physical/exchange/funds, scope/idempotency and private data remain fail-closed. If risk bound is smaller than min legal/strategy admissible quantity, mark no feasible executable quantity with explicit structured explanation; do not inflate to meet absolute TP profit. No new after-fill order authority. Preserve TP identity and human ownership.

## Phase 4 — tests and scientific gates
Property tests for size monotonicity under additional exposure/stress, no cash/asset mixing, exact step/tick and margin floors, identical as-of inputs produce identical output, UNKNOWN conservatism, order idempotency, no extra adds, owner handoff, TP reprice no quantity increase. Purged chronological out-of-sample with block bootstrap and separate extreme-market windows; compare downside-tail reduction AND opportunity loss, winning-trade contraction, capital turnover, time-under-water and unclosed inventory. Underpowered/uncertain cohorts remain nonconclusive; canonical net-funding eligibility gated by exact proof. Shadow first, no order writes. Any rollout needs separate TESTNET deployment authorization and independent Reactivity gate.

## Milestones
M0 document & code audit → M1 bounded snapshot and lot-level exact coverage table → M2 PIT replay with missing-data accounting → M3 pre-registered policy comparison and holdout → M4 authority-safe candidate design review → M5 optional shadow/prospective experiment after explicit approval. First-round unresolved: no fresh TESTNET live positions, no fully traced allocation caller chain, no quantitative policy outcome.

## Immutable scope
No strategy/Settings/Engine lifecycle/SQLite/order modifications in current phase. No production writes; no secrets in repo; F04/F10/F11 and 6.14s Reactivity analysis remain paused. Keep all nonsecret files and logs under versioned evidence paths in main or reviewed branch, never only local ephemeral files.
