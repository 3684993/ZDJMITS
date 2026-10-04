import {describe,expect,it} from 'vitest';
import {classifyOperationalError,OperationalIncidentTracker,operationalCandidates} from './operationalIncidents.js';

describe('user-facing operational incidents',()=>{
  const classify=(message:string,extra:Record<string,unknown>={})=>classifyOperationalError({message,...extra});
  it('classifies transport, egress and exchange errors without erasing raw facts',()=>{
    expect(classify('BINANCE_TRANSPORT_BLOCKED: ECONNRESET')?.publicCode).toBe('NET-001');
    expect(classify('Binance request timed out')?.publicCode).toBe('NET-002');
    expect(classify('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE')?.publicCode).toBe('NET-003');
    expect(classify('TESTNET_WRITE_EGRESS_NOT_VERIFIED:MISMATCH')?.publicCode).toBe('NET-004');
    expect(classify('Binance HTTP 451: unavailable')?.publicCode).toBe('EX-HTTP-451');
    expect(classify('Binance HTTP 429',{retryAfter:'10'})?.retryAfter).toBe('10');
    expect(classify('Binance HTTP 418',{blockedUntil:123})?.blockedUntil).toBe(123);
    expect(classify('Binance HTTP 400: {"code":-4024,"msg":"Price is lower"}')).toMatchObject({publicCode:'EX-BINANCE-4024',binanceCode:-4024,sourceMessage:expect.stringContaining('Price is lower')});
    expect(classify('ENTRY_SUBMIT_UNACKED')?.publicCode).toBe('EX-SUBMIT-UNKNOWN');
    expect(classify('BINANCE_REQUEST_QUEUE_TIMEOUT')).toBeNull();
    expect(classify('BINANCE_REQUEST_QUEUE_TIMEOUT',{transportEvidence:true})?.publicCode).toBe('NET-002');
    expect(classify('BINANCE_REQUEST_QUEUE_TIMEOUT',{transportEvidence:true,budgetPressureProven:true})).toBeNull();
  });
  it('dedupes a root cause, clears active on recovery and retains history',()=>{
    const tracker=new OperationalIncidentTracker(),incident=classify('BINANCE_TRANSPORT_BLOCKED: ECONNRESET')!;
    tracker.observe([incident],100);tracker.observe([incident],200);
    expect(tracker.read().active).toHaveLength(1);expect(tracker.read().active[0]).toMatchObject({count:1,firstSeenAt:100,lastSeenAt:200});
    tracker.observe([],300);expect(tracker.read().active).toHaveLength(0);expect(tracker.read().history[0]).toMatchObject({active:false,recoveredAt:300});
    tracker.observe([incident],400);expect(tracker.read().active).toHaveLength(1);expect(tracker.read().history).toHaveLength(2);expect(tracker.read().history.find(row=>!row.active)).toMatchObject({recoveredAt:300});
  });
  it('does not call isolated symbols a global outage while a healthy candidate remains',()=>{
    const routes:any[]=[],account={status:'READY'};
    expect(operationalCandidates({pipeline:{pipelineState:'RUNNING',marketDataReason:null},routes,account})).toHaveLength(0);
    expect(operationalCandidates({pipeline:{pipelineState:'PAUSED_MARKET_DATA_UNAVAILABLE',marketDataReason:'MARKET_QUOTES_STALE'},routes,account})[0]?.publicCode).toBe('MARKET-DATA-001');
  });
  it('keeps historical UNKNOWN out of the current submit alarm',()=>{
    const facts={pipeline:{pipelineState:'RUNNING'},routes:[],account:{status:'READY'},orders:[{status:'UNKNOWN',activeRiskExposure:true,createdAt:Date.now()-86_400_000}]};
    expect(operationalCandidates(facts)).toHaveLength(0);
    facts.orders[0]!.createdAt=Date.now();
    expect(operationalCandidates(facts)[0]?.publicCode).toBe('EX-SUBMIT-UNKNOWN');
  });
});
