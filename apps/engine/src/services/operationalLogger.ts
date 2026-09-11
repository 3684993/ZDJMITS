import path from 'node:path';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { redactAudit } from '../api/projections.js';

export const telemetryTypes=new Set(['CANDIDATE_RANKING_SHADOW','SHADOW_SAMPLE_RECORDED','POOL_UPDATED','POOL_SUPPLY_HEALTH','ASSET_ADMISSION_EVALUATED','UNIVERSE_UPDATED','MARKET_FRESHNESS_RECOVERED','MARKET_FRESHNESS_RECOVERY']);
export const isTelemetry=(type:string)=>telemetryTypes.has(type);
type Event={id?:string;type:string;ts:number;symbol?:string;payload?:any};
type Options={maxFileBytes:number;maxTotalBytes:number;retentionDays:number;heartbeatMs:number;maxQueueBytes:number};
const defaults:Options={maxFileBytes:100*1024*1024,maxTotalBytes:2*1024**3,retentionDays:7,heartbeatMs:30_000,maxQueueBytes:8*1024*1024};

/** Operational output only. Lossless trading audit remains in the synchronous journal. */
export class OperationalLogger {
  private rows:string[]=[];private queuedBytes=0;private counters=new Map<string,number>();private lastHeartbeat=Date.now();
  private file='';private day='';private fileBytes=0;private sequence=0;private draining:Promise<void>|null=null;
  private errors=new Map<string,{at:number;suppressed:number}>();private dropped=0;private failures=0;private lastError:string|null=null;
  private closed=false;private timer:NodeJS.Timeout;
  private readonly options:Options;
  constructor(private dir:string,private identity:{instanceId:string;buildId:string;environment:string},options:Partial<Options>={}){
    this.options={...defaults};for(const key of Object.keys(defaults) as Array<keyof Options>){const value=options[key];if(typeof value==='number'&&Number.isFinite(value)&&value>0)this.options[key]=value;}this.timer=setInterval(()=>{this.heartbeat();void this.flush();},100);this.timer.unref();
  }
  record(event:Event){
    if(this.closed)return;
    if(isTelemetry(event.type)){this.counters.set(event.type,(this.counters.get(event.type)??0)+1);this.heartbeat();return;}
    const error=/FAILED|ERROR|FATAL/.test(event.type),key=`${event.type}:${event.symbol??''}`;
    if(error){const old=this.errors.get(key);if(old&&event.ts-old.at<this.options.heartbeatMs){old.suppressed++;return;}if(old?.suppressed)this.enqueue({type:'ERROR_AGGREGATE',ts:event.ts,payload:{key,count:old.suppressed}});if(this.errors.size>=1000)this.errors.delete(this.errors.keys().next().value!);this.errors.set(key,{at:event.ts,suppressed:0});}
    this.enqueue(event);this.heartbeat();
  }
  private enqueue(event:Event){
    const p=event.payload??{},payload=JSON.parse(redactAudit(p,4096));
    const line=JSON.stringify({timestamp:event.ts,level:/FAILED|ERROR|FATAL/.test(event.type)?'error':'info',event:event.type,eventId:event.id??null,env:this.identity.environment,instanceId:this.identity.instanceId,buildId:this.identity.buildId,traceId:p.requestId??p.runId??p.brainRunId??p.intent?.brainRunId??null,symbol:event.symbol??null,durationMs:p.durationMs??null,errorCode:p.errorCode??null,payload})+'\n';
    const bytes=Buffer.byteLength(line);if(this.queuedBytes+bytes>this.options.maxQueueBytes){this.dropped++;return;}this.rows.push(line);this.queuedBytes+=bytes;
  }
  private heartbeat(force=false){if(!force&&Date.now()-this.lastHeartbeat<this.options.heartbeatMs)return;this.lastHeartbeat=Date.now();if(this.counters.size){this.enqueue({type:'TELEMETRY_HEARTBEAT',ts:Date.now(),payload:{counts:Object.fromEntries(this.counters)}});this.counters.clear();}}
  health(){return{status:this.failures||this.dropped?'DEGRADED':'READY',queuedBytes:this.queuedBytes,droppedOperational:this.dropped,writeFailures:this.failures,lastError:this.lastError,currentFile:this.file};}
  flush():Promise<void>{if(this.draining)return this.draining;this.draining=this.drain().catch(error=>{this.failures++;this.lastError=String(error);}).finally(()=>{this.draining=null;});return this.draining;}
  private async drain(){
    await mkdir(this.dir,{recursive:true});
    while(this.rows.length){
      const day=new Date().toISOString().slice(0,10),line=this.rows[0]!,bytes=Buffer.byteLength(line);
      if(!this.file||this.day!==day||this.fileBytes+bytes>this.options.maxFileBytes){
        const previous=this.file;this.day=day;this.file=path.join(this.dir,`engine-${day}-${this.identity.instanceId}-${this.sequence++}.jsonl`);this.fileBytes=0;
        if(previous){await pipeline(createReadStream(previous),createGzip(),createWriteStream(previous+'.gz'));await unlink(previous);}
        await this.prune();
      }
      // Bounded batch keeps FS calls out of the event handler and memory bounded.
      let count=1,size=bytes;while(count<this.rows.length&&size<64*1024&&this.fileBytes+size+Buffer.byteLength(this.rows[count]!)<=this.options.maxFileBytes){size+=Buffer.byteLength(this.rows[count]!);count++;}
      await appendFile(this.file,this.rows.slice(0,count).join(''),'utf8');this.rows.splice(0,count);this.queuedBytes-=size;this.fileBytes+=size;
    }
  }
  private async prune(){
    const rows=await Promise.all((await readdir(this.dir)).filter(name=>/^engine-\d{4}-\d{2}-\d{2}-[\w-]+-\d+\.jsonl(?:\.gz)?$/.test(name)).map(async name=>({file:path.join(this.dir,name),...(await stat(path.join(this.dir,name)))})));
    let total=rows.reduce((n,r)=>n+r.size,0);for(const row of rows.sort((a,b)=>a.mtimeMs-b.mtimeMs)){if(row.file===this.file)continue;if(Date.now()-row.mtimeMs>this.options.retentionDays*86400_000||total>this.options.maxTotalBytes){await unlink(row.file);total-=row.size;}}
  }
  async close(){clearInterval(this.timer);this.heartbeat(true);for(const [key,value] of this.errors)if(value.suppressed)this.enqueue({type:'ERROR_AGGREGATE',ts:Date.now(),payload:{key,count:value.suppressed}});this.closed=true;await this.flush();}
}
