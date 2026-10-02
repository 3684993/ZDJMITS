import {describe,expect,it} from 'vitest';
import {testnetFundsOnlyEntry,evaluateCapitalAdmission,selectUniverse} from '@zdj/core';
import {harness} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {executionReadiness} from './executionReadiness.js';
import {computeExecutableRiskHeadroom} from './executableRiskHeadroom.js';
import {candidateCapitalFromState} from './capitalCapacity.js';
import {RuntimeControlService} from './runtimeControlService.js';
import {reconcileCandidateLifecycles} from './candidateLifecycleDeriver.js';
import {reservationDebitsAvailableFunds} from './entryFundingCommitment.js';

function hostileBook(){
  const h=harness(),s=h.state,symbol=h.packet.symbol,now=Date.now();
  h.supplied.quantityUnits=1000;
  s.settings.portfolio.maxPositions=1;s.settings.portfolio.maxPendingEntries=1;
  s.settings.riskGovernance.maxConcurrentReservations=1;
  Object.assign(s.settings.riskGovernance,{maxGrossExposurePct:0,maxDirectionExposurePct:0,maxClusterExposurePct:0,maxClusterDirectionExposurePct:0,perTradeRiskPctEquity:0,maxDailyDrawdownPct:0,maxDailyLossUsd:1,circuitBreakerEnabled:true});
  // Portfolio ratios/slots are hostile observations. The deterministic business sizing contract is
  // deliberately valid: TESTNET funds-only does not mean a 0-margin route may evade the 100 floor.
  Object.assign(s.settings.portfolioIntelligence,{maxMarginPerPositionUsd:500,maxEquityPct:1,maxQuoteAssetMarginUsagePct:0,maxSameUnderlyingPositions:0,underlyingExposurePolicy:'BLOCK_ALL',maxSpeculativeExposurePct:0});
  s.account.riskBaseline={riskDrawdownPct:.99,calendarDayRealizedPnlUsd:-99999} as any;
  s.positions.set('held',{id:'held',symbol,side:'LONG',quantity:1e9,markPrice:1,leverage:1,managementStatus:'HUMAN_MANAGED',cycleId:'historical'} as any);
  s.entryOrders.set('unknown',{id:'unknown',intentId:'old-intent',reservationId:'old-reserve',symbol,side:'SHORT',quantity:1e9,price:1,filledQuantity:0,status:'UNKNOWN',createdAt:1,updatedAt:1,absoluteExpiresAt:2} as any);
  s.entryReservations.set('old-reserve',{id:'old-reserve',intentId:'old-intent',planId:'old-plan',underlying:symbol.replace(/USD[TC]$/,''),quoteAsset:'USDT',marginUsd:1e9,notionalUsd:1e9,status:'WORKING',createdAt:1,expiresAt:now+60000});
  s.marginTierCoverage={symbols:[]} as any;
  s.manualExitGoals.set('old-goal',{symbol} as any);
  (s as any).riskAdmission={capacityFacts:()=>{throw Error('RISK_ADMISSION_UNAVAILABLE');},admit:()=>({allowed:false,reasons:['PENDING_RISK_UNVERIFIED','UNKNOWN','STRESS_LIMIT:MAX_GROSS_NOTIONAL','HUMAN_POTENTIAL_SLOT_LIMIT'],limits:['MAX_CLUSTER_NOTIONAL'],snapshot:{complete:false},ticket:null}),preTradeFacts:()=>({complete:false,blockers:['UNKNOWN'],snapshotHash:'unproven'})};
  s.entryRiskGate=(()=>{throw Error('RISK_GATE_MUST_NOT_VETO');}) as any;
  return h;
}

