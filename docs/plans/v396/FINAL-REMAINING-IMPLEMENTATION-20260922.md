# V3.9.6 剩余实施闭环计划

审计代码基线 abc158c；整体 NOT_ACCEPTED。此计划替代“各原语通过即全部完成”的解释，不改变 CONTRACTS/I01–I12，不启用 AI exit，不执行现网操作。

| 顺序 | 对应规格 | 交付 | 必须验证 |
|---|---|---|---|
| J1 | S02/S03/S04 | 持续退出事实、旧单接入、真实成本与 JIT | 原 ID 恢复、撤权竞态、期限/价格/数量/版本漂移、部分成交取消 |
| J2 | S01/S05 | 单一权威组合准入与原子预留 | 新鲜快照、同 underlying/簇/保证金币种、UNKNOWN、人工容量与极端场景 |
| J3 | S06 | 原始不可变 TradePlan + q/T 候选 | 不能编造概率、不能为了净利地板扩仓、三种期限分离 |
| J4 | S07 | 有限 review、usage 台账、交易记忆 | 人工零调用、前后撤权、失败计预算、未知 usage、负例和删失 |
| J5 | S08 | 设置/API/UI/迁移回退矩阵 | 每字段真消费者、有效值回读、旧仓不扩权、备份恢复一致 |
| J6 | S09/S10 | 冻结回放/统计与发布包 | 全组结果、时序防泄漏、全账户净值、token 对照、真实运行另授权 |

## J1 退出真源和持续收敛（先红测）

文件：v396ExitRuntime、reconciliationService、tpGuardian、manualPositionService、appRuntime、ownershipRuntime、s03ExitCostEstimator、cycleAccounting。

1. 复现当前仅 startup 调 `convergeRecoveredExits` 的缺口：订单运行后真实 terminal，claim 不得永久卡在 WORKING。新增基于确证事件的消费或有界低频 exact query；并发去重、超时保留、账户隔离，不增加无界轮询。
2. 旧已有 TP/人工单先验证身份/实际数量，再纳入同一协调域；没 clientOrderId/周期/覆盖则保守阻断新增减仓，保护告警可见。不得先发另一张 TP 再补 ledger。
3. 实际 fee/funding/成本版本读取，拒绝把 UNKNOWN 人工估值零当 S03 ALLOW。当前 syntheticVerdict 仅保留 MANUAL/TP 维护适用范围，严禁复用于 AI。
4. FIRST_FILL→固定 deadline→owner 到期撤权→outbox，迟到 fill 不续期，人工不自动回收。expiry 与 graceDeadline 独立。
5. 测试：取消与成交竞态、部分填单后确认取消、旧单恢复、回执丢失、重启只查询、人工改价/撤销发生在最后一次 await 期间。没有证据不得释放 claim。

完成：实际消费者的 G2 矩阵有行为测试，不以源码字符串包含函数名代替。

## J2 组合准入（依赖 J1 的风险身份）

文件：portfolioRiskSnapshot、portfolioStress、humanCapacityPolicy、RuntimeState.reserveEntry、SettingsStore、entryCoordinator、capitalAdmission。

1. 真账户资产、持仓、订单/预留、ownership、保证金档位、现金流建立版本化 snapshot；缺档位/汇率/覆盖明确 incomplete。保留 UNKNOWN 敞口，区分账面余额和可用保证金，禁止重复扣同一占用。
2. profile 所有限额/单位显式配置；不自动填写可交易数值。candidate 加入后的压力、簇/方向/人工潜在接管容量统一评估。
3. 将快照 hash/riskGeneration/fact coverage/freshness 绑定到 C2 同一事务；预检查不占资金，JIT 重验后才 claim。不能沿用 selection generation 冒充风险版本。
4. 先测“两候选共用旧版本只一单获批”、人工接管风险不减、缺手工确认时间拒新仓但保护继续；再更新 s05ConsumerBoundary 的实际单一消费者白名单。不得只删边界测试。

完成：S05-T01–T08、生产 EntryCoordinator 拒绝/放行及 durable 恢复证据齐全，G3 才可复审。

## J3 交易计划（依赖 J2）

