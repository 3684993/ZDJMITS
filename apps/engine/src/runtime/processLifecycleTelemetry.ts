import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const truncate=(value:string,limit:number)=>value.length<=limit?value:value.slice(0,limit)+'...[truncated]';
const redact=(value:string)=>truncate(value
  .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,'$1[REDACTED]')
  .replace(/((?:api[_-]?key|secret|token|password)\s*[:=]\s*)[^\s,"']+/gi,'$1[REDACTED]'),8192);
const lifecycleMaxBytes=32*1024*1024;
let lifecycleBytes=-1;

export function processErrorFact(error:unknown){
  if(error instanceof Error)return{name:error.name,message:redact(error.message),stack:error.stack?redact(error.stack):null};
  return{name:null,message:redact(String(error)),stack:null};
}

export function appendProcessLifecycleFact(dataDir:string,event:string,payload:Record<string,unknown>={}){
  // Scheduler BEGIN/END was useful during native-crash forensics, but it duplicates foreground
  // stdout at very high frequency. Keep failures by default; enable full scheduler tracing only
  // for a short diagnostic window with ZDJ_FOREGROUND_SCHEDULER_TRACE=1.
  if((event==='SCHEDULED_TASK_BEGIN'||event==='SCHEDULED_TASK_END')&&process.env.ZDJ_FOREGROUND_SCHEDULER_TRACE!=='1')return true;
  const dir=path.join(dataDir,'runtime-logs'),file=path.join(dir,'engine-process-lifecycle.jsonl'),previous=path.join(dir,'engine-process-lifecycle.previous.jsonl');
  try{
    const row={ts:Date.now(),event,pid:process.pid,ppid:process.ppid,uptimeMs:Math.round(process.uptime()*1000),exitCode:process.exitCode??null,payload};
    const line=JSON.stringify(row)+'\n';
    mkdirSync(dir,{recursive:true});
    if(lifecycleBytes<0)lifecycleBytes=existsSync(file)?statSync(file).size:0;
    if(lifecycleBytes+Buffer.byteLength(line)>lifecycleMaxBytes){
      if(existsSync(previous))rmSync(previous,{force:true});
      if(existsSync(file))renameSync(file,previous);
      lifecycleBytes=0;
    }
    appendFileSync(file,line,'utf8');
    lifecycleBytes+=Buffer.byteLength(line);
    if(process.env.ZDJ_FOREGROUND_OBSERVE==='1')console.log(JSON.stringify({source:'PROCESS_LIFECYCLE',...row}));
    return true;
  }catch{return false;}
}

/**
 * Observability only. These hooks never restart the Engine and never change
 * Node's exception/signal semantics. Fatal policy remains owned by main.ts.
 */
export function installProcessLifecycleTelemetry(dataDir:string){
  const record=(event:string,payload:Record<string,unknown>={})=>appendProcessLifecycleFact(dataDir,event,payload);
  record('PROCESS_TELEMETRY_INSTALLED',{execPath:process.execPath,argv1:process.argv[1]??null});
  process.on('uncaughtExceptionMonitor',(error,origin)=>record('UNCAUGHT_EXCEPTION_MONITOR',{origin,error:processErrorFact(error)}));
  process.on('beforeExit',code=>record('PROCESS_BEFORE_EXIT',{code}));
  process.on('exit',code=>record('PROCESS_EXIT',{code,processExitCode:process.exitCode??null}));
  return{record};
}
