import { testnetFundsOnlyEntry } from '@zdj/core';
import { privateAccountFresh } from './privateAccountReadiness.js';
import { portfolioRiskProfileBlockers, portfolioRiskProfileStatus, type PortfolioRiskProfileAuthorityContext } from './portfolioRiskLedger.js';

/**
 * Whether the runtime may spend a model call.
 *
 * A Primary `PLACE` is only worth paying for when the book can act on it. Before this gate the
 * pipeline kept producing expensive PLACE decisions in a mode that converted every one of them into
 * a system WAIT, so the operator saw "PLACE 24 / Submit 0" with no statement of which fact was
 * missing. The judgment reads the same facts the write path itself will check, and it runs before
 * the model call rather than after the decision.
 */
export type ExecutionBlocker =
  | 'ENVIRONMENT_NOT_TESTNET'
  | 'EXECUTION_WRITE_LOCKED'
  | 'PRIVATE_DATA_UNAVAILABLE'
  | 'RUNTIME_NOT_RUNNING'
  | 'POLICY_NOT_AUTO'
  | 'NO_EXECUTABLE_CANDIDATE'
  | string;

export type ExecutionReadinessInput = {
  settings: { connections?: { executionMode?: string; exchange?: { environment?: string } }; riskGovernance?: { entrySafetyMode?: string; portfolioRisk?: Record<string, unknown> | null } } | null | undefined;
  account: { status: string; asOf: number | null } | null | undefined;
  runtimeControlMode: string;
  executionGovernanceMode: string;
  writeAdmissionBlock: string | null;
  executableCandidateCount: number;
  /** The symbols this tick could actually route; used only to detect that none of them is proven. */
  executableCandidateSymbols?: string[];
  /**
   * The sized universe margin coverage is committed against. Coverage of the routed two symbols is a
   * moving target that changes every capital route; the sized universe is what decides whether paying
   * for a model call could ever lead to an executable PLACE.
   */
  sizingWatchSymbols?: string[];
  /** The durable dataset authority, supplied by the runtime that read it from the same store. */
  portfolioRiskAuthority?: Pick<PortfolioRiskProfileAuthorityContext, 'facts' | 'staleObservedContentHash'> | null;
  authorityScope?: { environment: string; accountScope: string } | null;
  now?: number;
  entryPolicy?: {orderAuthorization:boolean;reason:string};
};

export type ExecutionReadiness = {
  /** The operator has armed autonomous entry, so the pipeline is expected to be able to trade. */
  intent: boolean;
  ready: boolean;
  modelSpendPermitted: boolean;
  blockers: ExecutionBlocker[];
  firstBlocker: ExecutionBlocker | null;
  profileStatus: ReturnType<typeof portfolioRiskProfileStatus>;
  privateFresh: boolean;
  writeLocked: boolean;
  executableCandidateCount: number;
  mode: 'EXECUTION_READY' | 'EXECUTION_BLOCKED' | 'RESEARCH_ONLY';
  text: string;
};

export function executionReadiness(input: ExecutionReadinessInput): ExecutionReadiness {
  const now = input.now ?? Date.now();
  const settings = input.settings ?? {};
  const environment = String(settings.connections?.exchange?.environment ?? '').toUpperCase();
  const executionMode = String(settings.connections?.executionMode ?? '');
  const profile = settings.riskGovernance?.portfolioRisk ?? {};
  const intent = input.executionGovernanceMode === 'AUTO_RUNNING' && settings.riskGovernance?.entrySafetyMode === 'AUTO';
  const privateFresh = privateAccountFresh({ status: String(input.account?.status ?? 'UNKNOWN'), asOf: input.account?.asOf ?? null } as never, now);
  // The same authority object the write path will check, not a second copy of its rules: an empty
  // required-symbol list is deliberate, because this gate answers "could any new risk be admitted",
  // and a specific candidate that falls outside coverage is named by the admission itself.
  const authority: PortfolioRiskProfileAuthorityContext | undefined = input.portfolioRiskAuthority && input.authorityScope
    ? {facts: input.portfolioRiskAuthority.facts, staleObservedContentHash: input.portfolioRiskAuthority.staleObservedContentHash ?? null,
      environment: input.authorityScope.environment, accountScope: input.authorityScope.accountScope, requiredSymbols: []}
    : undefined;
  // A single uncovered symbol in the pool must not freeze the fleet - the admission refuses that
  // candidate by name. But when *none* of this tick's executable candidates has a proven bracket,
  // every model call is a guaranteed waste, so the gate says so instead of paying for it.
  const executableSymbols = [...new Set((input.sizingWatchSymbols?.length ? input.sizingWatchSymbols : input.executableCandidateSymbols ?? [])
    .map(symbol => String(symbol).trim().toUpperCase()).filter(Boolean))];
  const uncoveredOnly = executableSymbols.length > 0 && authority?.facts
    && !executableSymbols.some(symbol => authority.facts!.margin.coverageSymbols.includes(symbol));
  const blockers: ExecutionBlocker[] = [];
  if (environment !== 'TESTNET') blockers.push('ENVIRONMENT_NOT_TESTNET');
  if (executionMode !== 'TESTNET_ENABLED') blockers.push('EXECUTION_WRITE_LOCKED');
  const analysisOnly = input.entryPolicy?.orderAuthorization === false;
  if (analysisOnly) blockers.push(input.entryPolicy!.reason);
  if (!privateFresh) blockers.push('PRIVATE_DATA_UNAVAILABLE');
  if (input.writeAdmissionBlock) blockers.push(input.writeAdmissionBlock);
  if (input.runtimeControlMode !== 'RUNNING') blockers.push('RUNTIME_NOT_RUNNING');
  else if (!intent) blockers.push('POLICY_NOT_AUTO');
  if(!testnetFundsOnlyEntry(settings))blockers.push(...portfolioRiskProfileBlockers(profile, authority));
  if (!testnetFundsOnlyEntry(settings)&&uncoveredOnly) blockers.push('MARGIN_TIER_NO_COVERED_CANDIDATE');
  if (input.executableCandidateCount < 1) blockers.push('NO_EXECUTABLE_CANDIDATE');
  const ready = blockers.length === 0;
  return {
    intent, ready, modelSpendPermitted: !intent || ready || (analysisOnly && privateFresh && environment==='TESTNET' && input.runtimeControlMode==='RUNNING'), blockers, firstBlocker: blockers[0] ?? null,
    profileStatus: portfolioRiskProfileStatus(profile, authority), privateFresh,
    writeLocked: executionMode !== 'TESTNET_ENABLED' || analysisOnly, executableCandidateCount: input.executableCandidateCount,
    mode: analysisOnly ? 'RESEARCH_ONLY' : ready ? 'EXECUTION_READY' : intent ? 'EXECUTION_BLOCKED' : 'RESEARCH_ONLY',
    text: analysisOnly ? `只读分析与风险观察可运行；未授权新 Entry 订单：${input.entryPolicy!.reason}` : ready
      ? '执行事实齐备：PLACE 可进入 reservation → intent → order submit 链'
      : `执行事实未齐：${blockers.join(' · ')}；已停止调用模型，避免产生无法执行的决策`,
  };
}
