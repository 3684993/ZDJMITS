import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { EventBus } from '../events/eventBus.js';

export class TemporalIntelligenceService {
  private worker:Worker|null=null;
  private timer:NodeJS.Timeout|null=null;
  private summaryValue:any={generatedAt:null,mode:'READ_ONLY_SHADOW_RESEARCH',status:'STARTING',runtime:{activeResearchJobs:0,backgroundQueue:0,workerCount:0,httpHotPath:false}};
  private active=0;private queued=0;private errors=0;private longestJobMs=0;private readonly lag=monitorEventLoopDelay({resolution:20});
  constructor(private readonly dataDir:string,private readonly events:EventBus){}
  start(){
    if(this.worker)return;this.lag.enable();
    // Research jobs must never open the live trading database for writes.
    if(process.env.ZDJ_OFFLINE_RESEARCH!=='1'){this.summaryValue={...this.summaryValue,status:'OFFLINE_ONLY',mode:'ISOLATED_RESEARCH',reason:'Use an isolated database copy for Temporal/Regime/Analog jobs'};return;}
    if(!process.env.ZDJ_RESEARCH_DB||path.resolve(process.env.ZDJ_RESEARCH_DB).toLowerCase()===path.resolve(this.dataDir,'zdj-settings.sqlite').toLowerCase())throw new Error('RESEARCH_LIVE_DATABASE_FORBIDDEN');
    const workerUrl=new URL('../workers/temporalResearchWorker.js',import.meta.url);
    this.worker=new Worker(workerUrl,{workerData:{dbPath:path.resolve(process.env.ZDJ_RESEARCH_DB)}});
    this.worker.on('message',(message:any)=>{if(message?.type==='ready'){this.request('STARTUP_BACKFILL');return;}if(message?.type==='summary'){this.active=0;this.longestJobMs=Math.max(this.longestJobMs,Number(message.value?.workerDurationMs??0));this.summaryValue={...message.value,status:'READY'};this.events.publish('TEMPORAL_RESEARCH_REFRESHED',{durationMs:message.value?.workerDurationMs,coverage:message.value?.coverage,mode:'READ_ONLY_SHADOW_RESEARCH'});if(this.queued){this.queued=0;this.request('COALESCED');}return;}if(message?.type==='error'){this.active=0;this.errors++;this.summaryValue={...this.summaryValue,status:'DEGRADED',lastError:message.message};this.events.publish('TEMPORAL_RESEARCH_FAILED',{message:message.message});}});
    this.worker.on('error',error=>{this.active=0;this.errors++;this.summaryValue={...this.summaryValue,status:'DEGRADED',lastError:error.message};});
    this.worker.on('exit',code=>{this.active=0;this.worker=null;if(code!==0&&!this.summaryValue.stopped)this.errors++;});
    this.timer=setInterval(()=>this.request('INCREMENTAL'),5*60_000);this.timer.unref();
  }
  request(reason='MANUAL'){if(!this.worker)return false;if(this.active){this.queued=1;return false;}this.active=1;this.worker.postMessage({type:'run',reason});return true;}
  snapshot(){const percentile=(n:number)=>Number((this.lag.percentile(n)/1e6).toFixed(3)),max=Number((this.lag.max/1e6).toFixed(3));return{...this.summaryValue,runtime:{...(this.summaryValue.runtime??{}),eventLoopLagMs:{p50:percentile(50),p95:percentile(95),max},activeResearchJobs:this.active,backgroundQueue:this.queued,workerCount:this.worker?1:0,workerKind:'worker_threads',workerErrors:this.errors,longestResearchJobMs:this.longestJobMs,httpHotPath:false}};}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;this.lag.disable();if(this.worker){this.summaryValue={...this.summaryValue,stopped:true};this.worker.postMessage({type:'stop'});void this.worker.terminate();this.worker=null;}this.active=0;this.queued=0;}
}
