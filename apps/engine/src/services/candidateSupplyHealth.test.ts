import { describe,it,expect } from 'vitest';
import { candidateSupplyHealth } from './candidateSupplyHealth.js';

const candidate=(i:number,ready:boolean)=>({symbol:`S${i}USDT`,rank:i+1,eligible:ready,residentEligible:true,pipelineEligible:ready,lifecycle:ready?'READY':'TECHNICAL_COOLDOWN',exclusionReasons:ready?[]:['TECHNICAL_COOLDOWN']});

describe('candidate supply health',()=>{
  it('reports READY independently from resident/pool occupancy',()=>{
    const universe=[...Array.from({length:10},(_,i)=>candidate(i,true)),...Array.from({length:20},(_,i)=>candidate(i+10,false))];
    const poolItems=universe.slice(0,20).map((row:any)=>({symbol:row.symbol,state:row.pipelineEligible?'READY':'WAITING'}));
    const routedCandidates=universe.slice(0,10).map((row:any)=>({symbol:row.symbol,longExecutable:true,shortExecutable:true}));
    const state:any={universe,pool:{list:()=>poolItems},runtimeControl:{capital:{routedCandidates,executableCandidateCount:10,reasonCounts:{}}},positions:new Map(),entryOrders:new Map(),candidateLifecycle:new Map(),snapshots:new Map(universe.map((row:any)=>[row.symbol,{}]))};
    const health=candidateSupplyHealth(state);
    expect(health.residentCount).toBe(30);expect(health.executionReadyCount).toBe(10);expect(health.poolResidentCount).toBe(20);expect(health.poolReadyCount).toBe(10);expect(health.readyZeroReason).toBeNull();
  });

  it('exposes stale online snapshots that have no current ownership',()=>{
    const state:any={universe:[],pool:{list:()=>[]},runtimeControl:{capital:{routedCandidates:[],executableCandidateCount:0,reasonCounts:{}}},positions:new Map(),entryOrders:new Map(),candidateLifecycle:new Map(),snapshots:new Map([['BTCUSDT',{}],['ETHUSDT',{}],['OLDUSDT',{}]])};
    const health=candidateSupplyHealth(state);
    expect(health.zombieSnapshotCount).toBe(1);expect(health.zombieSnapshots).toEqual(['OLDUSDT']);
  });

  it('classifies ready-zero causes so capital shortage is not mistaken for supply depletion',()=>{
    const row={...candidate(0,true),symbol:'SOLUSDT'};
    const state:any={universe:[row],pool:{list:()=>[{symbol:'SOLUSDT',state:'READY'}]},runtimeControl:{capital:{routedCandidates:[],executableCandidateCount:0,reasonCounts:{NO_USDT_MARGIN:1}}},positions:new Map(),entryOrders:new Map(),candidateLifecycle:new Map(),snapshots:new Map([['SOLUSDT',{}]])};
    const health=candidateSupplyHealth(state);
    expect(health.executionReadyCount).toBe(0);expect(health.readyZeroReason).toBe('CAPITAL');expect(health.blockerCategories.CAPITAL).toBeGreaterThan(0);
  });
});
