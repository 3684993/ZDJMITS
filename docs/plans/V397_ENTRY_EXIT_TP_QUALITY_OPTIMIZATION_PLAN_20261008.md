# V3.9.7 Entry / Exit / TP Quality Optimization Implementation Plan — 2026-10-08

Status: PLAN_ONLY / NOT_IMPLEMENTED / NOT_AUTHORIZED_FOR_DEPLOYMENT. 本轮已完成两阶段只读复盘；事实层整体Reactivity仍FAIL，6.14秒stall唯一调用链UNKNOWN，相关remediation暂停等待独立专项。F04/F10/F11保持暂停。本文件的候选阈值是未来实验设计，不是当前Settings修改。

依据：[Trade质量报告](../reports/v397-trade-entry-exit-quality-review-20261008/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md)及同行JSON/CSV/gzip/scripts/logs。核心事实：19/21持仓超targethorizon；原TP entry距离median.4502%，fresh当前剩余距median5.5159%；AAVE bad earlyEntry强证据，ETHFI为lateTPpartial+adds+manual的mixed exit；滚动周canonical net样本0，不可以闭合小赢家的96.7%诊断胜率当策略总体表现。

## 1. 排序与工作包

| 阶段 | 具体产物 | 依赖 / 完成定义 |
|---|---|---|
| P0 | identity conflict与mixed exit分开；净收益/funding资格；origin-run/lot约束；EV证据语义 | 无策略参数变化，纯事实/投影更正先行评审 |
| P1 | 有界逐lot路径、horizon/TP版本/ownership时点、counterfactual质量指标 | P0正确，不在主线程全历史扫描 |
| P2 | compact Qwen反馈与决策context age契约 | 仅有支持的canonical分组；Primary仍唯一Entry authority |
| P3 | 既有Exit review的horizon/edge触发与versioned候选政策 | P0/P1+独立Reactivity通过；human权限不扩大 |
| P4 | shadow、purged walk-forward、prospective TESTNET小范围实验 | P2/P3证据足够、另行实施/部署授权 |

最先更正标签与度量，其次验证可行退出政策，再考虑参数。不能以“所有TP缩一半”直接上线，也不能以auto max-hold exit掩盖坏Entry或HUMAN长期库存。

## 2. P0 — 数据与provenance正确性

### P0.1 精确identity冲突与周期mixed构成

涉及`api/router.ts:tradeCloseProvenance`、`orderProvenanceRegistry.resolve`、TradeRecord schema/readmodel/UI。

引入独立字段：`exitComposition`（TP/MANUAL/SYSTEM_EXIT/MIXED/UNKNOWN），`finalizer`（最后有确证exit identity的角色），`identityConflict`（同一scoped exchange/client identity映射多个不同role或cycle），`proofCoverage`（已证明quantity/未知quantity）。保留原始exitOrderIds、linkedFillIds和per-fill解析结果，不覆盖历史registry。

对ETHFI应输出finalizerSYSTEM_MANUAL、compositionMIXED_TP_MANUAL，TPqty118.5/manual3493.1；各自SYSTEM_PROVEN且identityConflict=false。AAVE继续SYSTEM_MANUAL。真正role冲突仍CONFLICT/UNRESOLVED；不能以兼容manual match消解registry.resolve已明确的冲突，不能依据maker/taker、时间靠近、UI操作字串认证manual。

以environment/account/symbol/client或exchange exactidentity查找，交叉验证linkedFillIds与exitOrderIds/cycle/quantity。旧恢复对象同一identity同一role只归一，不添加另一role；无证据末次退出finalizer UNKNOWN。

Regression：AAVE单manual；ETHFI16TP+1manual；同一ID双role；不同symbol/account复用ID；staleTP manual误匹配；registry重复same-role；manuallocal但registry冲突；fill缺失/部分保留；退出time tie；partial quantity/finalizerUNKNOWN；out-of-orderWS/恢复后等价；兼容旧字段UI迁移。Golden fixture用本轮redacted真实身份，不造exchange样本。

