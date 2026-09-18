import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCompactBrainPrompt } from '@zdj/core';
import { harness } from './tradingQualityTestHarness.js';
import { buildPreAiExecutionEnvelope } from './preAiExecutionEnvelope.js';

const fixtureSymbol: string = JSON.parse(
  readFileSync(new URL('./fixtures/v363-entry.json', import.meta.url), 'utf8'),
)[0].packet.symbol;

// The hostile legacy surface V3.9.4 must not obey: a NEW_LISTING tier whose
// preference bans LONG, plus a per-symbol SHORT_ONLY override and a preferred
// direction of SHORT that the AI packet would still be stamped with.
function armLegacyShortBias(state: any) {
  state.settings.portfolioIntelligence.globalDirectionPreference = 'INTELLIGENT_SHORT_BIAS';
  state.settings.portfolioIntelligence.tierDirectionPreferences.NEW_LISTING = 'SHORT_ONLY';
  state.settings.portfolioIntelligence.symbolDirectionPreferences = {
    ...(state.settings.portfolioIntelligence.symbolDirectionPreferences ?? {}),
    [fixtureSymbol]: 'SHORT_ONLY',
  };
  state.universe[0] = { ...state.universe[0], riskTier: 'NEW_LISTING' };
}

const legacyDirectionKeys = ['preferredDirection', 'directionPreference', 'allowedDirections', 'longExceptionRequired', 'SHORT_ONLY', 'INTELLIGENT_SHORT_BIAS'];

describe('V3.9.4 side-neutral Entry authorization', () => {
  it('carries the legacy direction surface into the packet without leaking it into the Primary prompt', () => {
    const h = harness();
    const packet: any = structuredClone(h.packet);
    packet.executionEnvelope = buildPreAiExecutionEnvelope(h.state, packet.symbol);
    packet.portfolioIntelligence = {
      ...(packet.portfolioIntelligence ?? {}),
      riskTier: 'NEW_LISTING',
      directionPolicy: 'SHORT_ONLY',
      directionPreference: 'SHORT_ONLY',
      allowedDirections: ['SHORT'],
      preferredDirection: 'SHORT',
      longExceptionRequired: true,
      reasons: ['DIRECTION_PREFERENCE_SHORT_ONLY'],
    };
    const prompt = buildCompactBrainPrompt(packet);
    for (const key of legacyDirectionKeys) {
      expect(prompt.includes(key), `Primary prompt must not carry legacy direction answer key ${key}`).toBe(false);
    }
    expect(prompt).toContain('Independently test BOTH LONG and SHORT');
    expect(packet.portfolioIntelligence.preferredDirection).toBe('SHORT');
  });

  it('submits the AI LONG with AI quantity and AI range while legacy policy bans LONG outright', async () => {
    const quantityUnits = 1000;
    const h = harness();
    armLegacyShortBias(h.state);
    const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
    const idealPrice = Number(quote.bid);
    const acceptablePriceRange = { min: idealPrice, max: Number(quote.ask) + Number(quote.tickSize) * 10 };

    const before = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(before.LONG.executable, 'fresh envelope must offer LONG objectively executable').toBe(true);
    expect(before.SHORT.executable, 'fresh envelope must offer SHORT objectively executable').toBe(true);

    (h.ai as any).decide.mockImplementation(async () => ({
      runId: 'side-neutral-run',
      decision: {
        ...h.supplied,
        decision: 'PLACE_LONG',
        tradeSide: 'LONG',
        direction: 'LONG',
        structureDirection: 'LONG',
        quantityUnits,
        idealPrice,
        acceptablePriceRange,
        horizonMinutes: 3,
      },
    }));

    await h.run();

    // A legacy veto is a veto by name: the pre-3.9.4 chain reported these exact reasons/types.
    // Key names that merely travel inside an intent payload (directionPolicy:"BOTH") are not vetoes.
    const LEGACY_VETOES = ['DIRECTION_NOT_ALLOWED', 'SPECULATIVE_LONG_EXCEPTION_EVIDENCE_REQUIRED'];
    const vetoed = h.events.filter((e: any) =>
      e.type === 'ENTRY_DIRECTION_POLICY_BLOCKED'
      || LEGACY_VETOES.includes(String(e.payload?.reason ?? ''))
      || LEGACY_VETOES.includes(String((e.payload as any)?.decisionContext?.reason ?? '')));
    expect(vetoed.map((e: any) => e.type), 'legacy direction policy must not veto the AI LONG').toEqual([]);

    expect(h.exchange.placeEntry, `intent must reach the wire; events=${h.events.map((e: any) => e.type).join(',')}`).toHaveBeenCalledOnce();
    const submitted = h.exchange.placeEntry.mock.calls[0][0] as any;
    expect(submitted.symbol).toBe(fixtureSymbol);
    expect(submitted.side, 'AI side must survive to order submission').toBe('LONG');
    expect(submitted.price).toBeGreaterThanOrEqual(acceptablePriceRange.min);
    expect(submitted.price).toBeLessThanOrEqual(acceptablePriceRange.max);

    const intent = [...h.state.entryIntents.values()][0] as any;
    expect(intent).toBeDefined();
    expect(intent.side).toBe('LONG');
    expect(intent.quantityUnits, 'legacy policy must not clamp AI quantityUnits').toBe(quantityUnits);
    expect(intent.acceptablePriceRange).toEqual(acceptablePriceRange);
    expect(intent.directionPolicy ?? 'ABSENT').not.toBe('SHORT_ONLY');
    const plan = [...h.state.allocationPlans.values()][0] as any;
    expect(plan.reasons).toContain('NO_DIRECTION_POLICY_RESIZING');
    expect(plan.direction, 'allocation must materialize the AI side, not the legacy preference').toBe('LONG');
  });

  it('still rejects an over-envelope AI quantity instead of clamping it under legacy bias', async () => {
    const h = harness();
    armLegacyShortBias(h.state);
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
    const oversized = envelope.LONG.maxQuantityUnits + 1;
    (h.ai as any).decide.mockImplementation(async () => ({
      runId: 'over-envelope-run',
      decision: {
        ...h.supplied, decision: 'PLACE_LONG', tradeSide: 'LONG', direction: 'LONG',
        quantityUnits: oversized, idealPrice: Number(quote.bid),
        acceptablePriceRange: { min: Number(quote.bid), max: Number(quote.ask) }, horizonMinutes: 3,
      },
    }));
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.some((e: any) => e.type === 'AI_SIZING_ERROR' && JSON.stringify(e.payload).includes('AI_QUANTITY_EXCEEDS_ENVELOPE'))).toBe(true);
    expect([...h.state.entryIntents.values()][0]).toBeUndefined();
  });
});
