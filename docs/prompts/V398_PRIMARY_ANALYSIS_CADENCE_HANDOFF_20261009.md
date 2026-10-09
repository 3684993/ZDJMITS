# ZDJMITS V3.9.8 — 新对话 / 本机 Codex P0：Primary 有效分析频率、行情新鲜度与模型价位输出可靠性

**创建**：2026-10-09 18:30+08；**状态**：SOURCE_AUDIT_COMPLETE / READ_ONLY_LIVE_DIAG_NOT_YET_EXECUTED / FIX_NOT_IMPLEMENTED  
**项目**：GitHub `3684993/ZDJMITS`，本计划基线 `main=7c9c94e9807c8c8ab1a9e0c8b205e391974493ec`，隔离分支 `codex/v398-primary-cadence-p0-20261009`；执行前重新读取最新 main、PR #16、Issue #17。不要假设后续 main 没变化。  
**用户目标**：当确有最新事实完整、策略允许的合格新建仓候选时，**每3～5分钟至少完成一笔不同币种的有意义的 Primary 分析**，及时响应 15m 趋势与 5m/1m 入场变化；这是**分析吞吐量 SLO，不是每5分钟必须 PLACE/挂单/成交**。没有真实合格机会可等待，但必须可解释。严禁为了达成数量制造候选、强制下单、抹去 UNKNOWN、降低合法性/资金/TP/同向重复建仓保护。

## 当前必须保留的运行与验收上下文

- 用户前轮报告：2026-10-09 16:16:04+08 已启动独立 **24小时稳定性验收**，截至 2026-10-10 16:16:04+08。TESTNET Engine 原 PID **18100**，instance `65185f71-b336-4f6f-8149-cafe90f5e160`，build `3.9.8-6cd926abca3eec24392e`，identity6/6、8080 READY、`ZDJ_ENTRY_ADMISSION_DISABLED=0`、`entryExecutionPolicy.orderAuthorization=true`；三个模型 8081/8083/8084、代理20091 健康；Production写入0；上一时间点 TP14/14。**一切为历史证据，不应无新读回而宣称当前仍是该 PID/状态。**
- Windows WER 全转储与 Crash Observer 45秒采样、独立交易只读审计5分钟已启用。验收期间不随便重启 Engine/三个模型/代理，不动 Settings/SQLite/TP/Entry许可；一旦自然崩溃先保全原生证据。所有代码性能优化在新 worktree 离线执行，真实部署另行授权。
- PR #16 订单生命周期 UI/API 修复虽本地测试250文件/2125 PASS，但尚未部署，审查发现其历史查询每刷新可能读取约**32 MB JSON**，15s重复查询压力尚未过关；本工作**不得借PR#16增加线上数据库扫描**。
- Issue #17 聚焦人类可读AI审计和空闲GPU效率；本任务专注 **Primary调度/候选供给/行情闭合/模型输出合法性**，不应重复职责或误改 Review/HOLD 策略。
- 用户提供当前持仓快照：ADAUSDT SHORT 约2h3m，RAYSOLUSDT LONG/HUMAN_MANAGED 浮盈亏约 -59.78 USD、ROE -59.74%，TIAUSDC LONG/HUMAN_MANAGED 约 -22.15 USD、ROE -22.14%。**已有 TP PROTECTED 不代表有止损**，不以低频焦虑为理由加仓或忽视现有风险。持仓时长不能证明近两小时无挂单，应从真实 Order/Entry History 测算。
- 市场结构快照 18:29:59+08 一批 READY（ZROUSDT/BCHUSDT/TIAUSDC/ONDOUSDT/DOGEUSDT/XRPUSDC/BTCUSDT/RAYSOLUSDT/VVVUSDT/BNBUSDC/DOTUSDT/ETHUSDT/FETUSDT/WLDUSDT/RENDERUSDT/AAVEUSDT/ADAUSDT/SOLUSDT）；另一批技术K线停在18:14:59且报 `TECHNICAL_1m/5m/15m_MISSING_LATEST_CLOSED`（GRASSUSDT/ENAUSDT/ZECUSDT/AEROUSDT/FILUSDC/ARBUSDT）。这说明**部分币种数据新鲜度有缺口，但不能把全部 PRIMARY 低频归咎行情源**。
- 用户页面动态池 Top100 排名已有多行 READY/WAITING，并且有少量位置排序非顺序；UI 的 READY ≠ Primary 真实派发资格。