Acceptance：案例exactqty守恒、per-fill角色可追踪；历史真冲突保留率100%；未知量不默认为人工；纯projection不改变交易权限/订单/数据库原记录。

### P0.2 Funding与正式净收益资格

保留fee、realizedPnL、FUNDING_FEE为不同ledger。只允许account/scope/asset/time及分配规则能证明的资金费进入cycle；0需要“已完整覆盖且确为0”证据，不能UNKNOWN→0。Cross持仓/加仓资金费需按实际持仓时间和数量分配，无法唯一归因就保留UNKNOWN和未分配资产ledger。

不立即重放/大扫描交易所：未来优先本地已保留事实；缺失外部只读补证需单独有界任务。formal canonical eligible要求完整fee/funding/quantity/identity，ex-funding诊断永远显式非canonical。closed/open/partial/mixed/unresolved各桶分别呈现；mixed不是一定非法，但学习前逐身份完整证明。

Regression：完整0fee/0funding、missingfunding、跨asset、多lotpartialexit、时间跨funding、lateincome重复、复用交易ID、ledgerconservation；USDT/USDC不自动等价；UNKNOWN对modeltraining无补零。Acceptance：无UNKNOWN收益进入正式训练；所有聚合能追溯分子/分母、资产与版本。

### P0.3 Entry origin、add lot与run权威链

原始Entry决策必须沿intent→entryOrder→lot→tradePlan→run确认，run完成先于该lot firstfill；后续position review/addrun不可冒充origin。旧UNI negative693802077ms链接进uncertainty，不clamp0；调查原因属于后续有界data任务，不修改历史填假事实。

每lot保存当时quantity/entrycost/TPversion/context/modelidentity；cycle最终VWAP只用于汇总，不回填此前MAE/MFE/PnL。Adds前后价格路径按有效库存计算，不使用未来持仓量估计pastMFE。

Regression：origin缺失、run晚于fill、addrun替换、reprice旧run、迁移旧cycle、partialfill/feeallocation、closedthenreopen。Acceptance：所有训练样本origin时间合法；多lot真PnL与固定锚MFE清楚区分；无法证明则omit。

### P0.4 概率与EV的真实语义

`quantityHorizonCandidates`非触达payoff=−requiredNetProfit是scenario，`historicalTpReachability`high/low触达率是有重叠历史窗口估计。拆字段：确定性`costBoundProof`、描述性`historicalTouchEstimate`（样本窗/重叠/来源/regime/coverage）、`scenarioExpectedPayoff`、真正`calibratedExpectedNetPnl`。后者只有已定义non-touch exitpolicy、费用/资金费、可执行路径及out-of-sample校准才KNOWN。

撤销“VERIFIED无条件EV”表述不等于降低资金/交易所硬门槛。未提供概率校准时不能用新估计或模型confidence绕过已授权facts；任何改变admission语义需独立评审，不在本轮实施。TP/horizon evidence失效要显式，不伪造默认正EV。

Regression：0/1概率、missing/non-touchloss、spreads/makerfees、重叠窗口、lookahead、少样本/confidence、unknownfunding。Acceptance：明确哪个字段确定、哪个估计、哪个情景；用户/Primary不会把proxy当verified收益。

## 3. P1 — 足以识别 Entry vs Exit 的有界观测

### P1.1 逐lot短路径与完整性

Entry firstfill后记录5m/15m/60m及原targetHorizon价格窗：mark+bids/asks+各sourceTs/receivedAt、必要closedbar、库存数量/fees/TPversion/ownership。新鲜度沿现有独立字段门槛，缺口显式，绝不放宽TTL。保存有界ring及lossless异步worker归档；关键claim/submission/UNKNOWN/TP durability保持同步fail-closed。

