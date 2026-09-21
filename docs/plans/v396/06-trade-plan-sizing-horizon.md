# S06：可验证交易计划、数量与持仓期限

状态 NOT_STARTED；主实施 terra；luna 做协议示例/拒绝原因 UI 夹具。前置 S03、S05；后继 S07。重点 AI1、ST3、EX3；涉及 I04/I05/I08/I09。

## 入口与边界

已有 contracts/ai.ts；core/compactEntry.ts、aiPrompts.ts、eip.ts；engine services/{aiFabric,aiQuantityAllocation,preAiExecutionEnvelope,economicEntryFeasibility,historicalTpReachability,entryCoordinator}.ts。

S02 PlanIdentity 保持兼容；拟新增 tradePlanSchema / tradePlanEvaluator / quantityHorizonCandidates。不能把模型生成 JSON 直接当执行授权，也不能替换其独立选边为“哪侧额度多选哪侧”。

## 实施子任务

1. **S06-A 契约。** TradePlan 引用系统生成身份；模型只输出决策字段、候选 ID、必要参数、短理由和证据。必填双向结论、选边、quantityUnits、目标/范围、期限、结构化失效谓词、反证、数据/记忆引用；拒绝/WAIT 不携带可执行数量。
2. 严格分开 entry TTL、target horizon、management deadline。允许的持仓期限档位来自数据/风险支持；firstFillAt 后固化硬期限，模型无续期字段。不可变原计划与后续 review 追加保存。
3. **S06-B 计算候选。** 用 S05 数量上限、交易所 filters 与 S03 成本生成若干合法 q/T/目标组合。记录每个组合的边际风险、资金占用、到目标条件净利、预期损益分布及约束。不可满足最小订单则 NO_TRADE，不扩大 q 凑利润地板。
4. q 候选是风险/经济可行集合，27B 自选数量并解释；若需要自行选择集合内整数单位，必须重新确定性计算。不得 confidence×仓位，也不得悄悄按方向偏好二次改量。
5. **S06-C 经济语义。** 保留 targetConditionalNetProfit，与 expectedNetPnlAtHorizon 分开命名。历史触达率仅是一项证据；新增触达前最大逆向波动、触达时间、到期盯市、不触达/清算情景、成本/funding；样本不足则状态明确。
6. 概率来自冻结统计器/校准模型而非 LLM 自报。数据不足时不假定 50%；新经济 ENFORCE 功能拒绝不可验证计划，SHADOW 仅记录“未证明”，不得误标 passed。
7. **S06-D 证据验证。** 校验引用存在、时效、适用 symbol/timeframe、数值约束；原始外部文本不允许指令注入。谓词仅允许安全 DSL 枚举，禁止 eval 任意模型表达式；短文本理由供审计，不声称机器已证明所有自然语言逻辑。
8. **S06-E 提交闭环。** 在 entryCoordinator 保存原计划→获取原子 reservation→实际价格 JIT 重验→记录 executedPlanDiff。成交回填真实价格/费用，不能改原始预测以匹配结果；TP 回退另记 source/reason。

## 失效谓词设计

允许预注册比较：特定已闭合 K 线价格穿越计划阈值、特定结构证据不再成立、已知事件证据失效、计划时间到期。每个谓词有 observedAt、有效窗口、阈值来源与确认要求。暂时浮亏不自动等于失效，谓词不允许交易后重写。

模型选 WAIT 时给可机读 release condition；缓存命中需事实版本仍有效。失效谓词的动作是触发 S03 判定或交接，不是直接平仓。

## 测试清单

| ID | 场景 | 预期 |
|---|---|---|
| S06-T01 | 一侧容量为 0 但市场论点偏该侧 | 不自动翻转方向，输出不可执行原因 |
| S06-T02 | 最小 q 无利润可行组合 | NO_TRADE，不扩仓或外推目标 |
| S06-T03 | 模型 confidence 高、概率缺数据 | 不替代概率，ENFORCE 拒绝 |
| S06-T04 | 有效 ID 但过期/其它币/未闭合 bar | 校验拒绝或标明不可用，不能冒充支持证据 |
| S06-T05 | 目标触达前深度逆向/先清算 | 不能只记 TP 成功 |
| S06-T06 | TTL/目标期限/管理期限混填 | schema/语义检查拒绝 |
| S06-T07 | 成交偏价、TP 变源、部分成交 | 保留原预测与差异，重新核实授权不扩权 |
| S06-T08 | 模型输出超量/延期/任意代码谓词 | 严格拒绝，无工具或执行权限 |
| S06-T09 | 同一冻结事实反复评估 | 计算部分一致，模型不确定性单独记录 |

复用 aiQuantityAllocation、economicEntryFeasibility、historicalTpReachability、entryCoordinator、aiFabric 测试，新增契约负例，不只验证 happy path。

## 验收与交接

验收：每个 PLACE 可复算 q/成本/时间/风险；非 PLACE 无执行残留；原计划到 intent/fill/TP 关联完整。不得以返回 JSON 可解析代替决策质量。

新协议默认影子验证，旧功能回退不重新解释新授权；跨版本 plan 只能只读，不交旧模型执行。移交 S07：review 输入快照、谓词/记忆引用；S09：固定基线协议与模型消融输出。
