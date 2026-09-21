# 公共契约与不变式：V396-C1

状态：拟议规格，未实现。所有阶段必须使用同一语义。接口字段名可在 S00 转为正式 schema，但任何语义变更须先更新本文件并由总设计审查；不能靠强制类型转换或默认值吞掉差异。

## 1. 标识、数值和时间

- `ExecutionScope = environment + accountId + symbol + positionSide`，复用现有 executionScope 的规范化方式；One-way 真实净仓域为 BOTH，不能人为拆成多/空两把锁。
- `cycleId` 表示原始开仓周期；人工接管、部分成交、重新授权不能重置原损益周期。仓位变为零后新开仓才创建新周期。
- `TradePlan.planId/planVersion` 由系统创建，模型不得自行生成可用授权；`positionVersion/ownerVersion/settingsVersion/riskGeneration` 由事实服务维护。
- 金额内部采用经评审的十进制精度策略，qty 用交易所 step 整数单位；禁止用浮点 epsilon 让超过亏损线变成允许。金额币种必须显式标明，USDC 不能无条件视为 USDT。
- 所有时间 UTC epoch ms；UI 可显示本地时区。决策数据包含 observedAt/availableAt/expiresAt，回放只能读取当时已可得事实。运行授权用单调时钟防回拨，持久期限用绝对时间且重启不能延长；时钟异常拒绝新授权并报警。

## 2. 事实与完整性

`FactStatus = EXACT | CONSERVATIVE_BOUND | UNKNOWN | CONFLICT`。带 sourceIds、asOf、coverageStart/End、完整分页/同步状态与币种。EXACT 零值需要完整覆盖证据；UNKNOWN 不默认 0，CONFLICT 不挑有利值。

账本与决策估值不同：账本只把可证明事实记 EXACT；有保守误差界的估值可用于策略判断，但保留界限与来源，不写成真实成交净利。关键事实无可用界时，AI 退出和新风险计划均拒绝；确定性对账/保护路径继续其既有安全规则。

UNKNOWN 订单的事实状态与风险状态分离。新拟议风险状态 `UNRESOLVED / CURRENT_NO_ACTIVE_RISK / DURABLE_TERMINAL_PROVEN / CONFLICT` 不直接覆盖原 exchange status。`CURRENT_NO_ACTIVE_RISK` 依赖有时效的账户同步和身份无冲突；`DURABLE_TERMINAL_PROVEN` 需要正向终局证据。七天前的短期无风险缓存、仅 -2013 或仅超龄均不足以推导永久终局。

## 3. 最小计划信封（S02 消费，S06 扩展）

```text
PlanIdentity {
  schemaVersion, planId, planVersion, cycleId, scope,
  settingsVersion, createdAt, firstFillAt|null,
  managementDurationMs, aiManagementDeadline|null,
  exitPolicySnapshot, provenanceHash
}
```

S02 可使用夹具 PlanIdentity，不等待 S06 模型功能；真实新 AI 管理授权仍关闭。截止时间在首笔成交时固化，后续补成交不延长。截止时间未知不允许 AI_ACTIVE。S06 TradePlan 增加双向结论、结构化失效谓词、quantityUnits、经济情景、目标/复核、记忆引用；不得重定义上述字段。

`entryAuthorizationExpiry`、`targetHorizonMinutes` 和 `aiManagementDeadline` 是三种独立约束。目标期限不是强制成交承诺；AI 管理截止时间是授权结束。

## 4. 管理权与维护权

`OwnershipRecord {scope, cycleId, ownerState, ownerVersion, planRef, transitionedAt, reason, acknowledgedAt|null}`。

- ownerState：AI_ACTIVE、HANDOFF_PENDING、HUMAN_MANAGED、CLOSED。
- 执行状态：NONE、EXIT_PENDING、UNKNOWN、TERMINAL；事实完整性另外记录。
- 所有权 CAS 变更、撤权事实与通知 outbox 同一事务提交；通知失败不能回滚撤权。
- 维护权 `ProtectionMandate {scope,cycleId,version,source,allowedPrice,allowedQuantityRule,revokedAt}` 独立于 AI 决策权。HUMAN 不代表 Guardian 自动获得改价权限。
- `now >= deadline` 禁止新 AI 指令；已在交易所的单先查实再撤。人工确认只是已阅；恢复 AI 需要新授权，禁止循环自动回收。

## 5. 成本与权限返回值

```text
ExitEstimate {
  scope, cycleId, positionVersion, costVersion, quoteAt, expiresAt,
  remainingQuantityUnits, grossRealizedToDate,
  incurredFees, signedFunding, projectedExitGross, projectedExitFee,
  uncertaintyBuffer, netIfAllClosed, factsStatus, sourceIds
}
AiExitVerdict {
  outcome: ALLOW | HOLD | HANDOFF | BLOCKED_FACTS,
  reasonCodes[], evidenceRefs[], ownerVersion, planVersion,
  estimateHash, authorizationExpiresAt, boundaryPrice|null
}
```

`netIfAllClosed = grossRealizedToDate + projectedExitGross − incurredFees − projectedExitFee + signedFunding − uncertaintyBuffer`。入场费及历史退出费在 incurredFees 只计一次；buffer 不与已在价格情景体现的同一滑点重复扣。净亏损阈值按原周期累计，不用其他仓收益抵扣。

