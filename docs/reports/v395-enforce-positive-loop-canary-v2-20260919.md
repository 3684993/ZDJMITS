# ZDJ-MITS V3.9.5｜ENFORCE 正向闭环 Canary V2 报告（2026-09-19）

- 实施依据：`docs/prompts/ZDJ-MITS-V3.9.5-ENFORCE正向闭环Canary-V2-Codex提示词-2026-09-19.md`（commit `9ffe340`）
- 分支 / HEAD：`v395-economics-human-managed-20260919` @ `9ffe340`；live `3.9.5-57b2843729dff7a298a9`，PID 9680，instanceId `1c6cc310…`，`restartCount 161`（**未重启 Engine**）
- 只读窗口：`20:56:28` 起持续观测至 `21:1x`

# **裁决：`POSITIVE_CANARY_NOT_EXECUTABLE_NOW`——本轮没有写入任何 Settings，没有任何 Canary 状态需要恢复**

Stage 1 的 headroom 门禁**通过**，但实验在第二个客观条件上不可执行：**1m K 线序列断裂使 96/104 个标的失去资格、`eligibility.count=0`，ENFORCE 评估在任何标的上都不可能产生**（0 次可尝试）。按本提示词"最高原则"与 Stage 10 条件 3/8，直接反驳可执行性并停止，而不是开一个必然空转的 cap 例外窗口。

> 一次 `apply isolate` 尝试在**发出任何请求之前**失败（首个 `GET /settings` 读超时），因此本轮对引擎**零写入**：`settingsVersion` 仍为 **184**，9 个 Canary 字段 + `minNetProfitUsd=1`、`minHistoricalReachProbability=0.5` 与预注册基线**逐项零漂移**，且本轮状态文件 `canary-state-v2.json` 从未生成（磁盘上只有上一轮的 `.round2` 归档）。

---

## A. 实验前 gross / LONG / SHORT headroom

`20:56:26` 实测（`/runtime/trading-control` + `/positions` 交叉重算）：

| 项 | 值 |
| --- | --- |
| equity | $10,789.19（`21:1x` 复核 $10,803.11） |
| gross（24 持仓） | $7,896.64 |
| long / short | $2,612.01 / $5,284.63 |
| 预算（`maxGrossExposurePct=1.0` / `maxDirectionExposurePct=0.5`，**均未改**） | $10,789.19 / $5,394.59 |
| **gross remaining** | **$2,892.25** |
| **LONG remaining** | **$2,782.60** |
| **SHORT remaining** | **$109.65** |

⇒ **Stage 1 通过**：LONG 侧客观余量远超 $200。**未**因 SHORT 余量低而人工处置任何仓位（Stage 12），方向仍由 AI 自主决定。

## B. `entryCapacity().used` 与 maxPositions 计算

| 读取时刻 | positions | inFlight | reserved | **used** | 计划 maxPositions |
| --- | --- | --- | --- | --- | --- |
| 20:56:28（Stage 1） | 24 | 0 | 0 | **24** | 25 |
| 20:59:xx（Stage 2 排名） | 24 | 1 | 0 | **25** | 26 |
| 21:0x（PUT 尝试时 `plan`） | 25 | 1 | 0 | **26** | 27（`plan` 输出 26，因该次读取在 in-flight 结清前） |

已按上一轮流程修正落实：`maxPositions` 取 **`entryCapacity().used + 1`**，且 `used` 直接读 `/api/v3/pipeline.capacity.used`（`appRuntime.ts:1401` ⇒ `state.entryCapacity()`，`runtimeState.ts:57-61` 含在途与预留），不再用持仓数猜测。上表也正好演示了为什么必须重读：20 分钟内 `used` 从 24 漂到 26（普通 SHADOW 活动，非我所为）。**实际未发生 PUT**，故 maxPositions 从未被改。

## C. 预注册候选排名与联合通过概率

预注册产物（ENFORCE 之前冻结）：`D:/MITS-WORKTREES/dryrun/canary-v2-preregistration.json` + 证据快照 `admissions-retained-2057.json`。

指标：`P(reach ≥ 0.50 ∧ targetMove ≤ historicalHardMax ∧ targetMove ≥ 0.588%)`，其中 0.588% = `1/200 + 0.0882%` 成本率，即 $200 包络下满足 `$1` 所需位移。

