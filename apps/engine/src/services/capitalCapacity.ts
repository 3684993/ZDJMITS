import type { SystemSettings } from '@zdj/contracts';
import { activeExecutionLeaseMargin } from './executionLease.js';

/**
 * §C: money and notional are different questions, and only one of them is answered by the wallet.
 *
 * `CapitalCapacity` is what the exchange account can actually fund right now: the quote asset's own
 * available balance, minus the margin already committed to live reservations and execution leases,
 * converted through *this* candidate's verified leverage. It never consults a notional ratio, and no
 * default leverage is invented — an unproven leverage is an unproven capacity.
 */

export type LeverageFact = 'CANDIDATE_RECOMMENDED' | 'POSITION_RECORDED' | 'POLICY_MAX' | 'UNPROVEN';
export type CapitalBindingConstraint = 'AVAILABLE_MARGIN' | 'MARGIN_POLICY_CAP' | 'LEVERAGE_UNPROVEN' | 'NONE';

export type QuoteAssetCapitalLedger = {
  quoteAsset: string;
  availableBalanceUsd: number;
  walletBalanceUsd: number | null;
  reservedMarginUsd: number;
  executionLeaseMarginUsd: number;
  executableMarginUsd: number;
  factsComplete: boolean;
  reasons: string[];
};

export type CapitalCapacityFact = QuoteAssetCapitalLedger & {
  policyMarginCapUsd: number;
  reserveMarginBufferPct: number;
  leverage: number;
  leverageFact: LeverageFact;
  executableNotionalUsd: number;
  minimumNotionalUsd: number;
  bindingConstraint: CapitalBindingConstraint;
  evaluatedAt: number;
};

const finiteOrNull = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : null);
const finiteAtLeast = (value: unknown, floor = 0) => (Number.isFinite(Number(value)) ? Math.max(floor, Number(value)) : floor);

/** Quote assets the account can actually fund an Entry with, in USD terms. */
export const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'FDUSD'] as const;

/** A leverage figure is only a fact when the pipeline resolved a real number for this candidate. */
export const leverageFactOf = (value: unknown): LeverageFact => (Number.isFinite(Number(value)) && Number(value) >= 1 ? 'CANDIDATE_RECOMMENDED' : 'UNPROVEN');

/** Margin already spoken for in one quote asset: live reservations plus execution leases, from their own owners. */
export function quoteAssetCommittedMargin(state: any, quoteAsset: string, now = Date.now()) {
  const asset = String(quoteAsset).toUpperCase();
  const reservedMarginUsd = [...(state.entryReservations?.values() ?? [])]
    .filter((row: any) => ['RESERVED', 'WORKING'].includes(String(row.status)) && Number(row.expiresAt) > now && String(row.quoteAsset).toUpperCase() === asset)
    .reduce((sum: number, row: any) => sum + Math.max(0, Number(row.marginUsd ?? 0)), 0);
  return {reservedMarginUsd, executionLeaseMarginUsd: activeExecutionLeaseMargin(state, asset, now)};
}

/** The whole funding block of the cockpit: one ledger per quote asset the account reports. */
export function quoteAssetCapitalLedgers(state: any, now = Date.now()): QuoteAssetCapitalLedger[] {
  const seen = new Set<string>();
  return (state.account?.assets ?? []).map((row: any) => String(row.asset ?? '').toUpperCase())
    .filter((asset: string) => (QUOTE_ASSETS as readonly string[]).includes(asset) && !seen.has(asset) && (seen.add(asset), true))
    .map((asset: string) => {
      const row: any = (state.account?.assets ?? []).find((item: any) => String(item.asset).toUpperCase() === asset),
        committed = quoteAssetCommittedMargin(state, asset, now);
      return capitalCapacityForQuoteAsset({quoteAsset: asset, availableBalanceUsd: row.availableBalance, walletBalanceUsd: row.walletBalance, ...committed});
    });
}

/** The account's funding view of one quote asset. Nothing here knows about exposure percentages. */
export function capitalCapacityForQuoteAsset(input: {
  quoteAsset: string;
  availableBalanceUsd: unknown;
  walletBalanceUsd?: unknown;
  reservedMarginUsd?: unknown;
  executionLeaseMarginUsd?: unknown;
}): QuoteAssetCapitalLedger {
  const availableBalanceUsd = finiteAtLeast(input.availableBalanceUsd), reservedMarginUsd = finiteAtLeast(input.reservedMarginUsd),
    executionLeaseMarginUsd = finiteAtLeast(input.executionLeaseMarginUsd), walletBalanceUsd = finiteOrNull(input.walletBalanceUsd);
  const reasons: string[] = [];
  if (!Number.isFinite(Number(input.availableBalanceUsd))) reasons.push('AVAILABLE_BALANCE_UNPROVEN');
  if (!Number.isFinite(Number(input.reservedMarginUsd))) reasons.push('RESERVED_MARGIN_UNPROVEN');
  if (!Number.isFinite(Number(input.executionLeaseMarginUsd))) reasons.push('EXECUTION_LEASE_MARGIN_UNPROVEN');
  return {quoteAsset: String(input.quoteAsset).toUpperCase(), availableBalanceUsd, walletBalanceUsd, reservedMarginUsd, executionLeaseMarginUsd,
    executableMarginUsd: Math.max(0, availableBalanceUsd - reservedMarginUsd - executionLeaseMarginUsd), factsComplete: reasons.length === 0, reasons};
}

