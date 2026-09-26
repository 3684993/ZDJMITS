import type { SystemSettings } from '@zdj/contracts';

/**
 * S08: the one place that says what a governance setting means.
 *
 * A settings blob can be validated by zod and still be useless to an operator: zod proves a number
 * is in range, not that the number is a percentage, that it takes effect on the next decision rather
 * than after a restart, or that anything reads it at all. Each row here carries the unit, the
 * effective moment and the named runtime consumer, and `s08GovernanceMatrix.test.ts` fails when a
 * consumer it names cannot be found in the source - so the matrix cannot quietly turn into a list of
 * settings that look configurable and do nothing.
 */

export type GovernanceKind = 'boolean' | 'integer' | 'number' | 'enum';
export type GovernanceUnit = 'USD' | 'MS' | 'MINUTES' | 'SECONDS' | 'COUNT' | 'PERCENT' | 'PERCENT_OF_MARGIN' | 'RATIO' | 'FLAG' | 'ENUM' | 'VERSION';
/** When a saved value is actually observable in behaviour. Never "eventually". */
export type GovernanceEffectiveAt = 'NEXT_MODEL_DECISION' | 'NEXT_ENTRY_CYCLE' | 'NEXT_TICK' | 'NEXT_EXIT_ATTEMPT' | 'IMMEDIATE' | 'RUNTIME_RESTART_REQUIRED';

export type GovernanceField = {
  path: string;
  kind: GovernanceKind;
  unit: GovernanceUnit;
  defaultValue: unknown;
  min?: number;
  max?: number;
  enum?: readonly string[];
  /** What the number authorises, in one line the operator can read without opening code. */
  meaning: string;
  /** `file#symbol` for every runtime reader. A field with no consumer is not editable. */
  consumers: readonly string[];
  editable: boolean;
  /** Set when writing needs an explicit acknowledgement, and what string that is. */
  ack?: string;
  /**
   * The values that actually need the acknowledgement. `aiExitAuthority` is acknowledged when it is
   * set to ENFORCE, not when it moves between the two tiers that submit nothing, because a guard that
   * fires on every change trains an operator to click through the one that matters.
   */
  ackOnlyFor?: readonly unknown[];
  readOnlyReason?: string;
  effectiveAt: GovernanceEffectiveAt;
};

const EXIT = 'riskGovernance.exitCoordination';
const RISK = 'riskGovernance';
export const PORTFOLIO_RISK = 'riskGovernance.portfolioRisk';

