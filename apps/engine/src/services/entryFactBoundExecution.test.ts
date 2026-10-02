import {describe,expect,it} from 'vitest';
import {ENTRY_FACT_BOUND_REFERENCE_PROTOCOL} from '@zdj/contracts';
import {harness,systemCandidateDecision} from './tradingQualityTestHarness.js';
import {factBoundWire} from '../testing/factBoundReferenceFixture.js';
import {entryDecisionParse} from './aiFabric.js';

function armed(side:'LONG'|'SHORT'='LONG',largest=false){
  const h=harness();
  h.ai.decide.mockImplementation(async(packet:any)=>{
    const offered=packet.executionEnvelope[side],selected=largest?[...offered.planCandidates].sort((a,b)=>b.marginUsd-a.marginUsd)[0]:null;
    const legacy=systemCandidateDecision(packet,h.supplied,side,selected?{selectedCandidateId:selected.candidateId}:{});
    const wire=factBoundWire(packet,{...legacy,candidateSetHash:offered.candidateSetHash,candidateSetFactVersion:offered.candidateSetFactVersion,
      opportunityType:'TREND_RESUMPTION',marketRegime:'TREND',waitCondition:null,rejectLayer:'NONE',supportingEvidenceRefs:['quote.top']});
    return{runId:'r2-chain',decision:entryDecisionParse(wire,packet,ENTRY_FACT_BOUND_REFERENCE_PROTOCOL)};
  });
  return h;
}

describe('R2 parsed decision through original execution gates',()=>{
  it('creates one intent and one mock submit from the selected immutable candidate',async()=>{
    const h=armed();await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();expect(h.state.entryIntents.size).toBe(1);
    const selected:any=h.events.find(e=>e.type==='AI_CANDIDATE_SELECTED')?.payload;
    const intent:any=[...h.state.entryIntents.values()][0];
    expect(selected.protocol).toBe('V3.9.7-R2_FROZEN_CANDIDATE_REFERENCE');
    expect(intent.quantityUnits).toBe(selected.quantityUnits);
    expect(h.events.filter(e=>e.type==='ENTRY_ORDER_CREATED')).toHaveLength(1);
    expect(h.events.some(e=>e.type==='ENTRY_FILLED')).toBe(false);
  });
  it('does not replace a too-large counter-trend choice with a smaller candidate',async()=>{
    const h=armed('SHORT',true);await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.state.entryIntents.size).toBe(0);
    expect(h.events.some(e=>e.type==='ENTRY_DECISION_BLOCKED'&&(e.payload as any).reason==='COUNTER_TREND_REQUIRES_MINIMUM_CANDIDATE')).toBe(true);
  });
  it('still refuses stale quotes at final dispatch and releases the reservation',async()=>{
    const h=armed(),market=h.state.snapshots.get(h.packet.symbol)!;
    h.exchange.setLeverage.mockImplementation(async()=>{market.quote.ts=Date.now()-60000;});
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.some(e=>e.type==='ENTRY_ORDER_BLOCKED'&&String((e.payload as any).reason).includes('QUOTE_STALE'))).toBe(true);
    expect([...h.state.entryReservations.values()][0]?.status).toBe('RELEASED');
  });
  it('still refuses a material price move without widening the band or replacing the candidate',async()=>{
    const h=armed(),original=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async(...args:any[])=>{
      const result=await (original as any)(...args),market=h.state.snapshots.get(h.packet.symbol)!;
      market.quote.last+=market.technical['15m'].atr14;market.quote.bid=market.quote.last;market.quote.ask=market.quote.last+.01;
      return result;
    });
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.state.entryIntents.size).toBe(0);
    expect(h.events.some(e=>e.type==='ENTRY_DECISION_BLOCKED'&&(e.payload as any).reason==='JIT_MARKET_THESIS_DRIFT')).toBe(true);
  });
});
