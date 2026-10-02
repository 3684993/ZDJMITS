import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildCompactBrainPrompt} from '@zdj/core';
import {harness} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {buildQuantityHorizonCandidates, legalTargetHorizonMinutes} from './quantityHorizonCandidates.js';

const fixtureSymbol: string = JSON.parse(
  readFileSync(new URL('./fixtures/v363-entry.json', import.meta.url), 'utf8'),
)[0].packet.symbol;

/**
 * The model is invited to choose a take-profit horizon, but the plan layer only ever writes a plan for
 * the horizons its own ladder accepts. Before this contract existed the two disagreed in silence: live
 * runs were refused with `CANDIDATE_HORIZON_UNSUPPORTED:30` because nothing had ever told the model
 * that 30 is not a legal answer. Publishing the ladder in the execution envelope - the same object the
 * plan is computed from - is what makes the invitation and the acceptance the same set.
 */
describe('V3.9.6 published target-horizon contract', () => {
  it('TH-01 the envelope publishes exactly the horizons the plan layer accepts', () => {
    const h = harness();
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    const published = (envelope.economics as {targetHorizonMinutes?: number[]}).targetHorizonMinutes;
    expect(published, 'the envelope must carry the legal horizon set').toEqual(legalTargetHorizonMinutes(h.state.settings));
    expect(published).toContain(15);
    expect(published, 'a horizon outside the ladder is not offered to the model either').not.toContain(30);
  });

  it('TH-02 the published set is the same code path the plan enforces, not a second list', () => {
    // The bug this pins: two places computing "which horizons are legal" and disagreeing, which shows
    // up in production as a refusal the model was never given a chance to avoid.
    const h = harness();
    const set = buildQuantityHorizonCandidates({
      symbol: fixtureSymbol, side: 'LONG', now: Date.now(),
      quote: (() => { const q = h.state.snapshots.get(fixtureSymbol)!.quote; return {bid: Number(q.bid), ask: Number(q.ask), tickSize: Number(q.tickSize), stepSize: Number(q.stepSize), minQty: Number(q.minQty), minNotional: Number(q.minNotional)}; })(),
      leverage: 10,
      envelope: buildPreAiExecutionEnvelope(h.state, fixtureSymbol).LONG,
      envelopeExpiresAt: Date.now() + 120_000,
      factVersion: 'horizon-contract', risk: {capitalAtRiskUsd: 100, grossNotionalAfterUsd: 1000, longNotionalAfterUsd: 1000, shortNotionalAfterUsd: 0,
        clusterNotionalUsd: 1000, clusterNotionalAfterUsd: 1000, limitingConstraints: [], riskGeneration: 1, snapshotHash: 'a'.repeat(64), profileVersion: 'b'.repeat(64), humanSlotsAfter: 1},
      settings: h.state.settings as never, candles: () => [] as never, managementDurationMs: 86_400_000,
    } as never);
    const enforced = (set.bounds ?? []).map((row: {horizonMinutes: number}) => row.horizonMinutes);
    expect(enforced.length, 'the candidate set must report the horizons it priced').toBeGreaterThan(0);
    expect(legalTargetHorizonMinutes(h.state.settings)).toEqual(enforced);
    expect((buildPreAiExecutionEnvelope(h.state, fixtureSymbol).economics as {targetHorizonMinutes?: number[]}).targetHorizonMinutes).toEqual(enforced);
    // An explicit ladder is honoured by the same function, so no second hard-coded list can drift in.
    expect(legalTargetHorizonMinutes(h.state.settings, [30, 120])).toEqual([30, 120]);
  });

  it('TH-03 the prompt tells the model which horizon values are legal, in the envelope it is already given', () => {
    const h = harness();
    const packet: any = structuredClone(h.packet);
    packet.executionEnvelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    const prompt = buildCompactBrainPrompt(packet);
    expect(prompt).toContain('profitTakePlan.targetHorizonMinutes');
    expect(prompt).toContain('EXECUTION_ENVELOPE.economics.targetHorizonMinutes');
    expect(prompt, 'the published list is data, not an instruction to prefer one horizon over another')
      .toMatch(/one of EXECUTION_ENVELOPE\.economics\.targetHorizonMinutes/i);
  });

  it('TH-04 a horizon in the published set is writable; one outside it is refused by name', async () => {
    const h = harness();
    const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
    const published = (buildPreAiExecutionEnvelope(h.state, fixtureSymbol).economics as {targetHorizonMinutes: number[]}).targetHorizonMinutes;
    const run = async (targetHorizonMinutes: number) => {
      const local = harness();
      local.state.settings.entry.minimumInitialMarginByQuote.USDT = 1;
      local.state.settings.entry.minimumOrderNotionalByQuote.USDT = 200;
      (local.ai as any).decide.mockImplementation(async () => ({
        runId: `horizon-${targetHorizonMinutes}`,
        decision: {...local.supplied, decision: 'PLACE_LONG', tradeSide: 'LONG', direction: 'LONG', structureDirection: 'LONG',
          quantityUnits: 1000, idealPrice: Number(quote.bid),
          acceptablePriceRange: {min: Number(quote.bid), max: Number(quote.ask) + Number(quote.tickSize) * 10},
          horizonMinutes: 3,
          profitTakePlan: {targetPrice: Number(quote.ask) + Number(quote.tickSize) * 20,
            acceptableTargetRange: {min: Number(quote.ask), max: Number(quote.ask) + Number(quote.tickSize) * 40},
            targetHorizonMinutes, targetReason: 'contract test', evidenceRefs: []}},
      }));
      await local.run();
      const blocked = local.events.find((event: any) => event.type === 'ENTRY_DECISION_BLOCKED' && event.payload?.stage === 'TRADE_PLAN');
      const resolved = local.events.find((event: any) => event.type === 'ENTRY_ECONOMIC_SIZE_RESOLVED');
      return {plan: local.events.some((event: any) => event.type === 'TRADE_PLAN_PERSISTED'), refusal: (blocked?.payload as any)?.reasons?.join('|') ?? null, resolved: resolved?.payload as any};
    };
    const legal = await run(published[0]);
    expect(legal.refusal ?? '', `a published horizon must be writable: ${legal.refusal}`).not.toMatch(/CANDIDATE_HORIZON_UNSUPPORTED/);
    expect(legal.resolved, 'the system must resolve an economic size before persisting Entry').toBeTruthy();
    expect(legal.resolved.notionalQuote).toBeGreaterThanOrEqual(200);
    expect(legal.resolved.quantityUnits).toBeGreaterThan(1000);
    const nonLadderPreference = await run(30);
    expect(nonLadderPreference.plan).toBe(true);
    expect(published).toContain(nonLadderPreference.resolved.targetHorizonMinutes);
  });
});
