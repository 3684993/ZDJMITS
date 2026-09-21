# S07：双模型有限复核、交易记忆与 token 预算

状态 NOT_STARTED；主实施 terra；luna 可实现统一用量台账和独立检索夹具。前置 S04、S06；后继 S08、S09。重点 AI1–AI3、ST3，涉及 I01/I05/I06/I08/I09。

## 入口与范围

已有 services/{aiFabric,decisionContext,experienceService,eipService,externalIntelligenceService,researchBrainPolicy,brainRunArchive,positionLifecycleTracker}.ts；adapters/ai/OpenAiCompatibleClient.ts；core/{compactEntry,aiPrompts}.ts。

拟新增 positionReviewScheduler.ts、tradeMemoryRetriever.ts、aiUsageLedger.ts。先做检索/评估与有限复核，不做在线训练、自动改风控或无限 agent 工具循环。

## 实施步骤

1. **S07-A 事实事件队列。** 27B 新仓计划、已有 AI 仓复核、9B 研究分任务类型；已有仓必要复核优先，研究最低。确定性到期/阈值/TP 维护不依赖模型队列。
2. 合并同事实触发，键含 plan/owner/position/settings/risk/evidence/memory 版本；价格跨关键谓词阈值可失效，不能只等下一根 K 线。缓存事实摘要不缓存可写授权。调用前后验证 owner，人工仓拒绝例行任务。
3. **S07-B 双模型职责。** 9B 输出来源、缺口、反证和匹配记忆；27B 独立判断 HOLD/EXIT_PROPOSAL/HANDOFF。9B 非权威方向、无订单权限；必要事实可由代码直接处理时不调模型。
4. 每份 plan 设置预算（候选初值：2 正常+1 异常复核，需回放确认），记录已用/待运行/失败次数。预算耗尽不跳过到期交接、不扩预算；模型失败不触发 Engine 恢复或市场单。
5. **S07-C 记忆。** S01 修过的净利润真值作为收益样本；对所有原始 cycle 保留原计划、净值路径、退出/接管、MFE/MAE、资金占用、最终结局和人工新增行为。未闭合是右删失/未完成状态，不作成功样本。
6. 同方向×形态×波动×期限×流动性检索，Top-3 覆盖正反案例；不足则明示零/少样本，不能强凑 3 条。去除相同周期/重复成交，避免相邻重叠样本虚增独立样本量。
7. **S07-D 归因。** 分开原决策全过程经济结果、交接时盯市贡献、人工后续增量；交接不是实现损益。以同一 cutover mark 和费用分配桥接；人工新增风险独立子记录，与原仓退出区分。
8. **S07-E token 台账。** 入口包括 ENTRY/REVIEW/SCOUT/EXTERNAL_RESEARCH、失败/重试；保存输入/输出/服务端未报告的 UNKNOWN 用量、延迟、截断、promptHash、触发原因、cacheHit。缺 usage 不造 0。
9. 公共 BTC/ETH/事件摘要共享按版本引用，必要风险字段不能裁剪。输出截断仍 fail closed；不要只降低 900/600 上限求节省。连续失效外部材料可隔离，不允许其指挥工具或改变系统规则。

## 必测矩阵

| ID | 场景 | 预期 |
|---|---|---|
| S07-T01 | HUMAN/HANDOFF_PENDING 的定时扫描 | 零例行模型调用，私有事实/TP 不受影响 |
| S07-T02 | 模型运行中发生交接/到期 | 丢弃可写建议，原回答只存审计 |
| S07-T03 | 同事实重复事件/模型重试 | 去重且受预算限制，不能无限消耗 |
| S07-T04 | 风险/成本/记忆版本变化 | 缓存正确失效，不复用过期授权 |
| S07-T05 | funding UNKNOWN、重复记录、未平仓深亏 | 不进入已实现收益分母，不隐藏原周期 |
| S07-T06 | 全赢家样本但存在匹配失败 | 检索可见反例与样本覆盖，不有意挑赢 |
| S07-T07 | 交接后人工加仓/最终大亏 | 原仓与人工新增可桥接，AI 账不洗白 |
| S07-T08 | 输出 length/usage 缺失/外部注入 | 无下单、用量 UNKNOWN 可见、越权指令无效 |
| S07-T09 | 模型全离线/预算耗尽 | deadline 照常交接，无 Engine 自动重启 |

## 量化验收

冻结相同候选/持仓事件回放，比较 token、调用次数、有效计划成本、review 延迟/漏事件、契约通过率与退出质量。目标总 token 较完整计量基线下降 ≥30%，同时硬风险漏检为 0、schema 通过率不降低，经济非劣需 S09 置信区间判断。预算不同、样本不同不能宣称节省。

不得把人工仓移出账户指标来降低调用数/提高收益。模型版本、quantization、server/context/prompt、seed 能获取则记录；不可复现部分明确写出。

## 验收/回退/移交

ACCEPTED：人工零例行推理、有限复核、费用/失败归因、用量覆盖与边界测试通过。若净收益样本不足，记忆功能可工程验收，但不宣称有效提升盈利。

回退停新 review 授权，保留 durable deadline/handoff；不能退成无限期 AUTO。移交 S08：只读计划/复核/记忆/用量 API；S09：消融四组、冻结 prompts、事件及用量 manifest。
