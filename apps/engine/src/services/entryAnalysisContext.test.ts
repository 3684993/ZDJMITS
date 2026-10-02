import {afterEach,describe,expect,it,vi} from 'vitest';
import {EntryAnalysisContext,ENTRY_PRIMARY_SLOT_WAIT_MS,ENTRY_PACKET_PREPARATION_MS} from './entryAnalysisContext.js';
import {harness,systemCandidateDecision} from './tradingQualityTestHarness.js';
import {noEdgeReviewFacts} from './decisionContext.js';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('analysis cancellation and independent stage clocks',()=>{
  it('checks the absolute stage deadline even when synchronous work delays the timer',async()=>{
    vi.useFakeTimers();const context=new EntryAnalysisContext(()=>'same');
    await expect(context.run('PREPARATION',async()=>{vi.setSystemTime(Date.now()+45001);return 'late';},45000))
      .rejects.toThrow('ENTRY_PREPARATION_DEADLINE_EXCEEDED');
    expect(context.signal.aborted).toBe(true);context.dispose();
  });
  it('expires a blocked stage and never consumes its eventual result',async()=>{
    vi.useFakeTimers();let key='a',late!:(value:number)=>void;
    const context=new EntryAnalysisContext(()=>key);
    const result=context.run('PREPARATION',()=>new Promise<number>(resolve=>{late=resolve;}),45_000).catch(error=>error);
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await result).message).toBe('ENTRY_PREPARATION_DEADLINE_EXCEEDED');
    expect(context.signal.aborted).toBe(true);
    late(1);await Promise.resolve();
    expect(()=>context.check()).toThrow('ENTRY_PREPARATION_DEADLINE_EXCEEDED');context.dispose();
  });
  it('cancels a native request after configuration changes and discards a late PLACE',async()=>{
    vi.useFakeTimers();const h=harness();let late!:(value:any)=>void;let packet:any,signal:AbortSignal|undefined;
    h.ai.decide.mockImplementation((...args:any[])=>{packet=args[0];signal=args[4].signal;return new Promise(resolve=>{late=resolve;});});
    const run=h.run();await vi.advanceTimersByTimeAsync(1);
    expect(h.ai.decide).toHaveBeenCalledOnce();
    h.state.settings.settingsVersion++;
    await vi.advanceTimersByTimeAsync(100);await run;
    expect(signal?.aborted).toBe(true);
    late({decision:systemCandidateDecision(packet,h.supplied),runId:'late'});
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.entryIntents.size).toBe(0);expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.find(e=>e.type==='ENTRY_ANALYSIS_CANCELLED')?.payload).toMatchObject({reason:'ENTRY_ANALYSIS_CONTEXT_CHANGED',backendCancellation:'UNKNOWN'});
    expect(h.state.candidateLifecycle.get(h.packet.symbol)).toMatchObject({status:'TECHNICAL_COOLDOWN',failureCount:0});
    expect((h.coordinator as any).active.size).toBe(0);
  });
  it('bounds the Primary slot without consuming a model call or leaking its waiter',async()=>{
    vi.useFakeTimers();const h=harness();Object.assign(h.ai,{hasCapacity:()=>false,isCircuitOpen:()=>false});
    const run=h.run();await vi.advanceTimersByTimeAsync(ENTRY_PRIMARY_SLOT_WAIT_MS);await run;
    expect(h.ai.decide).not.toHaveBeenCalled();expect((h.coordinator as any).primaryWaiters.size).toBe(0);
    expect(h.events.find(e=>e.type==='ENTRY_ANALYSIS_CANCELLED')?.payload.reason).toBe('ENTRY_PRIMARY_SLOT_DEADLINE_EXCEEDED');
    expect(h.events.find(e=>e.type==='ENTRY_ANALYSIS_CANCELLED')?.payload.slotWaitMs).toBe(30000);
  });
  it('bounds a dependency refresh and does not continue after the late refresh completes',async()=>{
    vi.useFakeTimers();const h=harness();let finish!:()=>void;
    const prepare=vi.spyOn(h.coordinator as any,'ensureEipDependencies').mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const run=h.run();await vi.advanceTimersByTimeAsync(ENTRY_PACKET_PREPARATION_MS);await run;
    finish();await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledOnce();expect(h.ai.decide).not.toHaveBeenCalled();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.find(e=>e.type==='ENTRY_ANALYSIS_CANCELLED')?.payload.reason).toBe('ENTRY_PREPARATION_DEADLINE_EXCEEDED');
  });
  it('prevents duplicate simultaneous analyses of one symbol',async()=>{
    const h=harness();let finish!:(value:any)=>void;
    h.ai.decide.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const first=h.run();await new Promise(resolve=>setImmediate(resolve));await h.run();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    finish({decision:{decision:'REJECT_CANDIDATE',reason:'mock refusal'},runId:'one'});await first;
    expect(h.events.some(e=>e.type==='PRIMARY_DUPLICATE_IN_FLIGHT_SKIPPED')).toBe(true);
  });
  it('releases unsent capital when configuration changes during leverage acknowledgement',async()=>{
    vi.useFakeTimers();const h=harness();let finish!:()=>void;
    h.exchange.setLeverage.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const run=h.run();await vi.advanceTimersByTimeAsync(1);
    expect(h.exchange.setLeverage).toHaveBeenCalledOnce();
    h.state.settings.settingsVersion++;
    await vi.advanceTimersByTimeAsync(100);await run;finish();await vi.advanceTimersByTimeAsync(0);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect([...h.state.entryReservations.values()].every(r=>r.status==='RELEASED')).toBe(true);
    expect(h.events.find(e=>e.type==='ENTRY_ORDER_BLOCKED')?.payload).toMatchObject({stage:'SET_LEVERAGE',reason:'ENTRY_ANALYSIS_CONTEXT_CHANGED'});
  });
  it('checks cancellation immediately before exchange dispatch after synchronous audit callbacks',async()=>{
    const h=harness();h.bus.on('event',e=>{if(e.type==='ENTRY_SUBMIT_ATTEMPTED')h.state.settings.settingsVersion++;});
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect([...h.state.entryOrders.values()][0]).toMatchObject({status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'});
    expect([...h.state.entryReservations.values()].every(r=>r.status==='RELEASED')).toBe(true);
  });
  it('does not rebind a waiting old decision to configuration changed by a reservation audit callback',async()=>{
    const h=harness(),q=h.packet.market.quote,target=q.bid*1.02;
    h.ai.decide.mockImplementation(async(packet:any)=>({runId:'waiting-old',decision:systemCandidateDecision(packet,h.supplied,'LONG',
      {idealPrice:target,acceptablePriceRange:{min:target,max:target+q.tickSize*4}})}));
    h.bus.on('event',e=>{if(e.type==='ENTRY_RESERVATION_CREATED')h.state.settings.settingsVersion++;});
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.state.entryIntents.size).toBe(0);
    expect([...h.state.entryReservations.values()].every(r=>r.status==='RELEASED')).toBe(true);
    expect(h.state.candidateLifecycle.get(h.packet.symbol)?.status).toBe('TECHNICAL_COOLDOWN');
  });
  it('gives the adapter a final guard and classifies a queued rejection as locally unsent',async()=>{
    const h=harness();const {EntryDispatchGuardRejectedError}=await import('../adapters/binance/entryDispatchDeadline.js');
    h.exchange.placeEntry.mockImplementation(async(_order:any,guard?:()=>void)=>{
      h.state.settings.settingsVersion++;
      try{guard!();}catch(error){throw new EntryDispatchGuardRejectedError((error as Error).message);}
      throw new Error('guard incorrectly accepted');
    });
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect([...h.state.entryOrders.values()][0]).toMatchObject({status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'});
    expect(h.exchange.findEntryByClientOrderId).not.toHaveBeenCalled();
  });
  it('does not retry a post-only refusal after configuration changes in the retry delay',async()=>{
    vi.useFakeTimers();const h=harness();h.exchange.placeEntry.mockRejectedValue(new Error('Binance -5022'));
    const run=h.run();await vi.advanceTimersByTimeAsync(1);
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    h.state.settings.settingsVersion++;await vi.advanceTimersByTimeAsync(200);await run;
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect([...h.state.entryOrders.values()][0]).toMatchObject({status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'});
    expect([...h.state.entryReservations.values()].every(r=>r.status==='RELEASED')).toBe(true);
  });
  it('rebuilds SERIAL packet/menu after Scout and reports separate queue/Scout/preparation timing',async()=>{
    vi.useFakeTimers();const h=harness();h.state.settings.ai.scoutEnabled=true;h.state.settings.ai.scoutExperimentMode='SERIAL';
    const symbol=h.packet.symbol,scoutQuote=h.state.snapshots.get(symbol)!.quote.ts;
    const build=vi.fn((_symbol:string,envelope?:unknown)=>({...h.packet,packetId:`packet-${Date.now()}`,
      market:structuredClone(h.state.snapshots.get(symbol)!),executionEnvelope:envelope}));
    (h.coordinator as any).eip={build};
    h.ai.scout.mockImplementation(async()=>{
      vi.setSystemTime(Date.now()+5_000);
      h.state.snapshots.get(symbol)!.quote.ts=Date.now();h.state.snapshots.get(symbol)!.orderBook.ts=Date.now();
      return null;
    });
    await h.run();
    const scoutPacket=(h.ai.scout.mock.calls as any[])[0][0],primaryPacket=h.ai.decide.mock.calls[0][0] as any;
    expect(scoutPacket.market.quote.ts).toBe(scoutQuote);
    expect(primaryPacket.market.quote.ts).toBe(scoutQuote+5000);
    expect(primaryPacket.executionEnvelope.createdAt).toBeGreaterThanOrEqual(scoutQuote+5000);
    expect(h.ai.decide.mock.calls[0][4]).toMatchObject({preRequestTiming:{scoutMs:5000,slotWaitMs:0}});
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('releases unchanged NO_EDGE only at its existing bounded re-evaluation deadline',()=>{
    vi.useFakeTimers();const h=harness(),symbol=h.packet.symbol,entry=h.coordinator as any,now=Date.now();
    const facts=noEdgeReviewFacts({market:h.state.snapshots.get(symbol)!,longExecutable:true,shortExecutable:true});
    h.state.candidateLifecycle.set(symbol,{status:'READY',decisionContextKey:entry.currentDecisionContext(symbol),
      noEdgeReview:{facts,expiresAt:now+1000}} as any);
    expect(entry.lifecycleRunnable(symbol)).toBe(false);
    h.state.snapshots.get(symbol)!.quote.ts++;
    expect(entry.lifecycleRunnable(symbol)).toBe(false);
    vi.setSystemTime(now+1000);
    expect(entry.lifecycleRunnable(symbol)).toBe(true);
    expect(h.state.candidateLifecycle.get(symbol)?.triggerReason).toBe('NO_EDGE_TTL_EXPIRED');
  });
});
