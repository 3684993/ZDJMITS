import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {harness} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope,type PreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {evaluatePreAiPlanFeasibility} from './preAiPlanFeasibility.js';
import {quantityLadder} from './quantityHorizonCandidates.js';

const fixtureSymbol: string = JSON.parse(
  readFileSync(new URL('./fixtures/v363-entry.json', import.meta.url), 'utf8'),
)[0].packet.symbol;

type Side = 'LONG' | 'SHORT';

const withSide = (env: PreAiExecutionEnvelope, side: Side, over: Record<string, unknown>): PreAiExecutionEnvelope =>
  ({...structuredClone(env), [side]: {...(env[side] as any), ...over}});

const settingsWith = (over: Record<string, any>) => ({...structuredClone(harness().state.settings), ...over} as any);

const envelopeOf = () => buildPreAiExecutionEnvelope(harness().state, fixtureSymbol);

/** A harness whose Primary returns a legal, in-envelope LONG, so a refusal can only come from a gate. */
function armedHarness() {
  const h = harness();
  const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
  (h.ai as any).decide.mockImplementation(async (decisionPacket:any) => ({
    runId: 'pre-ai-feasibility-run',
    decision: h.candidateDecision(decisionPacket,'LONG',0,{
      idealPrice: Number(quote.bid),
      acceptablePriceRange: {min: Number(quote.bid), max: Number(quote.ask) + Number(quote.tickSize) * 10},
      horizonMinutes: 3,
    }),
  }));
  return h;
}

