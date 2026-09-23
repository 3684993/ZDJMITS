import { privateAccountFresh } from './privateAccountReadiness.js';
import { portfolioRiskProfileBlockers, portfolioRiskProfileStatus } from './portfolioRiskLedger.js';

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
  now?: number;
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
  const blockers: ExecutionBlocker[] = [];
  if (environment !== 'TESTNET') blockers.push('ENVIRONMENT_NOT_TESTNET');
  if (executionMode !== 'TESTNET_ENABLED') blockers.push('EXECUTION_WRITE_LOCKED');
  if (!privateFresh) blockers.push('PRIVATE_DATA_UNAVAILABLE');
  if (input.writeAdmissionBlock) blockers.push(input.writeAdmissionBlock);
  if (input.runtimeControlMode !== 'RUNNING') blockers.push('RUNTIME_NOT_RUNNING');
  else if (!intent) blockers.push('POLICY_NOT_AUTO');
  blockers.push(...portfolioRiskProfileBlockers(profile));
  if (input.executableCandidateCount < 1) blockers.push('NO_EXECUTABLE_CANDIDATE');
  const ready = blockers.length === 0;
  return {
    intent, ready, modelSpendPermitted: !intent || ready, blockers, firstBlocker: blockers[0] ?? null,
    profileStatus: portfolioRiskProfileStatus(profile), privateFresh,
    writeLocked: executionMode !== 'TESTNET_ENABLED', executableCandidateCount: input.executableCandidateCount,
    mode: ready ? 'EXECUTION_READY' : intent ? 'EXECUTION_BLOCKED' : 'RESEARCH_ONLY',
    text: ready
      ? '执行事实齐备：PLACE 可进入 reservation → intent → order submit 链'
      : `执行事实未齐：${blockers.join(' · ')}；已停止调用模型，避免产生无法执行的决策`,
  };
}
