import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile,mkdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import {SocksProxyAgent} from 'socks-proxy-agent';

const execute=promisify(execFile);
export type ProxyResource={id:string;url:string;enabled:boolean};
export type ProxyValidationResult={status:string;asOf:number;latencyMs?:number;pid?:number|null;failurePhase?:string;reason?:string;manageable?:boolean;targetHost?:string};
type Result=ProxyValidationResult;
export function managedProxy(resource:ProxyResource){
  try{const u=new URL(resource.url);return u.protocol==='socks5h:'&&u.hostname==='127.0.0.1'&&u.port==='20091'&&!u.username&&!u.password;}catch{return false;}
}
export function proxyValidationLabel(status:string){return({NOT_CONFIGURED:'未配置',DISABLED:'已停用',VERIFYING:'验证中',VERIFIED:'验证通过',VALIDATION_FAILED:'验证未通过',NOT_VERIFIED:'尚未验证',STALE:'验证已过期'} as Record<string,string>)[status]??'验证未通过';}
/** Public GET only; one connection, fixed exchange host, bounded deadline. It does
 * not enter the trading request queue, so queue pressure cannot claim a dead proxy. */
async function remoteProbe(resource:ProxyResource,host:string):Promise<Result>{
  const started=Date.now();let u:URL;
  try{u=new URL(resource.url);if(u.protocol!=='socks5h:')throw Error();}catch{return{status:'NOT_CONFIGURED',asOf:Date.now()};}
  const agent=new SocksProxyAgent(u,{timeout:8000});
  return new Promise(resolve=>{
    let complete=false;
    const finish=(status:string,reason?:string)=>{if(complete)return;complete=true;clearTimeout(timer);request.destroy();agent.destroy();resolve({status,asOf:Date.now(),latencyMs:Date.now()-started,reason});};
    const request=https.get({host,path:'/fapi/v1/time',agent,timeout:8000},response=>{
      if(response.statusCode!==200){response.resume();finish('VALIDATION_FAILED',`HTTP_${response.statusCode}`);return;}
      let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)finish('VALIDATION_FAILED','RESPONSE_TOO_LARGE');});
      response.on('end',()=>{try{finish(Number.isFinite(JSON.parse(body).serverTime)?'VERIFIED':'VALIDATION_FAILED','PUBLIC_TIME_PROBE');}catch{finish('VALIDATION_FAILED','INVALID_RESPONSE');}});
      response.on('error',()=>finish('VALIDATION_FAILED','RESPONSE_FAILED'));
    });
    const timer=setTimeout(()=>finish('VALIDATION_FAILED','CONNECTION_TIMEOUT'),8000);
    request.on('error',()=>finish('VALIDATION_FAILED','CONNECTION_FAILED'));
  });
}
export class ProxyLifecycleService{
  private busy=false;
  private flights=new Map<string,Promise<Result>>();
  private values=new Map<string,Result>();
  constructor(private options:{directory:string;run?:(action:'start'|'restart'|'verify',resource:ProxyResource)=>Promise<Result>;audit?:(row:any)=>void}){}
  private key(r:ProxyResource,host="demo-fapi.binance.com"){return `${r.id}:${r.url}:${r.enabled}:${host}`;}
  status(r:ProxyResource,host="demo-fapi.binance.com"):Result{
    try{if(new URL(r.url).protocol!=='socks5h:')throw Error();}catch{return{status:'NOT_CONFIGURED',asOf:Date.now(),manageable:false};}
    if(!r.enabled)return{status:'DISABLED',asOf:Date.now(),manageable:managedProxy(r)};
    if(this.flights.has(this.key(r,host)))return{status:'VERIFYING',asOf:Date.now(),manageable:managedProxy(r)};
    const row=this.values.get(this.key(r,host));return{...row,status:row?(Date.now()-row.asOf>120000?'STALE':row.status):'NOT_VERIFIED',asOf:row?.asOf??Date.now(),manageable:managedProxy(r)};
  }
  private async command(action:'start'|'restart'|'verify',resource:ProxyResource):Promise<Result>{
    if(this.options.run)return this.options.run(action,resource);
    if(!managedProxy(resource))throw Error('PROXY_RESOURCE_NOT_LOCALLY_MANAGED');
    const script=fileURLToPath(new URL('../../../../scripts/vpn/zdj-trade-proxy-client-windows.ps1',import.meta.url));
    let stdout='';
    try{stdout=(await execute('pwsh.exe',['-NoProfile','-NonInteractive','-File',script,...(action==='verify'?['-Status']:action==='restart'?['-Restart']:[])],{windowsHide:true,timeout:60000,maxBuffer:65536})).stdout;}
    catch(error){const e=error as any;if(e.killed)throw Error('PROXY_OPERATION_TIMEOUT_OUTCOME_UNKNOWN');if(e.code==='ENOENT'||/SECURE_LOCAL_KEY_MISSING|PINNED_KNOWN_HOSTS_MISSING/.test(String(e.stderr??'')))return{status:'NOT_CONFIGURED',asOf:Date.now(),reason:'PROXY_LAUNCHER_OR_SECURE_KEY_NOT_CONFIGURED',manageable:true};stdout=String(e.stdout??'');if(!stdout.includes('{'))throw Error('PROXY_PROCESS_IDENTITY_OR_EXECUTION_FAILED');}
    try{const row=JSON.parse(stdout.slice(stdout.indexOf('{'),stdout.lastIndexOf('}')+1));return{status:row.healthy===true?'VERIFIED':'VALIDATION_FAILED',asOf:Date.now(),pid:row.pid??null,latencyMs:row.elapsedMs,failurePhase:row.failurePhase,reason:row.healthy?'PUBLIC_TIME_PROBE':String(row.error??'CONNECTION_FAILED').slice(0,180),manageable:true};}catch{throw Error('PROXY_OPERATION_RESULT_INVALID');}
  }
  async audit(row:any){await mkdir(this.options.directory,{recursive:true});const entry={at:Date.now(),...row};await appendFile(path.join(this.options.directory,'proxy-lifecycle.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});this.options.audit?.(entry);}
  async verify(r:ProxyResource,host='demo-fapi.binance.com'){
    const base=this.status(r,host);if(['NOT_CONFIGURED','DISABLED'].includes(base.status))return base;
    const key=this.key(r,host),running=this.flights.get(key);if(running)return running;
    if(!['demo-fapi.binance.com','fapi.binance.com'].includes(host))throw Error('PROXY_PROBE_HOST_NOT_ALLOWED');
    const flight=(async()=>{let result:Result;try{result=this.options.run?await this.options.run('verify',r):managedProxy(r)&&host==='demo-fapi.binance.com'?await this.command('verify',r):await remoteProbe(r,host);}catch(error){result={status:'VALIDATION_FAILED',asOf:Date.now(),reason:(error as Error).message};}result={...result,targetHost:host};this.values.set(key,result);await this.audit({resourceId:r.id,action:'verify',...result});return{...result,manageable:managedProxy(r)};})();
    this.flights.set(key,flight);try{return await flight;}finally{this.flights.delete(key);}
  }
  async operate(r:ProxyResource,action:unknown){
    if(action!=='start'&&action!=='restart')throw Error('PROXY_ACTION_INVALID');
    if(!managedProxy(r)||!r.enabled)throw Error('PROXY_RESOURCE_NOT_LOCALLY_MANAGED');
    if(this.busy||this.flights.size)throw Error('PROXY_OPERATION_BUSY');this.busy=true;
    const lockPath=path.join(this.options.directory,'proxy-operation.lock');let lock:any,complete=false;
    try{await mkdir(this.options.directory,{recursive:true});lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({enginePid:process.pid,resourceId:r.id,action,at:Date.now()}));await this.audit({resourceId:r.id,action,status:'STARTED'});
      const result={...await this.command(action,r),targetHost:'demo-fapi.binance.com',manageable:true};this.values.set(this.key(r),result);complete=true;await this.audit({resourceId:r.id,action,...result});return result;
    }catch(error){complete=!(error as Error).message.includes('TIMEOUT_OUTCOME_UNKNOWN');await this.audit({resourceId:r.id,action,status:'FAILED',reason:(error as Error).message});throw error;
    }finally{await lock?.close();if(lock&&complete)await unlink(lockPath);this.busy=false;}
  }
}
