# V3.9.5 项目结论与 V3.9.6 实施方案

日期：2026-09-21。范围：报告与源码复核；本次仅新增本文，不修改代码、Settings、仓位或 Engine 生命周期。

证据基线：GitHub 分支 `docs/v395-24h-final-report-20260921`，提交 `4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a`。已 fetch 核对；本地 engine/core/contracts/dashboard 源码与该提交无差异。运行数据引用 [R17 报告](./v395-final-24h-soak-and-release-baseline-20260921.md)，不冒充本次重新实测；未重做完整设置验收、24h 收口或模型收益实验。

## 1. 最终结论

**V3.9.5 可保留为 SHADOW 基线，但尚不是已证明盈利、可扩大权限的自主交易系统。V3.9.6 应优先补齐“证据→计划→成交→复核→记忆”闭环。**

- 安全证据较强：R17 的 TP 129/129 完整，4 次出口失效正确闭合，亏损仓未自动平仓。两条 P0 为采集竞态假警。
- 验收仍有边界：最后复核为 **21.70h / 131 采样**；没有后续证据就维持 `PENDING_WINDOW_INCOMPLETE`，不能因当前日期已到而补签 PASS。已知 UNKNOWN 七天回溯 P1 未解决，ENFORCE 仍 `NOT_READY`。
- 盈利尚不可证：45 次 SHADOW 经济评估均未通过；R17 中 135/135 funding UNKNOWN、netPnl 不完整。不能用胜率、TP 覆盖率或浮盈替代完整净收益。
- **目标改为：每次建仓都有可验证依据、数量与期限计划，持续检验净收益期望；不能承诺每笔达到预期收益。** 历史表现不能保证未来收益，参见 [SEC 投资者说明](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47)。

## 2. 代码确认的关键断层

以下源码链接固定在上述 GitHub 提交，避免分支变更后证据漂移。

| 项目 | 已有能力 | 实际不足与下一步 |
|---|---|---|
| 27B 自主决策 | [提示词](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/packages/core/src/compactEntry.ts)要求独立评估多空，自选数量、价格及 TP；[数量落地器](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/aiQuantityAllocation.ts)仅验证并落实数量 | 缺少可检验的数量选择依据、失败情景与资金占用代价；补计划契约，不能以模型 confidence 直接放大仓位 |
| 持仓期限 | [契约](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/packages/contracts/src/ai.ts)已有 TP `targetHorizonMinutes` 1–1440；建仓 `horizonMinutes` 1–5 是授权期限 | [TP Guardian](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/tpGuardian.ts)在目标选择时校验期限并可回退结构/固定目标，但不是完整持仓到期复核；需记录原计划与实际执行偏差 |
| 盈利预期 | [经济检查](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/economicEntryFeasibility.ts)计算目标价下扣费收益与历史触达率 | `expectedNetProfit` 是到达目标时的条件收益，并非概率加权期望；[触达统计](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/historicalTpReachability.ts)用后续窗口极值，未表达先遭受多大亏损，也不等于可成交概率 |
| 交易记忆 | [ExperienceService](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/experienceService.ts)已把同币种、同 regime 胜率注入决策 | 实际读取 tradeRecords 摘要；`netPnl ?? 0` 让未知净利进入非盈利分母。缺少方向/形态/期限匹配、相似失败案例、样本置信度和反馈贡献度 |
| 当前持仓利用 | [EIP](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/packages/core/src/eip.ts)提供多空数量、名义敞口及盈利比例 | 缺少持仓年龄、原始论点、到期状态、相关资产集中度；未平仓不得当作盈利记忆 |
| 双模型职责 | [AiFabric](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/aiFabric.ts)支持 Scout 建仓摘要和外部研究，27B 为 Primary | 两种 Scout 工作模式需区分；不能仅凭资源页显示判断是否参与。默认配置 Scout 关闭不代表运行中关闭，R17 有实际 Scout 调用 |
| 设置与菜单 | [SettingsView](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/dashboard/src/views/SettingsView.vue)已标注旧方向配置是兼容字段 | “保存成功”不等于控制当前 Entry 方向；不能宣称所有设置完全适用。需建立字段→消费者→生效时点→验收用例映射 |

## 3. 下一版决策与持仓方案

