import {describe, expect, it} from 'vitest';
import {ENTRY_CANDIDATE_REFERENCE_PROTOCOL, ENTRY_REFERENCE_REQUIRED_FIELDS} from '@zdj/contracts';
import {entryDecisionParse} from './aiFabric.js';
import {harness, systemCandidateDecision} from './tradingQualityTestHarness.js';
import {referenceFixture} from '../testing/candidateReferenceFixture.js';

function wireFor(packet:any, supplied:any, side:'LONG'|'SHORT'='LONG') {
  const selected=systemCandidateDecision(packet,supplied,side);
  const values={...referenceFixture(side).wire,...selected,schemaVersion:ENTRY_CANDIDATE_REFERENCE_PROTOCOL,
    candidateSetHash:packet.executionEnvelope[side].candidateSetHash,
    candidateSetFactVersion:packet.executionEnvelope[side].candidateSetFactVersion};
  return Object.fromEntries(ENTRY_REFERENCE_REQUIRED_FIELDS.map(key=>[key,values[key]]));
}

describe('R1 decision through the unchanged Entry admission path',()=>{
  it.each(['LONG','SHORT'] as const)('submits only the %s candidate selected before inference, with a 60-second execution window',async side=>{
    const h=harness();let frozen:any;let result:any;
    h.ai.decide.mockImplementation(async(packet:any)=>{
      const wire=wireFor(packet,h.supplied,side);
      frozen=structuredClone(packet.executionEnvelope[side].planCandidates.find((c:any)=>c.candidateId===wire.selectedCandidateId));
      result=entryDecisionParse(wire,packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL);
      return {decision:result,runId:`r1-${side}`,decisionCompletedAt:Date.now()};
    });
    await h.run();
    expect(h.exchange.placeEntry,JSON.stringify(h.events.filter(e=>/BLOCK|REJECT|FAIL/.test(e.type)))).toHaveBeenCalledOnce();
    const intent=[...h.state.entryIntents.values()][0];
    const order=[...h.state.entryOrders.values()][0];
    expect(intent.selectedCandidateId).toBe(frozen.candidateId);
    expect(intent.profitTakePlan).toMatchObject({targetPrice:frozen.targetPrice,acceptableTargetRange:frozen.acceptableTargetRange,targetHorizonMinutes:frozen.targetHorizonMinutes});
    expect(order.quantity/h.packet.market.quote.stepSize).toBeCloseTo(frozen.quantityUnits,7);
    expect(result.quantityUnits).toBeNull();
    expect(result.candidateReferenceResolution.source).toBe('SYSTEM_FROZEN_CANDIDATE');
    expect(intent.decisionExecutionExpiresAt!-intent.decisionCompletedAt!).toBe(60_000);
    expect(h.events.find(e=>e.type==='AI_CANDIDATE_SELECTED')?.payload.protocol).toBe('V3.9.7-R1_FROZEN_CANDIDATE_REFERENCE');
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });

  it.each([
    ['hash',(decision:any)=>{decision.candidateSetHash='wrong';},'AI_CANDIDATE_REFERENCE_IDENTITY_MISMATCH'],
    ['fact version',(decision:any)=>{decision.candidateSetFactVersion='wrong';},'AI_CANDIDATE_REFERENCE_IDENTITY_MISMATCH'],
    ['raw quantity',(decision:any)=>{decision.quantityUnits=123;},'AI_RAW_QUANTITY_AUTHORITY_FORBIDDEN'],
    ['TP',(decision:any)=>{decision.profitTakePlan.targetPrice*=1.01;},'AI_CANDIDATE_TARGET_RESTATEMENT_MISMATCH'],
    ['resolution packet',(decision:any)=>{decision.candidateReferenceResolution.packetId='other';},'AI_CANDIDATE_REFERENCE_PROOF_MISMATCH'],
    ['resolution removed',(decision:any)=>{decision.candidateReferenceResolution=null;},'AI_CANDIDATE_REFERENCE_PROOF_MISMATCH'],
  ] as const)('does not submit when normalized %s is tampered after parsing',async(_label,mutate,reason)=>{
    const h=harness();
    h.ai.decide.mockImplementation(async(packet:any)=>{
      const decision=entryDecisionParse(wireFor(packet,h.supplied),packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL);
      mutate(decision);
      return {decision,runId:'r1-tampered'};
    });
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.entryIntents.size).toBe(0);
    expect(JSON.stringify(h.events)).toContain(reason);
  });

  it.each(['STALE_QUOTE','EXPIRED_EXECUTION_WINDOW'] as const)('keeps the existing %s gate after a valid R1 decision',async failure=>{
    const h=harness();
    h.ai.decide.mockImplementation(async(packet:any)=>{
      const decision=entryDecisionParse(wireFor(packet,h.supplied),packet,ENTRY_CANDIDATE_REFERENCE_PROTOCOL);
      if(failure==='STALE_QUOTE')h.state.snapshots.get(h.packet.symbol)!.quote.ts=1;
      return {decision,runId:'r1-expired',decisionCompletedAt:Date.now()-(failure==='EXPIRED_EXECUTION_WINDOW'?60_001:0)};
    });
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.entryIntents.size).toBe(0);
    expect(JSON.stringify(h.events)).toContain(failure==='STALE_QUOTE'?'QUOTE_STALE':'ENTRY_DECISION_EXECUTION_EXPIRED');
  });
});
