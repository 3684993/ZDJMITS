import {describe,it,expect} from 'vitest';
import {aiLamp,proxyLamp,privateLamp,exchangeLamp,p95,uniqueAiRunStats} from './performanceFacts';
describe('performance evidence and status lamps',()=>{
  const now=100_000;
  it('never turns stale or absent source into a green light',()=>{
    expect(aiLamp({connectionStatus:'ONLINE',healthCheckedAt:0},now).tone).toBe('unknown');
    expect(aiLamp({connectionStatus:'OFFLINE',healthCheckedAt:99_000},now).tone).toBe('bad');
    expect(aiLamp({connectionStatus:'ONLINE',healthCheckedAt:99_000,active:0,queueDepth:3},now).tone).toBe('warn');
    expect(aiLamp({connectionStatus:'ONLINE',healthCheckedAt:99_000,active:0,queueDepth:0},now).tone).toBe('good');
    expect(privateLamp({account:{status:'READY',asOf:1000}},now).tone).toBe('warn');
    expect(privateLamp({account:{status:'READY',asOf:99_000}},now).tone).toBe('good');
    expect(privateLamp({account:{status:'UNAVAILABLE',asOf:99_000}},now).tone).toBe('bad');
  });
  it('does not relabel HTTP451 exchange refusal as proxy failure, or color stale health green',()=>{
    const healthy={health:[{id:'trading-network',status:'HEALTHY',updatedAt:99_000,detail:'healthy'}]};
    expect(exchangeLamp(healthy,[],now).tone).toBe('good');
    expect(exchangeLamp(healthy,[{active:true,category:'EXCHANGE',httpStatus:451}],now)).toMatchObject({tone:'bad',text:'HTTP 451'});
    expect(exchangeLamp(healthy,[{active:true,category:'EXCHANGE',httpStatus:429}],now).tone).toBe('warn');
    expect(exchangeLamp({health:[{id:'trading-network',status:'HEALTHY',updatedAt:1}]},[],now).tone).toBe('unknown');
  });
  it('reports proxy config only as warning, never as verified reachability',()=>{
    expect(proxyLamp([{rest:{throughProxy:true,failClosed:true}}]).tone).toBe('warn');
    expect(proxyLamp([{rest:{throughProxy:false,failClosed:true}}]).tone).toBe('bad');
    expect(proxyLamp([]).tone).toBe('unknown');
  });
  it('does not fabricate p95 or count duplicate run IDs',()=>{
    expect(p95([])).toBeNull();expect(p95([0,10,20])).toBe(20);
    const r={id:'A',role:'PRIMARY_BRAIN',status:'COMPLETED',timing:{queueMs:120}};
    const stats=uniqueAiRunStats([r,r,{id:'B',role:'PRIMARY_BRAIN',status:'FAILED',timing:{queueMs:30}}]);
    expect(stats.rows).toBe(2);expect(stats.byRole[1]).toMatchObject({count:2,failed:1,queuedP95Ms:120});
    expect(stats.byRole[0]!.queuedP95Ms).toBeNull();
  });
});
