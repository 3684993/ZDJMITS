import {afterEach, expect, it, vi} from 'vitest';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';
import {harness} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {factBoundWire} from '../testing/factBoundReferenceFixture.js';

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

it('returns the archived Primary completion timestamp even when completion auditing delays the caller', async () => {
  const startedAt = Date.now();
  let now = startedAt;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fetchMock = vi.fn(() => {throw new Error('NETWORK_FORBIDDEN_IN_DECISION_CLOCK_TEST');});
  vi.stubGlobal('fetch', fetchMock);
  const h = harness();
  h.state.settings.ai.decisionTimeoutMs = 180_000; // Match the native timing sample and its authorized envelope.
  h.state.aiResources = loadAiResources(h.state.settings);
  const ai = new AiFabric(h.state, h.bus, {} as never);
  const envelope = buildPreAiExecutionEnvelope(h.state, h.packet.symbol);
  (h.coordinator as any).buildPreAiCandidateSets(h.packet.symbol, envelope);
  const packet = {...h.packet, executionEnvelope: envelope};
  const quote = h.packet.market.quote;
  const raw = factBoundWire(packet, {
    action: 'FINAL', schemaVersion: 'V3.9.7-R1', decision: 'PLACE_LONG', tradeSide: 'LONG', structureDirection: 'LONG',
    selectedCandidateId: envelope.LONG.planCandidates![0].candidateId, candidateSetHash: envelope.LONG.candidateSetHash, candidateSetFactVersion: envelope.LONG.candidateSetFactVersion, confidence: 0.8,
    trend1dRole: 'NEUTRAL', trend4hRole: 'NEUTRAL', trend15mRole: 'NEUTRAL', alignmentClass: 'MIXED',
    counterTrendException: false, counterTrendReason: null, opportunityType: 'TREND_RESUMPTION', marketRegime: 'TRANSITION',
    idealPrice: quote.bid, acceptablePriceRange: {min: quote.bid, max: quote.ask}, horizonMinutes: 3, waitCondition: null,
    directionReason: 'Model selects LONG from the supplied facts.', timingReason: 'Use the authorized maker range.',
    entryLocationReason: 'Maker entry is bounded by the published range.', reason: 'A bounded LONG decision.',
    entryInvalidation: 'Expire authorization when the execution window closes.', supportingEvidenceRefs: [],
    rejectLayer: 'NONE', blockingCondition: '', releaseCondition: '', timingEvent: null,
  });
  const runJson = vi.spyOn((ai as any).openAi, 'runJson').mockImplementation(async (args: any) => {
    now += 135_664;
    return {value: args.parse(raw), raw: {choices: [{message: {content: JSON.stringify(raw)}}]},
      inputTokens: 14_335, outputTokens: 655, finishReason: 'stop', modelIdentity: null,
      timing: {requestMs: 135_664, retryMs: 0, parseMs: 0}};
  });
  h.bus.on('event', event => {if (event.type === 'AI_RUN_COMPLETED') now += 5_000;});

  const result = await ai.decide(packet);
  expect(runJson).toHaveBeenCalledOnce();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(result).toMatchObject({decision: {decision: 'PLACE_LONG'}, latencyMs: 135_664, decisionCompletedAt: startedAt + 135_664});
  expect(h.state.aiRuns.find(run => run.id === result.runId)).toMatchObject({status: 'COMPLETED', terminalStage: 'SCHEMA_VALID', startedAt, completedAt: startedAt + 135_664});
  expect(Date.now()).toBe(startedAt + 140_664);
  expect(result.decisionCompletedAt).toBeLessThan(Date.now());
});
