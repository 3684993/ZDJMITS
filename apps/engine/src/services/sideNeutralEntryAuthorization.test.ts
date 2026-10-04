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

  it('submits the exact non-minimum candidate chosen by Primary while legacy policy bans LONG outright', async () => {
    const h = harness();
    armLegacyShortBias(h.state);
    const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
    const idealPrice = Number(quote.bid);
    const acceptablePriceRange = { min: idealPrice, max: Number(quote.ask) + Number(quote.tickSize) * 10 };

    const before = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(before.LONG.executable, 'fresh envelope must offer LONG objectively executable').toBe(true);
    expect(before.SHORT.executable, 'fresh envelope must offer SHORT objectively executable').toBe(true);

    let chosen:any=null;
    (h.ai as any).decide.mockImplementation(async (decisionPacket:any) => {
      const rows=decisionPacket.executionEnvelope.LONG.planCandidates;
      chosen=rows[rows.length-1];
      return {runId:'side-neutral-run',decision:h.candidateDecision(decisionPacket,'LONG',rows.length-1,{idealPrice,acceptablePriceRange})};
    });

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
    expect(intent.quantityUnits, 'the Primary-selected candidate must survive unchanged').toBe(chosen.quantityUnits);
    expect(intent.selectedCandidateId).toBe(chosen.candidateId);
    expect(intent.acceptablePriceRange).toEqual(acceptablePriceRange);
    expect(intent.directionPolicy ?? 'ABSENT').not.toBe('SHORT_ONLY');
    const plan = [...h.state.allocationPlans.values()][0] as any;
    expect(plan.reasons).toContain('NO_DIRECTION_POLICY_RESIZING');
    expect(plan.reasons).toContain('NO_POST_SELECTION_RESIZING');
    expect(plan.direction, 'allocation must materialize the AI side, not the legacy preference').toBe('LONG');
    expect(h.events.some((e: any) => e.type === 'AI_CANDIDATE_SELECTED' && e.payload?.selectedCandidateId === chosen.candidateId && e.payload?.selectionAuthority === 'PRIMARY')).toBe(true);
    expect(h.events.some((e: any) => e.payload?.authority === 'SYSTEM_ECONOMIC_CANDIDATE_SOLVER')).toBe(false);
  });

  it('ignores redundant raw quantity and executes the frozen candidate quantity chosen by Primary', async () => {
    const h = harness();
    armLegacyShortBias(h.state);
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
    const oversized = envelope.LONG.maxQuantityUnits + 1;
    let chosen:any=null;
    (h.ai as any).decide.mockImplementation(async (decisionPacket:any) => {
      const valid=h.candidateDecision(decisionPacket,'LONG',0,{idealPrice:Number(quote.bid),acceptablePriceRange:{min:Number(quote.bid),max:Number(quote.ask)}});
      chosen=decisionPacket.executionEnvelope.LONG.planCandidates.find((row:any)=>row.candidateId===valid.selectedCandidateId);
      return {runId:'over-envelope-run',decision:{...valid,quantityUnits:oversized}};
    });
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.state.entryIntents.size).toBe(1);
    const intent=[...h.state.entryIntents.values()][0] as any;
    expect(intent.quantityUnits).toBe(chosen.quantityUnits);
    expect(intent.quantityUnits).not.toBe(oversized);
    expect(h.events.some((e: any) => e.type === 'POST_AI_REDUNDANT_FIELD_NORMALIZED'
      && e.payload?.field === 'quantityUnits' && e.payload?.postAiVeto === false)).toBe(true);
    expect(h.events.some((e:any)=>e.type==='CANDIDATE_REJECTED'&&e.payload?.reason==='AI_RAW_QUANTITY_AUTHORITY_FORBIDDEN')).toBe(false);
  });
});
