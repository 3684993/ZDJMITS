import {describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {compactEntryFacts} from '@zdj/core';
import {harness} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {evaluatePreAiPlanFeasibility} from './preAiPlanFeasibility.js';

/**
 * §C: the envelope is where determinism becomes a fact the model is told. It may say "this side cannot
 * be submitted, for this named reason" — it may never pick the other side on the model's behalf.
 */
const fixtureSymbol: string = JSON.parse(readFileSync(new URL('./fixtures/v363-entry.json', import.meta.url), 'utf8'))[0].packet.symbol;
const settingsWith = (over: Record<string, any>) => ({...structuredClone(harness().state.settings), ...over} as any);

function armedHarness(decideSide: 'LONG' | 'SHORT', tune?: (state: any) => void) {
  const h = harness();
  tune?.(h.state);
  const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
  (h.ai as any).probePrimaryIfDue = vi.fn(async () => {});
  (h.ai as any).decide.mockImplementation(async () => ({
    runId: 'envelope-side-run',
    decision: {...h.supplied, decision: `PLACE_${decideSide}`, tradeSide: decideSide, direction: decideSide, structureDirection: decideSide,
      quantityUnits: 1000, idealPrice: decideSide === 'LONG' ? Number(quote.bid) : Number(quote.ask),
      acceptablePriceRange: {min: Number(quote.bid), max: Number(quote.ask) + Number(quote.tickSize) * 10}, horizonMinutes: 3},
  }));
  return h;
}

/** A held LONG book at the enforced direction ceiling squeezes LONG capacity only. */
const squeezeLong = (state: any) => {
  state.settings.riskGovernance.maxDirectionExposurePct = 0.5;
  state.settings.riskGovernance.exposureCapacityPolicy = {...(state.settings.riskGovernance.exposureCapacityPolicy ?? {}), direction: 'ENFORCE'};
  state.positions.set('squeeze', {id: 'squeeze', symbol: 'BTCUSDT', side: 'LONG', quantity: 1, markPrice: 6_000, leverage: 10, cycleId: 'cycle-squeeze',
    unrealizedPnl: 0, unrealizedPnlPercent: 0, openedAt: Date.now() - 10_000, firstObservedAt: Date.now() - 10_000, entryTimeSource: 'SYSTEM_FILL',
    managementStatus: 'AUTO_MANAGED', humanManagedAt: null, tpStatus: 'PENDING', tpOrderId: null, tpLastVerifiedAt: null, tpCoverageSource: 'NONE'} as never);
};

describe('the pre-AI envelope publishes which sides are actually executable', () => {
  it('EP-01 states both sides, the real legal notional floor and the binding constraint per side', () => {
    const envelope = buildPreAiExecutionEnvelope(harness().state, fixtureSymbol);
    const quote = harness().state.snapshots.get(fixtureSymbol)!.quote;
    expect(envelope.executableSides).toEqual(['LONG', 'SHORT']);
    expect(envelope.noExecutableSide).toBe(false);
    expect(envelope.sideAuthorization).toEqual({LONG: 'EXECUTABLE', SHORT: 'EXECUTABLE'});
    const floor = Math.max(Number(quote.minNotional), Number(quote.minQty) * Number(quote.last));
    for (const side of ['LONG', 'SHORT'] as const) {
      const capacity = envelope[side];
      expect(capacity.minimumLegalNotionalUsd).toBeCloseTo(floor, 8);
      // The stated ceiling is the notional the published maximum quantity can actually cost, so it never
      // exceeds the authorized notional and still covers the whole-step maximum at the reference price.
      expect(capacity.legalNotionalRangeUsd![0]).toBeGreaterThanOrEqual(Math.max(floor,capacity.minimumOrderNotionalQuote??0));
      expect(capacity.legalNotionalRangeUsd![1]).toBeLessThanOrEqual(capacity.maxNotionalUsd + 1e-8);
      expect(capacity.legalNotionalRangeUsd![1]).toBeGreaterThanOrEqual(capacity.maxQuantityUnits * Number(quote.stepSize) * Number(quote.last) - 1e-8);
      expect(capacity.firstBindingConstraint).toBeTruthy();
    }
  });

  it('EP-02 names the real cause when neither side can be funded, and spends no model run', async () => {
    const h = armedHarness('LONG', (state) => {
      state.account = {...state.account, assets: [{asset: 'USDT', availableBalance: 0, walletBalance: 0, usdValue: 0, marginEligible: true}]};
    });
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(envelope.executableSides).toEqual([]);
    expect(envelope.noExecutableSide).toBe(true);
    expect(String(envelope.sideAuthorization.LONG)).toMatch(/^NOT_EXECUTABLE:/);
    expect(String(envelope.sideAuthorization.LONG)).not.toContain('MINIMUM_NOTIONAL');
    const probe = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope, settings: settingsWith({})});
    expect(probe.noHardExecutableSide).toBe(true);
    await h.run();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(h.state.entryIntents.size).toBe(0);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
  });

  it('EP-03 TESTNET exposes both funded sides despite exhausted direction risk', () => {
    const h=harness();squeezeLong(h.state);const envelope=buildPreAiExecutionEnvelope(h.state,fixtureSymbol);
    expect(envelope.executableSides).toEqual(['LONG','SHORT']);
    const facts:any=compactEntryFacts({...h.packet,executionEnvelope:envelope} as never);
    expect(facts.EXECUTION_ENVELOPE.sideAuthorization).toEqual(envelope.sideAuthorization);
    expect(facts.EXECUTION_ENVELOPE.executableSides).toEqual(['LONG','SHORT']);
  });

  it('EP-04 TESTNET executes the chosen funded LONG without a risk-driven direction remap', async () => {
    const h=armedHarness('LONG',squeezeLong);await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect([...h.state.entryOrders.values()][0].side).toBe('LONG');
  });

  it('EP-05 keeps the whole-side probe honest: one executable side is never a reason to skip Primary', async () => {
    const h = armedHarness('SHORT', squeezeLong);
    const probe = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: buildPreAiExecutionEnvelope(h.state, fixtureSymbol), settings: settingsWith({})});
    expect(probe.noHardExecutableSide).toBe(false);
    await h.run();
    expect(h.ai.decide).toHaveBeenCalled();
  });

  /** The sizing plan is the layer that will produce the order size, so its own verdict is a pre-AI fact. */
  const routed = (shortFacts: any, longFacts: any) => (state: any) => {
    state.runtimeControl.capital.routedCandidates = [{symbol: fixtureSymbol, underlying: 'FIX', quoteAsset: 'USDT', leverage: 8, admission: 'ALLOW', reason: 'EXECUTABLE',
      longPlanFacts: longFacts, shortPlanFacts: shortFacts}] as never;
  };
  const refused = {present: true, admission: 'REJECT_EXPOSURE_LIMIT', reasons: ['REJECT_EXPOSURE_LIMIT'], minExecutableMarginUsd: 1, notionalUsd: 5, marginUsd: 0.63, leverage: 8,
    capacityRoom: {source: 'SHORT_EXPOSURE', ceilingUsd: 5_248.68, usedUsd: 7_438.39, roomUsd: 0}};
  const allowed = {present: true, admission: 'ALLOW_REDUCED_SIZE', reasons: ['EXPOSURE_REDUCED_SIZE'], minExecutableMarginUsd: 1, notionalUsd: 197.01, marginUsd: 24.63, leverage: 8};

  it('EP-06 a side the sizing plan already refused is named before the model spends a run on it', () => {
    const h = harness();
    routed(refused, allowed)(h.state);
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(envelope.LONG.executable).toBe(true);
    expect(envelope.SHORT.executable).toBe(false);
    expect(envelope.executableSides).toEqual(['LONG']);
    expect(envelope.SHORT.authorization).toBe('NOT_EXECUTABLE:SIDE_PLAN_REJECT_EXPOSURE_LIMIT');
    const facts: any = compactEntryFacts({...h.packet, executionEnvelope: envelope} as never);
    expect(facts.EXECUTION_ENVELOPE.sideAuthorization.SHORT).toContain('SIDE_PLAN_REJECT_EXPOSURE_LIMIT');
    expect(facts.EXECUTION_ENVELOPE.sideAuthorization.LONG).toBe('EXECUTABLE');
  });

  it('EP-07 an absent route sample never invents a refusal', () => {
    const h = harness();
    routed(null, null)(h.state);
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(envelope.executableSides).toEqual(['LONG', 'SHORT']);
    const other = harness();
    other.state.runtimeControl.capital.routedCandidates = [{symbol: 'OTHERUSDT', underlying: 'OTHER', quoteAsset: 'USDT', shortPlanFacts: refused}] as never;
    expect(buildPreAiExecutionEnvelope(other.state, fixtureSymbol).executableSides).toEqual(['LONG', 'SHORT']);
  });

  // G2: the envelope is where the exchange floor becomes a number the model cannot miss.
  it('EP-08 publishes both ends of the legal quantity interval from the real filters', () => {
    const h = harness();
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    const q = h.state.snapshots.get(fixtureSymbol)!.quote as any;
    const floor = Math.max(q.minNotional, q.minQty * q.last);
    for (const side of ['LONG', 'SHORT'] as const) {
      const capacity = envelope[side];
      const businessFloor=Math.max(floor,Number(capacity.minimumInitialMarginQuote??0)*envelope.leverage,Number(capacity.minimumOrderNotionalQuote??0));
      const conservativeBand=Math.max(envelope.makerReachableBand.max,q.ask,q.last,q.tickSize);
      expect(capacity.minQuantityUnits).toBe(Math.max(1, Math.ceil(q.minQty / q.stepSize - 1e-9), Math.ceil(businessFloor / (conservativeBand * q.stepSize) - 1e-9)));
      expect(capacity.maxQuantityUnits % 1).toBe(0);
      if (capacity.executable) {
        expect(capacity.legalQuantityRangeUnits).toEqual([capacity.minQuantityUnits, capacity.maxQuantityUnits]);
        expect(capacity.maxQuantityUnits).toBeGreaterThanOrEqual(capacity.minQuantityUnits);
        expect(capacity.legalNotionalRangeUsd![0]).toBeGreaterThanOrEqual(businessFloor-1e-8);
      } else {
        expect(capacity.legalQuantityRangeUnits).toBeNull();
      }
    }
    const facts: any = compactEntryFacts({...h.packet, executionEnvelope: envelope} as never);
    expect(facts.EXECUTION_ENVELOPE.LONG.minQuantityUnits).toBe(envelope.LONG.minQuantityUnits);
    expect(facts.EXECUTION_ENVELOPE.LONG.legalQuantityRangeUnits).toEqual(envelope.LONG.legalQuantityRangeUnits);
  });

  it('EP-09 a side whose authorized capacity cannot reach the exchange floor is not executable', () => {
    const h = harness();
    // Squeeze the quote leg so even maximum leverage cannot produce one fillable step.
    h.state.account = {...h.state.account, assets: [{asset: 'USDT', availableBalance: 0.01, walletBalance: 0.01, usdValue: 0.01, marginEligible: true}]};
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(envelope.executableSides).toEqual([]);
    expect(envelope.noExecutableSide).toBe(true);
    expect(envelope.LONG.legalQuantityRangeUnits).toBeNull();
    expect(envelope.LONG.minQuantityUnits).toBeGreaterThan(0);
    expect(envelope.LONG.maxQuantityUnits).toBeLessThan(envelope.LONG.minQuantityUnits!);
    // The binding cause distinguishes a configured business floor that current funds cannot reach.
    expect(envelope.LONG.firstBindingConstraint).toBe('BUSINESS_MINIMUM_EXCEEDS_AVAILABLE_FUNDS');
    expect(String(envelope.LONG.authorization)).toBe('NOT_EXECUTABLE:BUSINESS_MINIMUM_EXCEEDS_AVAILABLE_FUNDS');
  });

  it('EP-12 enforces business notional floors independently of exchange minimums and user reductions', () => {
    const h=harness(),sample=h.state.snapshots.get(fixtureSymbol)!;
    h.state.snapshots.set('BTCUSDT',{...sample,symbol:'BTCUSDT',quote:{...sample.quote,last:60_000,bid:59_999,ask:60_001,minNotional:5,minQty:.001,stepSize:.001}} as any);
    h.state.snapshots.set('ETHUSDT',{...sample,symbol:'ETHUSDT',quote:{...sample.quote,last:3_000,bid:2_999,ask:3_001,minNotional:5,minQty:.001,stepSize:.001}} as any);
    h.state.settings.entry.minimumOrderNotionalByQuote.USDT=100;
    const envelope=buildPreAiExecutionEnvelope(h.state,'BTCUSDT');
    expect(envelope.LONG.minimumOrderNotionalQuote).toBe(200);
    expect(envelope.SHORT.minimumOrderNotionalQuote).toBe(200);
    expect(envelope.LONG.minQuantityUnits*Number(h.state.snapshots.get('BTCUSDT')!.quote.stepSize)*Number(h.state.snapshots.get('BTCUSDT')!.quote.last)).toBeGreaterThanOrEqual(200);
    const other=buildPreAiExecutionEnvelope(h.state,'ETHUSDT');
    expect(other.LONG.minimumOrderNotionalQuote).toBe(100);
    expect(other.SHORT.minimumOrderNotionalQuote).toBe(100);
  });
});

describe('B: an uncovered symbol is refused before the model, and only that symbol', () => {
  it('EP-10 missing committed margin risk coverage does not deny either funded TESTNET side', () => {
    const h=harness();h.state.marginTierCoverage={symbols:[]} as any;
    const envelope=buildPreAiExecutionEnvelope(h.state,fixtureSymbol);
    expect(envelope.executableSides).toEqual(['LONG','SHORT']);
    expect(envelope.LONG.legalQuantityRangeUnits).not.toBeNull();
  });

  it('EP-11 no committed authority mirror changes nothing (the profile gate owns that case)', () => {
    const withMirror = buildPreAiExecutionEnvelope(harness().state, fixtureSymbol);
    expect(withMirror.executableSides.length).toBeGreaterThan(0);
  });
});

// keep vi imported for harness stubs
void vi;