| 候选 | 联合通过 | 样本 | spread | grade | recLev | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **ENAUSDC（首选）** | 40%（2/5：留存 1/1 + 归档 1/4） | 5 | 5.12 bps | B | 8 | 首选；风险：reach 样本恰好跨在 0.50 两侧（0.5217 通过 / 0.4083 失败） |
| **AVAXUSDT（备用）** | 无观测（n=0，也无不利证据） | 0 | 5.37 bps | B | 8 | 备用；杠杆类与首选一致（8x），优先于有 0-通过证据的候选 |
| VVVUSDT | 4/16 单独被 cap 挡 | — | — | — | — | **出局：已成为持仓**（上一轮恢复后由普通 SHADOW 路径自然建仓） |
| INJUSDT | 1/4 | 4 | 15.85 bps（贴 18 bps 限额） | B | 8 | 出局：`ACTIVE_ENTRY_ORDER` + spread 无余量 |
| BCHUSDT / ADAUSDT / XPLUSDT | 0/2、0/2、0/2 | — | — | — | — | 出局：明确不利证据（reach 0.02–0.34、位移 0.35–0.44% 低于 0.588%） |
| ENAUSDT | 归档 2/4 | 4 | 5.11 bps | B | — | 出局：`DUPLICATE_UNDERLYING_CONTRACT`（同 underlying，与首选冲突） |

**方法论发现（必须记录）**：`runtime_events` 是**滚动保留**的——`ENTRY_ECONOMIC_ADMISSION_EVALUATED` 今天早先可查 207–216 条，本轮只剩 **16 条（18:52–20:57）**。所以预注册不能依赖"随时重查历史"，必须在注册时把证据**落盘冻结**（本轮已做）。这也意味着 Stage 2 的"历史通过率"只能取自已提交归档的两份 canary 报告 + 留存行。

## D. 最终 attempt budget / 分配 / 理由

沿用提示词建议并在 ENFORCE 前固定：**总上限 20 条真实 ENFORCE 评估；首选最多 12；备用最多 8；仅允许一次、按预注册规则（首选 12 次未过，或首选连续不可用 >12 分钟）切换，禁止切回，禁止结果驱动换币。** 上一轮实测节奏 ≈118 s/次 ⇒ 首选约 24 分钟、含备用约 40 分钟。

统计预设：在 p=0.40 下 `P(首选 12 次全拒)=0.6¹²=0.22%`；即便按悲观的归档-only p=0.25，`0.75¹²=3.2%`。**因此本设计的风险不在通过概率，而在"能否产生尝试次数"**——这正是本轮实际卡住的地方（见 V）。

## E. Canary margin 与经济性计算

**25 USDT（= 硬上限，未突破）**：`entryMarginUsd=25`、`maxMarginPerPositionUsd=25`、`dynamicMarginEnabled=false`；ENAUSDC `recommendedLeverage=8` ⇒ 包络 ≈ **$200** 名义、`minNotional 5` 可满足。复核：`requiredNotional(1) = 1/(move − 0.000882)` ⇒ 0.588% 位移即够，首选候选的自然位移中位数 4.31%（$1 需 $23.6 名义）远在其内 ⇒ **25 USDT 对本首选充分**；未提高 leverage、未降 `$1`、未降 0.50、未加 quantity、未移 target。反例也已预注册：若首选是 BCHUSDT/ADAUSDT（中位位移 0.35–0.44%），25 USDT **不足**（需 $263+ 名义 ≈ $33 保证金 > 上限），按 Stage 3 应停止而不是突破——这正是它们落选的原因之一。

## F. ENFORCE evaluation 总数

**0。** 未进入 ENFORCE（`admissionMode` 全程 SHADOW）。

## G. passed=true / false 数量

0 / 0。

## H. blocker 分布

本轮无 ENFORCE 样本。可归因的**上游**否决分布（实测）：`eligibility.count = 0`，全池 `exclusionReasons` 以 `TECHNICAL_1m_STALE`（`selection.ts:23`，1m 技术序列 asOf 超 125 s）与 `MARKET_QUALITY_*`/`SPREAD_TOO_WIDE` 为主，`noEntryReason = PAUSED_MARKET_DATA_UNAVAILABLE`（`appRuntime.ts:1272`，因 `marketDataReason=MARKET_QUOTES_STALE`）。

