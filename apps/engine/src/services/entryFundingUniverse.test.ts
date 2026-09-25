import {describe, expect, it} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import {entryFundingEligibleSymbol, isEntryQuoteAsset, quoteSuffixOf} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type: 'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {candidateCapitalFromState, entryTradingCapital, quoteAssetCapitalLedgers} from './capitalCapacity.js';
import {activeExecutionLeaseMargin, acquireExecutionLease} from './executionLease.js';

/**
 * §A: an account's asset list and the money this system may spend on a new Entry are different objects.
 * Binance reports BTC, BUSD and FDUSD as real, margin-eligible balances; none of them may fund an Entry.
 */

const settings = () => SystemSettingsSchema.parse({...defaults, appearance: {...defaults.appearance, theme: 'BINANCE_NOIR'}});

const stateWith = (assets: {asset: string; availableBalance: number; walletBalance: number; usdValue: number; marginEligible?: boolean}[]) => {
  const state = new RuntimeState(settings()) as any;
  state.account = {...state.account, status: 'READY', asOf: Date.now(), equityUsd: assets.reduce((n, row) => n + row.usdValue, 0), assets};
  return state;
};
const asset = (name: string, available: number, usd = available) => ({asset: name, availableBalance: available, walletBalance: available, usdValue: usd, marginEligible: true});
const FULL_BOOK = () => stateWith([asset('USDT', 3_681.75), asset('USDC', 4_970.81), asset('BUSD', 5_000), asset('FDUSD', 5_000), asset('BTC', 0.01, 850.23)]);