## 本次最直接的自然失败（必须逐 runId 分析，不能猜测）

北京时间 **2026-10-09 18:30:00**：
- BNBUSDC `SCOUT qwen3.5:9b COMPLETED`，运行约14.325s，input3569/output390；
- BNBUSDC `PRIMARY_BRAIN qwen/qwen3.8-27b FAILED`，总运行 **62,529ms**，队列1263ms，input **20,941** tokens、output **798** tokens，runId **`airun_mv0tqcnh_qqb6z1hm`**。
- 错误：`[{"code":"custom","path":["acceptablePriceRange"],"message":"min <= idealPrice <= max required"}]`。原始 AI 选出的入场价格与 AI 允许范围矛盾，strict schema 正确拒绝；既不是32K输入超限，也不是资金不足。该 Run 无 tradePlan、reservation、intent、order、fill，**本次未提交交易所**。
- 其实际风险：60秒推理成功返回但 schema 不可用，浪费一个调度机会。先取私有原始输出与 frozen execution envelope，证明究竟是价格数量精度/语义误解/场景格式/交叉 candidateID/不一致、prompt与schema矛盾，不能默默把非法价格夹在区间内转成 PLACE。已有历史43 FAILED 中另有5条价格区间矛盾、1条TP区间矛盾，说明这不是从未出现的问题。

## GitHub 主线代码已交叉核实的事实

1. `apps/engine/src/runtime/appRuntime.ts` **每2500ms** 运行 `dispatchAnalysisTick`；`UNIVERSE_REFRESH`每15s，`market.freshness()`恢复每10s；市场刷新另有每60s、1s轮询。故主要瓶颈**不是**调度tick为10分钟，禁止简单反复减小tick。
2. `apps/engine/src/services/entryCoordinator.ts` `processPool()` 在模型前过滤 `readyList()`、`objectiveCapacity`、`EIP依赖(symbol/BTCUSDT/ETHUSDT)`、`primaryOccupancyBlock`、active和rejectionCooldown、`lifecycleRunnable`，检查 `executionGate`、circuit/capacity后才 `ANALYSIS_DISPATCH_INTENT`。候选已在动态池、甚至页面 READY，仍可能不在可派发集合。
3. `lifecycleRunnable()` 对已经有 `decisionContextKey` 的 READY 行，要求决策上下文改变、某些方向权限改变或到 `nextReviewAt`；`decisionContext` 与 `noEdgeReview` 的冷却去重是防止相同信号重复耗费模型，不得一刀切移除。对新的 5m closed/15m structure 事实需调查是否会更新可派发资格。
4. `aiFabric.ts` Primary连续硬失败可让 circuit OPEN，30秒起指数退避至最多300秒；模型SCHEMA校验失败目前清零 Primary failure streak，但浪费一次推理。Review队列和Primary duty资源可能共享时有公平调度/让出机制，必须使用真实 `aiDutyRoutes`、OS 8083/8084身份和排队时间证明是否 Entry 被 Review占满。仅凭 GPU 任务管理器 IDLE 不能断言AI没工作。
5. `aiFabric.ts` `entryDecisionParse` 在 `EntryDecisionV370Schema.parse(raw)` 阶段严格验证，**TP target range**某种可证实冗余有受约束的 frozen candidate normalization，但本次 **entry idealPrice/range**尚未得到此合约兼容，不能未经证据直接套用 TP 的行为；后续 `entryCoordinator` 虽有 `POST_AI_REDUNDANT_FIELD_NORMALIZED`（由已验证 frozen ID/候选导入权威范围），但模型的价格 schema 错误发生在它之前。因此值得改进“仅让模型独立决定方向/候选ID，冗余价格来自可证明冻结候选”的协议，而不是神奇地修价或突破 frozen range。
6. `universeCoordinator.ts` 对同 Symbol/side 同向占用、决策上下文、候选质量、资产目录、freshness、ready/routable有多层状态；`marketDataStaleness.ts` 已支持单币数据缺失隔离，不应该因为几个STALE币种暂停其它READY币种。
7. `Market Intelligence OFFLINE_ONLY` 是隔离策略的预期配置，不能在本次任务为了“增加分析”直接启用在线 Temporal/Regime/Analog worker 或读写生产数据库；它并不是 Primary 高频失败的直接证明。