作为唯一可用的近期分布参考（18:52–20:57 留存 16 条 **SHADOW** 评估，非 ENFORCE）：`TP_REACH_PROBABILITY_UNMET` 10、`ECONOMIC_MIN_NET_PROFIT_UNMET` 5、`HUMAN_MANAGED_EXPOSURE_LIMIT` 16/16；其中 reach≥0.50 且位移≥0.588% 的"若开 ENFORCE 即可放行"样本 4 条（VVVUSDT 1.519%/0.62、INJUSDT 2.364%/0.55、ENAUSDC 4.31%/0.5217、ENAUSDT 4.284%/0.5625），**这 4 条恰好佐证首选画像**。

## I. reachProbability 分布

无 ENFORCE 样本。留存 SHADOW 16 条 reach：0.0244、0.066、0.2152、0.25、0.2581、0.268、0.3371、0.3551、0.3978、0.4083、0.5217、0.5417、0.55、0.5625、0.62、0.7248 ⇒ 中位 **0.3765**，≥0.50 者 **6/16 = 37.5%**——与归档 216 样本的 32.9% 同量级，即 **0.50 阈值当前真实否决过半候选**，正向样本必须靠多次尝试才能命中。

## J. 是否得到 passed=true

**没有（未执行）。** 未调 0.50、未调 $1、未换标的追样本、未制造任何条件。

## K. AI side / quantity / range / target 是否保持自主

**本轮未消耗任何 AI 运行**（Canary 未启动，Primary 只经历了正常 SHADOW 活动）。零人工指定方向、零人工改 target/quantity 的记录。

## L. EntryIntent 是否创建

Canary 标的：0（未进入实验）。窗口内出现的 `20:53:44 ENAUSDC intent（side LONG、units 14,071、econ `{mode:'SHADOW', passed:false, expectedNetProfit 43.97}`）` 与 `20:47:37 ENAUSDT intent` 都是**恢复态 SHADOW 的正常自动建仓**，发生在我的 PUT 尝试之前，与 Canary 无关（也正是它们把预注册首选占成了持仓/占用，见 C）。

## M. JIT economics 结果

**未观测**：JIT 复核位于 `entryCoordinator.ts:176-178`，需先有 `passed=true` 的 intent 与实际 order；本轮 0 intent。判据已固化在上一轮报告与本文件的工具里（`canary-trace.py`：`FINAL_ORDER_RISK_EVALUATED` 在 :181、即 JIT 之后发布 ⇒ 有该事件=以实际委托价放行；只有 `ENTRY_ORDER_BLOCKED{stage:'BINANCE_SUBMIT'}` 而无该事件=fail-closed）。

## N. `FINAL_ORDER_RISK_EVALUATED` 是否出现

Canary 标的：0（该事件全库保留 2,482 条，均来自正常 SHADOW 建仓，最早 09-17）。

## O. Maker submit / order / fill 结果

Canary：0 提交、0 建单、0 成交。窗口内 `ENTRY_SUBMIT_ATTEMPTED/ENTRY_ORDER_CREATED` 各 1 次，均为 20:53 的 **ENAUSDC 普通 SHADOW 单**（恢复态行为）。

## P. 若形成 Position：`economicAdmission` 持久化

Canary 未形成持仓 ⇒ **n/a**。同期 SHADOW 侧持久化正常：`20:53:44` 的 ENAUSDC intent 落盘 `economicAdmission{version:'V3.9.5', mode:'SHADOW', passed:false, expectedNetProfit:43.97…}`。

## Q. economic TP 是否观测

**`NOT_OBSERVED`**（Stage 9 口径，不伪造 PASS）。

## R. old TP 是否零影响

**零影响。** 与 `20:56:28` 基线逐字段对比：`positions 24 → 24`、`changed rows 0`、`tp protected 24 → 24`、`missing/duplicate/orphan/qtyMismatch/wrongSide/retryQueue` 全程 0，24 仓 `tpOrderId/tpPrice/targetPrice/range/quantity/managementStatus` 未变。本轮不存在任何可能影响 TP 的设置写入。

## S. durable claims / UNKNOWN

`activeClaims 0 → 0`、`activeUnknownClaims 0`、`releasedClaims/releasedUnknownClaims 17/17` 不变；`historicalUnknownCount 18 → 18`（未删）；`unresolvedDriftCount 0`、`activeRiskUnresolvedCount 0`、`p0EntryIntegrity.passed true`；`durableTasks 259 → 261` 全部来自恢复态普通建仓。

