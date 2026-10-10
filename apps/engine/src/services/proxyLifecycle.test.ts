import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProxyLifecycleService,managedProxy} from './proxyLifecycle.js';
const directories:string[]=[];
afterEach(async()=>{vi.useRealTimers();for(const d of directories.splice(0))await rm(d,{recursive:true,force:true});});
const resource={id:'proxy',url:'socks5h://127.0.0.1:20091',enabled:true};
async function service(run:any){const directory=await mkdtemp(path.join(os.tmpdir(),'zdj-proxy-'));directories.push(directory);return{directory,service:new ProxyLifecycleService({directory,run})};}
it('does not mistake saved settings, missing config or disabled resources for a successful connection',async()=>{
  const run=vi.fn().mockResolvedValue({status:'VALIDATION_FAILED',reason:'CONNECTION_TIMEOUT',asOf:Date.now()}),s=(await service(run)).service;
  expect(s.status(resource).status).toBe('NOT_VERIFIED');
  expect((await s.verify({...resource,url:''})).status).toBe('NOT_CONFIGURED');
  expect((await s.verify({...resource,enabled:false})).status).toBe('DISABLED');expect(run).not.toHaveBeenCalled();
  expect((await s.verify(resource)).status).toBe('VALIDATION_FAILED');expect(s.status(resource).reason).toBe('CONNECTION_TIMEOUT');
});
it('coalesces simultaneous validation, separates TESTNET/Production evidence and expires old proof',async()=>{
  let finish:any;const run=vi.fn(()=>new Promise<any>(resolve=>{finish=resolve;})),s=(await service(run)).service;
  const first=s.verify(resource),second=s.verify(resource);expect(run).toHaveBeenCalledTimes(1);expect(s.status(resource).status).toBe('VERIFYING');
  finish({status:'VERIFIED',asOf:Date.now(),pid:42});await Promise.all([first,second]);expect(s.status(resource).status).toBe('VERIFIED');
  expect(s.status(resource,'fapi.binance.com').status).toBe('NOT_VERIFIED');expect(s.status({...resource,url:'socks5h://127.0.0.1:29999'}).status).toBe('NOT_VERIFIED');
  vi.useFakeTimers();vi.setSystemTime(Date.now()+120001);expect(s.status(resource).status).toBe('STALE');
});
it('locks lifecycle mutation, only manages the fixed local proxy and audits actual failed verification',async()=>{
  let finish:any;const run=vi.fn(()=>new Promise<any>(resolve=>{finish=resolve;})),{service:s,directory}=await service(run);
  const first=s.operate(resource,'restart');await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(1));
  await expect(s.operate(resource,'start')).rejects.toThrow('BUSY');
  await expect(s.operate({...resource,url:'socks5h://other:20091'},'restart')).rejects.toThrow('NOT_LOCALLY_MANAGED');
  finish({status:'VALIDATION_FAILED',asOf:Date.now(),pid:42});expect((await first).status).toBe('VALIDATION_FAILED');
  const audit=await readFile(path.join(directory,'proxy-lifecycle.jsonl'),'utf8');expect(audit).toContain('STARTED');expect(audit).toContain('VALIDATION_FAILED');
  expect(managedProxy({...resource,url:'socks5h://user:secret@127.0.0.1:20091'})).toBe(false);
});
it('retains the lock after uncertain timeout and prevents a second lifecycle attempt',async()=>{
  const {service:s,directory}=await service(vi.fn().mockRejectedValue(Error('PROXY_OPERATION_TIMEOUT_OUTCOME_UNKNOWN')));
  await expect(s.operate(resource,'restart')).rejects.toThrow('TIMEOUT_OUTCOME_UNKNOWN');
  expect(await readFile(path.join(directory,'proxy-operation.lock'),'utf8')).toContain('restart');
  await expect(s.operate(resource,'start')).rejects.toThrow();
});
it('reuses recent probe evidence without refreshing asOf and backs off failed probes',async()=>{
 vi.useFakeTimers();const run=vi.fn().mockResolvedValue({status:'VALIDATION_FAILED',asOf:Date.now(),failurePhase:'SOCKS_CONNECT_REPLY'}),s=(await service(run)).service;
 const first=await s.verify(resource);for(let i=0;i<100;i++)expect((await s.verify(resource)).asOf).toBe(first.asOf);expect(run).toHaveBeenCalledTimes(1);
 vi.advanceTimersByTime(31000);run.mockResolvedValue({status:'VALIDATION_FAILED',asOf:Date.now()});await s.verify(resource);expect(run).toHaveBeenCalledTimes(2);
 vi.advanceTimersByTime(31000);await s.verify(resource);expect(run).toHaveBeenCalledTimes(2);vi.advanceTimersByTime(31000);await s.verify(resource);expect(run).toHaveBeenCalledTimes(3);
});
