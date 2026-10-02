import {describe, it, expect, vi} from 'vitest';
import {ScoutObservationSampler, SCOUT_OBSERVATION_POLICY} from './scoutObservationPolicy.js';
import {harness} from './tradingQualityTestHarness.js';

describe('bounded independent Scout observations', () => {
  it('samples at most every tenth completed Primary, at least five minutes apart, with one in flight', () => {
    const sampler = new ScoutObservationSampler();
    for (let i = 1; i < 10; i++) expect(sampler.tryReserve(1_000).sampled).toBe(false);
    expect(sampler.tryReserve(1_000)).toMatchObject({sampled:true, completedPrimary:10});
    for (let i = 11; i < 20; i++) sampler.tryReserve(999_000);
    expect(sampler.tryReserve(999_000)).toMatchObject({sampled:false, reason:'OBSERVER_IN_FLIGHT'});
    sampler.release();
    for (let i = 21; i < 30; i++) sampler.tryReserve(2_000);
    expect(sampler.tryReserve(2_000)).toMatchObject({sampled:false, reason:'SAMPLE_INTERVAL'});
    for (let i = 31; i < 40; i++) sampler.tryReserve(301_000);
    expect(sampler.tryReserve(301_000)).toMatchObject({sampled:true, completedPrimary:40});
    expect(SCOUT_OBSERVATION_POLICY.maxInFlight).toBe(1);
  });

  it('does not run Scout for the first completed Primary and passes no annotation', async () => {
    const h = harness();
    h.state.settings.ai.scoutEnabled = true;
    h.state.settings.ai.scoutExperimentMode = 'SAMPLED_SHADOW';
    const observeScout = vi.fn();
    Object.assign(h.ai, {observeScout});
    await h.run();
    expect(h.ai.scout).not.toHaveBeenCalled();
    expect(observeScout).not.toHaveBeenCalled();
    expect(h.ai.decide).toHaveBeenCalledWith(expect.anything(), null, expect.any(Number), undefined, expect.objectContaining({signal:expect.any(AbortSignal)}));
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });

  it('submits the already authorized order while a sampled observer remains unresolved', async () => {
    const h = harness();
    h.state.settings.ai.scoutEnabled = true;
    h.state.settings.ai.scoutExperimentMode = 'SAMPLED_SHADOW';
    const sampler = (h.coordinator as any).scoutObserver as ScoutObservationSampler;
    for (let i = 0; i < 9; i++) sampler.tryReserve();
    let complete!: (value:any) => void;
    const observeScout = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    Object.assign(h.ai, {observeScout});
    await h.run();
    expect(h.ai.scout).not.toHaveBeenCalled();
    expect(observeScout).toHaveBeenCalledOnce();
    expect(h.ai.decide.mock.invocationCallOrder[0]).toBeLessThan(observeScout.mock.invocationCallOrder[0]);
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.events.some(e => e.type === 'SCOUT_SAMPLED_OBSERVATION_RESULT')).toBe(false);
    complete({status:'COMPLETED', annotation:{summary:'observe only'}});
    await new Promise(resolve => setImmediate(resolve));
    expect(h.events.find(e => e.type === 'SCOUT_SAMPLED_OBSERVATION_RESULT')?.payload).toMatchObject({
      status:'COMPLETED', handedToPrimary:false, executionAuthority:false, primaryBlocked:false,
      observesFrozenPastPacket:true, brainRunId:'fixture-run',
    });
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });

  it('observer failure stays telemetry and cannot reject or reverse the decision', async () => {
    const h = harness();
    h.state.settings.ai.scoutEnabled = true;
    h.state.settings.ai.scoutExperimentMode = 'SAMPLED_SHADOW';
    for (let i = 0; i < 9; i++) (h.coordinator as any).scoutObserver.tryReserve();
    Object.assign(h.ai, {observeScout:vi.fn(async () => { throw new Error('OBSERVER_FIXTURE_FAILURE'); })});
    await h.run();
    await new Promise(resolve => setImmediate(resolve));
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.events.find(e => e.type === 'SCOUT_SAMPLED_OBSERVATION_RESULT')?.payload).toMatchObject({
      status:'FAILED', reason:'OBSERVER_FIXTURE_FAILURE', primaryBlocked:false, executionAuthority:false,
    });
    expect(h.state.candidateLifecycle.get(h.packet.symbol)?.status).toBe('ENTRY_WORKING');
  });
});