建议设计上限：每active lot覆盖到max(60m,targetHorizon)，常规1Hz最多6h/21600样本，超长horizon只在独立worker封闭interval摘要且不能宣称tickcomplete；<=64 active路径/总buffer硬字节限额128MiB（须离线容量评审，超限反压/gap标记，不丢authoritativefacts）。增量MFE/MAE和可执行touch摘要不需要主线程全historyparse。无论采样频率，不能把1Hz视作每tick完整；接受标准明确“规定采样网格覆盖”，精确intrasecond填单依旧UNKNOWN。

指标：sampled vs完整采样网格MFE/MAE5/15/60、time-toMFE、side-normalizedexecutiondelay/slippage、gap最长/总长、above/below已观察分钟、未观察分钟、TP首次touch/actualfill区别、fee-coverage及funding资格。重启断点和lateWS须版本化。历史2日retention不自动改变或删历史；若延长归档，另行容量/隐私评审。

### P1.2 TP/horizon/ownership审计链

保存Entry authorTTL、profit targetHorizon、managementdeadline三个独立字段。每次TP submit/reprice/cancel/partialfill/UNKNOWN附exactidentity、剩余inventory/coverage、ownerVersion、targetrevision/原因、reviewrun引用。异步报告采用同一asOf或明确字段时刻，不把后续owner状态当快照bug。

人管资产纳入右删失绩效，但不能据此自动管理。HOLD_TOO_LONG仅“目标超期”观察；是否应exit另需policy和authority证明。暴露当前price→TP距离、costbasis→TP距离、ATRmultiples、target/source、remainingedge；绝不从ATR直接推出time-to-hit。

### P1.3 分布与可复算报告

构建按policy/model/source版本、symbol/regime、quoteasset、single/multi-lot、ownership划分的closed+open competing-risk报告：TP/manual/otherexit为竞争终点，open为rightcensored。winrate/EV限定canonical；费用与资金费缺口列uncertainty。

接受指标：eligible数量/coverage报告完整；任何negativeoriginrun进入异常桶；训练0伪造标签；full-scan工作不在Engine热路径；观察CPU/heap/bytes上限与独立主机commit，不能凭测试通过宣称Reactivitystable。Regression：gaps/stalequote/out-of-order、heldoldinventory、fillschangingquantity、nativeinterrupt/workerbackpressure、sameasOf跨端点。

## 4. P2 — Qwen compact context与反馈

Primary仍唯一Entry authority，deterministic资金/私有/市场/交易所约束仍硬事实。REVIEW_BRAIN不成为第二Entryveto。与已授权TESTNETfunds-only政策一致：portfolio/quote利用可解释、不能新增隐式容量/组合risk否决；模型不能生成privatefacts。

推荐原decision/context保留asOf、featureclosedboundary、sourcefreshness、runstart/end、inputquoteage、JIT事实时点。若推理完成后context陈旧，仅按既有authoritativecontract处置；未来重新评价流程必须另行设计，不能延长TTL。先判断97秒耗时是否实质影响Entry，不在本轮换模型/温度/contextsize/GPU。

反馈包由独立worker增量构建，硬bound建议：最近50个canonicalclosed、最近7日优先、最多14日作为明确old样本，最多5个symbol/regime组、总<=1000tokens、24h重算及已有incident触发；缓存仅统计证据，不作privateauthorityTTL。每组至少30个独立cycle、跨>=3交易日才呈现效应，置信区间与实际n必填；达不到omit或仅提示INSUFFICIENT_EVIDENCE，不用相邻重叠窗充样本。阈值仅实验设计待评审，不是新增liveSettings。

字段：fee/fundingqualified净结果、5/15/60m完整采样格标签、horizonreach/actualfill、MAEwinnerdistribution、捕获/回吐、方向/时机/typedsetup、cost与executiondegradation、symbol/asset利用摘要；附schema/policy/modelversion、截止时间、sourcehash、uncertaintycounts。禁止raw历史promptdump、把HUMAN_RESCUE当模型正确、把PARTIAL盈利当canonical、“经验规律”变riskgate。

