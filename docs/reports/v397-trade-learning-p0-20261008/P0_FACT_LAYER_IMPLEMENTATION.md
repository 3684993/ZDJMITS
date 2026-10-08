# V3.9.7 Trade Learning P0 — 事实层纠错实施报告

日期：2026-10-08（Asia/Shanghai）。基线：`b65883d5e6435071acacd81e57d1921fc35a3574`，从 `origin/main` 建立独立工作树 `D:\MITS-WORKTREES\v397-trade-learning-p0-20261008`。

**P0.1–P0.4 已实现并完成本地验证；NOT_DEPLOYED。canonical 样本仍为 0，禁止将未证明收益送回 Qwen。本轮不进入 P1/P2/P3。** 这次修复建立可解释的证明边界，不以补零、删除历史或放宽资格增加样本数量。

已完整读取本轮指定的上一轮 review、优化 plan 和 maintenance handoff。报告计数使用上一轮同一冻结 rolling-week cohort（截至 2026-10-08 18:29 +08，755 个 retained records 中的 165 个 closed records），不是修复部署后的运行计数。另在 20:10 +08 对已有本地 income/coverage 表做一次有界只读补证；两种时间截面的来源分开记录。

## 1. ETHFI 新语义前后及 Exit provenance

| 案例 | 旧 closeProvenance | 新 composition | 新 finalizer | identityConflict | 已证明退出数量 / UNKNOWN |
|---|---|---|---|---|---|
| AAVEUSDT | SYSTEM_MANUAL | MANUAL（pure manual） | SYSTEM_MANUAL | false | 11.4 / 0 |
| ETHFIUSDC | CONFLICT | MIXED_TP_MANUAL | SYSTEM_MANUAL | false | 3611.6 / 0 |

ETHFI 的 TP exact identity 是 exchange `158623772` / client `v396x2ebcc6d12582486e6360b9b163b251`，16 个 partial fills 共 118.5；最终 manual exact identity 是 exchange `158727542` / client `v396xf4237e9d3ccb02bd6caf8865518183`，quantity 3493.1。两个 identity 不同，TP 占 3.2811%，manual 占 96.7189%；角色组合不能升级为 identity 碰撞。

`exitProvenance.ts` 按 scoped registry 及 exact local order identity 逐 fill 投影，按 exchange trade identity 去重、按 execution time 排序。`proofCoverage` 分别给出 expected / observed / proven / unknown quantity 和 role quantities。`finalizer` 表示最后具有 exact provenance 的角色；另以 `finalizerIsTerminalProof` 明示是否已证明它就是完整终态，缺 quantity 时不能声称终态完整。数量越界单独标为 `quantityConflict`，不会伪装成同 identity 多角色。

真正同 exchange/client identity 多 role、多 cycle 或矛盾 identity pair 仍 UNRESOLVED / CONFLICT。拒绝的第二 writer 写入独立 conflict ledger，原始 provenance row 不被覆盖，后续 resolve 仍 fail-closed；已有 registry 原始历史不重写。maker/taker、UI 文案、时间接近均不作为人工操作证明。真实脱敏 fixture：`apps/engine/src/services/fixtures/p0-exit-golden.json`。

同一 165 cohort：旧 TP 66、SYSTEM_MANUAL 3、CONFLICT 1、UNKNOWN 95；新 TP 66、MANUAL 3、MIXED_TP_MANUAL 1、UNKNOWN 95。bounded 投影未发现 identity conflict 不代表完整历史零冲突；两个 golden 案例之外没有完整 registry 覆盖，限制写入证据 summary。

## 2. Canonical eligible 数量前后及独立经济 ledger

**canonical eligible：0 → 0；没有产生或推送新增收益训练样本。** mixed exit 本身不排除资格；targeted test 已证明不同 exact TP/manual identity 在全部 origin、quantity、fee、funding 证明闭合时可以 eligible。

`factLedgers.ts` 独立核对 fill 的 native commission 与 realizedPnL；income 表中的 `COMMISSION`、`REALIZED_PNL`、`FUNDING_FEE` 不混算。按 linked fill、symbol/cycle、order identity、quantity、时间及金额守恒核对；非 native fee 缺少 FX 时拒绝资格。重复 income id 若金额、资产、symbol 或时间矛盾，保留原始 row，追加 conflict 事实并拒绝 EXACT。

Funding 的查询覆盖与 allocation 分开。只有完整、观察时间不早于覆盖终点的连续分页覆盖，才能将不存在 funding event 确证为 0；未覆盖期间没有 row 仍 UNKNOWN。非零收入必须有完整 exposure universe，按 funding 时间之前的真实 entry/add/partial-exit 数量轨迹证明唯一 owner；同时间 fill、cross/hedge/multiple owner、缺 symbol、晚到未复核均 UNKNOWN。不会按 cycle 总量或最终 VWAP猜测分摊。