## P0 实施顺序（本地 Windows Codex）

### A. 立刻进行仅 GET/只读运行诊断，不能触碰正常运行的 24h Engine

- 基于当前 PID/instance/build/Task/Current Maintenance Handoff，取过去90分钟和可得过去3小时**同一运行实例** `ANALYSIS_DISPATCH_HEARTBEAT`、`ANALYSIS_DISPATCH_INTENT`、`POOL_ANALYSIS_STARTED`、`PRIMARY_* / AI_RUN_*`、`EXECUTION_READINESS_BLOCKED`、`CANDIDATE_SUPPLY_HEALTH`、`POOL_SUPPLY_HEALTH`、`MARKET_FRESHNESS_RECOVERY`、`AI_PRIMARY_CIRCUIT_*`、`POSITION_REVIEW_*`。优先读取现有SQLite和已存日志，低频API，不能增加高频/全库扫描；保留原始来源与 instance。
- 做 **每个5分钟滑窗漏斗**：Universe ranked→resident/marketQuality→rank READY→live quote/1m5m15m closed freshness→capital direction executable→lifecycle READY/noEdge/cooldown→EIP dependencies→model spend permission→SCOUT dispatched/completed→Primary request→Primary completed/FAILED schema/context/model timeout→successful semantic decision→action/no intent→order → fill。按 symbol 和 first authoritative blocker 聚合，计算每一段等待时长、每个5分钟的Primary成功数、连续零成功时段长度。不要只计算模型请求/订单数量或用持仓时间替代频率。
- 判断当时如 BCHUSDT/DOGEUSDT/BNBUSDC等READY的候选为何没有被派发：提供真正 reason codes和依据，不以余额、GPU空闲或资产「READY」做推断。特别检查 `lifecycleRunnable` 的 nextReviewAt/contextKey、`rejectionCooldown`、资金方向容量、noSeparateAdd pending identity、Market Quality、Review共享Primary的服务份额及队列。保留订单保护真实拒绝。
- BNB runId上述精确归因：对比存档模型RAW `idealPrice`、range.min/max、`selectedCandidateId`、方向、schema、FrozenCandidate ID和交易所 tick size，列出任何相互矛盾字段。**原始私人请求/输出和订单身份仅存本机**，GitHub报告保留脱敏数字/哈希。

### B. 离线实现提升“有效 Primary 分析吞吐”而不抬高交易风险