describe('TESTNET funds-only Entry resource authority',()=>{
  it('requires exact TESTNET and TESTNET_ENABLED; never unlocks READ_ONLY or Production',()=>{
    for(const environment of ['PRODUCTION','TESTNET','UNKNOWN',undefined])for(const executionMode of ['READ_ONLY','TESTNET_ENABLED',undefined])
      expect(testnetFundsOnlyEntry({connections:{exchange:{environment},executionMode}})).toBe(environment==='TESTNET'&&executionMode==='TESTNET_ENABLED');
  });
  it('ignores every non-funding risk dimension in routing, both envelope sides, lifecycle and readiness',()=>{
    const h=hostileBook(),s=h.state,symbol=h.packet.symbol,now=Date.now();
    const admission=evaluateCapitalAdmission({candidates:s.universe,snapshots:[...s.snapshots.values()],settings:s.settings,positions:[...s.positions.values()],assets:s.account.assets});
    expect(admission.summary.executableCandidateCount).toBe(1);
    expect(admission.decisions[0].longPlan?.admission).toBe('ALLOW');expect(admission.decisions[0].shortPlan?.admission).toBe('ALLOW');
    const envelope=buildPreAiExecutionEnvelope(s,symbol);
    expect(envelope.executableSides).toEqual(['LONG','SHORT']);
    expect(envelope.LONG.maxNotionalUsd).toBeGreaterThan(1000);
    s.candidateLifecycle.set(symbol,{status:'POSITION_HELD'});
    reconcileCandidateLifecycles(s);expect(s.candidateLifecycle.get(symbol).status).toBe('READY');
    const ready=executionReadiness({settings:s.settings,account:s.account,runtimeControlMode:'RUNNING',executionGovernanceMode:'AUTO_RUNNING',writeAdmissionBlock:null,executableCandidateCount:1,executableCandidateSymbols:[symbol],now});
    expect(ready.ready).toBe(true);expect(ready.blockers).toEqual([]);
    new RuntimeControlService(s,h.bus).evaluate(true);
    expect(s.runtimeControl.mode).toBe('RUNNING');expect(s.runtimeControl.capital.executableCandidateCount).toBe(1);
  });
  it.each(['denied','missing','throwing'])('Primary PLACE traverses durable plan, reservation, intent and mocked submit with %s risk admission',async mode=>{
    const h=hostileBook();
    if(mode==='missing')(h.state as any).riskAdmission=null;
    if(mode==='throwing')(h.state as any).riskAdmission={admit:()=>{throw Error('RISK_ADMISSION_UNAVAILABLE');},preTradeFacts:()=>{throw Error('UNKNOWN');}};
    await h.run();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.exchange.placeEntry,JSON.stringify(h.events.slice(-8))).toHaveBeenCalledOnce();
    for(const type of ['TRADE_PLAN_PERSISTED','ENTRY_RESERVATION_CREATED','ENTRY_INTENT_CREATED','ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED'])expect(h.events.filter(e=>e.type===type),type).toHaveLength(1);
    expect([...h.state.tradePlans.values()][0]?.risk).toBeNull();
    const tradePlan=[...h.state.tradePlans.values()][0]!,intent=[...h.state.entryIntents.values()][0]!,order=[...h.state.entryOrders.values()].find(row=>row.intentId===intent.id)!;
    expect(intent).toMatchObject({planId:tradePlan.planId,selectedCandidateId:tradePlan.selectedCandidateId,candidateSetHash:tradePlan.provenance.candidateSetHash});
    expect(order).toMatchObject({selectedCandidateId:tradePlan.selectedCandidateId,candidateSetHash:tradePlan.provenance.candidateSetHash});
    expect(h.state.entryOrders.get('unknown')?.status).toBe('UNKNOWN');
    expect(h.state.positions.has('held')).toBe(true);
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('real funds exhausted or stale private facts still prevent submit',async()=>{
    for(const mode of ['no-funds','stale-private']){
      const h=hostileBook();
      if(mode==='no-funds')h.state.account.assets[0].availableBalance=0;else h.state.account.asOf=1;
      await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.ai.decide).not.toHaveBeenCalled();
    }
  });
  it('fresh available funds are checked again after Primary and before submit',async()=>{
    const h=hostileBook();h.exchange.setLeverage.mockImplementation(async()=>{h.state.account.assets[0].availableBalance=0;});
    await h.run();expect(h.ai.decide).toHaveBeenCalledOnce();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.some(e=>String(e.payload?.reason).includes('INSUFFICIENT_AVAILABLE_MARGIN'))).toBe(true);
  });
  it('does not subtract exchange-occupied or historical UNKNOWN claims twice, but accounts for an unsent current reservation',()=>{
    const h=hostileBook(),s=h.state,now=Date.now(),input={symbol:h.packet.symbol,quoteAsset:'USDT',leverage:10,leverageFact:'CANDIDATE_RECOMMENDED' as const};
    expect(candidateCapitalFromState(s,input).executableMarginUsd).toBe(10000);
    const row={id:'current',status:'RESERVED',quoteAsset:'USDT',marginUsd:150,expiresAt:now+10000};s.entryReservations.set('current',row);
    expect(reservationDebitsAvailableFunds(s,row,now)).toBe(true);
    expect(candidateCapitalFromState(s,input).executableMarginUsd).toBe(9850);
    expect(candidateCapitalFromState(s,{...input,excludeReservationId:'current'}).executableMarginUsd).toBe(10000);
  });
  it('risk NaNs and arbitrarily high exposures cannot change funding headroom; nonfinite money remains invalid',()=>{
    const h=hostileBook(),s=h.state,capital=candidateCapitalFromState(s,{symbol:h.packet.symbol,quoteAsset:'USDT',leverage:10,leverageFact:'CANDIDATE_RECOMMENDED'});
    const input={settings:s.settings,equity:NaN,positions:[{symbol:'X',side:'LONG' as const,quantity:NaN,markPrice:NaN}],symbol:h.packet.symbol,side:'LONG' as const,plannedNotional:50,expectedAdverseMovePct:NaN,dailyDrawdownPct:NaN,minimumNotional:5,capital,riskAdmissionRefusal:'UNKNOWN',riskAdmissionCeilingUsd:0};
    expect(computeExecutableRiskHeadroom(input)).toMatchObject({executable:true,finalNotional:50});
    const observed=computeExecutableRiskHeadroom(input);
    expect([observed.gateDecisions.gross,observed.gateDecisions.direction,observed.gateDecisions.cluster,observed.gateDecisions.stress,observed.gateDecisions.positionCap])
      .toEqual(expect.arrayContaining([expect.objectContaining({category:'STRATEGY_OBSERVATION',disposition:'OBSERVE',canVeto:false,mutatesQuantity:false})]));
    expect(observed.gateDecisions.availableMargin).toMatchObject({category:'CAPITAL_AUTHORITY',disposition:'ENFORCE',canVeto:true,mutatesQuantity:true});
    expect(computeExecutableRiskHeadroom({...input,capital:{...capital,factsComplete:false,executableNotionalUsd:NaN}}).executable).toBe(false);
  });
});