`learningFundingProof` 保存 scope、native asset、覆盖 identity、时间和已证明 allocations；后续本地投影和已有样本入口使用同一 canonical gate。旧的 raw `EXACT` 或一个 net 数值不足以进入 Experience、experience API、sync sample 或已有 Review memory 收益字段。未证明收益被抑制，未增加 Qwen prompt 收益反馈，也未引入第二 veto。

USDT / USDC 的 book 分资产守恒。跨资产 legacy 总和无 FX 证明返回 null，另输出 `byAsset` / `aggregateStatus=FX_UNPROVEN`；`fundingUsd` 不将 USDC 当 USD，native funding 单独记录。冻结 local closed-complete 的 ex-funding **诊断**分别为 USDT 117.89584631（45 cycles）和 USDC 93.85110410（17 cycles）；二者不加总、不作为 canonical，也不替代逐 fill 资格检查。

## 3. Funding UNKNOWN 剩余数量及补证缺口

冻结 records：UNKNOWN **165 / 165**。已有本地有界补证读取 374 个 income facts、18 个 coverage rows，scope=`TESTNET|binance-primary`；未访问交易所，未写 live SQLite。

逐 holding interval 验证：**165 个周期的 coverageComplete 都为 false，proven zero=0**。主 reason 中 163 为 `COVERAGE_DOES_NOT_ENCLOSE_WINDOW`，另 2 为 `FUNDING_CYCLE_ALLOCATION_AMBIGUOUS`（DASHUSDT / BTCUSDT，分别有 7 / 8 个 observed funding rows）；这两个周期也有 coverage gap，不能把主 reason 分组误读成仅 163 存在缺口。原始收入行“存在”并不证明 whole holding interval 或唯一周期归属。

补证结果见 `local-funding-facts.json`、`bounded-local-funding-proof-results.json`。这些独立补证事实未写回 live records，也未晋升样本。下一步应先按每个周期真实 open/close 区间列出缺 coverage 的小窗口，优先复用本地已验证分页。确需交易所补证时使用独立 read-only、按 asset/scope/window checkpoint 的任务，固定时间上界、页数及行数上限，逐页保存 exact income identity/观察时间/连续 coverage；超限或失败留 UNKNOWN 并可恢复。非零 attribution 还需完整 account exposure universe / lot timeline，分页查全本身不能解决 hedge ownership。无需无界历史重放。

## 4. Origin-run invalid / uncertain 数量与 lot lineage

冻结 165 cohort 中，**33 个 cycle 的所有 lot 链闭合，132 个 cycle 仍 UNCERTAIN / omit**。另外，legacy `entryRunId` reference 有 **1 个已确认晚于 origin fill**，是上一轮 UNI 的晚到 run；它与 uncertain 集合重叠，不额外加总。新投影不以该 cycle 字段替代真实 intent run，不 clamp 负 delay，也不猜 run。

每个 lot 单独绑定 `intent → entryOrder → actual fill stages → immutable TradePlan → PRIMARY ENTRY COMPLETED run`。保存 actual quantity/cost/fee、TP version/target、planCycleId 与 physical positionCycleId、model/resource/model identity、context timestamp、run start/end、first fill timestamp；保存每个 partial fill 的 quantity/cost/time/native fee stages。各 stage 及 lot quantity/cost 必须守恒，origin run 必须完成在 first fill 之前。add lot 使用自己的 intent/order/plan/run，不共享 cycle origin decision；其规划 cycle identity 可以不同于 physical position cycle，两个含义显式保存。

未知来源不会回退到 cycle entryRunId。read model 保留 `rawEntryRunId` 并只将闭合 origin 放到 formal entryRunId；已有样本及收益 gate 不通过时 omit。最终 cycle VWAP 仍仅用于汇总，不回填 earlier lot/stage 的价格、MFE、MAE、cost 或 PnL。已有 Episode 的 FIRST_FILL 与 COMPLETE_FILL anchor 分开；late/missing origin 显式标出 uncertainty，新的 descriptive aggregate 排除已标注 origin-invalid episode。

原因是重叠计数，不可相加：132 个 cycle 缺完整 PRIMARY run/timestamps/context/model/resource，95 缺完整 lot fill chain，8 有 lot quantity 非守恒，1 缺 order/intent/plan/TP 链。archive 中 `{}` 或未保留 run payload 不会凭 prompt 文案恢复为事实。ETHFI 原始 lot 1370.6 的 run 可证明；后续 308.2 / 801.2 / 1131.6 各有独立 run id，但 archived run 事实仍不足，三个 add lot 保持 UNCERTAIN，整周期不能学习。

原 slim 分析文件省略 planVersion/provenance/packetId；本轮改从已提交 lossless archive 按 exact identity 提取 272 intents、272 orders、271 plans（保留原 row），避免把投影省略误报为原始事实缺失。新 run 在创建时直接保存 contextCreatedAt，减少 future lineage 对大型 preview 的依赖。不存在修改 model resource 的操作。

## 5. VERIFIED 经济字段纠正

