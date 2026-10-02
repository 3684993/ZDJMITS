import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildCompactBrainPrompt} from '@zdj/core';
import {harness,systemCandidateDecision} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {buildQuantityHorizonCandidates, legalTargetHorizonMinutes} from './quantityHorizonCandidates.js';

const fixtureSymbol: string = JSON.parse(
  readFileSync(new URL('./fixtures/v363-entry.json', import.meta.url), 'utf8'),
)[0].packet.symbol;

/**
 * The model chooses a system candidate, and therefore chooses only a horizon already priced by that
 * candidate. It may restate the candidate horizon, but it may not author a replacement horizon.
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

  it('TH-03 the prompt makes the candidate menu the only target-horizon authority', () => {
    const h = harness();
    const packet: any = structuredClone(h.packet);
    packet.executionEnvelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    const prompt = buildCompactBrainPrompt(packet);
    expect(prompt).toContain('selectedCandidateId');
    expect(prompt).toContain('planCandidates');
    expect(prompt).toContain('targetHorizonMinutes');
    expect(prompt).toMatch(/engine resolves exact frozen values, never another row or a fresh recomputation/i);
    expect(prompt).toContain('copy candidateSetHash and candidateSetFactVersion');
    expect(prompt).toContain('Do not output quantityUnits or profitTakePlan');
  });

  it('TH-04 a candidate horizon is writable; a model-authored replacement is refused by name', async () => {
    const h = harness();
    const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
    const published = (buildPreAiExecutionEnvelope(h.state, fixtureSymbol).economics as {targetHorizonMinutes: number[]}).targetHorizonMinutes;
    const run = async (targetHorizonMinutes: number) => {
      const local = harness();
      (local.ai as any).decide.mockImplementation(async(packet:any)=>{
        const offered=packet.executionEnvelope.LONG.planCandidates as any[];
        const candidate=offered.find(row=>row.targetHorizonMinutes===targetHorizonMinutes)??offered[0];
        const decision=systemCandidateDecision(packet,local.supplied,'LONG',{selectedCandidateId:candidate.candidateId,
          idealPrice:Number(quote.bid),acceptablePriceRange:{min:Number(quote.bid),max:Number(quote.ask)+Number(quote.tickSize)*10},horizonMinutes:3});
        if(targetHorizonMinutes===30)decision.profitTakePlan={...decision.profitTakePlan,targetHorizonMinutes};
        return{runId:`horizon-${targetHorizonMinutes}`,decision};
      });
      await local.run();
      const blocked=local.events.find((event:any)=>event.type==='ENTRY_DECISION_BLOCKED'&&event.payload?.stage==='POST_AI_CANDIDATE_VERIFY');
      return{plan:local.events.some((event:any)=>event.type==='TRADE_PLAN_PERSISTED'),refusal:String((blocked?.payload as any)?.reason??'')};
    };
    const legal = await run(published[0]);
    expect(legal.plan,`a published candidate horizon must be writable: ${legal.refusal}`).toBe(true);
    const illegal = await run(30);
    expect(illegal.plan).toBe(false);
    expect(illegal.refusal ?? '').toBe('AI_CANDIDATE_TARGET_RESTATEMENT_MISMATCH');
  });
});
