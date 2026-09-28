import {reservationDebitsAvailableFunds} from './entryFundingCommitment.js';
import { testnetFundsOnlyEntry } from '@zdj/core';
import type { SystemSettings } from '@zdj/contracts';
import { ENTRY_QUOTE_ASSETS, isEntryQuoteAsset, quoteSuffixOf } from '@zdj/contracts';
import { activeExecutionLeaseMargin } from './executionLease.js';

/**
 * §C/§A: money and notional are different questions, and only one of them is answered by the wallet —
 * and only for the quote assets this product is allowed to spend.
 *
 * `CapitalCapacity` is what the exchange account can actually fund right now: the quote asset's own
 * available balance, minus the margin already committed to live reservations and execution leases,
 * converted through *this* candidate's verified leverage. It never consults a notional ratio, and no
 * default leverage is invented — an unproven leverage is an unproven capacity.
 *
 * The universe comes from `@zdj/contracts` so routing, ledger, reservation, lease, pre-AI envelope,
 * preflight, JIT, the API projection and the cockpit cannot drift into six different lists.
 */

export type LeverageFact = 'CANDIDATE_RECOMMENDED' | 'POSITION_RECORDED' | 'POLICY_MAX' | 'UNPROVEN';
export type CapitalBindingConstraint = 'AVAILABLE_MARGIN' | 'MARGIN_POLICY_CAP' | 'LEVERAGE_UNPROVEN' | 'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE' | 'NONE';

export type QuoteAssetCapitalLedger = {
  quoteAsset: string;
  entryFundingEligible: boolean;
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

export type EntryTradingCapital = {
  quoteAssets: QuoteAssetCapitalLedger[];
  totalExecutableMarginUsd: number;
  proven: boolean;
  excludedAssets: {asset: string; usdValue: number | null; reason: 'NOT_IN_ENTRY_FUNDING_UNIVERSE'}[];
  accountEquityUsd: number | null;
};

const finiteOrNull = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : null);
const finiteAtLeast = (value: unknown, floor = 0) => (Number.isFinite(Number(value)) ? Math.max(floor, Number(value)) : floor);

/** Quote assets this system may fund an Entry with, in the product's own canonical order. */
export const entryQuoteAssets = (): readonly string[] => ENTRY_QUOTE_ASSETS;

/** A leverage figure is only a fact when the pipeline resolved a real number for this candidate. */
export const leverageFactOf = (value: unknown): LeverageFact => (Number.isFinite(Number(value)) && Number(value) >= 1 ? 'CANDIDATE_RECOMMENDED' : 'UNPROVEN');

/** Margin already spoken for in one quote asset: live reservations plus execution leases, from their own owners. */
export function quoteAssetCommittedMargin(state: any, quoteAsset: string, now = Date.now(), excludeReservationId?:string) {
  const asset = String(quoteAsset).toUpperCase();
  const reservedMarginUsd = [...(state.entryReservations?.values() ?? [])]
    .filter((row: any) => row.id!==excludeReservationId && reservationDebitsAvailableFunds(state,row,now) && String(row.quoteAsset).toUpperCase() === asset)
    .reduce((sum: number, row: any) => sum + Math.max(0, Number(row.marginUsd ?? 0)), 0);
  return {reservedMarginUsd, executionLeaseMarginUsd: activeExecutionLeaseMargin(state, asset, now)};
}

/**
 * The account's funding view of one quote asset. `entryFundingEligible:false` is reported as zero
 * capacity rather than as absent, so a caller can show the fact without ever spending it.
 */
export function capitalCapacityForQuoteAsset(input: {
  quoteAsset: string;
  availableBalanceUsd: unknown;
  walletBalanceUsd?: unknown;
  reservedMarginUsd?: unknown;
  executionLeaseMarginUsd?: unknown;
}): QuoteAssetCapitalLedger {
  const eligible = isEntryQuoteAsset(input.quoteAsset);
  const reportedAvailable = eligible ? Number(input.availableBalanceUsd) : Number.NaN;
  const availableBalanceUsd = eligible ? finiteAtLeast(input.availableBalanceUsd) : 0;
  const reservedMarginUsd = eligible ? finiteAtLeast(input.reservedMarginUsd) : 0;
  const executionLeaseMarginUsd = eligible ? finiteAtLeast(input.executionLeaseMarginUsd) : 0;
  const walletBalanceUsd = finiteOrNull(input.walletBalanceUsd);
  const reasons: string[] = [];
  if (!eligible) reasons.push('QUOTE_ASSET_NOT_ENTRY_ELIGIBLE');
  if (eligible && !Number.isFinite(Number(input.availableBalanceUsd))) reasons.push('AVAILABLE_BALANCE_UNPROVEN');
  if (eligible && !Number.isFinite(Number(input.reservedMarginUsd))) reasons.push('RESERVED_MARGIN_UNPROVEN');
  if (eligible && !Number.isFinite(Number(input.executionLeaseMarginUsd))) reasons.push('EXECUTION_LEASE_MARGIN_UNPROVEN');
  return {quoteAsset: String(input.quoteAsset).toUpperCase(), entryFundingEligible: eligible, availableBalanceUsd, walletBalanceUsd, reservedMarginUsd, executionLeaseMarginUsd,
    executableMarginUsd: Math.max(0, availableBalanceUsd - reservedMarginUsd - executionLeaseMarginUsd), factsComplete: reasons.length === 0, reasons};
}