**9B 做事实整理与质疑，27B 做交易计划，确定性执行器保留风险否决权。** 自主性体现为主动发现缺证据、选择不交易、按新事实复核，不是绕开风控。

1. **9B：**按新收盘事实、外部事件或持仓里程碑触发，输出事实 ID、时效、缺口、反证及记忆候选；复用同一事件摘要。缺行情由数据服务定向补取；外部文本仅作不可信资料。无下单权限，非关键研究失败不阻塞 TP。
2. **27B：**输出短结构化计划：`planId / side / evidenceRefs / counterEvidence / quantityUnits / sizingReason / targetPrice / targetHorizon / reviewAt / invalidation / scenarioTable / memoryRefs`。仅需简短理由与可核验证据，不要求长篇推理。证据缺失、过期、计划不可行则 WAIT/NO_TRADE。
3. **科学定量：**先固定方向，再由计算服务给出合法数量与期限的候选表；模型选择数量并解释取舍。`q = units × stepSize`，上限取执行包、组合敞口、保证金、流动性及压力损失预算中最严格者；最小订单与预期收益不相容时不交易，禁止为凑 $1 而加仓或抬高目标。
4. **科学收益：**计算 `EV(q,T)=Σ pᵢ × [情景毛损益ᵢ(q,T)−手续费ᵢ−滑点ᵢ−资金费ᵢ]`；情景概率来自按时间切分的历史样本，并报告样本量、区间与未知项，不能由模型自报 confidence 代替。纳入未触达、先逆向、尾部亏损和资金占用；压力损失预算不等于保证最大损失。
5. **科学期限：**比较可支持的期限（优先复用现有 5/15/30/60/120…分钟档），依据净 EV、触达时间分布、最大不利波动及资金占用选择，不以“拖久总会回本”为理由。分别保存建仓授权期限、目标期限和复核时刻。
6. **成交后闭环：**实际成交价/数量/成本回填计划；重大事实变化、目标到期、亏损接管触发一次复核。当前“不自动亏损平仓”政策下，到期只能解释偏差、提示或人工接管并保留 TP；**不能保证持仓在目标时间结束**。强制限时退出属于另行授权的策略变更。
7. **记忆闭环：**用 `planId→decisionChainId→cycleId→fills→tradeRecord→memory` 贯通；保存目标/实际净利、持仓时间、最大有利/不利波动、失败原因、TP 回退原因。资金费未知标 UNKNOWN，排除收益学习但保留事实；已闭合完整样本按方向、形态、波动和期限检索 Top-3 正反案例。未闭合持仓作为风险状态，统计时作为未完成样本，防止只看已盈利平仓的幸存者偏差。

## 4. Token 与额度方案

**Qwen 推理 token 和本次 Codex 工作额度分开治理；本报告未测出节省结果。** 以下比例是待验证目标。

