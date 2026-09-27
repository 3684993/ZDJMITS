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
  capacityVisibility?: {firstBlocker?: string | null; exhaustedForNewRisk?: boolean; exhaustedReason?: string | null; sideStatus?: {code?: string; text?: string} | null;
    admission?: {status?: 'AVAILABLE'|'ZERO'|'UNAVAILABLE'|'NOT_APPLICABLE'; exhausted?: boolean; hasVerdict?: boolean; code?: string | null; gate?: string | null; detail?: string | null;
      evaluatedAt?: number; ceilingUsdBySide?: {LONG: number; SHORT: number} | null;reasons?:string[];scope?:string;snapshotHash?:string;profileVersion?:string;settingsVersion?:string|null;riskGeneration?:number;
      authorityVersions?:Record<string,unknown>;coverage?:Record<string,string>;
      gates?:Array<{name:string;reason:string;unit:string;limitUsd:number;usedUsd:number;maxAdditionalUsd:number;shortfallUsd?:number;candidateImpactUsd?:number;candidateShortfallUsd?:number;clusterKey?:string|null}>;
      firstBinding?:{kind:string;code:string;gate:string|null;unit?:string|null;limitUsd:number|null;usedUsd:number|null;headroomUsd:number|null;shortfallUsd:number|null;detail:string}|null;
      pendingLineage?:Array<{id:string;dedupeKey?:string;symbol:string;side:string;notionalUsd:number;marginUsd?:number;quoteAsset:string|null;source?:string;ownerState?:string;factStatus:string}>;quoteAsset?:string|null;leverage?:number|null;leverageFact?:string|null} | null} | null;
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
  riskAdmission?: {at: number; symbol: string; stage: string; code: string; reasons: string[]; limits: string[]; ageMs: number;
    binding?: {kind: string; code: string; gate: string | null; unit?:string|null;limitUsd: number | null; usedUsd: number | null; headroomUsd: number | null; shortfallUsd: number | null; detail: string} | null;
    readback?:{scope:'BOOK'|'CANDIDATE';evaluatedAt:number;snapshotHash:string|null;riskGeneration:number|null;profileVersion:string|null;settingsVersion:string|null;authorityVersions?:Record<string,unknown>;coverage?:Record<string,string>;
      symbol:string|null;side:'LONG'|'SHORT'|null;quoteAsset:string|null;leverage:number|null;leverageFact:string|null;candidateNotionalUsd:number|null;candidateMarginUsd:number|null;
      status:'AVAILABLE'|'ZERO'|'UNAVAILABLE';pendingLineage:Array<{id:string;dedupeKey?:string;symbol:string;side:string;notionalUsd:number;marginUsd?:number;quoteAsset:string|null;source?:string;ownerState?:string;factStatus:string}>}|null;
    gates?: Array<{name: string; unit: string; limitUsd: number; usedUsd: number; maxAdditionalUsd: number;shortfallUsd?:number;candidateImpactUsd?:number;candidateShortfallUsd?:number; clusterKey?: string | null}>} | null;
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
    const refusal = facts.riskAdmission, binding = refusal?.binding;
    // The gate's own arithmetic is the sentence: which limit, how much room is left, how much a human has
    // to release. A bare reason code is what let five labels stand in for one measurable ceiling.
    const headline = binding
      ? `${binding.code}${binding.gate && binding.gate !== binding.code ? ` · ${binding.gate}` : ''}`
        + (binding.headroomUsd != null ? ` 可新增 ${binding.headroomUsd.toFixed(2)} ${binding.unit??'USD'}` : '')
        + (binding.shortfallUsd != null && binding.shortfallUsd > 0 ? `，需人工先释放 ${binding.shortfallUsd.toFixed(2)} ${binding.unit??'USD'}` : '')
        + (binding.kind === 'SIZE_INDEPENDENT' ? '（与订单规模无关，缩小订单不能通过）' : '')
      : (refusal?.code ?? 'RISK_ADMISSION');
    const coBinding = (refusal?.reasons ?? []).filter((code: string) => code !== binding?.code);
    // A dollar ceiling is already fully stated by its own numbers above; anything else needs the gate's
    // sentence, which is where the count and the age a human has to act on live.
    const measure = binding && binding.kind !== 'NOTIONAL' && binding.detail ? `：${binding.detail}` : '';
    return `确定性风险门拒绝新增风险（${refusal?.symbol ?? '候选'}：${headline}${measure}${coBinding.length ? `；同时成立 ${coBinding.slice(0, 6).join(' · ')}` : ''}）；只能由人工减少已有敞口、人工确认交接，或经 governance 写入调整权威上限。不放宽阈值、不重启流程、不再调用模型换取放行`;
  },
  NONE: () => '无需处理：Entry 管线可用，继续由确定性硬门决定是否建仓',
};