describe('V3.9.6 pre-AI hard plan feasibility', () => {
  it('PF-01 a fully executable envelope on both sides is not a reason to skip the model', () => {
    const envelope = envelopeOf();
    expect(envelope.LONG.executable && envelope.SHORT.executable).toBe(true);
    const probe = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope, settings: settingsWith({})});
    expect(probe.noHardExecutableSide, JSON.stringify(probe.sides)).toBe(false);
    for (const side of ['LONG', 'SHORT'] as const) {
      expect(probe.sides[side].executable).toBe(true);
      expect(probe.sides[side].reasons).toEqual([]);
      expect(probe.sides[side].quantityUnits).toBeGreaterThan(0);
    }
  });

  it('PF-02 the risk headroom that already refuses a side is named, not flattened into one reason', () => {
    const envelope = envelopeOf();
    const blocked = withSide(withSide(envelope, 'LONG', {
      executable: false,
      maxNotionalUsd: 0,
      maxQuantityUnits: 0,
      riskHeadroom: {...envelope.LONG.riskHeadroom, blockers: ['MAX_GROSS_EXPOSURE'], reason: 'MAX_GROSS_EXPOSURE'},
    }), 'SHORT', {
      executable: false,
      maxNotionalUsd: 0,
      maxQuantityUnits: 0,
      riskHeadroom: {...envelope.SHORT.riskHeadroom, blockers: ['NO_FREE_MARGIN'], reason: 'NO_FREE_MARGIN'},
    });
    const probe = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: blocked, settings: settingsWith({})});
    expect(probe.noHardExecutableSide).toBe(true);
    expect(probe.sides.LONG.reasons).toContain('MAX_GROSS_EXPOSURE');
    expect(probe.sides.SHORT.reasons).toContain('NO_FREE_MARGIN');
    expect(probe.sides.LONG.reasons).not.toContain('NO_FREE_MARGIN');
  });

  it('PF-03 an unreachable hard profit floor refuses at the minimum legal size, never by growing it', () => {
    const envelope = envelopeOf();
    const probe = evaluatePreAiPlanFeasibility({
      symbol: fixtureSymbol,
      now: Date.now(),
      envelope,
      settings: (() => { const base = settingsWith({}); return settingsWith({takeProfit: {...base.takeProfit, minNetProfitUsd: 1e9}}); })(),
    });
    expect(probe.noHardExecutableSide).toBe(true);
    const quote = envelope.exchange;
    for (const side of ['LONG', 'SHORT'] as const) {
      const row = probe.sides[side];
      expect(row.executable).toBe(false);
      expect(row.reasons[0]).toBe('MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY');
      const printed = row.reasons.filter((r) => r.startsWith('MIN_NET_PROFIT_USD=') || r.startsWith('ATTAINED_NET_PROFIT_USD='));
      expect(printed.length).toBe(2);
      const [min, attained] = [Number(printed[0].split('=')[1]), Number(printed[1].split('=')[1])];
      expect(attained).toBeLessThan(min);
      // Sizing to the outcome is forbidden: the probe tests exactly the smallest legal quantity,
      // priced at the favourable edge of the maker band it is allowed to hope for.
      const entryPrice = side === 'LONG' ? envelope.makerReachableBand.min : envelope.makerReachableBand.max;
      const ladder = quantityLadder(1, envelope[side].maxQuantityUnits, quote.stepSize, entryPrice, quote.minNotional);
      expect(row.quantityUnits).toBe(ladder[0]);
    }
  });

  it('PF-04 historical statistics cannot answer this question in either admission mode', () => {
    const envelope = envelopeOf();
    const answers = (['OFF', 'SHADOW', 'ENFORCE'] as const).map((admissionMode) =>
      evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope, settings: settingsWith({tradeEconomics: {admissionMode}})}));
    for (const answer of answers) {
      expect(Object.keys(answer), 'the probe exposes no statistical veto channel at all').not.toContain('statisticalEvidence');
      expect(answer.sides.LONG.statisticalEvidence).toEqual([]);
      expect(answer.sides.SHORT.statisticalEvidence).toEqual([]);
      expect(answer.noHardExecutableSide).toBe(false);
    }
    const [off, shadow, enforce] = answers;
    expect(shadow.sides).toEqual(off.sides);
    expect(enforce.sides).toEqual(off.sides);
  });

  it('PF-05 one hard-blocked side does not skip the model and does not imply a preferred side', () => {
    const envelope = envelopeOf();
    const blocked = withSide(envelope, 'SHORT', {
      executable: false,
      maxNotionalUsd: 0,
      maxQuantityUnits: 0,
      riskHeadroom: {...envelope.SHORT.riskHeadroom, blockers: ['MAX_DIRECTION_EXPOSURE'], reason: 'MAX_DIRECTION_EXPOSURE'},
    });
    const probe = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: blocked, settings: settingsWith({})});
    expect(probe.noHardExecutableSide).toBe(false);
    expect(probe.sides.SHORT.executable).toBe(false);
    expect(probe.sides.LONG.executable).toBe(true);
    // The probe reports capacity; it must not read as a recommendation, so it carries no ranking field.
    expect(JSON.stringify(probe)).not.toMatch(/preferred|recommend|suggest/i);
  });

  it('PF-09 the probe answers the same way whatever the adverse band edge looks like', () => {
    const base = structuredClone(envelopeOf());
    // A feasibility probe may only refuse when no legal price could clear the floor. If it read the
    // adverse edge of the maker band, widening that edge would change the answer and the pipeline
    // would silently stop calling the model on opportunities the plan would have written.
    const narrow: PreAiExecutionEnvelope = {...base, makerReachableBand: {min: base.makerReachableBand.min, max: base.makerReachableBand.min * 1.002}};
    const wide: PreAiExecutionEnvelope = {...base, makerReachableBand: {min: base.makerReachableBand.min, max: base.makerReachableBand.min * 1.4}};
    const settings = settingsWith({});
    const tight = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: narrow, settings});
    const loose = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: wide, settings});
    expect(loose.sides.LONG, 'the LONG answer is priced at the favourable edge only').toEqual(tight.sides.LONG);
    // The mirrored case: SHORT reads the upper edge, so moving only the lower edge cannot change it.
    const lowBand: PreAiExecutionEnvelope = {...base, makerReachableBand: {min: base.makerReachableBand.max * 0.6, max: base.makerReachableBand.max}};
    const sameTop: PreAiExecutionEnvelope = {...base, makerReachableBand: {min: base.makerReachableBand.max, max: base.makerReachableBand.max}};
    const dropped = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: lowBand, settings});
    const held = evaluatePreAiPlanFeasibility({symbol: fixtureSymbol, now: Date.now(), envelope: sameTop, settings});
    expect(dropped.sides.SHORT).toEqual(held.sides.SHORT);
    expect(dropped.sides.SHORT.executable).toBe(true);
  });

  it('PF-06 the whole chain still calls Primary when a legal hard path exists', async () => {
    const h = armedHarness();
    await h.run();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.exchange.placeEntry, `the fixture must reach the wire; events=${h.events.map((e: any) => e.type).join(',')}`).toHaveBeenCalledOnce();
  });

  it('PF-07 a hard profit floor on both sides is settled before Primary, so the model is not spent', async () => {
    const h = armedHarness();
    h.state.settings.takeProfit.minNetProfitUsd = 1e9;
    // Nothing mechanical changed: the envelope still offers both sides, so the only possible
    // pre-AI refusal is the plan-feasibility probe reading the same arithmetic as the plan layer.
    const envelope = buildPreAiExecutionEnvelope(h.state, fixtureSymbol);
    expect(envelope.LONG.executable && envelope.SHORT.executable).toBe(true);
    await h.run();
    expect(h.ai.decide, 'a refusal the deterministic layer can prove must not cost a model run').not.toHaveBeenCalled();
    const blocked = h.events.filter((e: any) => e.type === 'ENTRY_DECISION_BLOCKED' && e.payload?.stage === 'PRE_AI_TRADE_PLAN');
    expect(blocked.length).toBe(1);
    expect(blocked[0].payload.reason).toBe('PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE');
    const sides = blocked[0].payload.sides as Record<Side, {reasons: string[]}>;
    expect(sides.LONG.reasons).toContain('MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY');
    expect(sides.SHORT.reasons).toContain('MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY');
    const rejected = h.events.filter((e: any) => e.type === 'CANDIDATE_REJECTED');
    expect(rejected.map((e: any) => e.payload.reason)).toEqual(['PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE']);
    expect(rejected[0].payload.entryIntentCreated).toBe(false);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
  });

  it('PF-08 a refusal is written with the symbol and never leaks into the next run', async () => {
    const h = armedHarness();
    h.state.settings.takeProfit.minNetProfitUsd = 1e9;
    await h.run();
    const refusals = () => h.events.filter((e: any) => e.type === 'ENTRY_DECISION_BLOCKED' && e.payload?.stage === 'PRE_AI_TRADE_PLAN');
    expect(refusals()[0].symbol).toBe(fixtureSymbol);
    expect(refusals()[0].brainRunId ?? null).toBe(null);
    const first = h.events.length;
    h.state.settings.takeProfit.minNetProfitUsd = 1;
    await h.run();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.events.slice(first).filter((e: any) => e.payload?.stage === 'PRE_AI_TRADE_PLAN').length).toBe(0);
  });
});
