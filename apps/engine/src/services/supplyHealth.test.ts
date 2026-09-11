import { describe,expect,it } from 'vitest';
import { buildSupplyHealth } from './supplyHealth.js';

const row=(symbol:string,overrides:any={})=>({symbol,rank:1,eligible:true,residentEligible:true,pipelineEligible:true,lifecycle:'READY',exclusionReasons:[],...overrides});

describe('supply health diagnostics',()=>{
  it('keeps waiting residents distinct from actual dispatch-ready and pool-ready supply',()=>{
    const waiting=Array.from({length:20},(_,index)=>row(`WAIT${index}USDT`,{pipelineEligible:false,lifecycle:'WAITING_CAPITAL_ROUTE'}));
    const ready=Array.from({length:10},(_,index)=>row(`READY${index}USDT`));
    const health=buildSupplyHealth({universe:[...waiting,...ready],pool:[...waiting.map(candidate=>({symbol:candidate.symbol,state:'WAITING'})),...ready.map(candidate=>({symbol:candidate.symbol,state:'READY'}))],snapshots:new Map(),positions:new Set(),activeEntries:new Set(),capacity:{used:0,max:50},runtimeControl:{mode:'RUNNING',capital:{routedCandidates:ready.map(candidate=>({symbol:candidate.symbol,longExecutable:true,shortExecutable:true}))}},target:20,lowWatermark:6});
    expect(health.counts.residentSymbols).toBe(30);
    expect(health.counts.dispatchReadySymbols).toBe(10);
    expect(health.readyCount).toBe(10);
    expect(health.poolCount).toBe(30);
    expect(health.cohort.status).toBe('NOT_ESTABLISHED');
    expect(health.retention.zombieSnapshotCount).toBeNull();
  });

  it('reports a single root blocker while retaining overlapping reason counts',()=>{
    const health=buildSupplyHealth({universe:[row('BTCUSDT',{pipelineEligible:false,lifecycle:'WAITING_CAPITAL_ROUTE',exclusionReasons:['QUOTE_STALE']})],pool:[],snapshots:new Map(),positions:new Set(['ETHUSDT']),activeEntries:new Set(),capacity:{used:50,max:50},runtimeControl:{mode:'PAUSED_DAILY_RISK_LIMIT',reasonCode:'DAILY_RISK_LIMIT'},aiResources:[{role:'PRIMARY_BRAIN',status:'OFFLINE'}],target:20,lowWatermark:6});
    expect(health.rootBlocker).toBe('CAPACITY');
    expect(health.reasonCounts).toMatchObject({CAPACITY:1,RISK:1,AI:1,CAPITAL:0,MARKET:1});
  });
  it('does not call a cooldown or rank-zero governance rejection capital-blocked',()=>{const health=buildSupplyHealth({universe:[row('COOLEDUSDT',{lifecycle:'REJECT_COOLDOWN',pipelineEligible:false}),row('GOVUSDT',{rank:0,eligible:false,residentEligible:false,assetAdmission:{classification:'EXCLUDED'},exclusionReasons:['ASSET_EXCLUDED']})],pool:[],snapshots:new Map(),positions:new Set(),activeEntries:new Set(),capacity:{used:0,max:50},runtimeControl:{mode:'RUNNING',capital:{routedCandidates:[]}},target:20,lowWatermark:6});expect(health.reasonCounts.CAPITAL).toBe(0);expect(health.counts.governanceBlockedSymbols).toBe(1);});
});