| 旧字段 | 新经济含义 |
|---|---|
| targetConditionalNetProfitStatus=VERIFIED | ESTIMATE，另给 deterministic costBoundProof=CONDITIONAL_BOUND；明确 target-fill conditional、configured fees/slippage/buffer、funding/FX 未证明 |
| reachProbabilityStatus=VERIFIED | ESTIMATE / historicalTouchEstimate；closed-candle overlapping touch 描述，非 executable fill probability |
| expectedNetPnlAtHorizonStatus=VERIFIED | SCENARIO / scenarioExpectedPayoff；non-touch payoff 是 assumed negative profit floor，非真实退出政策 |
| “verified EV” 的隐含解释 | calibratedExpectedNetPnl=UNKNOWN / value=null |

旧 durable plans 不重写；读侧 relabel 旧 VERIFIED proxies，新候选直接写分开的 evidence。缺值仍 null，不填 0。Calibrated KNOWN contract 要求明确 non-touch exit policy、fee/funding fact identities、executable path proof、out-of-sample calibration identity、training/test 不重叠。当前 host writer 不产生 KNOWN，probability 或 model confidence 无权产生 calibrated EV。没有改变物理资金、交易所合法性、UNKNOWN fail-closed、Entry sizing/authority 或 TP 参数。

## 6. 是否具备进入 P1 的数据前置条件

**本轮不进入 P1/P2/P3；P1 数据前置条件未完整具备。** 33 个 frozen cycle 的全 lot origin 闭合不等于 whole-cohort 可学习；funding 165 仍 UNKNOWN，132 cycle lineage uncertainty，既有 bid/ask/path coverage 缺口也未通过本轮证明。P1 的 prospective price-only 数据以后可以单独取得，但不能借此提前宣称 canonical 收益、EV calibration 或参数优化成立。

下一步分开处理：有界 funding coverage/owner 补证；从可恢复的 exact run archive 补 model/context/time lineage，找不到的 omit；另一个获明确授权的运行专项处理 Engine 可用性及 UNKNOWN stall。P1 path collector、max-hold、trailing、break-even、time-decay、TP 百分比、Review veto、F04/F10/F11 均未实施。

## 验证、Git 与运行边界

开发阶段仅 targeted tests。候选执行一次 `npm run verify`：deps、scripts、release identity 通过，S00 在新增两个离线工具的 entrypoint 清单（155→157）处停止，exit=1；保留原日志，未把它改写为 PASS，也未第二次调用完整 verify。按现有机械规则重建 review 清单，未放松规则；然后继续原流水线尚未执行的 S00 / full typecheck / full build / full tests，全部 PASS。full test 为 **237 files / 2047 tests**（contracts 2、core 59、dashboard 124、engine 1862）。

其后最后的语义/read guard 收敛仅涉及：quantity conflict 与 role identity conflict 分开、已知 UNKNOWN 收益先抑制以避免无资格历史解析；相应 **82 targeted tests + Engine typecheck/build PASS**，未重复 full suite。所有成功/失败开发输出均保留日志。最终 frozen reprojection 为生产同一服务 projector 的离线调用；lossless gzip 的 uncompressed hash 可复核。

本轮隔离依赖及 build artifacts，未指向 live @zdj package dist；未调整主机内存/模型服务。主机 available commit 验证前后单独记录，不当作 Engine 反应性证据。

**运行异常只记录，未越权处理：** 20:07 +08、full verify 前，8080 已无监听；health/closeout 连接拒绝。8081/8083/8084 PIDs 12732/17468/51124 保持监听，验证后仍一致。没有 stop/start/restart、SSH/SOCKS 改动、Settings 改动、下单/撤单、live SQLite 写入或删除历史。本 run 的 exchange writes=0；当下 Engine 的 Production counter 因 HTTP 不可达为 UNKNOWN，不能将历史 Production=0 冒充当前读数。已有本地 income scope 全为 TESTNET；代码保持 Production 写边界。previous fan-out effective / overall Reactivity FAIL / 6.14 秒唯一调用链 UNKNOWN 的 handoff 结论不变，原因未调查。

`D:\MITS` 的 6 个 dirty entries 保留，独立工作树只提交本轮源代码、fixture、脚本、报告、handoff 与完整日志/证据。提交前远端新增仅文档 commit `64fdf6953277b8dac75820bab39b1bdbe793f15f`（V3.9.8 启动提示）；已 ordinary FF 集成，P0 验证涉及的代码基线未变化，保留该他人提交。main promotion 使用 fetch ancestry proof + ordinary fast-forward push，不 force/rebase/squash，不 dispatch GitHub Actions。远端提交与 evidence hash 在提交后用 Git readback 核对。

复核入口：`frozen-p0-summary.json`、`frozen-p0-record-projections.jsonl.gz`、`lineage-authority-subset-manifest.json`、`local-funding-facts.json`、`bounded-local-funding-proof-results.json`、`full-verify.log`、`full-verify-result.json`、`s00-corrected.log`、`full-typecheck.log`、`full-build.log`、`full-test.log`、`full-verify-continuation-result.json`、`targeted-final-readguards.log`、`readonly-boundary-before-verify.json`、listeners/memory 及 EVIDENCE_MANIFEST。