本轮canonical样本0，所以当前应省略收益学习反馈，仅带明确数据不足与真实可核实案例。BAD_ENTRY需早期充分采样/可执行cost说明；GOOD_ENTRY_BAD_EXIT需先有可捕获净盈利、后续实际退出失效率及权限区分；ENTRY_LATE需pre-entryrunup/decision完成时edge对照；PROFIT_GIVEBACK不能用未来quantity。MANUAL_RESCUE标签区分动作/动机/未来避免损失。

Regression：canonical0、组n不足、allunknownfunding、mixedidentity、multiplelot、旧模型/run晚于origin、版本变更、tokenbudget/worker失败/来源过期；任何缺失反馈不产生第二veto。Acceptance：Primary可见紧凑可追溯证据，不新增authority、不增同步historyscan，收益改善仍必须P4证明。

## 5. P3 — 既有TP / Exit review架构

复用当前positionReviewScheduler/Runner与TPGuardian，不新建重叠Reviewbrain。候选触发：目标horizon届满、closedbar失效谓词成立、可证明remainingedge衰减、足够可执行MFE后保护盈利；每position ownerVersion/planrevision去重、预算并发与冷却由后续验证确定。HUMAN_MANAGED/HANDOFF_PENDING只review-only，不能submit/cancel/reprice/自动exit。AUTO状态也须deterministic新鲜事实、合法order/qty、授权与durability。

Primary应输出typedsetup与versioned失效谓词（frame、closedbar条件、level、factref、expiry）。自然语言只能解释，不regex直转执行。区分entryTTL、盈利horizon、ownerdeadline。到horizon不是天然止损命令，而是可审计重新估计；不放宽loss/humanhandoff门槛。

TP候选契约：目标价与tick合法、fee/funding未知状态、当前quantity/reservation/owner、TP原版本、edge与horizon依据、expectedcost、proofquality、行为NONE/KEEP/REVIEW/TIGHTEN/EXIT。新目标不能覆盖durableUNKNOWN；取消/替换原TP需准确过渡与保护证明，保留authority-critical同步journal。AI期望不是exchangefact。

分政策设计：

| 候选 | 待证明收益 / 实施约束 |
|---|---|
| 波动归一TP | 按entry时点ATR/regime/horizon和成本下界分层；不将ATR乘数变唯一默认 |
| regime/horizonTP | 先有typedsetup校准；range/momentum不同，跨regime样本不足omit |
| time-decay / edge tightening | 保留targetrevision、剩余edge证据与成本；高频改价/手续费/TPgap风险要计入 |
| break-even/profitprotection | 先满足全成本executableMFE，不是mark尖峰；资金费UNKNOWN保持显式 |
| trailing | 持久峰值watermark、tickqty、重启恢复、partialfill与保护覆盖严格测试 |
| stagedexit | Exchange合法minqty/notional、部分执行qty守恒、remainingTP、unknownack恢复；先shadow |
| max-holdreview | 只触发审查，不赋予humaninventory执行权，不修改authorizationTTL |

Regression：owner转移并发、TPpartial/manualrace、staleprivate/market、unknownsubmit、lostack、重启恢复、PnL/fee精度、bestbookdepth不足、noactiveedge、重复review、worker延迟。Accept：0authority越界、0UNKNOWN误解为取消许可、0覆盖失真；新政策收益需P4而非仅unitpass。

## 6. P4 — 实验与科学验收

本轮33singlelot的halfmove observedtouch13 vs原target2，仅探索性机会下界；不能称实际hit改善33.3个百分点，也不能从conditionalpayoff14.0869推EV。AAVEhalfmove仍未观察touch，badEntry必须单独优化。

Phase1离线dataset冻结：exactversions/asset/ownership/fee/funding/gridcoverage，包含closed与open右删失，多lot按真实库存；legacy/缺口隔离。Phase2 shadow：只生成政策与counterfactual证据，无orderwrites、无模型资源/Settings变化。Phase3 purged walk-forward：按时间切分，purge至少maxhorizon，embargo防重叠/window/cycle泄漏；按day/symbol做blockbootstrap，多候选multiplecomparison校正，保持最后timeblock留出。不能选择本轮两案例后直接宣称泛化。

