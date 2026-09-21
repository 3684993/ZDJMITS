# S05：组合与尾部风险、人工承载能力

状态 NOT_STARTED；主实施 terra；luna 做冻结数据的展示/报告。前置 S01、S02；后继 S06、S09。重点 RI1–RI4，将历史 5/20 的缺口变为可测约束。涉及 I02/I05/I06/I07/I08。

## 文件与目标

已有 packages/core/src/{capitalAdmission,portfolio}.ts；engine services/{preAiExecutionEnvelope,executableRiskHeadroom,economicEntryFeasibility,entryRiskOccupancy,liveValidationService}.ts；contracts/riskGovernance.ts、settings.ts；runtime/appRuntime.ts。

拟新增 portfolioRiskSnapshot.ts、portfolioStress.ts、humanCapacityPolicy.ts（位置按现有层次调整）。纯计算置 core，运行事实聚合置 engine；仅一个权威准入/预留服务，禁止另造互相矛盾的余额。

## 分步实现

1. **S05-A 全账户真源。** 用 S01 可验证余额/净值/资金流和全部 AI、人工、待交接仓位建立风险快照；合并 pending entry、reservation 和 UNKNOWN，按身份去重。已平仓未确认状态仍保守占用；不能直接相加三份同一订单风险。
2. 币种保证金分别计算，USDC/USDT 按已知转换及可用权限区分；多资产保证金/交叉模式未支持要明确阻断，不偷偷用 USDT 总余额近似。
3. **S05-B 聚合与关联。** 同 underlying 合约统一暴露，保留 LONG/SHORT 毛额与净额；相关簇采用版本化映射/滚动历史，历史缺失用保守分组，不当独立资产。压力情景相关性趋同，不能因平时相关系数小而无限分散开仓。
4. **S05-C 压力预算。** 构建价格单边/跳空、深度收缩、价差/资金费变坏、mark-basis 变化与交易所不可用情景，输出每仓和账户压力损失、保证金消耗、清算缓冲、资金占用。使用交易所当前风险档位/模式，缺维持保证金信息不能宣称清算安全。
5. 不设置“看起来安全”的固定倍数。风险档案包含 maxCapitalAtRisk、maxDrawdown、maxStressLoss、gross/direction/cluster limits、margin/liq buffer、human count/notional/pending/ack age；每项单位、适用模式、事实来源和违规动作明确。未配置的关键限额拒绝新风险；离线 fixture 有显式测试值但不写默认实盘值。
6. **S05-D 人工容量。** 人工/待交接全部计入风险。新仓事前预留潜在交接容量；首版可每个 AI 仓按最坏情况占一个潜在交接名额，之后只有足够数据才引入概率预算。过量人工积压或确认过期时停止新 entry，不停止保护，不自动平掉深亏仓。
7. **S05-E 原子 JIT。** 初筛给出两侧最大合法数量；entry 提交时按最新 riskGeneration 再验并原子 claim 保证金/敞口。多候选并发只允许在真实剩余额度内通过；任务 UNKNOWN 不释放预留。
8. 上限变严立即缩小新增授权；变宽不追认旧 AI 计划。记录 limitingConstraints 与事实版本，WAITING_EXECUTION_CAPACITY 改为可区分资金/方向/人工/数据/槽位原因。

## 人工响应与风险动作

默认违规动作是拒绝新增风险、撤销尚未提交的新 entry 授权、告警/交接。原已存在风险仍需监测；本阶段不增加深亏自动退出或自动资金调拨。账户隔离、补保证金权限与值守安排作为 S10 外部准入证据。

不把“最大亏损 10”用于定义账户压力上限。若人工长期失联，系统可停止继续扩张，但不能以此声明已有风险封顶。

## 必测矩阵

| ID | 场景 | 预期 |
|---|---|---|
| S05-T01 | AI→人工/待交接，无数量变动 | 全账户暴露/资金占用不下降 |
| S05-T02 | 同 underlying 两种报价、同一 pending 与 reservation | underlying 合并、相同风险只计一次 |
| S05-T03 | 多候选同时使用旧 generation | 原子预留无双花；后到者重验或拒绝 |
| S05-T04 | 相关性升至同向、跳空/资金费/深度变坏 | 压力损失上升，准入按预算收紧 |
| S05-T05 | 报价/汇率/保证金档位缺失 | 数据不完整拒绝新风险，不编造安全结论 |
| S05-T06 | 人工待办爆满/8h 未响应 | 阻断新仓但私有事实和保护继续 |
| S05-T07 | 大额存款掩盖日回撤 | 流量调整净值与 drawdown 口径正确 |
| S05-T08 | 减仓成交/未成交/UNKNOWN | 只有真实风险减少才能释放对应额度 |

性质测试：扩大风险或收紧预算不得提高 allowed capacity；转人工不能降低总压力风险；风险场景可重算且相同 hash 结果一致。

## 验收与移交

RI 提分证据须包含真实基准事实或明确标记的冻结模拟数据、全部压力场景、被拒绝的候选与原因。不能只展示新仪表盘。

回退保留原风险门并关闭新放行路径；新门若更严格但不能准确归因，修复读模型而非关闭风控求通过。移交 S06：双侧数量上限/约束来源/期限资本代价；S09：冻结风险档案与无人响应情景；S10：待用户确定的资本和人类安排。
