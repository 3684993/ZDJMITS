import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {timingSafeEqual} from 'node:crypto';
import {appendFile,mkdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
export type ModelAction='start'|'stop'|'restart';
export function modelOperationPermission(token:unknown,expected:string|undefined,origin:string|undefined,host:string|undefined){
  if(!expected||expected.length<32||typeof token!=='string')return false;
  const a=Buffer.from(token),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return false;
  try{return Boolean(origin&&host&&new URL(origin).host===host&&['http:','https:'].includes(new URL(origin).protocol));}catch{return false;}
}
export class ModelLifecycleService {
  private busy=false;
  private reads=new Map<string,{at:number;value:Promise<any>}>();
  constructor(private options:{directory:string;manifest?:string;inspect?:(id:string)=>Promise<any>;perform?:(id:string,action:ModelAction,identity:any)=>Promise<any>;validate?:(id:string,status:any)=>void;guard:()=>void;drain:(id:string)=>()=>void;audit?:(row:any)=>void}){}
  private async command(id:string,action:string,identity?:any){
    if(!this.options.manifest)throw Error('MODEL_MANAGEMENT_NOT_CONFIGURED');
    const script=fileURLToPath(new URL('../../../../scripts/model-lifecycle.ps1',import.meta.url));
    try{
      const {stdout}=await execute('pwsh.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Manifest',this.options.manifest,'-ResourceId',id,'-Action',action,'-ExpectedEnginePid',String(process.pid),...(identity?['-ExpectedPid',String(identity.pid??0),'-ExpectedStartUtc',String(identity.processStartedAt??'')]:[])],{windowsHide:true,timeout:action==='status'?12_000:330_000,maxBuffer:128*1024});
      return JSON.parse(stdout.trim().replace(/^\uFEFF/,''));
    }catch(error){
      const e=error as any,reason=String(e.stderr??'').match(/\b(?:MODEL|LAUNCHER|EXECUTABLE|MANIFEST|CONFIG)_[A-Z_]+\b/)?.[0];
      throw Error(reason??(e.killed?'MODEL_PROCESS_TIMEOUT_OUTCOME_UNKNOWN':'MODEL_PROCESS_EXECUTION_FAILED'));
    }
  }
  async status(id:string,fresh=false){
    const cached=this.reads.get(id);if(!fresh&&cached&&Date.now()-cached.at<10_000)return cached.value;
    const value=this.options.inspect?this.options.inspect(id):this.command(id,'status');
    this.reads.set(id,{at:Date.now(),value});try{return await value;}catch(error){this.reads.delete(id);throw error;}
  }
  async audit(row:any){await mkdir(this.options.directory,{recursive:true});const entry={at:Date.now(),...row};await appendFile(path.join(this.options.directory,'model-lifecycle.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});this.options.audit?.(entry);}
  async operate(id:string,action:unknown){
    if(!['start','stop','restart'].includes(String(action)))throw Error('MODEL_ACTION_INVALID');
    if(this.busy)throw Error('MODEL_OPERATION_BUSY');
    this.busy=true;let release:(()=>void)|undefined,lock:any,complete=false,mutationStarted=false;
    const lockPath=path.join(this.options.directory,'model-operation.lock');
    try{
      await mkdir(this.options.directory,{recursive:true});
      lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({id,action,at:Date.now(),enginePid:process.pid}));
      await this.audit({resourceId:id,action,result:'STARTED'});
      this.options.guard();release=this.options.drain(id);
      const before=await this.status(id,true);
      this.options.validate?.(id,before);
      this.options.guard();
      mutationStarted=true;
      const result=this.options.perform?await this.options.perform(id,action as ModelAction,before):await this.command(id,String(action),before);
      this.options.guard();
      await this.audit({resourceId:id,action,result:'COMPLETED',pid:result.pid??null});complete=true;return result;
    }catch(error){
      // An uncertain child outcome keeps the durable lock: no retry after timeout or host crash.
      complete=!mutationStarted;
      await this.audit({resourceId:id,action,result:'REFUSED_OR_FAILED',reason:((error as Error).message??'UNKNOWN').split('\n')[0]!.slice(0,180)});throw error;
    }finally{this.reads.delete(id);if(complete||!mutationStarted)release?.();await lock?.close();if(lock&&complete)await unlink(lockPath);this.busy=false;}
  }
}