/** The single authoritative verdict for one pipeline cycle, with everything else demoted to diagnostics. */
export function authoritativePipelineVerdict(facts: VerdictFacts): PipelineVerdict {
  const isolatedCount = facts.marketIsolation?.isolated?.length ?? facts.marketIsolation?.isolatedCount ?? 0,
    gate = facts.capacityVisibility?.admission ?? null,
    // The gate may deny the whole book before any candidate reaches `admit` — that is the pre-model capacity
    // stop. Its book-level verdict is then still the first cause: answering "nothing is blocking" because no
    // cycle was ever submitted to admit() would rebuild the same contradiction one layer up.
    // A legacy pre-model summary has no numeric pass. Prefer the complete BOOK readback
    // when that book is refusing; never attach BOOK numbers to the legacy candidate label.
    riskAdmission = (facts.riskAdmission?.readback||!(gate?.exhausted||gate?.status==='UNAVAILABLE')?facts.riskAdmission:null) ?? (gate?.exhausted||gate?.status==='UNAVAILABLE' ? {
      at: Number(gate.evaluatedAt) || facts.now, symbol: '书本级', stage: 'PORTFOLIO_RISK_ADMISSION',
      code: gate.code ?? 'RISK_ADMISSION_EXHAUSTED', reasons: gate.reasons??[], limits: [],binding:gate.firstBinding??
        {kind: 'OTHER', code: gate.code ?? 'RISK_ADMISSION_EXHAUSTED', gate: gate.gate ?? null, limitUsd: null, usedUsd: null,
        headroomUsd: Math.min(Number(gate.ceilingUsdBySide?.LONG ?? 0), Number(gate.ceilingUsdBySide?.SHORT ?? 0)), shortfallUsd: null, detail: gate.detail ?? ''},
      readback:{scope:'BOOK',evaluatedAt:Number(gate.evaluatedAt)||facts.now,snapshotHash:gate.snapshotHash??null,riskGeneration:gate.riskGeneration??null,
        profileVersion:gate.profileVersion??null,settingsVersion:gate.settingsVersion??null,authorityVersions:gate.authorityVersions,coverage:gate.coverage,symbol:null,side:null,quoteAsset:gate.quoteAsset??null,leverage:gate.leverage??null,
        leverageFact:gate.leverageFact??null,candidateNotionalUsd:null,candidateMarginUsd:null,status:gate.status==='UNAVAILABLE'?'UNAVAILABLE':
          gate.exhausted?'ZERO':'AVAILABLE',pendingLineage:gate.pendingLineage??[]},gates:gate.gates??[],
      ageMs: Math.max(0, facts.now - (Number(gate.evaluatedAt) || facts.now)),
    } : null),
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
    nextAction: NEXT_ACTION[stage](riskAdmission === facts.riskAdmission ? facts : {...facts, riskAdmission}, code),
    evidence: {pipelineState: facts.pipelineState ?? null, marketDataReason: facts.marketDataReason ?? null,
      isolatedSymbols: (facts.marketIsolation?.isolated ?? []).slice(0, 12).map((row) => `${row.symbol}:${row.reasons[0] ?? 'DATA_INVALID'}`),
      isolatedCount, healthyCandidates: facts.marketIsolation?.healthyCandidates ?? 0,
      slotsUsed: facts.slots?.used ?? null, slotsMax: facts.slots?.max ?? null,
      executableCandidateCount: facts.executableCandidateCount ?? null, exhaustedForNewRisk: facts.capacityVisibility?.exhaustedForNewRisk ?? null,
      pendingEntries: facts.pendingEntries ?? null, maxPendingEntries: facts.maxPendingEntries ?? null, poolStatus: facts.poolStatus ?? null,
      riskAdmissionStage: admission?.stage ?? null, riskAdmissionSymbol: admission?.symbol ?? null,
      riskAdmissionReasons: admission?.reasons ?? [], riskAdmissionLimits: admission?.limits ?? [],
      riskAdmissionBinding: admission?.binding ?? null, riskAdmissionGates: admission?.gates ?? [],
      riskAdmissionReadback:admission?.readback?{...admission.readback,firstBinding:admission.binding??null,gates:admission.gates??[]}:null,
      // A "can add" capacity reading beside a 0% admission is the contradiction this verdict exists to kill,
      // so the number the gate reported is carried into the evidence even when the ratio model is OBSERVE.
      riskAdmissionCeilingUsdBySide: admission?.readback?.scope==='CANDIDATE'?null:gate?.ceilingUsdBySide??null,
      riskAdmissionExhausted: admission?.readback?.scope==='CANDIDATE'?null:gate?.exhausted??false,
      bookAdmission:gate,
      riskAdmissionAgeMs: admission?.ageMs ?? null},
    secondary, evaluatedAt: facts.now,
  };
}
