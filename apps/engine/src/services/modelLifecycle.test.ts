import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ModelLifecycleService,modelOperationPermission} from './modelLifecycle.js';
describe('model lifecycle permission and transaction boundary',()=>{
  const secret='x'.repeat(32);
  it('requires an operator secret and matching origin; refuses absent configuration and CSRF',()=>{
    expect(modelOperationPermission(secret,secret,'http://localhost:35555','localhost:35555')).toBe(true);
    for(const [token,configured,origin] of [[secret,undefined,'http://localhost:35555'],['wrong',secret,'http://localhost:35555'],[secret,secret,'https://evil.test'],[secret,secret,undefined],[secret,'short','http://localhost:35555']] as const)expect(modelOperationPermission(token,configured,origin,'localhost:35555')).toBe(false);
  });
  async function fixture(overrides:any={}){
    const directory=await mkdtemp(path.join(os.tmpdir(),'model-operation-'));
    const release=vi.fn(),guard=vi.fn(),drain=vi.fn(()=>release),perform=vi.fn(async()=>({pid:123,status:'READY'}));
    const service=new ModelLifecycleService({directory,guard,drain,perform,inspect:async()=>({pid:123,identityVerified:true}),...overrides});
    return{directory,release,guard,drain,perform,service};
  }
  it('rejects unsafe trading facts or in-flight inference before process changes',async()=>{
    for(const key of ['guard','drain']){
      const f=await fixture({[key]:()=>{throw Error('PROTECTION_OR_INFLIGHT_BLOCKED');}});
      try{await expect(f.service.operate('primary','restart')).rejects.toThrow('BLOCKED');expect(f.perform).not.toHaveBeenCalled();expect(await readFile(path.join(f.directory,'model-lifecycle.jsonl'),'utf8')).toContain('REFUSED_OR_FAILED');}
      finally{await rm(f.directory,{recursive:true,force:true});}
    }
  });
  it('rejects edited resource identity and browser command strings',async()=>{
    const f=await fixture({validate:()=>{throw Error('IDENTITY_MISMATCH');}});
    try{await expect(f.service.operate('primary','restart')).rejects.toThrow('IDENTITY');await expect(f.service.operate('primary','cmd /c whoami')).rejects.toThrow('ACTION_INVALID');expect(f.perform).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalled();}
    finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it('serializes all GPUs and releases the drain after a proven completion',async()=>{
    let done!:(value:any)=>void;const f=await fixture({perform:()=>new Promise(resolve=>done=resolve)});
    try{const operation=f.service.operate('primary','start');while(!done)await new Promise(resolve=>setTimeout(resolve,5));await expect(f.service.operate('review','start')).rejects.toThrow('BUSY');done({pid:123,status:'READY'});await operation;expect(f.guard).toHaveBeenCalledTimes(3);expect(f.release).toHaveBeenCalledOnce();}
    finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it('retains a durable lock for uncertain outcomes and blocks retries across service instances',async()=>{
    const f=await fixture({perform:async()=>{throw Error('MODEL_START_TIMEOUT_OUTCOME_UNKNOWN');}});
    try{await expect(f.service.operate('primary','start')).rejects.toThrow('TIMEOUT');expect(f.release).not.toHaveBeenCalled();expect(await readFile(path.join(f.directory,'model-operation.lock'),'utf8')).toContain('primary');const other=new ModelLifecycleService({directory:f.directory,guard:vi.fn(),drain:()=>vi.fn(),perform:f.perform});await expect(other.operate('review','start')).rejects.toThrow();expect(f.perform).not.toHaveBeenCalled();}
    finally{await rm(f.directory,{recursive:true,force:true});}
  });
});
