# Codex 专项执行提示词 — V3.9.8 交易记录完整性、历史盈亏极值、持仓生命周期与 AI 持仓上下文

> 专项性质：**用户问题陈述 + 证据核验要求 + 执行边界**。这份提示词**不预设根因，不指定修复技术路径，不给算法或代码方案**。请 Codex 先用最新源码和真实本地事实确认现象是否成立、严重程度、影响范围及根因，再自行制定实施计划、**先提交 GitHub 并核实远端**，然后在证据充分的范围内按计划开展**隔离环境离线实施、验证、提交 GitHub**。
>
> 仓库：`3684993/ZDJMITS`。工作现场：Windows `D:\MITS` 及已存在的隔离 worktree。**不要请求用户重述此前聊天历史。**

## 0. 起点、已知事实与严格证据口径

先从 GitHub **最新 `origin/main`** 完整读取以下文件及其关联证据/源码；不要把下面的历史 SHA 当成永不变化的 main：

1. `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
2. `docs/prompts/CODEX_V398_ENTRY_SIZING_NO_ADD_VALIDATION_AND_IMPLEMENTATION.md`
3. `docs/prompts/CHATGPT_V398_ENTRY_QUALITY_OPTIMIZATION_START.md`
4. `docs/reports/v398-entry-sizing-quality-review/IMPLEMENTATION_REPORT.md`
5. `docs/reports/v398-entry-sizing-quality-review/ENTRY_SIZING_QUALITY_REVIEW.md`
6. `docs/plans/V398_ENTRY_SIZING_RISK_BUDGET_PLAN.md`
7. `docs/reports/v398-entry-sizing-quality-review/evidence-20261008/exchange-cycle-reconstruction.json`
8. `docs/reports/v398-entry-sizing-quality-review/evidence-20261008/missing-facts.json`
9. `docs/reports/v397-trade-entry-exit-quality-review-20261008/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md`
10. P0 事实层、TradeRecord/entryLineage/资金费/owner/finalizer 的原有报告、测试、当前交易历史 API/前端代码与最新 CI workflow。

用户已确认 GitHub Actions `37853581957` 为 SUCCESS；先通过 API 自行核对该 run 的 `head_sha/status/conclusion`，再核对**当前** main 最新 runs。2026-10-09 06:33 +08 前的已知归档基线 `5fe95a8662639571ac27e2ae1580c5994847ff77`，并不证明现在运行中的 Engine/持仓仍保持当时状态。

V3.9.8 报告曾记载 TESTNET Engine PID `8524`、READY/identity 6/6/TP 保护、生产写入 0、正式 sizing risk bounds 仅 shadow；这些是**指定观测时点的历史事实**，不得当成当前 live 心跳。实例可能仍运行；**本次不授权重启、停止、部署、改 Settings 或任何人造交易**。

阅读旧报告时请特别留意但**不要直接认定根因**：

- AVAXUSDT SHORT 的交易所历史重建曾显示 2026-09-20 00:10:45 +08 首次成交，18 个独立 Entry orders / 17 个独立后续追加订单，而旧界面 addCount 为 25；本轮用户记得 **2026-10-05 统计为追加 13 次**。可能是不同时间、不同定义或不同资料，请精确对齐时间窗和计数单位，不能凭直觉判错。
- 过去的物理重建曾给 AVAXUSDT 交易所 entry 累计 qty=1263、本地 TradeRecord entryQty=288、local lots 总和=1074；这是**明确需要复核的数据差异**，并不自动证明今天的界面记录为何不存在。
- 用户曾实际观察 AVAXUSDT **最大浮亏超过 1000 USDT**，但当前交易记录没有展示对应生命周期最大亏损。该 `1000+` 是**用户观察、非已独立回放核验的精确峰值**；不能写成已证实数学结果。
- 旧数据库曾有 funding UNKNOWN、P0 canonical 不合格、历史 PRIMARY run 归档缺口及价格路径留存不连续；绝不把缺失值补零/猜测或把“在某时刻看到的浮亏”冒充完整周期历史极值。

必须使用 `PROVEN / PARTIAL / CONTRADICTED / UNKNOWN` 分类，指出文件、代码 commit:line、真实数据源、环境/account/symbol/positionSide、时间戳、时间区间、证据哈希与缺口；反事实推理要单列，不可混成现场事实。

## 1. 用户提出的首要问题：AVAXUSDT 的整段交易为何“消失”

**用户观察（待验证）：**

- AVAXUSDT 曾在 **2026-09-20** 建仓，方向 **SHORT**。
- **2026-10-05** 一次统计记为补充 **13 次**；更早研究出现不同的 add/order/partial-fill 计数。
- 此刻用户在**交易记录界面**找不到该 SHORT 的 2026-09-20 建仓记录，在**当前持仓界面**也找不到对应条目，因此怀疑交易历史混乱、丢失或展示错误。

请从实际操作环境、数据、API 和代码回答**问题**，不要先提出修复方法：

1. 当前真实 TESTNET 账户中 AVAXUSDT LONG/SHORT 各是否仍有物理持仓？有无对应 open orders、reduce-only/TP orders、已关闭订单或历史成交？账户、交易对、quote asset 与 positionSide 是否与用户观察完全相同？若仓位确实已经结束，准确退出时间、数量守恒、退出路径/owner/交易所身份是否可证明？若无法证明，不得仅因界面无持仓就判定平仓。
2. 2026-09-20 至今，AVAXUSDT SHORT 在交易所 history、entry/exit executions、SQLite 原始 TradeRecord、物理 cycle、entry intents、plans、fills、owner/handoff、TP/人工操作、归档与前端交易记录中分别存在几条？**最早建仓事实最终落在哪一条历史记录、哪个 ID、哪个生命周期？**
3. 用户交易记录页面的“记录”到底指正在持仓、已完成周期、全部订单、逐笔 fill、周期聚合、历史已归档还是筛选结果？不同 tabs/filter/日期窗口/分页/排序/搜索/symbol/side/status/HUMAN_MANAGED 与 TESTNET/环境选择如何影响可见性？是否存在后端数据在但前端未展示、API 未返回、映射错、计数误读、时间分组变化？如果根本没有持久化，应证明丢失发生在哪一层。
4. 9/20 的原始 SHORT 与 10/5 的追加、之后的可能减仓/平仓/人工接管是否被拆成多个 cycle、错误合并、覆盖或改变 side、entryAt、exitAt、firstFillAt？各层记录能否跨重启、owner 交接、partial fill 与关闭周期保持稳定身份？有无重复/孤儿/相反方向串单/不同 quote 资产混合？
5. 清楚对比三个**不能混用**的概念：**当前物理持仓已不在**、**历史交易生命周期仍须可查询**、**某个前端视图未显示**。逐层回答究竟发生哪一种；不能直接把用户的怀疑当作已确认系统性丢历史。
6. 对 **2026-10-05“追加13次”** 与之前 **18 个独立 Entry orders / 17 次 separate adds / addCount25**，以各自观测时间、订单身份与时间窗逐一对账：时间点是否不同？add 的口径是否包含 partial fills、数量上报变化、取消重试、不同 intent、新独立 wire 或人工动作？最终能够确认多少，不能确认多少？

本轮不只要一个 AVAX 特例：Codex 还应检查近期**所有交易记录与当前/已结束仓位**是否存在相同的时间、方向、状态、数量、归档与界面可见性异常，并给出受影响范围和明确分母。

## 2. 生命周期最大盈利/亏损为什么没有记录或显示

**用户观察（待验证）：** AVAXUSDT 的历史浮亏曾达到 **1000+ USDT**，交易记录未显示“整个交易生命周期的最大亏损/最大盈利”等有价值的极值信息。

需要 Codex 核实：

1. 目前所谓交易记录的 PnL、最高盈亏、最大浮亏、MAE、MFE、已实现盈亏、浮动盈亏、最大回撤分别有什么实际字段？前端有无展示？每个值指 **单笔 fill、单个 entry order、整个物理持仓周期、部分平仓子周期、某个 AI trade plan** 还是账户组合？名字和口径是否匹配？
2. 是否真正收集了整个周期内**随持仓数量/成本/资金费与部分减仓动态变化**的有效带时间戳的浮动 PnL？来自 WS、mark/bid/ask、账户快照、存储轨迹、交易所历史哪个来源？运行期间、重启后、历史回放、人工接管前后是否连续？市场行情采样与位置快照是否同刻？
3. 9/20 起 AVAXUSDT 持仓曾出现的 `1000+ USDT` 负浮盈亏，当前留存事实能否独立证明其**数值、最差发生时间、当时 quantity/VWAP/mark 与仓位 side**？是否只能证明某一观测下界？若覆盖不足，哪些历史区间没有观测，为什么？不要用今日数量/成本反填过去，不要以插值制造极值。
4. “最大亏损”究竟应该如何与**最大浮亏、累计已实现亏损、费用/资金费净值、持仓总权益最低点、MAE 百分比、峰谷回撤**区分？当前代码/UI 的实际语义是否让用户误解？有 USDT 与 USDC 混合的地方吗？有没有把杠杆再乘一次、或把相对保证金收益率当 USDT 盈亏？
5. 如果交易周期还开放，应如何界定其“截至观测时间”极值；如果已结束，历史极值和最终净结算怎样独立保留？现有 retention、重启恢复、历史归档/数据库保留期会否造成周期早期点丢失？
6. 覆盖 ETHUSDT、AVAXUSDT 及其他典型 **有追加订单 / 有 TP 部分成交 / 人工退出 / 长时间持仓 / 已结束历史** 的周期，核查每种生命周期的展示与来源完整性。完整资金费和真实历史极值不足时，应如实标记 UNKNOWN 或不完整覆盖，不能向用户展示伪精确的最高/最低值。

请让数据事实决定问题是否成立、成立于哪一层、造成多大损害。**不要因“想展示极值”而先决定新增某个字段、表或采集器**。

## 3. 全项目交易记录一致性与可追溯性专项审查

请针对实际代码、数据库、交易所、前台界面逐条核验以下质量问题是否存在：

- **身份**：environment/account/symbol/positionSide、physicalCycleId、intent、clientOrderId、exchangeOrderId、fill、run、TradePlan、TradeRecord、TP/Exit/人工动作、ownerVersion 之间关联是否完整、唯一、可追溯？UNKNOWN、孤儿、重复、冲突分别多少？
- **时间**：最初 first fill、最后填单、每次追加、平仓、人工接管、TradeRecord created/updated、页面展示时间是否为相同意义？时区、时间排序、迟到交易所历史、跨日与跨重启时会不会改变原始建仓时间？
- **方向与持仓生命周期**：同一个 symbol 同时 LONG 和 SHORT、USDT/USDC 不同市场、reduce-only/TP、数量增减、部分成交、手工处理、零仓/历史闭环，是否造成错误方向、错误合并、漏显示或遗漏结束记录？
- **数量和资金**：物理订单累计成交、原始订单授权数量、TradeRecord entry/exit qty、逐 lot 数量、总 current qty、手续费资产与 funding 资格能否守恒？列出所有像 **AVAX 288 vs 1074 vs 1263** 的不一致，追溯精确数据源并审慎判断历史记录正确性。
- **历史保全**：旧版本 schema、持久化 retention、迁移/升级、新版本 ledger、API 聚合缓存、SSE/WS 消息、前端缓存、分页性能/取数预算，是否影响“从首次建仓到结算后的完整历史永久可追溯”的用户需求？是否存在看似消失但只是窗口遗漏？
- **页面和业务语义**：订单详情、周期详情、当前仓位和历史交易，能否分别展示完整且不互相矛盾的事实？曾经产生的追加行为记录应可追溯，即使 V3.9.8 现在禁止未来追加；历史审计不应改写。
- **学习/统计影响**：历史缺失、方向/时间错配或极值缺口，是否污染胜率、PnL、持仓时间、Entry/TP/Exit 质量和 Qwen 学习标签？正式 canonical / funding UNKNOWN / EXACT lot lineage 资格能否继续 fail-closed？

要求给出分母、例子、源数据、明确证据等级和用户可感知影响。绝不能为让报表“看着正确”偷偷篡改真实 fills、已证明订单身份、历史 owner 或 canonical 判定。

## 4. 用户新增需求：AI 应知晓已有同方向持仓及持仓时长；反向允许

**用户希望的策略语义（需求，不是对现有代码的事实断言）：**

假设真实 TESTNET 已有 **UNIUSDC SHORT**。如果系统再次遇到 UNIUSDC 市场机会并进入 AI 决策相关流程，希望 AI **看见/得知此刻已有 UNIUSDC SHORT、最初建仓时间、截至本次决策已持仓多久** 等真实上下文；不应该在不知情情况下将同向新建仓误当一个全新机会。用户明确**禁止同一币种同一方向的独立补仓**，但**UNIUSDC LONG 反向独立建仓原则上允许**（仍受交易所账户模式、资金、订单合法性和其他既有真实约束）。

请 Codex **先调查再提出计划**，重点回答：

1. 目前最新 V3.9.8 的 no-separate-add 与 pre-AI frozen candidate、Primary 入参、模型 prompt/context、AI 日志、Primary 决策结果、最终 ENTRY authority 的真实先后顺序是什么？已有同向仓位时，候选是否在 AI 前就被过滤？AI 目前到底能否获知该仓位与其持有时间？不要假设用户描述的功能今天一定不存在。
2. 如果 UNIUSDC SHORT 已有持仓，再出现 UNIUSDC SHORT 机会，在所有相关阶段分别发生什么？用户要的是 **AI 上下文可见性 + 禁止独立同向增加库存**；现有实现能够同时满足吗？如不能，缺在哪个事实或交互边界？
3. UNIUSDC SHORT 已有时，UNIUSDC LONG 机会能否正常进入 AI 判断、合法 frozen candidate 与 Primary 授权？当前是否有将 symbol 级别占用误当 side 级别、或无意全局封锁反向独立开仓的行为？必须核实交易所 hedge/one-way position mode、同一账户/同一交易对/quote asset 归属、净额抵消风险；“反向允许”不等于绕开交易所合法性、真实资金与环境隔离。
4. 若同向持仓还在人工接管、待交割、pending entry/exit、partial fills、UNKNOWN ACK、owner 状态变动或物理数量与本地状态不一致，AI 看见的信息是否具有清晰 as-of 时间、来源、可信度和 UNKNOWN 标记？是否会用过期库存或错误持仓时长误导决策？
5. 用户要提醒的“已经有 SHORT、持仓多久”是否能从真正 earliest current physical-cycle first-fill 算出，而不是用最近一次加仓时间、最近更新 TradeRecord 时间或同 symbol 的其他方向时间？是否存在多笔原始周期、平仓再开仓重置计时、部分平仓影响？
6. 如何验证 AI 实际**收到并理解**该事实，而不只是在后端生成了字段？AI 决策文本、真实 decision input 与权限边界能否被不泄露私有内容地审计？已有同方向风险不得因 AI 偏好而突破，反方向仍保留 Primary 独立选择。
7. 此需求与 V3.9.8 既有 no-add、Primary 唯一 Entry authority、Review 不是第二 veto、HUMAN 管理权限之间有无冲突？有则必须列证据、影响、需要用户决定的真实分歧；**不要擅自取消已上线 no-add 防护来“让 AI 再看一次”**。

本专项只给出预期用户行为与要验证的问题。**采用何种上下文传递、展示、判断或冻结时机，由 Codex 查明实际代码后在计划中论证，不在这份提示词指定。**

## 5. 证据及完成标准：先证明问题，再提交实施计划

### Phase A — 只读审查和事实闭合（先完成）

- 核验最新 GitHub main SHA、上述 CI 是否 SUCCESS、当前 Engine/数据/环境、工作树 dirty 状态和证据覆盖，保留各观测时间。不能把上一轮 RUNNING 当作新鲜当前健康。
- 审计真实源码调用链及 UI/API/持久化投影；本地只读收集必要的 TESTNET 历史及当前资料，**查询时间窗、记录数、网络请求数、数据库开销必须有界**，不拖慢运行实例，不触发交易、重启、Settings 修改、数据库写入/迁移、账户操作或超范围历史扫描。
- 形成 AVAXUSDT 从 9/20 first fill 经 10/5 统计到**目前可证实的状态**的逐事件时间线；数据不充分就明确哪里有 gap，不能补造平仓、最高亏损、历史 PRIMARY 权限或最新仓位。
- 核对历史 `1000+ USDT` 最大浮亏、所有历史价格与库存观测的充分性，以及“交易记录缺失”的层级。验证当前报告中旧 AVAX qty 数值是否仍可重现，不能只转述。
- 用真实 UNIUSDC SHORT，**如果当下账户没有它**就用可用历史事实 + 完全隔离、无交易写入的合法测试样本，验证 same-side/reverse-side/AI context 行为。禁止为了制造样本而自然或人工向交易所下单。
- 将全项目相关记录的误差、缺字段、异常状态、数量守恒、历史消失/过滤、学习污染整理为可重复核查的问题清单，并对其优先级标注“已证实/未证实”，不先筛选一个想要的技术方案。

### Phase B — 将**验证结果及 Codex 自行制定的实施计划**先提交 GitHub

至少在仓库内新增或更新：

- `docs/reports/v398-trade-record-integrity-20261009/FACT_AUDIT_REPORT.md` —— 经证实问题、反证/UNKNOWN、AVAX 时间线、极值覆盖、全项目影响范围、源码与数据证据索引。
- `docs/plans/V398_TRADE_RECORD_INTEGRITY_IMPLEMENTATION_PLAN_20261009.md` —— Codex 在真实源码/事实核查后**自行决定**修复范围、技术方案、文件级改动、行为兼容性、数据/持仓/AI 语义、风险与回滚、版本/部署门禁、验证与验收条件。
- 同一证据目录的**脱敏可复核** JSON/CSV/log/source-map/测试准备、时间范围/数据覆盖及 SHA256 manifest。完整私有数据库和日志、账户身份、密钥、私有提示词不提交仓库。

**必须先 Git commit/push 到 GitHub，再独立远端 fetch/readback 与 hash/HEAD 核实上述报告和计划，才准开始改任何交易记录/AI上下文相关源代码。** 报告与计划不得把未经证明的假设写成既定根因或数值结论。若关键问题无法复核，Codex 应标出 `NEEDS_EVIDENCE / IMPLEMENTATION_BLOCKED` 并保留未解决问题，而不是在缺乏依据时编造落地方案。

### Phase C — 按已提交计划开展隔离离线实施与测试

此阶段仅在 Phase B 远端门禁完成且具体改动风险可控后执行。Codex 自行选择经事实证明必要的最小修改及验证策略；用户未提前指定根因、代码、数据库结构或修复算法。

用户对最终结果的验收诉求：

1. 能明确找到 AVAXUSDT 2026-09-20 SHORT 的**真实历史轨迹或被证明的历史缺口**，且能解释为何此前页面既无当前持仓也无历史 Entry。
2. 能对齐 10/5 13 次与后续历史 addCount25、17 独立追加等不同口径，不错误修正原始订单/成交事实。
3. 交易记录里的方向、最早建仓时间、持仓时长、物理周期、期间累计数量/费用、最终生命周期状态等显示和源证据语义一致；全部类型有明确覆盖测试。
4. 历史最大浮动盈利/亏损与发生时间应只有在可证明覆盖条件下标为 verified；不完整历史不能伪造 `1000+` 精确峰值、无观测区间也不能宣称从未触及。
5. AI 在需要进行与已有仓位相关的分析/决策时，所用真实持仓方向、最早建仓时间、持仓年龄等事实能够核实；同方向独立追加仍被禁止；**反向独立机会不会仅因另一方向仓位存在就被误挡**，同时不得绕过合法性和 Primary authority。
6. 其他交易对、已平仓/HUMAN/TP+MANUAL/partial fill/多方向/资金费 UNKNOWN/历史长周期、恢复与 API/前端筛选均有回归；关键数据库/交换所身份和数量守恒不退化；未充分证明的旧数据仍有可信 UNKNOWN/diagnostic 标注。
7. 测试、CI、证据、变更及限制明确可审计；**已开发、已部署、现场数据迁移是三个不同状态**。

所有本轮必要修改只在隔离 worktree 进行，保留 `D:\MITS` 的用户未提交修改和正在运行实例。完成与源码相容的 targeted + full verify、S00、Actions 和远端 hash readback，形成 `IMPLEMENTATION_REPORT.md`、实际测试结果和源 SHA。

**本轮不授权：** 部署/重启/停止 Engine，人工 TESTNET 下单、生产环境任何写入、清除/修补 live SQLite 或历史 TradeRecord、删除私有备份、改 Settings/模型/TP 参数/策略资金风险倍率、通过“做假平仓”解决显示、关闭 no-add 或取消 HUMAN ownership。不复活 F04/F10/F11，不顺手处理独立 Reactivity 课题。若计划确实需要线上历史数据迁移或真实账户写入，请停在实施前相应授权门禁，提交证据与计划而不执行这类操作。对于本地原先 `blocked by policy` 的私有临时备份删除，不绕过审批或绕道重试删除。

## 6. 最终交付给用户的格式

1. **先于代码实现阶段**报告远端 main SHA、CI、当前 runtime 真实性，AVAX 历史失踪和 PnL 极值各项 PROVEN/UNKNOWN 根因证据、其他交易对影响、UNIUSDC same/reverse-side AI上下文真实性、Phase B GitHub 报告/计划 URL 与远端 commit/readback 结果。
2. **Phase C 后**报告实际代码与测试范围、修复前后对账、文件/源码 commit、CI与哈希、没有触碰的 live 实例/数据、无法证明的历史极值及后续授权门禁。不得给出“历史已完整修复”“最高亏损已精确复原”“反向建仓已实盘证明”等没有现场证据的断言。
3. 长控制台日志必须由 Codex 保存为 `*.log`；结构化统计 `*.json`/`*.csv`，脱敏后提交 GitHub，用户无需复制长终端输出。保留失败证据，不静默覆盖；任何公网归档之前检查 secret/privacy，不能将私有原始数据带入 public repo。

**执行顺序不可反转：当前最新 main → 实际源码/TESTNET事实证实或证伪用户现象 → GitHub FACT_AUDIT_REPORT + 自拟 Implementation Plan 并远端核验 → 根据经证实的问题开展隔离离线实施与测试 → GitHub 交付回读。此次提示词不代替 Codex 的调查与结论。**
