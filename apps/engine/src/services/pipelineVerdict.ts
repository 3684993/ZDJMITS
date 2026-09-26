/**
 * G4: one authoritative answer to "what is stopping a new Entry right now, and what should the operator do".
 *
 * The Engine already folds its pipeline facts into a single `noEntryReason`; this service keeps that chain as
 * the only precedence source and adds the two things the cockpit was inventing on its own: the stage the code
 * came from, the next action that matches it, and an explicitly subordinate diagnostic list. A page renders
 * what is returned here — it must not rank the same facts a second time.
 */
export type PipelineVerdict = {
  code: string;
  stage: 'PERMISSION' | 'RUNTIME_CONTROL' | 'MARKET_DATA' | 'EXECUTION_FACTS' | 'CAPACITY' | 'SUPPLY' | 'POSITION_SLOTS' | 'IN_FLIGHT' | 'RISK_ADMISSION' | 'MODEL' | 'NONE';
  nextAction: string;
  evidence: Record<string, unknown>;
  /** Lower-level facts about the same cycle. Never presented as a second first cause. */
  secondary: Array<{code: string; detail: string}>;
  evaluatedAt: number;
};

type VerdictFacts = {
  now: number;
  noEntryReason: string | null;
  pipelineState?: string | null;
  marketDataReason?: string | null;
  marketIsolation?: {candidateCount: number; isolatedCount?: number; healthyCandidates: number; isolated?: Array<{symbol: string; reasons: string[]}>} | null;
  executionReadiness?: {mode?: string; ready?: boolean; firstBlocker?: string | null; blockers?: string[]} | null;
  capacityVisibility?: {firstBlocker?: string | null; exhaustedForNewRisk?: boolean; exhaustedReason?: string | null; sideStatus?: {code?: string; text?: string} | null} | null;
  slots?: {used: number; max: number} | null;
  eligibility?: {status?: string; count?: number} | null;
  executableCandidateCount?: number | null;
  poolStatus?: string | null;
  analysisReason?: string | null;
  idleReason?: string | null;
  pendingEntries?: number | null;
  maxPendingEntries?: number | null;
  freshMarkets?: {status?: string; stale?: string[]; sequenceInvalid?: number} | null;
  /** Problem A: the deterministic admission refusal of the newest Entry cycle, already age-bounded. */
  riskAdmission?: {at: number; symbol: string; stage: string; code: string; reasons: string[]; limits: string[]; ageMs: number} | null;
};

const STAGE_BY_CODE: Record<string, PipelineVerdict['stage']> = {
  SCHEDULER_STOPPED: 'PERMISSION', ENTRY_PAUSED_MANUAL: 'PERMISSION', MANUAL_PAUSE: 'PERMISSION',
  PAUSED_MANUAL: 'PERMISSION', PAUSED_NO_CAPITAL: 'RUNTIME_CONTROL', PAUSED_NO_EXECUTABLE_CONTRACT: 'RUNTIME_CONTROL',
  PAUSED_DAILY_RISK_LIMIT: 'RUNTIME_CONTROL', PAUSED_MARKET_DATA_UNAVAILABLE: 'MARKET_DATA',
  MARKET_QUOTES_STALE: 'MARKET_DATA', MARKET_TECHNICAL_STALE: 'MARKET_DATA', MARKET_WS_BACKOFF: 'MARKET_DATA', MARKET_WS_TLS_CERT_MISMATCH: 'MARKET_DATA',
  EXECUTION_BLOCKED: 'EXECUTION_FACTS', PRIVATE_DATA_UNAVAILABLE: 'EXECUTION_FACTS', RISK_PROFILE_UNCONFIGURED: 'EXECUTION_FACTS',
  EXECUTION_WRITE_LOCKED: 'EXECUTION_FACTS', CAPACITY_BLOCKED: 'CAPACITY', GROSS: 'CAPACITY', DIRECTION_LONG: 'CAPACITY', DIRECTION_SHORT: 'CAPACITY',
  BOTH_DIRECTIONS: 'CAPACITY', AVAILABLE_MARGIN: 'CAPACITY', POSITION_CAPACITY_FULL: 'POSITION_SLOTS',
  ENTRY_BACKPRESSURE: 'IN_FLIGHT', POOL_SUPPLY_SHORTAGE: 'SUPPLY', POOL_REFILL_FAILURE: 'SUPPLY', POOL_EMPTY_MARKET_DEGRADED: 'SUPPLY',
  POOL_EMPTY_ALL_COOLDOWN: 'SUPPLY', POOL_EMPTY_NO_ELIGIBLE: 'SUPPLY', POOL_EMPTY_ALL_EXCLUDED: 'SUPPLY', POOL_REFILLING: 'SUPPLY',
  WAITING_EXECUTION_CAPACITY: 'CAPACITY', MIN_EXECUTABLE_CANDIDATES_NOT_MET: 'SUPPLY',
  PRIMARY_MODEL_OFFLINE: 'MODEL', PRIMARY_MODEL_HEALTH_UNKNOWN: 'MODEL', ENTRY_BLOCKED: 'EXECUTION_FACTS',
};

