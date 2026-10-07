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
    expect(classify('BINANCE_REQUEST_QUEUE_TIMEOUT',{transportEvidence:true})?.publicCode).toBe('BINANCE-QUEUE-001');
    expect(classify('BINANCE_REQUEST_QUEUE_TIMEOUT',{transportEvidence:true,budgetPressureProven:true})).toBeNull();
  });
  it('dedupes a root cause, clears active on recovery and retains history',()=>{
    const tracker=new OperationalIncidentTracker(),incident=classify('BINANCE_TRANSPORT_BLOCKED: ECONNRESET')!;
    tracker.observe([incident],100);tracker.observe([incident],200);
    expect(tracker.read().active).toHaveLength(1);expect(tracker.read().active[0]).toMatchObject({count:1,firstSeenAt:100,lastSeenAt:200});
    tracker.observe([],300);expect(tracker.read().active).toHaveLength(0);expect(tracker.read().history[0]).toMatchObject({active:false,recoveredAt:300});
    tracker.observe([incident],400);expect(tracker.read().active).toHaveLength(1);expect(tracker.read().history).toHaveLength(2);expect(tracker.read().history.find(row=>!row.active)).toMatchObject({recoveredAt:300});
  });
  it('keeps one active network incident per proxy route while the failing endpoint changes',()=>{
    const tracker=new OperationalIncidentTracker(),a=classify('Binance request timed out',{subsystem:'BINANCE_HTTP',endpoint:'/fapi/v2/account',routeIdentity:'proxy-x',requestId:'a'})!,b=classify('Binance request timed out',{subsystem:'BINANCE_HTTP',endpoint:'/fapi/v1/openOrders',routeIdentity:'proxy-x',requestId:'b'})!;
    tracker.observe([a],100);tracker.observe([b],200);
    expect(tracker.read().active).toHaveLength(1);expect(tracker.read().active[0]).toMatchObject({publicCode:'NET-002',endpoint:'/fapi/v1/openOrders',routeIdentity:'proxy-x',count:2,firstSeenAt:100});
  });
  it('keeps a brief global market-data pause out of the incident banner until it persists across three observations',()=>{
    const tracker=new OperationalIncidentTracker(),candidate=operationalCandidates({pipeline:{pipelineState:'PAUSED_MARKET_DATA_UNAVAILABLE',marketDataReason:'MARKET_QUOTES_STALE'},routes:[],account:{status:'READY'}})[0]!;
    expect(tracker.observe([candidate],100).active).toHaveLength(0);
    expect(tracker.observe([candidate],5_100).active).toHaveLength(0);
    expect(tracker.observe([candidate],10_100).active[0]?.publicCode).toBe('MARKET-DATA-001');
    expect(tracker.observe([],15_100).active).toHaveLength(0);
  });
  it('never turns /fapi/v1/time queue jitter into NET-002 by itself',()=>{
    const now=Date.now(),rows=operationalCandidates({pipeline:{pipelineState:'RUNNING',freshMarkets:{status:'FRESH'}},routes:[{recentFailures:[0,1,2,3].map(i=>({message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:`clock-${i}`,endpoint:'/fapi/v1/time',method:'GET',routeIdentity:'proxy-test',completedAt:now-i*1000})),requestBudget:{recentDispatches:[0,1,2,3].map(i=>({decision:'TIMEOUT',completedAt:now-i*1000,endpoint:'/fapi/v1/time',method:'GET',requestId:`clock-${i}`,routeIdentity:'proxy-test'}),),admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'}});
    expect(rows).toHaveLength(0);
  });
  it('does not call isolated symbols a global outage while a healthy candidate remains',()=>{
    const routes:any[]=[],account={status:'READY'};
    expect(operationalCandidates({pipeline:{pipelineState:'RUNNING',marketDataReason:null},routes,account})).toHaveLength(0);
    const market=operationalCandidates({pipeline:{pipelineState:'PAUSED_MARKET_DATA_UNAVAILABLE',marketDataReason:'MARKET_QUOTES_STALE'},routes,account})[0];
    expect(market?.publicCode).toBe('MARKET-DATA-001');
    expect(market?.remediationZh).toContain('不是行情涨跌趋势判断');
  });
  it('tolerates isolated REST jitter and raises NET-002 only after a sustained critical timeout burst',()=>{
    const now=Date.now(),base:any={pipeline:{pipelineState:'RUNNING',marketDataReason:null,freshMarkets:{status:'FRESH'}},marketStream:{state:'LIVE'},account:{status:'READY'}};
    const failure=(n:number)=>({message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:`r${n}`,endpoint:'/fapi/v2/account',method:'GET',routeIdentity:'proxy-test',completedAt:now-n*1000});
    const route=(count:number)=>({recentFailures:Array.from({length:count},(_,i)=>failure(i)),requestBudget:{recentDispatches:[],admissionObservedWeight1m:100,softBackgroundWeight:1000}});
    expect(operationalCandidates({...base,routes:[route(1)]})).toHaveLength(0);
    expect(operationalCandidates({...base,routes:[route(2)]})).toHaveLength(0);
    expect(operationalCandidates({...base,routes:[route(3)]})[0]?.publicCode).toBe('NET-002');
  });
  it('keeps fresh WS market execution available despite repeated REST market fallback timeouts',()=>{
    const now=Date.now(),rows=operationalCandidates({pipeline:{pipelineState:'RUNNING',marketDataReason:null,freshMarkets:{status:'FRESH'}},marketStream:{state:'LIVE'},routes:[{recentFailures:[0,1,2,3].map(i=>({message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:`m${i}`,endpoint:'/fapi/v1/ticker/24hr',method:'GET',routeIdentity:'proxy-test',completedAt:now-i*1000})),requestBudget:{recentDispatches:[],admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'}});
    expect(rows).toHaveLength(0);
  });
  it('uses candidate-local market health when unrelated retained symbols keep the global freshness view recovering',()=>{
    const now=Date.now(),failures=[0,1,2,3].map(i=>({message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:`isolated-${i}`,endpoint:'/fapi/v1/ticker/bookTicker',method:'GET',routeIdentity:'proxy-test',completedAt:now-i*1000}));
    const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING',marketDataReason:null,freshMarkets:{status:'RECOVERING'},marketDataIsolation:{healthyCandidates:1,blockedCandidates:4}},marketStream:{state:'LIVE'},routes:[{recentFailures:failures,requestBudget:{recentDispatches:failures.map(row=>({...row,decision:'TIMEOUT'})),admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'}});
    expect(rows).toHaveLength(0);
  });
  it('never turns optional derivatives REST latency into NET-002, even while market execution is degraded',()=>{
    const now=Date.now(),failures=['/fapi/v1/openInterest','/fapi/v1/premiumIndex','/futures/data/openInterestHist'].flatMap((endpoint,j)=>[0,1,2].map(i=>({message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:`adv-${j}-${i}`,endpoint,method:'GET',routeIdentity:'proxy-test',completedAt:now-i*1000})));
    const rows=operationalCandidates({pipeline:{pipelineState:'PAUSED_MARKET_DATA_UNAVAILABLE',marketDataReason:'MARKET_QUOTES_STALE',freshMarkets:{status:'STALE'}},marketStream:{state:'LIVE'},routes:[{recentFailures:failures,requestBudget:{recentDispatches:failures.map((row:any)=>({...row,decision:'TIMEOUT'})),admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'}});
    expect(rows.filter(row=>row.publicCode==='NET-002')).toHaveLength(0);
    expect(rows.some(row=>row.publicCode==='MARKET-DATA-001')).toBe(true);
  });
  it('keeps historical income enrichment latency out of NET-002 while current private truth is ready',()=>{
    const now=Date.now(),failures=[0,1,2,3].map(i=>({message:'BINANCE_REQUEST_QUEUE_TIMEOUT',requestId:`income-${i}`,endpoint:'/fapi/v1/income',method:'GET',routeIdentity:'proxy-test',completedAt:now-i*1000}));
    const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING',freshMarkets:{status:'FRESH'}},routes:[{recentFailures:failures,requestBudget:{recentDispatches:failures.map(row=>({...row,decision:'TIMEOUT'})),admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'}});
    expect(rows).toHaveLength(0);
  });
  it('represents exact-order timeout recovery as SUBMIT_UNKNOWN instead of a duplicate NET-002 incident',()=>{
    const now=Date.now(),failures=[0,1,2,3].map(i=>({message:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out',requestId:`order-${i}`,endpoint:'/fapi/v1/order',method:'GET',routeIdentity:'proxy-test',completedAt:now-i*1000}));
    const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING',freshMarkets:{status:'FRESH'}},routes:[{recentFailures:failures,requestBudget:{recentDispatches:failures.map(row=>({...row,decision:'TIMEOUT'})),admissionObservedWeight1m:100,softBackgroundWeight:1000}}],account:{status:'READY'},orders:[{status:'UNKNOWN',activeRiskExposure:true,createdAt:now}]});
    expect(rows.filter(row=>row.publicCode==='NET-002')).toHaveLength(0);
    expect(rows.filter(row=>row.publicCode==='EX-SUBMIT-UNKNOWN')).toHaveLength(1);
  });
  it('keeps historical UNKNOWN out of the current submit alarm',()=>{
    const facts={pipeline:{pipelineState:'RUNNING'},routes:[],account:{status:'READY'},orders:[{status:'UNKNOWN',activeRiskExposure:true,createdAt:Date.now()-86_400_000}]};
    expect(operationalCandidates(facts)).toHaveLength(0);
    facts.orders[0]!.createdAt=Date.now();
    expect(operationalCandidates(facts)[0]?.publicCode).toBe('EX-SUBMIT-UNKNOWN');
  });
  it('treats one or two -5022 maker races as auto-recovery telemetry and surfaces only a repeated pricing problem',()=>{
    const failure=(n:number)=>({message:'Binance HTTP 400: {"code":-5022,"msg":"Post Only"}',requestId:`r${n}`,endpoint:'/fapi/v1/order',method:'POST',routeIdentity:'proxy-test',completedAt:Date.now()-n*1000});
    const facts=(count:number)=>({pipeline:{pipelineState:'RUNNING'},routes:[{recentFailures:Array.from({length:count},(_,i)=>failure(i))}],account:{status:'READY'}});
    expect(operationalCandidates(facts(1))).toHaveLength(0);
    expect(operationalCandidates(facts(2))).toHaveLength(0);
    expect(operationalCandidates(facts(3))).toMatchObject([{publicCode:'EX-BINANCE-5022',endpoint:'/fapi/v1/order',method:'POST'}]);
  });
  it('keeps exact-order absence audit-only without suppressing other methods',()=>{
    const missing='Binance HTTP 400: {"code":-2013,"msg":"Order does not exist"}',absent='Binance HTTP 400: {"code":-2011,"msg":"Unknown order sent"}';
    expect(classify(missing,{method:'GET',endpoint:'/fapi/v1/order'})).toBeNull();
    expect(classify(absent,{method:'DELETE',endpoint:'/fapi/v1/order'})).toBeNull();
    expect(classify(missing,{method:'DELETE',endpoint:'/fapi/v1/order'})?.publicCode).toBe('EX-BINANCE-2013');
    expect(classify(missing,{method:'POST',endpoint:'/fapi/v1/order'})?.publicCode).toBe('EX-BINANCE-2013');
  });
});


it('does not let one private timeout bypass the sustained NET-002 criterion',()=>{
 const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING'},routes:[],account:{status:'UNAVAILABLE',reason:'BINANCE_REQUEST_QUEUE_TIMEOUT|requestId=private-one|endpoint=/fapi/v2/account'}});
 expect(rows.some(row=>row.publicCode==='NET-002')).toBe(false);
 expect(rows.some(row=>row.publicCode==='PRIVATE-DATA-001')).toBe(true);
});
it('returns recovery transitions once rather than replaying historical recoveries',()=>{
 const tracker=new OperationalIncidentTracker(),candidate=classifyOperationalError({message:'Binance request timed out'})!;
 for(let cycle=0;cycle<3;cycle++){tracker.observe([candidate],100+cycle*100);expect(tracker.observe([],110+cycle*100).recovered).toHaveLength(1);expect(tracker.observe([],120+cycle*100).recovered).toHaveLength(0);}
 expect(tracker.read().history).toHaveLength(3);
});

it('separates historical purpose from current critical reads on the same endpoint',()=>{
 const now=Date.now(),failures=[0,1,2].map(i=>({message:'Binance request timed out',requestId:`history-${i}`,endpoint:'/fapi/v1/allOrders',method:'GET',source:'ORDER_VERIFICATION',purpose:'TRADE_AUDIT_ALL_ORDERS',completedAt:now-i}));
 const facts:any={pipeline:{pipelineState:'RUNNING'},account:{status:'UNAVAILABLE',reason:'Binance request timed out'},routes:[{recentFailures:failures,requestBudget:{recentDispatches:failures.map(row=>({...row,decision:'TIMEOUT'}))}}]};
 expect(operationalCandidates(facts).map(row=>row.publicCode)).toEqual(['PRIVATE-DATA-001']);
 for(const row of failures){row.endpoint='/fapi/v2/account';row.source='PRIVATE_STATE';row.purpose='READ_ACCOUNT';}
 expect(operationalCandidates(facts).some(row=>row.publicCode==='NET-002')).toBe(true);
});
it('keeps historical/backfill wire and queue failures telemetry but preserves real rate limiting',()=>{
 const now=Date.now(),failures=['BACKGROUND','BACKGROUND_AUDIT','HISTORICAL_REPAIR'].map((source,i)=>({source,endpoint:'/fapi/v1/order',method:'GET',purpose:'READ_ORDER',requestId:`bg-${i}`,completedAt:now,message:'Proxy connection timed out'}));
 const facts:any={pipeline:{pipelineState:'RUNNING'},account:{status:'READY'},routes:[{recentFailures:failures,requestBudget:{recentDispatches:failures.map(row=>({...row,decision:'TIMEOUT'}))}}]};
 expect(operationalCandidates(facts)).toHaveLength(0);
 facts.routes[0].requestBudget.recentDispatches.push({...failures[0],status:429});
 expect(operationalCandidates(facts).map(row=>row.publicCode)).toEqual(['EX-HTTP-429']);
});

it('reports one physical network cause plus a separate private fact blocker',()=>{
 const failure={message:'BINANCE_TRANSPORT_BLOCKED: ECONNRESET',requestId:'same-read',endpoint:'/fapi/v2/account',method:'GET',routeIdentity:'proxy-x',completedAt:Date.now()};
 const rows=operationalCandidates({pipeline:{pipelineState:'RUNNING'},routes:[{recentFailures:[failure]}],account:{status:'UNAVAILABLE',reason:failure.message}});
 expect(rows.map(row=>row.publicCode)).toEqual(['NET-001','PRIVATE-DATA-001']);expect(rows.filter(row=>row.category==='NETWORK')).toHaveLength(1);expect(rows[0]?.requestId).toBe('same-read');
});