/** The whole funding block of the cockpit: one ledger per allowed quote asset, in canonical order. */
export function quoteAssetCapitalLedgers(state: any, now = Date.now()): QuoteAssetCapitalLedger[] {
  const assets: any[] = state.account?.assets ?? [];
  return ENTRY_QUOTE_ASSETS.map((quoteAsset) => {
    const row = assets.find((item: any) => String(item.asset ?? '').toUpperCase() === quoteAsset),
      committed = quoteAssetCommittedMargin(state, quoteAsset, now);
    return capitalCapacityForQuoteAsset({quoteAsset, availableBalanceUsd: row ? row.availableBalance : 0, walletBalanceUsd: row ? row.walletBalance : 0, ...committed});
  });
}

/**
 * What the system may actually spend on new Entries, kept strictly apart from what the account is
 * worth. Other balances (BTC collateral, BUSD/FDUSD stables) stay visible as excluded facts because
 * Binance reports them as margin-eligible and an operator must be able to see why they are not counted.
 */
export function entryTradingCapital(state: any, now = Date.now()): EntryTradingCapital {
  const quoteAssets = quoteAssetCapitalLedgers(state, now);
  const allowed = new Set(quoteAssets.map((row) => row.quoteAsset));
  const excludedAssets = (state.account?.assets ?? []).map((row: any) => String(row.asset ?? '').toUpperCase())
    .filter((asset: string, index: number, all: string[]) => !allowed.has(asset) && asset !== 'UNKNOWN' && all.indexOf(asset) === index)
    .map((asset: string) => ({asset, usdValue: finiteOrNull((state.account.assets as any[]).find((row: any) => String(row.asset ?? '').toUpperCase() === asset)?.usdValue), reason: 'NOT_IN_ENTRY_FUNDING_UNIVERSE' as const}));
  return {quoteAssets, totalExecutableMarginUsd: quoteAssets.reduce((sum, row) => sum + row.executableMarginUsd, 0),
    proven: quoteAssets.every((row) => row.factsComplete), excludedAssets, accountEquityUsd: finiteOrNull(state.account?.equityUsd)};
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
  const policyMarginCapUsd = usablePolicyCaps.length ? Math.max(0, Math.min(...usablePolicyCaps)) : ledger.executableMarginUsd;
  const fundableMarginUsd = Math.max(0, Math.min(ledger.executableMarginUsd, policyMarginCapUsd));
  const leverage = Number(input.leverage), leverageVerified = input.leverageFact !== 'UNPROVEN' && Number.isFinite(leverage) && leverage >= 1;
  const executableNotionalUsd = ledger.entryFundingEligible && leverageVerified ? fundableMarginUsd * leverage * Math.max(0, 1 - bufferPct) : 0;
  const minimumNotionalUsd = finiteAtLeast(input.minimumNotionalUsd ?? 1, 0);
  const bindingConstraint: CapitalBindingConstraint = !ledger.entryFundingEligible ? 'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE'
    : !leverageVerified ? 'LEVERAGE_UNPROVEN'
      : executableNotionalUsd + 1e-8 < minimumNotionalUsd ? 'AVAILABLE_MARGIN'
          : ledger.executableMarginUsd <= 0 ? 'AVAILABLE_MARGIN'
          : fundableMarginUsd < ledger.executableMarginUsd - 1e-8 ? 'MARGIN_POLICY_CAP' : 'NONE';
  const reasons = [...ledger.reasons, ...(leverageVerified ? [] : ['LEVERAGE_UNPROVEN'])];
  return {...ledger, policyMarginCapUsd, reserveMarginBufferPct: bufferPct, leverage: leverageVerified ? leverage : 0, leverageFact: leverageVerified ? input.leverageFact : 'UNPROVEN',
    executableNotionalUsd, minimumNotionalUsd, bindingConstraint, evaluatedAt: Number(input.evaluatedAt ?? Date.now())};
}

/**
 * The routing/JIT convenience: read the same facts straight out of a runtime state, so no caller has
 * to re-derive which reservations and leases already hold this quote asset's margin. A symbol quoted
 * outside the Entry universe is refused here, at the same place every other consumer reads capacity.
 */
export function candidateCapitalFromState(state: any, input: {symbol: string; quoteAsset: string; leverage: unknown; leverageFact: LeverageFact; minimumNotionalUsd?: number; now?: number; excludeReservationId?:string; settings?: SystemSettings}): CapitalCapacityFact {
  const now = input.now ?? Date.now(), settings = input.settings ?? state.settings,
    quoteAsset = String(input.quoteAsset ?? quoteSuffixOf(input.symbol)).toUpperCase(),
    asset = (state.account?.assets ?? []).find((row: any) => String(row.asset).toUpperCase() === quoteAsset),
    {reservedMarginUsd, executionLeaseMarginUsd} = quoteAssetCommittedMargin(state, quoteAsset, now,input.excludeReservationId),
    pi = settings?.portfolioIntelligence ?? {};
  return candidateCapitalCapacity({quoteAsset, availableBalanceUsd: isEntryQuoteAsset(quoteAsset) ? asset?.availableBalance : Number.NaN, walletBalanceUsd: asset?.walletBalance,
    reservedMarginUsd, executionLeaseMarginUsd, leverage: input.leverage, leverageFact: input.leverageFact,
    maxMarginPerPositionUsd: testnetFundsOnlyEntry(settings)?undefined:pi.maxMarginPerPositionUsd, maxEquityPctPerPosition: testnetFundsOnlyEntry(settings)?undefined:pi.maxEquityPct, reserveMarginBufferPct:testnetFundsOnlyEntry(settings)?0:undefined, equityUsd: state.account?.equityUsd,
    minimumNotionalUsd: input.minimumNotionalUsd ?? 1, evaluatedAt: now});
}
