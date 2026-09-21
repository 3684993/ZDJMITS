import {describe,it,expect} from 'vitest';
import {allocateSharedQuantity,attributeFunding,capitalBaseline,decideAiExit,estimateExit,experimentId,portfolioRiskSnapshot,tokenLedgerTotal,validateTradePlan} from './v396OfflineStages.js';
import {executionScope} from './executionLifecycle.js';
import {riskFactCoverage} from './s01TruthAccountingObservability.js';

const facts={grossRealizedToDate:0,incurredFees:1,signedFunding:0,projectedExitGross:3,projectedExitFee:1,uncertaintyBuffer:0,factsStatus:'EXACT' as const};
const policy={owner:'AI_ACTIVE' as const,now:1,deadline:10,estimate:estimateExit(facts),thesisInvalid:true,lossLimit:10,minProfit:.1,allowSmallLoss:true};
describe('Independent adversarial audit regressions',()=>{
  it.each(['UNKNOWN','CONFLICT'] as const)('numeric %s costs do not authorize exits',factsStatus=>{
    expect(estimateExit({...facts,factsStatus}).netIfAllClosed).toBeNull();
    expect(decideAiExit({...policy,estimate:{netIfAllClosed:2,status:factsStatus,reason:'injected'}}).outcome).toBe('BLOCKED_FACTS');
  });
  it.each([NaN,Infinity,-1,11])('rejects invalid loss permission %s',lossLimit=>expect(decideAiExit({...policy,lossLimit}).outcome).toBe('BLOCKED_FACTS'));
  it('never turns negative fees or a malformed deadline into permission',()=>{
    expect(estimateExit({...facts,incurredFees:-100}).netIfAllClosed).toBeNull();
    expect(decideAiExit({...policy,deadline:NaN}).outcome).toBe('HANDOFF');
    expect(decideAiExit({...policy,minProfit:-20}).outcome).toBe('BLOCKED_FACTS');
  });
  it.each([-9.99,-10,-10.01])('honors original cycle loss boundary %s',net=>{
    const estimate=estimateExit({...facts,grossRealizedToDate:-8,projectedExitGross:net+10});
    expect(decideAiExit({...policy,estimate}).outcome).toBe(net < -10?'HANDOFF':'ALLOW');
  });
  it.each([NaN,Infinity,-1,1.5])('rejects malformed available quantity %s',available=>expect(allocateSharedQuantity([],1,available).allowed).toBe(false));
  it('unknown claims retain occupancy and malformed claims never increase capacity',()=>{
    const claim={scope:'s',cycleId:'c',source:'TP' as const,claimId:'id',quantityUnits:10,version:1,status:'UNKNOWN' as const};
    expect(allocateSharedQuantity([claim],1,10).allowed).toBe(false);
    expect(allocateSharedQuantity([{...claim,quantityUnits:-10}],1,10).allowed).toBe(false);
    expect(allocateSharedQuantity([claim,claim],1,100).allowed).toBe(false);
  });
  it('preserves legacy entry journal key until migration is explicit',()=>{
    expect(executionScope('TESTNET','a','btcusdt','ENTRY')).toBe('["TESTNET","a","BTCUSDT","ENTRY"]');
    expect(executionScope('TESTNET','a','btcusdt','ENTRY')).not.toBe(executionScope('TESTNET','a','btcusdt','BOTH'));
  });
  it('cannot attribute another cycle, asset, unbound row or duplicate funding',()=>{
    const f={id:'f',accountScope:'a',asset:'USDT',amount:1,time:5,cycleId:'c'};
    const input={accountScope:'a',cycleId:'c',start:1,end:10,coverageComplete:true};
    for(const rows of [[{...f,cycleId:'other'}],[{...f,cycleId:undefined}],[{...f,asset:'BNB'}],[f,f]])expect(attributeFunding(rows,input).status).toBe('UNKNOWN');
    expect(attributeFunding([f],input).amount).toBe(1);
  });
  it('partial capital snapshots cannot certify a complete baseline',()=>expect(capitalBaseline({snapshots:[{at:2,equity:100}],flows:[],start:1,end:10}).status).toBe('UNKNOWN'));
  it('blocks portfolio admission without stress evidence or positive finite equity',()=>{
    const base={equity:100,positions:[],claims:[],unknownClaims:0,stressLoss:1,coverage:'EXACT' as const};
    for(const change of [{equity:NaN},{equity:0},{stressLoss:null},{unknownClaims:1}])expect(portfolioRiskSnapshot({...base,...change}).admission).toBe('BLOCKED_FACTS');
  });
  it('numeric tokens with unknown provenance do not become actual usage',()=>expect(tokenLedgerTotal([{eventId:'x',role:'ENTRY',inputTokens:2,outputTokens:3,latencyMs:1,usageStatus:'UNKNOWN',promptHash:'h',reason:'estimated'}]).inputTokens).toBeNull());
  it('plan cannot authorize zero quantity, no deadline or expired management',()=>{
    const p={schemaVersion:'V396-PLAN-1' as const,planId:'p',planVersion:1,cycleId:'c',scope:'s',quantityUnits:1,targetHorizonMinutes:10,managementDurationMs:100,aiManagementDeadline:101,direction:'LONG' as const,evidenceRefs:['e'],provenanceHash:'h'};
    for(const change of [{quantityUnits:0},{aiManagementDeadline:null},{aiManagementDeadline:1}])expect(validateTradePlan({...p,...change},1).valid).toBe(false);
  });
  it('stale terminal text does not certify current absence',()=>{
    const base={now:100,checkedAt:1,historyCovered:true,terminalStatus:'CANCELED',activeOrderIdentity:false,fillIdentity:false,positionRelation:'ABSENT' as const};
    for(const validUntil of [undefined,null,99])expect(riskFactCoverage({...base,validUntil}).currentRisk).toBe('UNKNOWN');
  });
  it('manifest hash is full SHA256 and independent of property insertion order',()=>{
    expect(experimentId({a:1,b:2})).toBe(experimentId({b:2,a:1}));
    expect(experimentId({a:1})).toMatch(/^[a-f0-9]{64}$/);
  });
});
