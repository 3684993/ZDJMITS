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
      expect(envelope[side].minimumLegalNotionalUsd).toBeCloseTo(floor, 8);
      expect(envelope[side].legalNotionalRangeUsd).toEqual([floor, envelope[side].maxNotionalUsd]);
      expect(envelope[side].firstBindingConstraint).toBeTruthy();
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

  it('EP-03 tells the model the other side is not executable without choosing for it', () => {
    const h = harness();
    squeezeLong(h.state);
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(envelope.SHORT.executable).toBe(true);
    expect(envelope.LONG.executable).toBe(false);
    expect(envelope.executableSides).toEqual(['SHORT']);
    expect(envelope.sideAuthorization.LONG.startsWith('NOT_EXECUTABLE:')).toBe(true);
    const packet = {...h.packet, executionEnvelope: envelope} as never;
    const facts: any = compactEntryFacts(packet);
    expect(facts.EXECUTION_ENVELOPE.sideAuthorization).toEqual(envelope.sideAuthorization);
    expect(facts.EXECUTION_ENVELOPE.executableSides).toEqual(['SHORT']);
    // S06-T01: the envelope never rewrites a direction.
    expect(envelope.LONG.authorization).not.toContain('USE_SHORT');
  });

  it('EP-04 a model choice outside the envelope is named as a violation and is not remapped', async () => {
    const h = armedHarness('LONG', squeezeLong);
    await h.run();
    const blocked = h.events.filter((event: any) => event.type === 'ENTRY_DECISION_BLOCKED' && event.payload?.stage === 'POST_PRIMARY_EXECUTION_ENVELOPE');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.at(-1).payload).toMatchObject({reason: 'AI_DIRECTION_NOT_EXECUTABLE', violation: 'MODEL_SELECTION_OUTSIDE_EXECUTABLE_ENVELOPE', direction: 'LONG', executableSides: ['SHORT']});
    expect(String(blocked.at(-1).payload.envelopeAuthorization)).toMatch(/^NOT_EXECUTABLE:/);
    // It stays a refusal on the side the model chose: no silent flip, no reservation, no order.
    expect(h.state.entryIntents.size).toBe(0);
    expect(h.state.entryOrders.size).toBe(0);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    const flipped = h.events.filter((event: any) => event.payload?.direction === 'SHORT' && event.type === 'ENTRY_INTENT_CREATED');
    expect(flipped.length).toBe(0);
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
});

// keep vi imported for harness stubs
void vi;