const NEXT_ACTION: Record<PipelineVerdict['stage'], (facts: VerdictFacts, code: string) => string> = {
  PERMISSION: () => '等待人工恢复 Entry 权限；不自动重启、不改阈值换取放行',
  RUNTIME_CONTROL: (facts) => `等待运行控制恢复：${facts.noEntryReason ?? 'PAUSED'}；持仓、止盈与对账继续运行`,
  MARKET_DATA: (facts) => `恢复行情数据源后继续：${facts.marketDataReason ?? facts.noEntryReason ?? 'MARKET_DATA'}；已隔离的 symbol 单独补数据，不牵连同市场其余候选`,
  EXECUTION_FACTS: (facts) => {
    const blocker = facts.executionReadiness?.firstBlocker ?? facts.noEntryReason ?? 'EXECUTION_FACTS';
    return `先补齐执行事实 ${blocker}；在事实齐备前不调用模型、不提交订单`;
  },
  CAPACITY: (facts) => {
    const exhausted = facts.capacityVisibility?.exhaustedReason ?? facts.capacityVisibility?.firstBlocker ?? 'CAPACITY';
    return `新增风险受限于 ${exhausted}；只能由人工减仓或经 governance 写入调整权威上限，不静默放宽`;
  },
  SUPPLY: (facts) => `等待合格候选供给（${facts.poolStatus ?? facts.noEntryReason ?? 'SUPPLY'}）；不为凑数放宽资格或行情事实`,
  POSITION_SLOTS: (facts) => `持仓槽位 ${facts.slots?.used ?? 0}/${facts.slots?.max ?? 0} 已满；只能人工释放槽位，不自动减仓`,
  IN_FLIGHT: (facts) => `在途建仓 ${facts.pendingEntries ?? 0}/${facts.maxPendingEntries ?? 0} 已达上限；等待在途订单收敛或终态确认，不并发追加`,
  MODEL: (facts) => `恢复 Primary 模型可用性（${facts.noEntryReason ?? 'MODEL'}）；模型不可用时不猜测方向、不消费额度`,
  RISK_ADMISSION: (facts) => {
    const refusal = facts.riskAdmission;
    const reasons = (refusal?.reasons ?? []).length ? (refusal?.reasons ?? []).join(' · ') : refusal?.code ?? 'RISK_ADMISSION';
    return `确定性风险门拒绝新增风险（${refusal?.symbol ?? '候选'}：${reasons}）；只能由人工减少已有敞口，或经 governance 写入调整权威上限。不放宽阈值、不重启流程、不再调用模型换取放行`;
  },
  NONE: () => '无需处理：Entry 管线可用，继续由确定性硬门决定是否建仓',
};

