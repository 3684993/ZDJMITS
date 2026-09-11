import { describe,it,expect,vi } from 'vitest';
import path from 'node:path';
import { EngineRuntime } from './appRuntime.js';

describe('mock V3 runtime',()=>{
  it('bootstraps universe, pool and snapshots',async()=>{
    process.env.ZDJ_DATA_MODE='mock';process.env.ZDJ_AI_MODE='mock';process.env.ZDJ_TRADING_ADAPTER='mock';
    const root=path.resolve(process.cwd(),'../..');
    const runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:path.join(root,'data-test')});
    await runtime.bootstrap();
    expect(runtime.state.snapshots.size).toBeGreaterThan(5);
    expect(runtime.state.universe.filter(x=>x.rank>0).map(x=>x.symbol).sort()).toEqual(['BTCUSDT','ETHUSDT']);
    expect(runtime.state.pool.list().length).toBeGreaterThan(0);
    expect((runtime as any).marketSymbolLimit()).toBeGreaterThanOrEqual(runtime.state.settings.selection.poolTarget+32);

    let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    runtime.state.account={...runtime.state.account,status:'READY',reason:null};
    (runtime as any).trade={hasCredentials:()=>true,fetchAccountSnapshot:async()=>{await pending;return{equityUsd:1,availableUsd:1,walletBalanceUsd:1,unrealizedPnlUsd:0,assets:[],asOf:Date.now()};}};
    const refresh=runtime.syncPrivate();
    expect(runtime.state.account.status).toBe('READY');
    release();await refresh;
    expect(runtime.state.account.status).toBe('READY');
    runtime.stop();
  },30_000);

  it('starts critical runtime loops without awaiting risk baseline I/O',async()=>{
    const root=path.resolve(process.cwd(),'../..');
    const runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:path.join(root,'data-test')});
    const refreshRiskBaseline=vi.fn(()=>new Promise<never>(()=>{}));
    runtime.liveValidation.refreshRiskBaseline=refreshRiskBaseline;
    runtime.externalIntelligence.tick=vi.fn(async()=>{});

    await runtime.start();

    expect(refreshRiskBaseline).not.toHaveBeenCalled();
    runtime.stop();
  },30_000);

  it('starts degraded runtime loops when the initial public market refresh fails',async()=>{
    const root=path.resolve(process.cwd(),'../..');
    const runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:path.join(root,'data-test')});
    const failures:any[]=[];
    runtime.events.on('event',event=>{if(event.type==='MARKET_BOOTSTRAP_FAILED')failures.push(event);});
    runtime.market.refresh=vi.fn(async()=>{throw new Error('TRANSIENT_MARKET_TIMEOUT');});
    runtime.externalIntelligence.tick=vi.fn(async()=>{});

    await runtime.start();

    expect(failures).toHaveLength(2);
    expect(failures.every(event=>event.payload.retry==='PERIODIC_MARKET_REFRESH')).toBe(true);
    runtime.stop();
  },30_000);
});
it('does not publish into the closed database from queued UI snapshots',async()=>{
 const {createApiRouter}=await import('../api/router.js');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(path.join(tmpdir(),'zdj-shutdown-')),root=path.resolve(process.cwd(),'../..');
 const runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:dir});
 try{createApiRouter(runtime);runtime.events.publish('POOL_UPDATED',{});runtime.stop();await new Promise(r=>setTimeout(r,350));expect((runtime as any).persistenceClosed).toBe(true);}
 finally{await rm(dir,{recursive:true,force:true});}
});
it('starts private synchronization before a delayed full-universe bootstrap',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os');const dir=await mkdtemp(path.join(tmpdir(),'zdj-bootstrap-order-')),root=path.resolve(process.cwd(),'../..'),runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:dir});
 let release!:(n:number)=>void;const privateRead=vi.spyOn(runtime,'syncPrivate').mockResolvedValue();vi.spyOn(runtime.market,'refresh').mockReturnValueOnce(new Promise(r=>release=r)).mockResolvedValue(0);
 try{const boot=runtime.bootstrap();await Promise.resolve();expect(privateRead).toHaveBeenCalledOnce();release(0);await boot;}finally{runtime.stop();await rm(dir,{recursive:true,force:true});}
});
