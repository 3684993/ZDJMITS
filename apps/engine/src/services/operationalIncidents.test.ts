import {describe,expect,it} from 'vitest';
import {classifyOperationalError,OperationalIncidentTracker,operationalCandidates} from './operationalIncidents.js';

describe('user-facing operational incidents',()=>{
  const classify=(message:string,extra:Record<string,unknown>={})=>classifyOperationalError({message,...extra});
  it('classifies transport and exchange errors without fixed-egress alarms',()=>{
    expect(classify('BINANCE_TRANSPORT_BLOCKED: ECONNRESET')?.publicCode).toBe('NET-001');
    expect(classify('Binance request timed out')?.publicCode).toBe('NET-002');
    expect(classify('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE')).toBeNull();
    expect(classify('BINANCE_EGRESS_MISMATCH')).toBeNull();
    expect(classify('Binance HTTP 451: unavailable')?.publicCode).toBe('EX-HTTP-451');
    expect(classify('Binance HTTP 429',{retryAfter:'10'})?.retryAfter).toBe('10');
    expect(classify('Binance HTTP 418',{blockedUntil:123})?.blockedUntil).toBe(123);
    expect(classify('Binance HTTP 400: {"code":-4024,"msg":"Price is lower"}')).toMatchObject({publicCode:'EX-BINANCE-4024',binanceCode:-4024,sourceMessage:expect.stringContaining('Price is lower')});
    expect(classify('Binance HTTP 400: {"code":-5022,"msg":"Post Only"}')?.publicCode).toBe('EX-BINANCE-5022');
    expect(classify('Binance HTTP 400: {"code":-1000,"msg":"An unknown error occurred while processing the request."}')).toMatchObject({publicCode:'EX-BINANCE-1000',titleZh:'Binance 临时处理异常 -1000',category:'EXCHANGE'});
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
    const market=operationalCandidates({pipeline:{pipelineState:'PAUSED_MARKET_DATA_UNAVAILABLE',marketDataReason:'MARKET_QUOTES_STALE'},routes,account})[0];
    expect(market?.publicCode).toBe('MARKET-DATA-001');
    expect(market?.remediationZh).toContain('不是行情涨跌趋势判断');
  });
  it('does not turn optional derivatives REST timeout into a NEW_ENTRY outage while WS market facts are fresh',()=>{
    const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING',marketDataReason:null,freshMarkets:{status:'FRESH'}},marketStream:{state:'LIVE'},routes:[{recentFailures:[{message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:'oi-1',endpoint:'/fapi/v1/openInterest',method:'GET',routeIdentity:'proxy-test'}],requestBudget:{recentDispatches:[{decision:'TIMEOUT',completedAt:Date.now(),endpoint:'/fapi/v1/openInterest',method:'GET',requestId:'oi-1',routeIdentity:'proxy-test'}],admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'}});
    expect(rows).toHaveLength(0);
  });
  it('keeps historical UNKNOWN out of the current submit alarm',()=>{
    const facts={pipeline:{pipelineState:'RUNNING'},routes:[],account:{status:'READY'},orders:[{status:'UNKNOWN',activeRiskExposure:true,createdAt:Date.now()-86_400_000}]};
    expect(operationalCandidates(facts)).toHaveLength(0);
    facts.orders[0]!.createdAt=Date.now();
    expect(operationalCandidates(facts)[0]?.publicCode).toBe('EX-SUBMIT-UNKNOWN');
  });
  it('projects a current Binance business rejection with request evidence',()=>{
    const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING'},routes:[{recentFailures:[{message:'Binance HTTP 400: {"code":-5022,"msg":"Post Only"}',requestId:'r1',endpoint:'/fapi/v1/order',method:'POST',routeIdentity:'proxy-test'}]}],account:{status:'READY'}});
    expect(rows).toMatchObject([{publicCode:'EX-BINANCE-5022',requestId:'r1',endpoint:'/fapi/v1/order',method:'POST'}]);
  });
  it('keeps exact-order absence audit-only without suppressing other methods',()=>{
    const missing='Binance HTTP 400: {"code":-2013,"msg":"Order does not exist"}',absent='Binance HTTP 400: {"code":-2011,"msg":"Unknown order sent"}';
    expect(classify(missing,{method:'GET',endpoint:'/fapi/v1/order'})).toBeNull();
    expect(classify(absent,{method:'DELETE',endpoint:'/fapi/v1/order'})).toBeNull();
    expect(classify(missing,{method:'DELETE',endpoint:'/fapi/v1/order'})?.publicCode).toBe('EX-BINANCE-2013');
    expect(classify(missing,{method:'POST',endpoint:'/fapi/v1/order'})?.publicCode).toBe('EX-BINANCE-2013');
  });
});
