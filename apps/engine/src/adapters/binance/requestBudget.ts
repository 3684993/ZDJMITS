import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

type Priority=0|1|2;
export type RequestBudgetMeta={requestId?:string;source?:string;purpose?:string;endpoint?:string;method?:string};
type QueueItem={priority:Priority;weight:number;run:()=>void;reject:(error:Error)=>void;expiresAt:number;meta:RequestBudgetMeta;queuedAt:number};
type Attribution={source:string;endpoint:string;requests:number;estimatedWeight:number;admitted:number;queued:number;blocked:number;lastStatus:number|null;lastObservedWeight:number|null;lastAt:number};
type BudgetOptions={scope?:string;persistKey?:string;softPublicWeight?:number;softBackgroundWeight?:number;hardWeight?:number};

/** Process-local REQUEST_WEIGHT governor. All Binance HTTP dispatches must pass here. */
export class RequestBudget {
  private activeWeight=0;private persistenceError:string|null=null;private anomalyUntil=0;private active=0;private publicActive=0;private starts:Array<{at:number;weight:number}>=[];private blockedUntil=0;
  private queue:QueueItem[]=[];private timer:ReturnType<typeof setTimeout>|null=null;
  private weightObservedAt=0;private usedWeight:number|null=null;
  private http418=0;private http429=0;private lastLimitedAt:number|null=null;private lastObservedBanIp:string|null=null;
  private recovering=false;private recoverySuccesses=0;private nextRecoveryProbeAt=0;
  private attribution=new Map<string,Attribution>();private decisions={admitted:0,queued:0,blocked:0,queueTimeout:0};
  private readonly scope:string;private readonly persistFile:string|null;private readonly softPublicWeight:number;private readonly softBackgroundWeight:number;private readonly hardWeight:number;
  constructor(private readonly total=6,private readonly publicLimit=4,private readonly startsPerSecond=8,options:BudgetOptions={}){
    this.scope=options.scope??'TEST';this.softPublicWeight=options.softPublicWeight??1000;this.softBackgroundWeight=options.softBackgroundWeight??1800;this.hardWeight=options.hardWeight??2200;
    this.persistFile=options.persistKey?path.join(process.env.ZDJ_DATA_DIR??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../../data'),'rate-limit',`${options.persistKey.replace(/[^a-z0-9_.-]/gi,'_')}.json`):null;this.restore();
  }
  async run<T>(priority:Priority,weightOrFn:number|(()=>Promise<T>),maybeFn?:()=>Promise<T>,meta:RequestBudgetMeta={}):Promise<T>{
    const weight=typeof weightOrFn==='number'?Math.max(0,Math.ceil(weightOrFn)):1,fn=(typeof weightOrFn==='function'?weightOrFn:maybeFn)!;
    if(!fn)throw new Error('BINANCE_REQUEST_FUNCTION_REQUIRED');
    const now=Date.now(),normalized=this.normalizeMeta(meta),row=this.attr(normalized);
    row.requests++;row.estimatedWeight+=weight;row.lastAt=now;
    if(now<this.blockedUntil){this.decisions.blocked++;row.blocked++;throw new Error(`BINANCE_RATE_LIMIT_UNTIL:${this.blockedUntil}`);}
    if(this.queue.length>=512){this.decisions.blocked++;row.blocked++;throw new Error('BINANCE_REQUEST_QUEUE_FULL');}
    this.decisions.queued++;row.queued++;
    await new Promise<void>((resolve,reject)=>{this.queue.push({priority,weight,run:resolve,reject,expiresAt:Date.now()+5000,meta:normalized,queuedAt:now});this.queue.sort((a,b)=>a.priority-b.priority||a.weight-b.weight);this.pump();});
    try{return await fn();}finally{this.activeWeight=Math.max(0,this.activeWeight-weight);this.active=Math.max(0,this.active-1);if(priority===2)this.publicActive=Math.max(0,this.publicActive-1);this.pump();}
  }
  observe(status:number,weight:string|undefined,retryAfter:string|undefined,meta:RequestBudgetMeta={},observedIp:string|null=null,bodyBlockedUntil=0){
    const now=Date.now(),row=this.attr(this.normalizeMeta(meta));row.lastStatus=status;row.lastAt=now;
    if(weight!==undefined&&Number.isFinite(Number(weight))){const n=Number(weight);if(n>this.estimatedWeight(now))this.anomalyUntil=(Math.floor(now/60000)+1)*60000;this.usedWeight=Math.floor(now/60000)===Math.floor(this.weightObservedAt/60000)?Math.max(this.usedWeight??0,n):n;this.weightObservedAt=now;row.lastObservedWeight=n;}
    if(observedIp)this.lastObservedBanIp=observedIp;
    if(status===418||status===429){this.lastLimitedAt=now;if(status===418)this.http418++;else this.http429++;const raw=Number(retryAfter),date=Date.parse(retryAfter??''),delay=retryAfter!=null&&Number.isFinite(raw)?Math.max(1000,raw*1000):Number.isFinite(date)?Math.max(1000,date-now):bodyBlockedUntil>now?bodyBlockedUntil-now:status===418?24*60*60_000:60_000,safety=status===418?5_000:1_000;this.blockedUntil=Math.max(this.blockedUntil,Math.max(now+delay,bodyBlockedUntil)+safety);this.recovering=true;this.recoverySuccesses=0;this.nextRecoveryProbeAt=this.blockedUntil;this.persist();this.pump();return;}
    if(this.recovering&&status>=200&&status<400){this.recoverySuccesses++;if(this.recoverySuccesses>=3){this.recovering=false;this.nextRecoveryProbeAt=0;this.blockedUntil=0;this.persist();}else this.nextRecoveryProbeAt=now+1500;this.pump();}
  }
  health(){const now=Date.now(),estimated=this.estimatedWeight(now),observedFresh=this.usedWeight!==null&&Math.floor(this.weightObservedAt/60000)===Math.floor(now/60000),pressure=Math.max(estimated,observedFresh?this.usedWeight??0:0);return{scope:this.scope,active:this.active,publicActive:this.publicActive,queued:this.queue.length,queuedWeight:this.queue.reduce((sum,row)=>sum+row.weight,0),activeWeight:this.activeWeight,observedWeightAnomaly:now<this.anomalyUntil,persistenceError:this.persistenceError,usedWeight1m:this.usedWeight,estimatedWeight1m:estimated,softPublicWeight:this.softPublicWeight,softBackgroundWeight:this.softBackgroundWeight,hardWeight:this.hardWeight,blockedUntil:this.blockedUntil,status:this.persistenceError?'PERSISTENCE_FAILED':now<this.blockedUntil?'RATE_LIMITED':this.recovering?'RECOVERING':pressure>=this.hardWeight?'SATURATED':pressure>=this.softBackgroundWeight||now<this.anomalyUntil?'PRESSURED':'AVAILABLE',recoverySuccesses:this.recoverySuccesses,retryInMs:Math.max(0,(now<this.blockedUntil?this.blockedUntil:this.nextRecoveryProbeAt)-now),http418:this.http418,http429:this.http429,lastLimitedAt:this.lastLimitedAt,lastObservedBanIp:this.lastObservedBanIp,decisions:{...this.decisions},attribution:[...this.attribution.values()].sort((a,b)=>b.estimatedWeight-a.estimatedWeight).slice(0,40)};}
  private normalizeMeta(meta:RequestBudgetMeta):RequestBudgetMeta{return{requestId:meta.requestId??null as any,source:String(meta.source??'UNKNOWN'),purpose:String(meta.purpose??'UNSPECIFIED'),endpoint:String(meta.endpoint??'UNKNOWN'),method:String(meta.method??'GET').toUpperCase()};}
  private attr(meta:RequestBudgetMeta){const source=String(meta.source??'UNKNOWN'),endpoint=String(meta.endpoint??'UNKNOWN'),key=`${source}|${endpoint}`;let row=this.attribution.get(key);if(!row){row={source,endpoint,requests:0,estimatedWeight:0,admitted:0,queued:0,blocked:0,lastStatus:null,lastObservedWeight:null,lastAt:0};this.attribution.set(key,row);}return row;}
  private estimatedWeight(now=Date.now()){this.starts=this.starts.filter(row=>now-row.at<60_000);return this.starts.reduce((sum,row)=>sum+row.weight,0);}
  private allowed(q:QueueItem,now:number){if(this.persistenceError)return false;if(this.recovering){if(q.priority!==0&&q.meta.source!=='HEALTH_PROBE'&&q.meta.source!=='CLOCK')return false;if(this.active>0||now<this.nextRecoveryProbeAt)return false;}if(q.priority===2&&this.publicActive>=this.publicLimit)return false;const observedFresh=this.usedWeight!==null&&Math.floor(this.weightObservedAt/60000)===Math.floor(now/60000),observed=observedFresh?this.usedWeight!:0,estimated=this.estimatedWeight(now),projected=Math.max(observed+this.activeWeight,estimated)+q.weight;if(q.priority>0&&now<this.anomalyUntil&&q.meta.source!=='CLOCK')return false;if(q.priority===2&&projected>this.softPublicWeight)return false;if(q.priority===1&&projected>this.softBackgroundWeight)return false;return projected<=this.hardWeight;}
  private pump(){const now=Date.now();this.starts=this.starts.filter(row=>now-row.at<60_000);this.queue=this.queue.filter(q=>{if(now<this.blockedUntil||now>=q.expiresAt){const row=this.attr(q.meta);row.blocked++;this.decisions.blocked++;if(now>=q.expiresAt)this.decisions.queueTimeout++;q.reject(new Error(now<this.blockedUntil?`BINANCE_RATE_LIMIT_UNTIL:${this.blockedUntil}`:'BINANCE_REQUEST_QUEUE_TIMEOUT'));return false;}return true;});const starts1s=this.starts.filter(row=>now-row.at<1000).length;let started=starts1s;while(this.active<this.total&&started<this.startsPerSecond&&now>=this.blockedUntil){const index=this.queue.findIndex(q=>this.allowed(q,now));if(index<0)break;const [q]=this.queue.splice(index,1);this.active++;this.activeWeight+=q!.weight;if(q!.priority===2)this.publicActive++;this.starts.push({at:now,weight:q!.weight});started++;this.decisions.admitted++;this.attr(q!.meta).admitted++;if(this.recovering)this.nextRecoveryProbeAt=now+3000;q!.run();if(this.recovering)break;}if(this.queue.length&&!this.timer){const target=now<this.blockedUntil?this.blockedUntil:this.recovering?Math.max(now+20,this.nextRecoveryProbeAt):now+100;this.timer=setTimeout(()=>{this.timer=null;this.pump();},Math.max(20,Math.min(1000,target-now)));}}
  private restore(){if(!this.persistFile)return;try{const value=JSON.parse(readFileSync(this.persistFile,'utf8'));if(Number(value.blockedUntil)>0){this.blockedUntil=Number(value.blockedUntil);this.lastLimitedAt=Number(value.lastLimitedAt)||null;this.http418=Number(value.http418)||0;this.http429=Number(value.http429)||0;this.lastObservedBanIp=typeof value.lastObservedBanIp==='string'?value.lastObservedBanIp:null;this.recovering=true;this.nextRecoveryProbeAt=Math.max(Date.now()+1000,this.blockedUntil);}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.persistenceError=String(error);}}
  private persist(){if(!this.persistFile)return;try{mkdirSync(path.dirname(this.persistFile),{recursive:true});writeFileSync(this.persistFile+'.tmp',JSON.stringify({scope:this.scope,blockedUntil:this.blockedUntil,lastLimitedAt:this.lastLimitedAt,http418:this.http418,http429:this.http429,lastObservedBanIp:this.lastObservedBanIp,updatedAt:Date.now()}),{flush:true});renameSync(this.persistFile+'.tmp',this.persistFile);this.persistenceError=null;}catch(error){this.persistenceError=String(error);}}
}

const budgets=new Map<string,RequestBudget>();
export function getBinanceRequestBudget(environment:string,routeIdentity='default'){const env=environment.toUpperCase()==='PRODUCTION'?'PRODUCTION':'TESTNET',scope=`${env}:${routeIdentity}`;let budget=budgets.get(scope);if(!budget){budget=new RequestBudget(6,4,8,{scope,persistKey:process.env.VITEST?undefined:`binance-${scope.toLowerCase()}`});budgets.set(scope,budget);}return budget;}
export function binanceRequestBudgetsHealth(){return Object.fromEntries([...budgets.entries()].map(([scope,budget])=>[scope,budget.health()]));}
/** Backward-compatible TESTNET projection for existing diagnostics/tests. */
export const binanceRequestBudget=getBinanceRequestBudget('TESTNET');

export function binanceEntryBlockReason(environment:string){const env=String(environment??'TESTNET').toUpperCase();const blocked=[...budgets.entries()].filter(([scope])=>scope.startsWith(env+':')&&!scope.endsWith(':default')).map(([,budget])=>budget.health()).find(h=>h.status!=='AVAILABLE');return blocked?`BINANCE_BUDGET_${blocked.status}`:null;}
