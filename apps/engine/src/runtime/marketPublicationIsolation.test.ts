import {it,expect,vi} from 'vitest';
import {EngineRuntime} from './appRuntime.js';
it('continues publishing received market facts while exchange reconciliation is pending and never overlaps exchange ticks',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);let release!:()=>void;const pending=new Promise<void>(r=>release=r);
 const runtime:any=Object.create(EngineRuntime.prototype);runtime.stopped=false;runtime.timers=[];runtime.events={publish:vi.fn()};runtime.state={settings:{connections:{executionMode:'TESTNET_ENABLED'}},snapshots:new Map()};
 runtime.market={tick:vi.fn(async()=>runtime.state.snapshots.set('BTCUSDT',{quote:{ts:Date.now()}}))};runtime.exchangeLoop={tick:vi.fn(async()=>pending)};
 try{runtime.startMarketAndExchangeTicks();await vi.advanceTimersByTimeAsync(120_000);
  expect(runtime.market.tick).toHaveBeenCalledTimes(120);expect(runtime.exchangeLoop.tick).toHaveBeenCalledTimes(1);
  expect(runtime.state.snapshots.get('BTCUSDT').quote.ts).toBe(Date.now());
  release();await Promise.resolve();await vi.advanceTimersByTimeAsync(1_000);expect(runtime.exchangeLoop.tick).toHaveBeenCalledTimes(2);
 }finally{runtime.stopped=true;for(const timer of runtime.timers)clearInterval(timer);release();vi.useRealTimers();}
});
it('keeps market publication alive in read-only mode without an exchange execution tick',async()=>{
 vi.useFakeTimers();const runtime:any=Object.create(EngineRuntime.prototype);runtime.stopped=false;runtime.timers=[];runtime.events={publish:vi.fn()};runtime.state={settings:{connections:{executionMode:'READ_ONLY'}}};runtime.market={tick:vi.fn(async()=>{})};runtime.exchangeLoop={tick:vi.fn()};
 try{runtime.startMarketAndExchangeTicks();await vi.advanceTimersByTimeAsync(3_000);expect(runtime.market.tick).toHaveBeenCalledTimes(3);expect(runtime.exchangeLoop.tick).not.toHaveBeenCalled();}
 finally{runtime.stopped=true;for(const timer of runtime.timers)clearInterval(timer);vi.useRealTimers();}
});