- 分离 **频率/质量/成交**：SLO `EFFECTIVE_PRIMARY_DECISION_CADENCE` **当近5分钟持续存在 >=1 个实时完整、合法可执行、可派发且在非cooldown状态的候选时**，目标 p90 分析完成间隔 <=5分钟、5分钟窗口至少1条有效 Primary `COMPLETED`（PLACE/WAIT/REJECT都是有效分析，FAILED/SCHEMA_INVALID不是）；窗口内确无机会须给唯一权威 `NO_ELIGIBLE_CANDIDATE` 证明，不强行制造。显示 `nextEligibleAt/nextDispatchAt/reasons`，报警连续超5/10分钟漏斗断裂。取连续60min样本与24h趋势，不能一次测量宣称长期达标。
- 只修复**确证的瓶颈**：关键行情闭合补齐/单币隔离恢复、Pool READY与Executor ROUTABLE状态不同步、冷却没有按新的事实释放、模型调用与Review优先级/排队不合理、Primary模型的必要数据请求冗余或超长延迟。不动无关总量/保证金阈值，不掩盖数据错误。
- **Price schema不可接受直接夹值成交**。优先将AI输出协议缩成：模型选 `PLACE_LONG/SHORT`、`selectedCandidateId`、真实证据、信心和意义判断；权威价量范围和TP只能从已冻结同一candidate派生且严格验证 model/candidate/side/validity/hash/price/qty/target/horizon 一致。若模型表达自相矛盾的执行意图，应仍判 `INVALID`，并仅在有明文冻结身份可证明的重复字段误填场景允许审计式冗余归一（不得改变模型方向或帮它猜ID）。优先考虑单次 bounded修复提问只在有证据支持且**不赋予新交易权限**时使用；如果一次有效请求后修正失败，释放该币种调度 lease，把下一币种排上队。所有策略含 SAFE/FAIL_CLOSED 回退。
- 将 `SCHEMA_INVALID`、`PROMPT_BUDGET_UNAVAILABLE`、`MARKET_STALE`、`NO_ELIGIBLE_CANDIDATE`、`AI_BUSY`、`CAPACITY/ENTRY_ORDER_OCCUPIED`、`MODEL_TIMEOUT` 分别统计；不要把 Primary 失败算成有效完成，也不要无界循环要求模型重试。
- 预防 Review饿死Entry或Entry饿死Review：按真实 duty routes / 模型别名/PID调查，做隔离 fair-share 测试；若共享必须设可解释任务优先级和token/时间预算，不使用直接挪用另一个 27B 推理进程而不验证其职责/推理设置/输出协议。
- 行情恢复只能使用真实 Binance 已闭合K线/身份时间戳，保持15m趋势和5m/1m时机策略；绝不通过延长 stale 窗口、伪造closeTime、降准入规则来实现次数。

### C. 测试 / 交付

- 离线单测和真实存档回放：BNBUSDC不合法ideal/range、多种price tick区间、TP区间矛盾、合法候选、LONG/SHORT方向独立、错candidateID、永不默默改方向/量/TP、schema fail→下一个READY币种、multi-symbol公平、行情STALE隔离、noEdge上下文变更、Entry/Review公平、模型context32k预算、相同输入去重；测试必须证明 **无新增非法下单**。
- 完整 `npm ci` / `npm run verify`、release/S00和测试数；保留失败测试回执，不降低断言、跳过Schema或加大风险限制。建立独立PR和准确CI状态；初步只读现场诊断即使没有修复也必须先交真实漏斗与首因表。
- **24h稳定观察继续**：不主动停止/重启Engine、三个模型、SSH代理或WRR；不修改在线Settings/SQLite、TP、Entry授权、现有Order和持仓；交易所仅GET，所有代码离线。24h结束且经额外操作授权，才单次正式Engine切换部署并验证新的cadence；如基础运行自然崩溃，先封存WER证据。未经明确用户额外部署许可不可把PR merge等同生效。
- 质量验收另计：有效决策频率达标**不**代表实际挂单频率达标，更不证明胜率提升。记录 PLACE→INTENT→交易所真实提交→保留时长/Review CANCEL→fill→新仓TP→成熟闭环，50条成熟交易链仍待真实样本。

## 用户可用的新对话提示词（新窗口只需提供下面简短指令）

> 继续维护GitHub项目3684993/ZDJMITS。完整读取分支 `codex/v398-primary-cadence-p0-20261009` 下的 `docs/prompts/V398_PRIMARY_ANALYSIS_CADENCE_HANDOFF_20261009.md`，把它作为当前唯一 P0 任务和全部硬约束。先从Windows在线运行日志只读重建90分钟的Primary 5分钟派发/完成漏斗和18:30 BNBUSDC runId=`airun_mv0tqcnh_qqb6z1hm` 的价格schema失败根因，然后按计划在独立worktree修复低频及输出合法性，做真实回放和完整verify，提交独立PR。维持24小时观察中的Engine PID18100及三个模型/代理，不得为此重启、下单、篡改Settings或放宽风控。目标是有真实合格候选时平均每3-5分钟完成一条有用Primary分析，不是强制挂单。给我有证据的代码、测试、漏斗、PR和上线方案；没有实证的步骤标 UNKNOWN。