候选基线：当前TP版本、halfmove诊断benchmark、ATR归一、regime/horizon、timedecay、break-even、trailing、maxholdreview、staged、dynamicedge；统一费用/资金费/depth/fillqueue假设，touch与fill上下界分开。任何无法证明makerfill用保守taker/depth情景并列，不伪造真实fill。

每政策必须报告以下完整向量（现阶段改善值均UNKNOWN）：真实TP概率/竞争退出、全成本netEV/median/downsidetail、prematureexit损失、mean/median/p95holding与capitalturnover、manual率/动作收益、MFEcapture/giveback、MAEbeforewinners、asset/symbol/regime稳健性、overfit风险、data/authoritycoverage、TPdurability、runtimeoverhead。

最低研究gate建议：每主分层>=30独立完整cycle且>=3日，仅用于探索；上线候选总>=100完整独立cycle、至少14日和>=3symbol、每关键regime有足够样本，blockCI不确定则延长采集或拒绝，不降低资格。不能保证这些n足以检测小效应；预先功效/效应量计算后调整。全部gate是未来research，不重启当前长观察。

净EV下置信界相对基线>0且下行尾部不恶化、manual减少不以剥夺human权限实现、收益不能只来自单symbol/单日或删openlosers，才可讨论小范围TESTNET授权。实测策略增益前不发布固定TP%建议。

## 7. Rollout gates、接受指标与回滚

G0：本轮文档/证据GitHub闭合、P0回归设计review；不运行新完整verify或服务重启。

G1：独立Reactivity专项明确新证据与部署授权，解决秒级stall/关键PRIVATE EXECUTION REQUIRED_MARKET queue/freshness目标；当前FAIL不能拿fanout改善代替事实层稳定。主机commit与Engineheap各自验证，模型/测试/build不可并行污染。

G2：P0/P1形成一个可评审候选，开发targetedtests，准备部署时一次完整verify；仅另行授权的服务切换，不由本计划自动执行。runtimeauthority/production0/TP未知边界验证。

G3：P2/P3 shadow无执行，worker/CPU/heap/token预算证明；所有科学统计和跨资产分母完整，支持不足不发布模型规律。G4：P4out-of-sample研究通过，再由用户授权分范围TESTNET实验；Production禁止。

接受指标：数据provenance和qty守恒100%；正式样本UNKNOWNfee/funding0；run-origin时序合法100%；unsafeauthority/orderwrites0；feedbacksize上限有效；报告fresh字段均有timestamp/gap，不能以缓存报告替代private权威；policyCI/效应/损失tail与rightcensor明确；criticalREST/TP/loop不劣于独立稳定基线。没有“降低一个热点便接受全系统”的指标。

回滚触发：任何跨TESTNETboundary或human权限越界、exactidentity冲突被吞、UNKNOWN被当0/事实、TPcoveragegap/duplicateorder、关键queue/freshness退化、新增秒级stall、workerbackpressure影响主线程、canonicalstats污染、out-of-sample收益反转。回滚只移除新feedback/policy入口，保留原authoritativejournal/TP保护和完整证据；不能通过删除历史/放宽TTL/改margin风险规避失败。现场lifecycle须遵守独立授权。

## 8. 明确不变与未决项

本轮不实现任何上述source/schema/UI/模型改动；采集/分析脚本只为复现。Settings247、Entry/TP政策、策略参数、模型资源/SSH/SOCKS、数据库、订单及服务生命周期不动。Primaryauthority、REVIEW不是Entryveto、UNKNOWNfailclosed、资金/交易所合法性硬约束、authoritativeclaim/submission/UNKNOWN/TP同步durability不变；TESTNET-only/Production0。

待独立确认：6.14秒stall唯一调用链、真实自然lostACKTP终态恢复、旧UNI晚run链接原因、funding归因、完整历史早期路径、各addlotQwen决策因果、深度与queuefill、人工救援避免损失。人工动作已知，用户动机不是模型训练真值。非关键发现进backlog，不扩展当前run。