## T. 429 / 418 / egress

`http429 17 → 17`、`http418 3 → 3`、`lastLimitedAt 1789694699483` 未更新、`blockedUntil 0`、`status AVAILABLE`、`queued 0`、`usedWeight1m 169 / estimated 257 / limit 6000（BINANCE_EXCHANGE_INFO）`、`observationTrust TRUSTED`、`persistenceError null` ⇒ **限流与权重完全不是本轮障碍**。egress `VERIFIED`（`172.104.186.174` = 期望值，`lastVerifiedAt 1789822802809`，自动周期重证），`TESTNET_WRITE_EGRESS_NOT_VERIFIED` 0，REST `demo-fapi.binance.com`、`failClosed true`、`productionWrites 0`。

## U. 是否完整恢复 SHADOW + HUMAN cap + 原 Settings

**无需恢复——本轮零写入。** 逐项核对（live `GET /settings` @ v184 vs 预注册冻结值）：

`admissionMode=SHADOW` ✔｜`humanManagedAdmissionCapsEnabled=true` ✔（`maxHumanManagedPositions=4`、`maxHumanManagedNotionalPctEquity=0.2` 原样）✔｜`selection.mode=COMPREHENSIVE_MAINSTREAM`、`customSymbols=[]` ✔｜`maxPositions=50`、`maxPendingEntries=6`、`entryMarginUsd=200` ✔｜`dynamicMarginEnabled=true`、`maxMarginPerPositionUsd=500` ✔｜`minNetProfitUsd=1`、`minHistoricalReachProbability=0.5` ✔ ⇒ 程序判定 **`drift: NONE`**。

Engine 侧：24 持仓 / 24 TP PROTECTED、Account READY、`binancePrivate READY`（`consecutiveFailures 0`）、WS `streamState LIVE`（但 1m 技术序列被判断裂，见 V）、reconciliation READY、egress VERIFIED、429/418 无增长。**未重启 Engine、未启停任何进程**（AGENTS.md：行情供给异常只做报告与人工处置，不做恢复性重启）。

## V. 若 20 次仍全拒：全拒概率与原因分析

未产生尝试，故"20 次全拒概率"不适用；实际原因是**尝试次数被上游卡为 0**，证据链：

| 证据 | 值 |
| --- | --- |
| `MARKET_SYMBOL_ERROR` 总数 **2,957 条**，其中 `message:'1m closed candle gap'` **2,929 条（99.1%）** | 18:49:00 → 21:08:37；每 10 分钟：39 / 447 / 395 / 353 / 310 / 214 / 141 / 55 / 52 / 51 / 53 / 52 / 49 / 44 / **674（当前桶反弹）** |
| 触发点 | 1m 技术序列 hydration 抛错（`marketDataHub` `LIVE_HYDRATE_TECHNICAL`，timeframe `1m`），引擎按 fail-closed 不信任该序列 |
| 后果 | `selection.ts:23` `TECHNICAL_1m_STALE` ⇒ `freshMarkets DEGRADED`，仅 **4–9 / 104** 个标的通过严格新鲜度；`quotesFresh 100–104/104`（原始 quote 是新鲜的，坏的是 **1m 闭合序列**） |
| 门禁 | `marketDataReason=MARKET_QUOTES_STALE` ⇒ `pipelineState/noEntry=PAUSED_MARKET_DATA_UNAVAILABLE`（`appRuntime.ts:1272`）、`eligibility BLOCKED count 0`、`executableCandidateCount 0`（Stage 1 时还是 7） |
| WS 事件 | `connectedAt 20:22:08`、`reconnects 2`、`gaps 3`（`gapsByType.websocketConnection 2`） |

判定：**不是候选画像变化，也不是 0.50 阈值过严，而是市场数据供给故障**（1m K 线序列缺口，且 2.3 小时未自愈、当前桶还在恶化）。在这种状态下开启 `ENFORCE + caps=false` 窗口，只会得到 0 次评估并白白暴露一次安全例外，因此按 Stage 1"直接反驳并停止"。

## W. 是否具备进入"正式 ENFORCE 参数/策略裁决"的证据条件