文件：contracts/ai 与新 tradePlanSchema、quantityHorizonCandidates、tradePlanEvaluator；aiFabric、entryCoordinator、positionLifecycleTracker。

1. 模型仅选择系统生成候选与安全谓词；引用必须匹配币种、闭合 K 线、版本/时效。WAIT quantity=0；不因另一侧容量更大翻转方向。
2. q/T/目标每个组合给完整成本、压力、资金占用和统计来源；targetConditionalNetProfit 与 expectedNetPnlAtHorizon 分开；没概率/经济样本不能默认 50% 或用 confidence 替代。
3. entry TTL、目标期限、管理期限分字段。原计划持久化先于 reservation；成交关联实际价/量/成本差异，不改原预测。
4. S06-T01–T09 与从模型输出到 intent/fill 的集成测试；新经济 ENFORCE 在证据不足时拒绝。

## J4 复核/token/记忆（依赖 J1/J3）

文件：新增 positionReviewScheduler、aiUsageLedger、tradeMemoryRetriever；OpenAiCompatibleClient、aiFabric、experienceService、brainRunArchive。

1. 调用前原子占 review/失败预算；触发键含全部相关版本；回调后再校验 owner/deadline，迟到建议只审计。
2. ENTRY/REVIEW/SCOUT/EXTERNAL_RESEARCH 每次调用、重试、失败全记账；没有服务端 usage 即 UNKNOWN，不能零填；不只做汇总函数。
3. HUMAN/HANDOFF_PENDING 零例行模型任务，但 deadline/对账/TP 不依赖模型；断网/预算耗尽照常交接。
4. 原 cycle 正负案例、未闭合右删失、人工后续增量保留；Top-3 不足明确不足，拒绝重复与只选赢家。
5. 同一冻结事件集比较 token，目标 ≥30% 降低且无风险漏检；未跑前只写 NOT_MEASURED。S07-T01–T09 全部具实际消费者证据。

## J5 设置和可操作性（依赖 J2–J4）

文件：contracts/settings、runtimeSettingsResources、API router、SettingsView/PositionsView/TradeRecordsView/MemoryView/BrainView、PositionConsole、settingsStore。

1. 字段清单覆盖 schema/default/API/持久化/消费者/单位/生效时点/回读；`humanHandoffAfterMinutes` 先接 deadline 真消费者再开放编辑。
2. 新增独立 AI minNetProfit/maxRealizedLoss 权限字段；旧 TP 的 0.15 按 0.15% 解释，禁止隐式转成 15%；不放宽旧 TP floor 代替新政策。
3. 页面显示实际 owner/version、原计划/预算/UNKNOWN/接管 ack/维护授权；人工操作后服务端回读，不伪造 FILLED。废模块先证明无消费者/无必要事实再移除。
4. 完整临时数据库 preview→迁移→读回→恢复/重跑；测试新任务阻止不兼容旧写入器，不覆盖现网库。

## J6 实验和发布（依赖 J1–J5）

文件：隔离 replay runner、成本/事件模拟器、实验 manifest、结果生成器、release manifest/migration preview/canary plan。

1. 冻结 availableAt、训练/验证/样本外边界、费用/滑点/funding 与人工延迟。所有消融组预注册；未平仓浮亏、深亏、下架、先强平后触达都纳入。
2. 分层报告收益/回撤/尾部/占用、bootstrap 区间和全部失败结果；区间跨零或成本不全保持 INSUFFICIENT_EVIDENCE，不能调整判据换 PASS。
3. 生成 build/source/settings/prompt/schema/实验 hash，统一真实 package 版本；具体手动发布与回退命令仅作为待授权材料，不执行。
4. 离线工具完成与真实经济证据分别裁决。canary/部署/Engine 生命周期/现网迁移逐项需具体授权；24h 不满则 PENDING_WINDOW_INCOMPLETE。

## 共同提交门

每 J：红测证据→源码→定向→Engine 全仓/关联 workspace→typecheck/build→S00→diff check→独立 commit；原历史与 PR #9 不改，只 fast-forward push。未知外部事实不伪造。最终逐项更新 20 项评分和六个硬门，不在任务未闭环时签 ACCEPTED。