describe('the Entry funding universe is exactly USDT and USDC', () => {
  it('QA-01 publishes one ledger per allowed quote asset and none for the rest', () => {
    const ledgers = quoteAssetCapitalLedgers(FULL_BOOK(), Date.now());
    expect(ledgers.map((row) => row.quoteAsset).sort()).toEqual(['USDC', 'USDT']);
  });

  it('QA-02 totals Entry trading capital from allowed quote assets only', () => {
    const capital = entryTradingCapital(FULL_BOOK(), Date.now());
    expect(capital.totalExecutableMarginUsd).toBeCloseTo(3_681.75 + 4_970.81, 6);
    expect(capital.excludedAssets.map((row) => row.asset).sort()).toEqual(['BTC', 'BUSD', 'FDUSD']);
    expect(capital.excludedAssets.every((row) => row.reason === 'NOT_IN_ENTRY_FUNDING_UNIVERSE')).toBe(true);
    // The account valuation keeps telling the truth about the rest.
    expect(capital.accountEquityUsd).toBeCloseTo(3_681.75 + 4_970.81 + 5_000 + 5_000 + 850.23, 2);
  });

  it('QA-03 doubles the BTC balance without moving Entry trading capital by one cent', () => {
    const small = entryTradingCapital(stateWith([asset('USDT', 3_681.75), asset('USDC', 4_970.81), asset('BTC', 0.01, 850.23)]), Date.now());
    const large = entryTradingCapital(stateWith([asset('USDT', 3_681.75), asset('USDC', 4_970.81), asset('BTC', 2, 170_046)]), Date.now());
    expect(large.totalExecutableMarginUsd).toBe(small.totalExecutableMarginUsd);
    expect(large.accountEquityUsd).toBeGreaterThan(small.accountEquityUsd);
  });

  it('QA-04 keeps BUSD and FDUSD balances out of the ledger even when they are large and margin-eligible', () => {
    const withStables = entryTradingCapital(FULL_BOOK(), Date.now());
    const without = entryTradingCapital(stateWith([asset('USDT', 3_681.75), asset('USDC', 4_970.81)]), Date.now());
    expect(withStables.totalExecutableMarginUsd).toBe(without.totalExecutableMarginUsd);
  });

  it('QA-05 charges each quote asset only its own committed margin', () => {
    const state = FULL_BOOK();
    const now = Date.now();
    state.entryReservations.set('r-usdc', {id: 'r-usdc', underlying: 'ADA', quoteAsset: 'USDC', marginUsd: 400, notionalUsd: 3_200, planId: 'p', intentId: 'i', createdAt: now, expiresAt: now + 60_000, status: 'WORKING'});
    const capital = entryTradingCapital(state, now);
    const usdt = capital.quoteAssets.find((row) => row.quoteAsset === 'USDT')!, usdc = capital.quoteAssets.find((row) => row.quoteAsset === 'USDC')!;
    expect(usdt.reservedMarginUsd).toBe(0);
    expect(usdt.executableMarginUsd).toBeCloseTo(3_681.75, 6);
    expect(usdc.reservedMarginUsd).toBe(400);
    expect(usdc.executableMarginUsd).toBeCloseTo(4_570.81, 6);
    expect(capital.totalExecutableMarginUsd).toBeCloseTo(3_681.75 + 4_570.81, 6);
  });

  it('QA-06 refuses to fund a symbol whose quote leg is outside the universe', () => {
    const state = FULL_BOOK();
    const capital = candidateCapitalFromState(state, {symbol: 'BNBFDUSD', quoteAsset: 'FDUSD', leverage: 5, leverageFact: 'CANDIDATE_RECOMMENDED', minimumNotionalUsd: 5, now: Date.now()});
    expect(capital.quoteAsset).toBe('FDUSD');
    expect(capital.entryFundingEligible).toBe(false);
    expect(capital.executableMarginUsd).toBe(0);
    expect(capital.executableNotionalUsd).toBe(0);
    expect(capital.bindingConstraint).toBe('QUOTE_ASSET_NOT_ENTRY_ELIGIBLE');
    expect(capital.reasons).toContain('QUOTE_ASSET_NOT_ENTRY_ELIGIBLE');
  });

  it('QA-07 keeps an eligible symbol funded at its own quote asset', () => {
    const state = FULL_BOOK();
    const capital = candidateCapitalFromState(state, {symbol: 'ADAUSDC', quoteAsset: 'USDC', leverage: 8, leverageFact: 'CANDIDATE_RECOMMENDED', minimumNotionalUsd: 5, now: Date.now()});
    expect(capital.entryFundingEligible).toBe(true);
    expect(capital.executableNotionalUsd).toBeGreaterThan(0);
  });

  it('QA-08 separates symbol suffix parsing from funding permission in one shared source', () => {
    expect(quoteSuffixOf('4000BONKUSDT')).toBe('USDT');
    expect(quoteSuffixOf('BNBFDUSD')).toBe('FDUSD');
    expect(quoteSuffixOf('adacusdc')).toBe('USDC');
    expect(quoteSuffixOf('BTCUSDT_PERP')).toBe('UNKNOWN');
    expect(isEntryQuoteAsset('USDT')).toBe(true);
    expect(isEntryQuoteAsset('BUSD')).toBe(false);
    expect(isEntryQuoteAsset('FDUSD')).toBe(false);
    expect(isEntryQuoteAsset('BTC')).toBe(false);
    expect(entryFundingEligibleSymbol('BNBFDUSD')).toBe(false);
    expect(entryFundingEligibleSymbol('BNBUSDT')).toBe(true);
  });

  it('QA-09 exposes a missing balance as an unproven fact rather than as free money', () => {
    const state = stateWith([{asset: 'USDT', availableBalance: Number.NaN, walletBalance: 1_000, usdValue: 1_000}, asset('USDC', 100)] as never);
    const capital = entryTradingCapital(state, Date.now());
    expect(capital.proven).toBe(false);
    expect(capital.quoteAssets.find((row) => row.quoteAsset === 'USDT')!.factsComplete).toBe(false);
  });

  it('QA-11 reads an account without a USDC row as zero capacity, not as a broken fact', () => {
    const capital = entryTradingCapital(stateWith([asset('USDT', 1_000), asset('BTC', 0.01, 850)]), Date.now());
    const usdc = capital.quoteAssets.find((row) => row.quoteAsset === 'USDC')!;
    expect(usdc.factsComplete).toBe(true);
    expect(usdc.availableBalanceUsd).toBe(0);
    expect(capital.proven).toBe(true);
    expect(capital.totalExecutableMarginUsd).toBeCloseTo(1_000, 6);
  });

  it('QA-10 charges an execution lease against its own quote asset only', () => {
    const state = FULL_BOOK(), now = Date.now();
    acquireExecutionLease(state, {symbol: 'ADAUSDC', quoteAsset: 'USDC', reservedMarginUsd: 466.57, ttlMs: 60_000}, now);
    expect(activeExecutionLeaseMargin(state as never, 'USDC', now)).toBeCloseTo(466.57, 6);
    expect(activeExecutionLeaseMargin(state as never, 'USDT', now)).toBe(0);
    const capital = entryTradingCapital(state, now);
    expect(capital.quoteAssets.find((row) => row.quoteAsset === 'USDC')!.executionLeaseMarginUsd).toBeCloseTo(466.57, 6);
    expect(capital.quoteAssets.find((row) => row.quoteAsset === 'USDT')!.executionLeaseMarginUsd).toBe(0);
    expect(capital.totalExecutableMarginUsd).toBeCloseTo(3_681.75 + (4_970.81 - 466.57), 4);
  });
});