- Qwen：沿用已有 [decisionContext 去重](https://github.com/3684993/ZDJMITS/blob/4473a6f59f132eddb35fd3cca2ddf8e6fa7bdf8a/apps/engine/src/services/decisionContext.ts)，补齐持仓/记忆/经济计划版本与风险变化的失效条件；无新事实不重新调用。公共 BTC/ETH 资料按时间版本复用，记忆只传 Top-3 摘要，数值计算交给代码。
- 不发送整本交易账和重复市场 JSON；输入预算必须保留必要风险事实。现有 Primary/Scout 建仓输出上限为 900/600，外部研究为 900，不机械再砍；先消除重复调用、冗余字段，截断仍应拒绝下单。
- 建立按角色、任务类型的输入/输出 token、失败重试、缓存命中及每个有效计划成本；外部研究也纳入统一计量。模型不可用或预算不足时拒绝新增计划，TP/对账继续。
- 验收目标：同一冻结回放集总 token 较基线减少 **30%**，同时决策契约通过率不降低、漏风险不增加、样本外净收益不劣化；不达标就保留必要上下文。
- Codex 工作流：以本文为固定索引，每轮只给一个 PR 范围、差异与验收结果；脚本产出一次摘要，长日志存文件按需读取，避免重复全库扫描与反复生成长报告。未来持续监控采用确定性采集器，仅异常需解释时调用模型；**这些措施减少消耗，不承诺恢复或无限扩展额度**。

## 5. 设置与菜单精简

建议常用入口为：**总览、持仓、交易记录、AI 决策、设置**。候选池/时序/情报归入“研究”，订单/人工接管并入持仓的子页，记忆并入交易记录与 AI 决策交叉入口，运维保留独立高级入口。

- 旧方向偏好、方向覆盖：先移至“兼容配置（不控制当前 AI 方向）”，撤掉误导性可操作入口；确认没有执行/迁移消费者后才删除字段。
- 设置归为“风险与授权、交易计划、模型与预算、连接与运维、外观”；每项显示当前有效值、来源、实际消费者、生效时点。SHADOW 标明“仅评估，不执行经济准入否决”，不能把开关展示成已强制生效。
- 可清理候选：无消费者的重复 lifecycle 发布、未接发布点的死探针、重复页面、旧兼容控件。先补真实观测，再删除死探针；先做依赖检查与迁移，再删模块。
- 保留：TP、对账、人工接管、交易事实、记忆、出口闸、审计记录。主题等纯展示功能低优先级；删菜单不会减少模型 token，需切断实际重复调用才能节省。

## 6. 实施顺序与验收门槛

每步独立小 PR；本次只提出方案。涉及运行版本切换时，必须另获用户对具体 Engine 生命周期动作的指令。

| 顺序 | 实施位置与动作 | 完成标准 |
|---|---|---|
| 1：修基线阻断 | `reconciliationService / entryRiskOccupancy`：解决七天悬崖，区分已证终局与证据不足；持久保存身份/证据，迟到事实重开审计。collector 修小时率、Primary 故障规则、指标时效与事件留存 | 覆盖七天前后、重启恢复、迟到成交、证据断档；缺证据不能仅因超龄释放风险。重放假警与漏警样本均得正确结果；未修前继续 SHADOW |
| 2：建立收益真值 | `tradeRecordSync/Integrity、ExperienceService、capital epoch`：补 funding、费用、账户基准、UNKNOWN 分母；分开人工与系统交易 | 收益样本可逐笔对账；未知项明确保留；资金变动不伪装交易收益。历史无证据区间不制造 epoch 或净利 |
| 3：计划契约与计算器 | `contracts/ai、compactEntry、economicEntryFeasibility、preAiExecutionEnvelope`：增加数量依据、情景 EV、期限/复核与证据版本 | 每笔 PLACE 有完整可计算计划；超额/过期/不存在的证据全拒绝；低成本只在合理目标可达时成立；方向不由容量驱动 |
| 4：复核与记忆反馈 | `positionLifecycle、tpGuardian、experienceService、eipService`：成交回填、到期复核、Top-3 记忆及当前持仓摘要 | 任一交易能追溯原计划与实际结果；TP 回退不覆盖原始预测；未知净利不入收益统计；复核不引入自动亏损退出 |
| 5：双模型与 UI/预算 | `aiFabric、decisionContext、SettingsView、navigation`：9B 事件研究/反证，27B 计划；去重、统一 token 台账、有效设置映射 | 模型角色可观测；节省目标在冻结回放上验证；每个可编辑设置有实际消费者或明确兼容标签；旧字段迁移回读一致 |
| 6：验证后逐级放行 | 时间切分回放→SHADOW→用户授权的隔离 Testnet canary→新的完整 24h soak | 无未来数据泄漏；新旧同样本比较净收益/回撤/持仓时长/目标兑现率/token；真实放行链完整，风险硬门全过，blockers 有事实依据解除，才讨论扩大权限 |

**验证约束：**回放须覆盖不同市场状态，并将重叠持仓窗口隔离；纳入未成交和未平仓，禁止只挑盈利样本。建议先收集至少 100 个完整闭环作工程评估，盈利判断仍取决于有效独立样本和置信区间；净 EV 区间跨零则结论是证据不足。16–20 次 canary 只证明流程，不证明盈利；Testnet 的成交与流动性也不能直接证明实盘收益。

**优先级明确：先可对账，再可规划，再可学习，最后提高自主权限。** `/order` 请求绝对量暂不作为优化目标；先修 UNKNOWN 正确性及可归因性。不放宽 cap 掩盖阻断，不为通过验收调整收益门槛。