/**
 * How much notional one candidate can fund. `maxMarginPerPositionUsd` and `maxEquityPctPerPosition`
 * are the deployment's own per-position policy; they narrow the wallet figure, never widen it.
 */
export function candidateCapitalCapacity(input: {
  quoteAsset: string; availableBalanceUsd: unknown; walletBalanceUsd?: unknown; reservedMarginUsd?: unknown; executionLeaseMarginUsd?: unknown;
  leverage: unknown; leverageFact: LeverageFact; maxMarginPerPositionUsd?: unknown; maxEquityPctPerPosition?: unknown; equityUsd?: unknown;
  minimumNotionalUsd?: unknown; reserveMarginBufferPct?: unknown; evaluatedAt?: number;
}): CapitalCapacityFact {
  const ledger = capitalCapacityForQuoteAsset(input);
  const bufferPct = finiteAtLeast(input.reserveMarginBufferPct ?? 0.005, 0);
  const equityUsd = finiteOrNull(input.equityUsd), maxEquityPct = finiteOrNull(input.maxEquityPctPerPosition);
  const policyCaps = [finiteOrNull(input.maxMarginPerPositionUsd)];
  if (equityUsd !== null && maxEquityPct !== null) policyCaps.push(equityUsd * Math.max(0, maxEquityPct));
  const usablePolicyCaps = policyCaps.filter((value): value is number => value !== null);
  const policyMarginCapUsd = usablePolicyCaps.length ? Math.max(0, ...[Math.min(...usablePolicyCaps)]) : ledger.executableMarginUsd;
  const fundableMarginUsd = Math.max(0, Math.min(ledger.executableMarginUsd, policyMarginCapUsd));
  const leverage = Number(input.leverage), leverageVerified = input.leverageFact !== 'UNPROVEN' && Number.isFinite(leverage) && leverage >= 1;
  const executableNotionalUsd = leverageVerified ? fundableMarginUsd * leverage * Math.max(0, 1 - bufferPct) : 0;
  const minimumNotionalUsd = finiteAtLeast(input.minimumNotionalUsd ?? 1, 0);
  const bindingConstraint: CapitalBindingConstraint = !leverageVerified ? 'LEVERAGE_UNPROVEN'
    : executableNotionalUsd + 1e-8 < minimumNotionalUsd ? 'AVAILABLE_MARGIN'
      : fundableMarginUsd < ledger.executableMarginUsd - 1e-8 ? 'MARGIN_POLICY_CAP' : 'NONE';
  const reasons = [...ledger.reasons, ...(leverageVerified ? [] : ['LEVERAGE_UNPROVEN'])];
  return {...ledger, policyMarginCapUsd, reserveMarginBufferPct: bufferPct, leverage: leverageVerified ? leverage : 0, leverageFact: leverageVerified ? input.leverageFact : 'UNPROVEN',
    executableNotionalUsd, minimumNotionalUsd, bindingConstraint, evaluatedAt: Number(input.evaluatedAt ?? Date.now())};
}

/**
 * The routing/JIT convenience: read the same facts straight out of a runtime state, so no caller has
 * to re-derive which reservations and leases already hold this quote asset's margin.
 */
export function candidateCapitalFromState(state: any, input: {symbol: string; quoteAsset: string; leverage: unknown; leverageFact: LeverageFact; minimumNotionalUsd?: number; now?: number; settings?: SystemSettings}): CapitalCapacityFact {
  const now = input.now ?? Date.now(), settings = input.settings ?? state.settings,
    asset = (state.account?.assets ?? []).find((row: any) => String(row.asset).toUpperCase() === String(input.quoteAsset).toUpperCase()),
    {reservedMarginUsd, executionLeaseMarginUsd} = quoteAssetCommittedMargin(state, input.quoteAsset, now),
    pi = settings?.portfolioIntelligence ?? {};
  return candidateCapitalCapacity({quoteAsset: input.quoteAsset, availableBalanceUsd: asset?.availableBalance, walletBalanceUsd: asset?.walletBalance,
    reservedMarginUsd, executionLeaseMarginUsd, leverage: input.leverage, leverageFact: input.leverageFact,
    maxMarginPerPositionUsd: pi.maxMarginPerPositionUsd, maxEquityPctPerPosition: pi.maxEquityPct, equityUsd: state.account?.equityUsd,
    minimumNotionalUsd: input.minimumNotionalUsd ?? 1, evaluatedAt: now});
}