判定优先级：CLOSED/人工/owner 不符→拒绝；到期→HANDOFF；关键事实未知→BLOCKED_FACTS；净退出估值低于 -L→HANDOFF；结构化论点失效且 -L≤N<0 且允许小亏→ALLOW；N≥微利门槛且获利退出条件成立→ALLOW；其余 HOLD。事实未知持续到冻结的 factsGraceDeadline 时由确定性服务交接，不能无界等待。

L 来自已授权计划与当前更严格上限的最小值；微利门槛取两者更严格值。默认设计 L=10，allowSmallLossExit=true，feature 状态仍 OFF；默认值不为旧仓生成新权限。报价与预算在提交前重验。

## 6. 执行授权和任务日志

`ExitAuthorization {scope,cycleId,ownerVersion,planVersion,positionVersion,settingsVersion,riskGeneration,estimateHash,maxQuantityUnits,limitPrice,expiresAt,idempotencyKey}`。

拟议统一任务状态：PREPARED→SUBMITTING→WORKING/PARTIALLY_FILLED→FILLED/CANCELED/REJECTED/EXPIRED；网络不确定转 UNKNOWN。先持久化幂等任务和数量 claim，再发交易所请求，永不把超时当作未提交。

同 scope 的 TP、人工与 AI 退出共享实际数量预算；改价和撤单也受域协调。One-way 可用适配器支持的 reduce-only；Hedge 按官方约束处理 positionSide/方向/数量，不假设同一参数通用。并发安全不是只加内存 mutex，需持久 claim、版本复验和恢复对账。

新 AI 路径默认关闭；现有 TP/人工路径接入协调器须保持已授权行为。禁止因全局禁止新 entry 而停止 TP 维护；也禁止以“保护”为名绕过现有出口/环境闸。

模型计划/退出建议与短期可执行授权是两个对象：模型完成后先用最新事实计算合法授权，不能要求一分钟前提示词的盘口版本一直不变；一旦生成可执行授权，其绑定版本变化就拒绝该授权，由既定策略重新评估，不能偷偷修改价格/数量继续发单。riskGeneration 应跟踪相关风险事实的实质变化，不因轮询时间戳自身变化而递增。

## 7. 组合快照与准入

`PortfolioRiskSnapshot {riskGeneration,asOf,expiresAt,equity,freeMargin,positions,reservations,unknownClaims,humanBook,clusterExposure,stressResults,coverage}`。

仓位按实际净仓聚合，订单/预留通过共同身份去重；UNKNOWN 占用不重复且不忽略。转人工保持资金占用。保证金币种逐一核算；估值无法转换则数据不完整。

`AdmissionVerdict {allowed,reasonCodes,riskGeneration,maxQuantityUnitsBySide,limitingConstraints,reservationToken|null}`。预检查不预支资金；提交前由一个事务/串行权威进行 JIT 复验并占用，禁止两个候选使用同一旧 riskGeneration 双花额度。

## 8. 事件、存储与证据

共同事件信封：eventId、schemaVersion、type、occurredAt、persistedAt、scope、cycleId、planId、ownerVersion、causationId、correlationId、source。先提交事实再消费事件；允许至少一次投递，消费者必须幂等。

关键类型：OWNERSHIP_CHANGED、HANDOFF_CREATED、HANDOFF_ACKNOWLEDGED、AI_EXIT_EVALUATED、EXIT_TASK_UPDATED、PROTECTION_MANDATE_CHANGED、PORTFOLIO_ADMISSION_EVALUATED、TRADE_PLAN_CREATED、POSITION_REVIEW_COMPLETED、ACCOUNTING_RECONCILED。实现时需检查同义现有事件，采用版本化扩展而非双写刷量。

交易计划、ownership、执行任务与会计事实是持久真源，不能只依赖有容量上限的 runtime_events。活动记录及所需身份墓碑禁止被通用清理删除；所有新表/字段迁移登记、备份验证、兼容读取，不做自动破坏性降级。

## 9. 必守不变式编号

| ID | 不变式 |
|---|---|
| I01 | 人工/超期/旧版本不得产生新 AI 策略写 |
| I02 | 未证实撤销或未成交不得释放数量/风险 claim |
| I03 | 主动减仓不得超量或成为反向新增风险 |
| I04 | 10 USDT 权限按原周期累计，不拆单/重授权重置 |
| I05 | UNKNOWN 不充当零值、终局、成功或样本盈利 |
| I06 | 人工交接不释放账户风险、不擦除原决策损益 |
| I07 | 新风险准入与保护维护隔离；现有环境/出口闸不绕过 |
| I08 | 模型无自行改期限、杠杆、数量授权或风险配置权 |
| I09 | 回放只使用当时可得事实；测试集不得参与调参 |
| I10 | Engine 生命周期与交易启用均需各自明确授权 |
| I11 | 所有减仓采用持久幂等、同域协调与恢复复验 |
| I12 | 设置显示、服务端有效值、执行消费者和版本可对应 |

各阶段必须在交付中引用涉及的不变式和测试 ID；有冲突先修契约，禁止工程师各自定义。