export const V396_GOVERNANCE_FIELDS: readonly GovernanceField[] = [
  { path: `${EXIT}.aiExitAuthority`, kind: 'enum', enum: ['OFF', 'SHADOW', 'ENFORCE'], unit: 'ENUM', defaultValue: 'OFF', editable: true,
    ack: 'AI_EXIT_ENFORCE_AUTHORITY', ackOnlyFor: ['ENFORCE'], effectiveAt: 'NEXT_EXIT_ATTEMPT',
    meaning: 'AI 退出权限档位。OFF 不判定；SHADOW 只记录；ENFORCE 才允许 AI 触发 reduce-only 限价平仓，必须由操作者显式确认。',
    consumers: ['services/v396ExitRuntime.ts#authority', 'services/aiExitAuthority.ts#AiExitAuthorityService', 'runtime/appRuntime.ts#aiExitAuthority'] },
  { path: `${EXIT}.aiExitLossLimitUsd`, kind: 'number', unit: 'USD', min: 0, max: 10, defaultValue: 10, editable: true, effectiveAt: 'NEXT_EXIT_ATTEMPT',
    meaning: '单周期 AI 已实现净亏损许可线（USDT）。这是 AI 失去决定权的线，不是账户亏损上限；人工接管不受它约束。',
    consumers: ['services/v396AiExitRunner.ts#lossLimit', 'services/entryCoordinator.ts#maxRealizedLossUsd', 'services/s03AiExitPolicy.ts#decideAiExit'] },
  { path: `${EXIT}.aiExitMinNetProfitUsd`, kind: 'number', unit: 'USD', min: 0.001, max: 1000, defaultValue: 0.2, editable: true, effectiveAt: 'NEXT_EXIT_ATTEMPT',
    meaning: 'AI 自己的最小净收益许可线（USDT）。它与计划利润地板同时生效、取更高者；TP 经济地板不会被当作 AI 权限复用。',
    consumers: ['services/s03AiExitPolicy.ts#aiFloorMilli', 'services/v396AiExitRunner.ts#minNetProfitUsd'] },
  { path: `${EXIT}.aiExitAllowSmallLoss`, kind: 'boolean', unit: 'FLAG', defaultValue: false, editable: true, effectiveAt: 'NEXT_EXIT_ATTEMPT',
    meaning: '是否允许 AI 在计划失效时做小额亏损平仓。默认关闭：关闭时任何 net<0 的 AI 平仓被拒绝。',
    consumers: ['services/s03AiExitPolicy.ts#allowSmallLoss', 'services/v396AiExitRunner.ts#allowSmallLoss'] },
  { path: `${EXIT}.aiExitAuthorizationTtlMs`, kind: 'integer', unit: 'MS', min: 1000, max: 30000, defaultValue: 15000, editable: true, effectiveAt: 'NEXT_EXIT_ATTEMPT',
    meaning: '一次 AI 平仓授权从签发到失效的毫秒窗口；过期后必须重新判定，不能沿用旧 verdict。',
    consumers: ['services/s03AiExitPolicy.ts#authorizationTtlMs'] },
  { path: `${EXIT}.continuousConvergenceEnabled`, kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '是否持续收敛未确认的退出任务（用交易所事实平账，不重新下单）。关闭只会让待查任务滞留，不会取消保护。',
    consumers: ['services/v396ExitRuntime.ts#convergenceDue', 'runtime/appRuntime.ts#convergeExitsPeriodically'] },
  { path: `${EXIT}.convergenceIntervalMs`, kind: 'integer', unit: 'MS', min: 30000, max: 3600000, defaultValue: 120000, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '两次收敛扫描之间的最小间隔，同时决定单次查询的尝试窗口。',
    consumers: ['services/v396ExitRuntime.ts#convergePeriodically'] },
  { path: `${EXIT}.convergenceBatchLimit`, kind: 'integer', unit: 'COUNT', min: 1, max: 20, defaultValue: 8, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '一轮收敛最多查询多少笔在途退出，限制私有请求配额。',
    consumers: ['services/v396ExitRuntime.ts#convergePeriodically'] },
  { path: `${EXIT}.positionReviewEnabled`, kind: 'boolean', unit: 'FLAG', defaultValue: false, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: 'AI 管理周期的例行复核总开关。默认关闭时 tick 不读任何状态、不发任何模型请求。',
    consumers: ['services/positionReviewRunner.ts#tick'] },
  { path: `${EXIT}.normalReviewsPerPlan`, kind: 'integer', unit: 'COUNT', min: 0, max: 6, defaultValue: 2, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '每份计划例行的模型复核次数上限（不含谓词触发的例外复核）。',
    consumers: ['services/positionReviewScheduler.ts#reserve'] },
  { path: `${EXIT}.exceptionReviewsPerPlan`, kind: 'integer', unit: 'COUNT', min: 0, max: 3, defaultValue: 1, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '谓词触发时可追加的例外复核次数。',
    consumers: ['services/positionReviewScheduler.ts#reserve'] },
  { path: `${EXIT}.reviewFailureBudget`, kind: 'integer', unit: 'COUNT', min: 1, max: 6, defaultValue: 2, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '连续/累计失败多少次后停止对该计划的复核。用尽只停推理，不停 deadline、TP 扫描、对账或交接。',
    consumers: ['services/positionReviewScheduler.ts#reserve'] },
  { path: `${EXIT}.reviewMinIntervalMs`, kind: 'integer', unit: 'MS', min: 30000, max: 3600000, defaultValue: 300000, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '两次复核之间的最小间隔；也是复核回答可作为退出证据的时限。',
    consumers: ['services/positionReviewScheduler.ts#reserve', 'runtime/appRuntime.ts#maxAgeMs'] },
  { path: `${EXIT}.reviewAuthorityTtlMs`, kind: 'integer', unit: 'MS', min: 1000, max: 120000, defaultValue: 20000, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '一次复核授权的有效窗口；窗口外返回的回答只归档，不可作为证据。',
    consumers: ['services/positionReviewScheduler.ts#reserve', 'services/positionReviewScheduler.ts#accept'] },

  { path: `${RISK}.entrySafetyMode`, kind: 'enum', enum: ['SAFETY_REVIEW_PAUSED', 'SHADOW', 'SHADOW_READY', 'AUTO'], unit: 'ENUM', defaultValue: 'SAFETY_REVIEW_PAUSED', editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '入场安全评审阶段档位。', consumers: ['services/runtimeControlService.ts#entrySafetyMode'] },
  { path: `${RISK}.protectionMode`, kind: 'enum', enum: ['OFF', 'SHADOW', 'REQUIRED'], unit: 'ENUM', defaultValue: 'SHADOW', editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '入场前保护性证据校验档位。', consumers: ['services/entryCoordinator.ts#protectionMode'] },
  { path: `${RISK}.requirePostAiVerification`, kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: false, effectiveAt: 'NEXT_ENTRY_CYCLE',
    consumers: [], readOnlyReason: '生产代码里没有读取这个开关的位置（只有页面与默认值文件带着它）。在没有消费者之前不得通过治理接口修改，否则页面会显示一个不起作用的承诺。',
    meaning: 'AI 结论之后是否仍要求确定性复核（当前无消费者）。' },
  { path: `${RISK}.failClosedOnMissingEvidence`, kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '证据缺失时是拒绝还是放行。', consumers: ['services/entryCoordinator.ts#failClosedOnMissingEvidence'] },
  { path: `${RISK}.requiredEvidenceCompleteness`, kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0.92, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '入场要求的证据完整度比例。', consumers: ['services/entryCoordinator.ts#requiredEvidenceCompleteness'] },
  { path: `${RISK}.maxConcurrentReservations`, kind: 'integer', unit: 'COUNT', min: 1, max: 100, defaultValue: 6, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '同时在途的入场预留上限。', consumers: ['services/preflightFeasibility.ts#maxConcurrentReservations', 'state/runtimeState.ts#maxConcurrentReservations'] },
  { path: `${RISK}.reservationTtlSeconds`, kind: 'integer', unit: 'SECONDS', min: 30, max: 3600, defaultValue: 300, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '单笔预留的存活秒数。', consumers: ['state/runtimeState.ts#entryReservations'] },
  { path: `${RISK}.lockLeaseSeconds`, kind: 'integer', unit: 'SECONDS', min: 15, max: 3600, defaultValue: 120, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '标的排他锁租约秒数。', consumers: ['state/runtimeState.ts#underlyingLocks'] },
  { path: `${RISK}.perTradeRiskPctEquity`, kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0.01, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '单笔风险占权益比例（0.01 = 1%）。UI 以百分数展示，落库仍为比例。',
    consumers: ['services/executableRiskHeadroom.ts#perTradeRiskPctEquity', 'services/riskReadiness.ts#perTradeRiskPctEquity'] },
  { path: `${RISK}.maxGrossExposurePct`, kind: 'number', unit: 'RATIO', min: 0.0001, max: 20, defaultValue: 1, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '总敞口上限（比例，1 = 100%）。', consumers: ['services/executableRiskHeadroom.ts#maxGrossExposurePct', 'services/riskReadiness.ts#maxGrossExposurePct'] },
  { path: `${RISK}.maxDirectionExposurePct`, kind: 'number', unit: 'RATIO', min: 0.0001, max: 20, defaultValue: 0.5, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '单向敞口上限。', consumers: ['services/executableRiskHeadroom.ts#maxDirectionExposurePct', 'services/riskReadiness.ts#maxDirectionExposurePct', 'packages/core/src/portfolio.ts#maxDirectionExposurePct'] },
  { path: `${RISK}.exposureCapacityPolicy.gross`, kind: 'enum', enum: ['ENFORCE', 'OBSERVE'], unit: 'ENUM', defaultValue: 'ENFORCE', editable: true,
    ack: 'EXPOSURE_CAPACITY_OBSERVE', ackOnlyFor: ['OBSERVE'], effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '总名义敞口比例是硬门（ENFORCE）还是只观测的组合事实（OBSERVE）。OBSERVE 只取消该比例的否决权，金额、杠杆、维持保证金/强平距离、单风险、cluster、槽位、JIT 与 PortfolioRisk 压力继续硬约束；比例本身仍按 equity×上限计算并展示。',
    consumers: ['services/executableRiskHeadroom.ts#exposureCapacityPolicy', 'services/riskReadiness.ts#exposureCapacityPolicy'] },
  { path: `${RISK}.exposureCapacityPolicy.direction`, kind: 'enum', enum: ['ENFORCE', 'OBSERVE'], unit: 'ENUM', defaultValue: 'ENFORCE', editable: true,
    ack: 'EXPOSURE_CAPACITY_OBSERVE', ackOnlyFor: ['OBSERVE'], effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '单向敞口比例的否决权开关，语义同上；驾驶舱展示的 LONG/SHORT 上限始终等于 equity×maxDirectionExposurePct。',
    consumers: ['services/executableRiskHeadroom.ts#exposureCapacityPolicy', 'services/riskReadiness.ts#exposureCapacityPolicy'] },
  { path: `${RISK}.exposureCapacityPolicy.cluster`, kind: 'enum', enum: ['ENFORCE', 'OBSERVE'], unit: 'ENUM', defaultValue: 'ENFORCE', editable: true,
    ack: 'EXPOSURE_CAPACITY_OBSERVE', ackOnlyFor: ['OBSERVE'], effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '相关性集中度（cluster 与 cluster×方向）是否仍然一票否决。默认 ENFORCE：这是组合集中度事实，不是资金余额。',
    consumers: ['services/executableRiskHeadroom.ts#exposureCapacityPolicy'] },
  { path: `${RISK}.maxDailyLossUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '账户日亏损停机线（账户级，不同于 AI 的单周期平仓许可）。', consumers: ['services/runtimeControlService.ts#maxDailyLossUsd'] },
  { path: `${RISK}.maxDailyLossPct`, kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '账户日亏损停机比例线。', consumers: ['services/runtimeControlService.ts#maxDailyLossPct'] },
  { path: `${RISK}.circuitBreakerEnabled`, kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '风险熔断开关。', consumers: ['services/runtimeControlService.ts#circuitBreakerEnabled'] },

  { path: `${PORTFOLIO_RISK}.configured`, kind: 'boolean', unit: 'FLAG', defaultValue: false, editable: true, ack: 'PORTFOLIO_RISK_PROFILE_ENABLED',
    ackOnlyFor: [true], effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '组合风险准入总开关。开启前必须先把所有限额填成真实值，否则新风险一律被拒（这是设计行为，不是故障）。',
    consumers: ['services/portfolioRiskLedger.ts#RISK_PROFILE_UNCONFIGURED', 'runtime/appRuntime.ts#refreshCashFlowFacts'] },
  { path: `${PORTFOLIO_RISK}.maxCapitalAtRiskUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '组合在险资本上限。0 表示没有额度。', consumers: ['services/portfolioStress.ts#maxCapitalAtRiskUsd'] },
  { path: `${PORTFOLIO_RISK}.maxGrossNotionalUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '组合总名义上限。', consumers: ['services/portfolioStress.ts#maxGrossNotionalUsd'] },
  { path: `${PORTFOLIO_RISK}.maxDirectionNotionalUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '单向名义上限。', consumers: ['services/portfolioStress.ts#maxDirectionNotionalUsd'] },
  { path: `${PORTFOLIO_RISK}.maxClusterNotionalUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '相关簇名义上限。', consumers: ['services/portfolioStress.ts#maxClusterNotionalUsd'] },
  { path: `${PORTFOLIO_RISK}.maxStressLossUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '压力情景可承受损失上限。', consumers: ['services/portfolioStress.ts#maxStressLossUsd'] },
  { path: `${PORTFOLIO_RISK}.maxDrawdownPct`, kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '组合回撤比例上限。', consumers: ['services/portfolioStress.ts#maxDrawdownPct'] },
  { path: `${PORTFOLIO_RISK}.minMarginBufferPct`, kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '维持保证金之上要求的最小缓冲比例。', consumers: ['services/portfolioStress.ts#minMarginBufferPct'] },
  { path: `${PORTFOLIO_RISK}.minLiquidationBufferPct`, kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '强平价之外要求的最小距离比例。', consumers: ['services/portfolioStress.ts#minLiquidationBufferPct'] },
  { path: `${PORTFOLIO_RISK}.maxHumanPositions`, kind: 'integer', unit: 'COUNT', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '人工管理持仓占用的槽位上限（AI 新风险的容量由此扣减）。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },
  { path: `${PORTFOLIO_RISK}.maxHumanNotionalUsd`, kind: 'number', unit: 'USD', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '人工管理名义占用上限。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },
  { path: `${PORTFOLIO_RISK}.maxPendingHandoffs`, kind: 'integer', unit: 'COUNT', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '待人工接手的周期数量上限。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },
  { path: `${PORTFOLIO_RISK}.maxAckAgeMs`, kind: 'integer', unit: 'MS', min: 0, defaultValue: 0, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '人工接手确认允许的滞留毫秒数。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },
  { path: `${PORTFOLIO_RISK}.snapshotTtlMs`, kind: 'integer', unit: 'MS', min: 5000, max: 120000, defaultValue: 20000, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '一份组合风险快照可授权下单的时长。', consumers: ['services/portfolioRiskLedger.ts#RISK_TICKET_EXPIRED'] },
  { path: `${PORTFOLIO_RISK}.maintenanceMarginRatePct`, kind: 'number', unit: 'RATIO', min: 0, max: 0.2, defaultValue: null, editable: false,
    readOnlyReason: '这是保证金档位数据集的派生事实：只能由服务端从已提交的档位表算出（取可达档位的最大值，不可证时取全部已覆盖档位的最大值）。改这一个数字就等于用一个字符串冒充已证明的档位，写入必须随档表走专用 authority commit。', effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '所用保证金档位的维持保证金比例（0.01 = 1%）。null 表示档位未证明，此时新风险被拒。',
    consumers: ['services/portfolioRiskLedger.ts#maintenanceMarginRatePct'] },
  { path: `${PORTFOLIO_RISK}.cashFlowWindowMs`, kind: 'integer', unit: 'MS', min: 60000, max: 604800000, defaultValue: 86400000, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '外部出入金覆盖窗口。', consumers: ['runtime/appRuntime.ts#cashFlowFacts'] },
  { path: `${PORTFOLIO_RISK}.cashFlowMaxAgeMs`, kind: 'integer', unit: 'MS', min: 60000, max: 3600000, defaultValue: 900000, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '出入金读数可继续授权的最长陈旧时间。', consumers: ['runtime/appRuntime.ts#cashFlowFacts'] },
  { path: `${PORTFOLIO_RISK}.marginTierVersion`, kind: 'enum', unit: 'VERSION', defaultValue: '', editable: false, readOnlyReason: '档位表是操作者提供的数据集，不是数值开关；写入必须随该档表一起走离线校验，避免页面改一个字符串就冒充已证明。', effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '保证金档位表版本标识。', consumers: ['services/portfolioRiskLedger.ts#MARGIN_TIER_UNPROVEN'] },
  { path: `${PORTFOLIO_RISK}.correlationVersion`, kind: 'enum', unit: 'VERSION', defaultValue: '', editable: false, readOnlyReason: '同上：相关性版本必须指向真实计算过的相关性矩阵。', effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '相关性矩阵版本标识。', consumers: ['services/portfolioRiskLedger.ts#CORRELATION_VERSION_UNPROVEN'] },
  { path: `${PORTFOLIO_RISK}.scenarioVersion`, kind: 'enum', unit: 'VERSION', defaultValue: '', editable: false, readOnlyReason: '情景集与版本号必须一同提交，防止只改名不换内容。', effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '压力情景集合版本标识。', consumers: ['services/portfolioRiskLedger.ts#STRESS_SCENARIO_SET_UNPROVEN'] },
  { path: `${PORTFOLIO_RISK}.scenarios`, kind: 'enum', unit: 'ENUM', defaultValue: [], editable: false, readOnlyReason: '情景数组需要整体校验，不走单字段补丁通道。', effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '压力情景集合。', consumers: ['services/portfolioStress.ts#scenarios'] },
  { path: `${PORTFOLIO_RISK}.clusters`, kind: 'enum', unit: 'ENUM', defaultValue: {}, editable: false, readOnlyReason: '簇映射需要整体校验。', effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '相关簇归属表。', consumers: ['services/portfolioStress.ts#clusters'] },

  { path: 'positionManagement.humanHandoffAfterMinutes', kind: 'integer', unit: 'MINUTES', min: 1, max: 525600, defaultValue: 1440, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: 'AI 管理一个周期的最长时限（分钟），FIRST_FILL 时写进 durable owner deadline；到期后 AI 失去决定权、转人工。',
    consumers: ['runtime/appRuntime.ts#fixCycleDeadline', 'services/entryCoordinator.ts#managementDurationMs'] },
  { path: 'positionManagement.lossHandoffBars', kind: 'integer', unit: 'COUNT', min: 1, max: 96, defaultValue: 4, editable: true, effectiveAt: 'NEXT_TICK',
    meaning: '连续亏损多少根已闭合 K 线后触发人工交接。', consumers: ['services/lossHandoff.ts#lossHandoffBars'] },
  { path: 'positionManagement.humanManagedAdmissionCapsEnabled', kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '人工管理持仓是否扣减 AI 新风险的容量。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },
  { path: 'positionManagement.maxHumanManagedPositions', kind: 'integer', unit: 'COUNT', min: 1, max: 100, defaultValue: 4, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '人工管理持仓数量上限。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },
  { path: 'positionManagement.maxHumanManagedNotionalPctEquity', kind: 'number', unit: 'RATIO', min: 0.01, max: 5, defaultValue: 0.2, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE',
    meaning: '人工管理名义占权益比例上限。', consumers: ['services/humanCapacityPolicy.ts#evaluateHumanCapacity'] },

  { path: 'takeProfit.minNetProfitUsd', kind: 'number', unit: 'USD', min: 1, max: 20, defaultValue: 1, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: 'TP 经济地板的绝对下限（USDT）。这是计划侧利润地板，不是 AI 的平仓许可；两者在退出时取更高者。',
    consumers: ['packages/core/src/tradingCost.ts#requiredNetProfit', 'services/quantityHorizonCandidates.ts#requiredNetProfit'] },
  { path: 'takeProfit.minNetProfitRoiPct', kind: 'number', unit: 'PERCENT_OF_MARGIN', min: 0, max: 100, defaultValue: 0.15, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: 'TP 经济地板按保证金计的收益率下限，单位是百分数本身：0.15 表示 0.15%，不是 15%。计算里除以 100。',
    consumers: ['packages/core/src/tradingCost.ts#minNetProfitRoiPct'] },
  { path: 'takeProfit.tpEconomicsEnabled', kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: false, effectiveAt: 'NEXT_MODEL_DECISION',
    consumers: [], readOnlyReason: '生产代码里没有读取这个开关的位置（只有页面与默认值文件带着它）：TP 经济地板目前无条件参与计算，关掉它的开关不存在。',
    meaning: '是否按经济地板计算 TP 目标（当前无消费者）。' },
  { path: 'takeProfit.exitFeeAssumption', kind: 'enum', enum: ['MAKER', 'TAKER'], unit: 'ENUM', defaultValue: 'TAKER', editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '经济地板计算采用的平仓费率假设。', consumers: ['services/tpGuardian.ts#exitFeeAssumption', 'services/v396AiExitRunner.ts#exitFeeAssumption'] },
  { path: 'takeProfit.feeSafetyBufferPct', kind: 'number', unit: 'PERCENT', min: 0, max: 100, defaultValue: 10, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '费用安全缓冲百分比。', consumers: ['packages/core/src/tradingCost.ts#feeSafetyBufferPct'] },
  { path: 'takeProfit.slippageBufferPct', kind: 'number', unit: 'PERCENT', min: 0, max: 100, defaultValue: 0, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '滑点缓冲百分比。', consumers: ['services/tpGuardian.ts#slippageBufferPct', 'services/quantityHorizonCandidates.ts#slippageBufferPct'] },
  { path: 'tradeEconomics.admissionMode', kind: 'enum', enum: ['OFF', 'SHADOW', 'ENFORCE'], unit: 'ENUM', defaultValue: 'SHADOW', editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '经济可达性在入场侧的执行档位；ENFORCE 时证据不足必须拒绝，SHADOW 只记录未证明。',
    consumers: ['services/quantityHorizonCandidates.ts#enforceEconomics', 'services/economicEntryFeasibility.ts#admissionMode'] },
  { path: 'tradeEconomics.minHistoricalReachProbability', kind: 'number', unit: 'RATIO', min: 0, max: 1, defaultValue: 0.5, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '历史可达概率要求。', consumers: ['services/quantityHorizonCandidates.ts#reachability'] },
  { path: 'tradeEconomics.historicalTpReachabilityEnabled', kind: 'boolean', unit: 'FLAG', defaultValue: true, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '是否启用历史 TP 可达性统计。', consumers: ['services/quantityHorizonCandidates.ts#reach'] },
  { path: 'tradeEconomics.reachabilityLookbackBars', kind: 'integer', unit: 'COUNT', min: 30, max: 300, defaultValue: 120, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '可达性统计回看 K 线数。', consumers: ['services/quantityHorizonCandidates.ts#reach'] },
  { path: 'tradeEconomics.reachabilityMinSamples', kind: 'integer', unit: 'COUNT', min: 10, max: 250, defaultValue: 30, editable: true, effectiveAt: 'NEXT_MODEL_DECISION',
    meaning: '可达性统计最少样本数；不足时不得给出概率。', consumers: ['services/quantityHorizonCandidates.ts#sampleCount'] },
] as const;

/** Namespaces the governance matrix owns. A change inside one of these must be a listed field. */
export const GOVERNANCE_NAMESPACES = ['riskGovernance.', 'positionManagement.', 'tradeEconomics.', 'takeProfit.'] as const;

const BY_PATH = new Map(V396_GOVERNANCE_FIELDS.map(field => [field.path, field]));

export function governanceFieldOf(path: string) { return BY_PATH.get(path) ?? null; }

const leaves = (value: unknown, prefix = ''): Array<[string, unknown]> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => leaves(item, prefix ? `${prefix}.${key}` : key))
    : [[prefix, value]];

export function isGovernancePath(path: string) { return GOVERNANCE_NAMESPACES.some(namespace => path.startsWith(namespace)); }

/** Every governance leaf whose value differs, compared by identity then by serialised value. */
export function changedGovernancePaths(before: SystemSettings, after: SystemSettings): string[] {
  const prior = new Map(leaves(before as never).filter(([path]) => isGovernancePath(path)));
  const next = leaves(after as never).filter(([path]) => isGovernancePath(path));
  const changed: string[] = [];
  for (const [path, value] of next) {
    const old = prior.get(path);
    if (old === undefined && !prior.has(path)) { changed.push(path); continue; }
    if (JSON.stringify(old) !== JSON.stringify(value)) changed.push(path);
  }
  for (const [path] of prior) if (!next.some(([candidate]) => candidate === path)) changed.push(path);
  return [...new Set(changed)].sort();
}

type Refusal = { path: string; code: string; detail: string };

export function validateGovernanceValue(field: GovernanceField, value: unknown): string | null {
  if (field.kind === 'boolean') return typeof value === 'boolean' ? null : `GOVERNANCE_TYPE_BOOLEAN_REQUIRED:${field.path}`;
  // An enum is validated by membership, not by range: `configured` and the version strings are text
  // fields as far as the matrix is concerned, and demanding a number from them would be a bug here.
  if (field.kind === 'enum') return value === undefined || value === null ? `GOVERNANCE_VALUE_MISSING:${field.path}` : null;
  const numeric = typeof value === 'number' && Number.isFinite(value);
  if (!numeric) return `GOVERNANCE_TYPE_NUMBER_REQUIRED:${field.path}`;
  if (field.kind === 'integer' && !Number.isSafeInteger(value)) return `GOVERNANCE_INTEGER_REQUIRED:${field.path}`;
  if (field.min !== undefined && Number(value) < field.min) return `GOVERNANCE_BELOW_MINIMUM:${field.path}=${value}<${field.min}`;
  if (field.max !== undefined && Number(value) > field.max) return `GOVERNANCE_ABOVE_MAXIMUM:${field.path}=${value}>${field.max}`;
  return null;
}

/**
 * Whether writing this new value needs an explicit acknowledgement: a change of authority, or a
 * percentage that is exactly one hundred times the value on screen. The second case is the single
 * most expensive unit confusion this system can have - `0.15` means 0.15%, and reading it as 15%
 * would move every take-profit target by two orders of magnitude without any type error appearing.
 */
export function governanceRequiresAck(field: GovernanceField, before: unknown, after: unknown): boolean {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  if (field.ack) return !field.ackOnlyFor || field.ackOnlyFor.some(value => JSON.stringify(value) === JSON.stringify(after));
  return field.unit === 'PERCENT_OF_MARGIN' && typeof before === 'number' && before > 0
    && typeof after === 'number' && Math.abs(after - before * 100) < Number.EPSILON * 100;
}

/**
 * Applies a patch of governance fields, all or nothing.
 *
 * A value that is exactly one hundred times the one on screen is refused until it is acknowledged,
 * because `0.15` meaning 0.15% is the single most expensive unit confusion this system can have: it
 * would quietly move every take-profit target two orders of magnitude.
 */
export function applyGovernancePatch(settings: SystemSettings, patch: Record<string, unknown>, options: { acks?: readonly string[] } = {}): { settings: SystemSettings; applied: string[]; refusals: Refusal[] } {
  const next = structuredClone(settings) as any, acks = new Set(options.acks ?? []), refusals: Refusal[] = [], applied: string[] = [];
  for (const [path, value] of Object.entries(patch ?? {})) {
    const field = BY_PATH.get(path);
    if (!field) { refusals.push({ path, code: 'GOVERNANCE_FIELD_UNSUPPORTED', detail: '该路径不在治理字段矩阵中，不接受写入。' }); continue; }
    if (!field.editable) { refusals.push({ path, code: 'GOVERNANCE_FIELD_READ_ONLY', detail: field.readOnlyReason ?? '只读字段。' }); continue; }
    if (field.kind === 'enum' && field.enum && !field.enum.includes(String(value))) {
      refusals.push({ path, code: 'GOVERNANCE_ENUM_UNSUPPORTED', detail: `${String(value)} 不是允许值：${field.enum.join('|')}` }); continue;
    }
    const invalid = validateGovernanceValue(field, value);
    if (invalid) { refusals.push({ path, code: invalid.split(':')[0], detail: invalid }); continue; }
    const current = readPath(settings, path);
    if (governanceRequiresAck(field, current, value)) {
      if (field.unit === 'PERCENT_OF_MARGIN' && !acks.has('PERCENT_UNIT_INTENDED')) {
        refusals.push({ path, code: 'GOVERNANCE_UNIT_REQUIRES_CONFIRMATION',
          detail: `${path} 的单位是百分数本身（0.15 表示 0.15%）。新值恰为当前值 ${(current as number)}% 的 100 倍，若确实要改成 ${Number(value)}%，请带 ack=PERCENT_UNIT_INTENDED 重发。` });
        continue;
      }
      if (field.ack && !acks.has(field.ack)) {
        refusals.push({ path, code: 'GOVERNANCE_ACK_REQUIRED', detail: `${path} 改变权限边界，写入必须携带 ack=${field.ack}。` });
        continue;
      }
    }
    writePath(next, path, value);
    applied.push(path);
  }
  if (refusals.length) return { settings, applied: [], refusals };
  return { settings: next as SystemSettings, applied, refusals };
}

export function readPath(settings: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), settings);
}
function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.'), last = keys.pop()!;
  const holder = keys.reduce<Record<string, unknown>>((node, key) => {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    return node[key] as Record<string, unknown>;
  }, target);
  holder[last] = value;
}

/** The operator readback: what is set, in what unit, when it takes effect, and who reads it. */
export function governanceReadback(settings: SystemSettings) {
  return V396_GOVERNANCE_FIELDS.map(field => {
    const value = readPath(settings, field.path);
    return { path: field.path, value: value ?? null, kind: field.kind, unit: field.unit, min: field.min ?? null, max: field.max ?? null,
      enum: field.enum ?? null, default: field.defaultValue, meaning: field.meaning, effectiveAt: field.effectiveAt, editable: field.editable,
      ack: field.ack ?? null, ackOnlyFor: field.ackOnlyFor ?? null, readOnlyReason: field.readOnlyReason ?? null, consumers: [...field.consumers],
      atDefault: JSON.stringify(value ?? null) === JSON.stringify(field.defaultValue ?? null) };
  });
}