**仍未具备，缺口与上一轮相同且未缩小**：正向闭环 `passed=true → EntryIntent → JIT(实际委托价) → Maker → fill/Position → economicAdmission → economic TP` **依然 0 样本**；已 live 证明的仍是拒绝腿（上一轮 8 条、本轮 0 条）。

但本轮新增两条**决策相关**事实：

1. 16 条留存 SHADOW 里，reach 中位 0.3765、≥0.50 占 37.5% ⇒ 与归档 216 样本（32.9%）一致地指向 **"0.50 是真正的建仓率阀门"**；`$1` 门槛在 ≥$100 名义下几乎不约束（上轮 7/7、历史 75/76）。正式参数应围绕可达性阈值 + 敞口预算 + 人工仓账本来定。
2. **可执行性前置条件必须是行情链路健康**，否则"20 次预算"是纸面数字。当前 1m 序列故障未修复前，任何正向 Canary 都不可安排。

## X. 对当前设计与本实验方案的反驳与建议

1. **反驳"现在值得执行 Canary"**（已据此停止）：Stage 1 只检查了 headroom，**没有检查候选可尝试性**。建议在门禁里加一条硬性 pre-flight：`pipeline.freshMarkets.status=='FRESH'`、`eligibility.count ≥ 1`、**预注册标的自身 `eligible==true` 且其 1m/5m/15m 技术 `asOf` 全部在 TTL 内**，三项缺一即 `NOT_EXECUTABLE_NOW`。本轮若有该条，20 秒即可判定，无需进入 PUT。
2. **反驳"预注册即足够稳定"**：本轮预注册在 **6 分钟内**被事实推翻（`20:53` 普通 SHADOW 路径自己把首选 ENAUSDC 建仓占用了）。建议预注册增加一条**事实驱动**（非结果驱动）的复验规则并事先写明：在 PUT 前一刻复验候选"无持仓/无 pending/无 active claim/eligible"，若不满足则按**预定次序**顺位下移（primary → backup → 第三顺位），并记录复验时间戳。这样既守住"禁止看结果换币"，又不会被自然活动随机击穿。第三顺位应事先固定（本轮建议 BTCUSDT：spread 1.35 bps、grade B、recLev 19、minNotional 50 ≤ $200 包络，n=0 无不利证据）。
3. **`runtime_events` 滚动保留是实验设计的隐藏风险**：预注册依赖"历史通过率"，而历史在 2 小时尺度上被回收。建议把"评估即导出"固化为脚本步骤（本轮已手工冻结 `admissions-retained-2057.json`），或改用长期读模型（`trade_records` / `decision_chains` / `shadow_mark_series`）作为统计底表。
4. **需要人工决断的两件事**（我不做任何自动恢复动作）：(a) **1m K 线缺口的修复**——是代理/交易所侧供给问题还是本地序列恢复策略，需人工判断是否重启 Engine 或调整数据源（AGENTS.md 明确禁止我启停）；(b) 是否接受在**当前 25 仓、SHORT 余量仅 $110** 的敞口画像下继续追正向样本（追法即本报告 V 节所述：等行情链路恢复后，按 12+8 预算重跑，或先由人工消化敞口/明确风险限额）。
5. **对本实验设计本身的肯定部分**：25 USDT 与 12+8 预算在数学上依然成立（首选候选自然位移 4.31% ≫ 门槛 0.588%；p=0.40 下 12 次全拒仅 0.22%），因此**不需要修改提示词的参数**——需要修改的是"进入条件"，即第 1、2 条。

---

### 附：硬边界自检（本轮全部保持原值，未写入）

未改 `maxGrossExposurePct` / `maxDirectionExposurePct`（1.0 / 0.5）✔｜未处置任何现有仓位、未动 HUMAN_MANAGED、未因 SHORT 余量低而人工干预 ✔｜未调低 `minHistoricalReachProbability=0.50` / `minNetProfitUsd=1` ✔｜未提高 leverage、未改 `parameterProfile=CUSTOM`、未改 HUMAN cap 数值（4 / 0.20）✔｜未改 AI 自主权、未改唯一退出链 ✔｜historical UNKNOWN 18 条未删 ✔｜未改 Binance request governance ✔｜未做结果驱动选币（停止而非换币）✔｜未进入生产（TESTNET / `demo-fapi.binance.com` / `failClosed true` / `productionWrites 0`）✔｜未重启 Engine、未启停进程（PID 9680、`restartCount 161`）✔。