/** The single authoritative verdict for one pipeline cycle, with everything else demoted to diagnostics. */
export function authoritativePipelineVerdict(facts: VerdictFacts): PipelineVerdict {
  const isolatedCount = facts.marketIsolation?.isolated?.length ?? facts.marketIsolation?.isolatedCount ?? 0,
    riskAdmission = facts.riskAdmission ?? null,
    // A pipeline-level blocker outranks everything: while the pipeline itself is stopped, the refusal of
    // an older cycle is history, not the operator's next action. Only with the pipeline open does the
    // newest deterministic admission decision become the first cause, and it expires on its own.
    code = facts.noEntryReason ?? riskAdmission?.code ?? 'NONE',
    stage = facts.noEntryReason ? (STAGE_BY_CODE[code] ?? (code.startsWith('POOL_') ? 'SUPPLY' : 'EXECUTION_FACTS'))
      : riskAdmission ? 'RISK_ADMISSION' : 'NONE',
    secondary: Array<{code: string; detail: string}> = [],
    // The refusal is evidence for the verdict it produced. While a higher stage is primary, an older
    // admission refusal is history and must not ride along in the current first cause's evidence.
    admission = stage === 'RISK_ADMISSION' ? riskAdmission : null;
  if (facts.marketDataReason && facts.marketDataReason !== code) secondary.push({code: `MARKET_DATA_DIAGNOSTIC:${facts.marketDataReason}`, detail: `健康候选 ${facts.marketIsolation?.healthyCandidates ?? 0}/${facts.marketIsolation?.candidateCount ?? 0}，已隔离 ${isolatedCount}`});
  if (facts.executionReadiness && facts.executionReadiness.ready === false) secondary.push({code: `EXECUTION_FACTS_DIAGNOSTIC:${facts.executionReadiness.firstBlocker ?? 'BLOCKED'}`, detail: (facts.executionReadiness.blockers ?? []).join(' · ')});
  if (facts.capacityVisibility?.sideStatus?.code) secondary.push({code: `CAPACITY_DIAGNOSTIC:${facts.capacityVisibility.sideStatus.code}`, detail: facts.capacityVisibility.sideStatus.text ?? ''});
  if (facts.eligibility && facts.eligibility.count !== undefined) secondary.push({code: 'SUPPLY_DIAGNOSTIC:ELIGIBILITY', detail: `${facts.eligibility.status} ${facts.eligibility.count}（可执行 ${(facts.executableCandidateCount ?? 0).toString()}）`});
  if (facts.freshMarkets?.stale?.length) secondary.push({code: 'MARKET_DIAGNOSTIC:STALE_SYMBOLS', detail: `${facts.freshMarkets.status ?? 'UNKNOWN'} 序列无效 ${facts.freshMarkets.sequenceInvalid ?? 0}：${facts.freshMarkets.stale.slice(0, 8).join(' ')}`});
  if (facts.idleReason && facts.idleReason !== code) secondary.push({code: 'MODEL_DIAGNOSTIC:IDLE_REASON', detail: facts.idleReason});
  if (facts.analysisReason && facts.analysisReason !== code && facts.analysisReason !== facts.idleReason) secondary.push({code: 'MODEL_DIAGNOSTIC:ANALYSIS_REASON', detail: facts.analysisReason});
  return {
    code, stage,
    nextAction: NEXT_ACTION[stage](facts, code),
    evidence: {pipelineState: facts.pipelineState ?? null, marketDataReason: facts.marketDataReason ?? null,
      isolatedSymbols: (facts.marketIsolation?.isolated ?? []).slice(0, 12).map((row) => `${row.symbol}:${row.reasons[0] ?? 'DATA_INVALID'}`),
      isolatedCount, healthyCandidates: facts.marketIsolation?.healthyCandidates ?? 0,
      slotsUsed: facts.slots?.used ?? null, slotsMax: facts.slots?.max ?? null,
      executableCandidateCount: facts.executableCandidateCount ?? null, exhaustedForNewRisk: facts.capacityVisibility?.exhaustedForNewRisk ?? null,
      pendingEntries: facts.pendingEntries ?? null, maxPendingEntries: facts.maxPendingEntries ?? null, poolStatus: facts.poolStatus ?? null,
      riskAdmissionStage: admission?.stage ?? null, riskAdmissionSymbol: admission?.symbol ?? null,
      riskAdmissionReasons: admission?.reasons ?? [], riskAdmissionLimits: admission?.limits ?? [],
      riskAdmissionAgeMs: admission?.ageMs ?? null},
    secondary, evaluatedAt: facts.now,
  };
}
