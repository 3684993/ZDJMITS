import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

type Priority=0|1|2;
type QueueItem={priority:Priority;weight:number;run:()=>void;reject:(error:Error)=>void;expiresAt:number};

type BudgetOptions={scope?:string;persistKey?:string;softPublicWeight?:number;softBackgroundWeight?:number;hardWeight?:number};

/**
 * Process-local REQUEST_WEIGHT governor.
 *
 * Important invariants:
 * - request count is not treated as request weight;
 * - TESTNET and PRODUCTION use independent governors;
 * - 418/429 creates a durable ban window;
 * - after a ban expires only one request may probe at a time, with three
 *   successful responses required before normal concurrency is restored;
 * - public hydration yields well before private/order maintenance.
 */
export class RequestBudget {
  private active=0;private publicActive=0;private starts:Array<{at:number;weight:number}>=[];private blockedUntil=0;
  private queue:QueueItem[]=[];private timer:ReturnType<typeof setTimeout>|null=null;
  private weightObservedAt=0;private usedWeight:number|null=null;
  private http418=0;private http429=0;private lastLimitedAt:number|null=null;
  private recovering=false;private recoverySuccesses=0;private nextRecoveryProbeAt=0;
  private readonly scope:string;private readonly persistFile:string|null;private readonly softPublicWeight:number;private readonly softBackgroundWeight:number;private readonly hardWeight:number;
  constructor(private readonly total=6,private readonly publicLimit=4,private readonly startsPerSecond=8,options:BudgetOptions={}){
    this.scope=options.scope??'TEST';this.softPublicWeight=options.softPublicWeight??1000;this.softBackgroundWeight=options.softBackgroundWeight??1800;this.hardWeight=options.hardWeight??2200;
    this.persistFile=options.persistKey?path.join(process.cwd(),'data','rate-limit',`${options.persistKey.replace(/[^a-z0-9_.-]/gi,'_')}.json`):null;
    this.restore();
  }
  async run<T>(priority:Priority,weightOrFn:number|(()=>Promise<T>),maybeFn?:()=>Promise<T>):Promise<T>{
    const weight=typeof weightOrFn==='number'?Math.max(0,Math.ceil(weightOrFn)):1,fn=(typeof weightOrFn==='function'?weightOrFn:maybeFn)!;
    if(!fn)throw new Error('BINANCE_REQUEST_FUNCTION_REQUIRED');
    if(Date.now()<this.blockedUntil)throw new Error(`BINANCE_RATE_LIMIT_UNTIL:${this.blockedUntil}`);
    if(this.queue.length>=512)throw new Error('BINANCE_REQUEST_QUEUE_FULL');
    await new Promise<void>((resolve,reject)=>{this.queue.push({priority,weight,run:resolve,reject,expiresAt:Date.now()+5000});this.queue.sort((a,b)=>a.priority-b.priority||a.weight-b.weight);this.pump();});
    try{return await fn();}finally{this.active=Math.max(0,this.active-1);if(priority===2)this.publicActive=Math.max(0,this.publicActive-1);this.pump();}
  }
  observe(status:number,weight:string|undefined,retryAfter:string|undefined){
    const now=Date.now();
    if(weight!==undefined&&Number.isFinite(Number(weight))){this.usedWeight=Math.floor(now/60000)===Math.floor(this.weightObservedAt/60000)?Math.max(this.usedWeight??0,Number(weight)):Number(weight);this.weightObservedAt=now;}
    if(status===418||status===429){this.lastLimitedAt=now;if(status===418)this.http418++;else this.http429++;const raw=Number(retryAfter??60),delay=Number.isFinite(raw)?Math.max(1000,raw*1000):60_000,safety=status===418?5_000:1_000;this.blockedUntil=Math.max(this.blockedUntil,now+delay+safety);this.recovering=true;this.recoverySuccesses=0;this.nextRecoveryProbeAt=this.blockedUntil;this.persist();this.pump();return;}
    if(this.recovering&&status>=200&&status<400){this.recoverySuccesses++;if(this.recoverySuccesses>=3){this.recovering=false;this.nextRecoveryProbeAt=0;this.blockedUntil=0;this.persist();}else this.nextRecoveryProbeAt=now+1500;this.pump();}
  }
  health(){const now=Date.now();return{scope:this.scope,active:this.active,publicActive:this.publicActive,queued:this.queue.length,usedWeight1m:this.usedWeight,estimatedWeight1m:this.estimatedWeight(now),softPublicWeight:this.softPublicWeight,softBackgroundWeight:this.softBackgroundWeight,hardWeight:this.hardWeight,blockedUntil:this.blockedUntil,status:now<this.blockedUntil?'RATE_LIMITED':this.recovering?'RECOVERING':'AVAILABLE',recoverySuccesses:this.recoverySuccesses,retryInMs:Math.max(0,(now<this.blockedUntil?this.blockedUntil:this.nextRecoveryProbeAt)-now),http418:this.http418,http429:this.http429,lastLimitedAt:this.lastLimitedAt};}
  private estimatedWeight(now=Date.now()){this.starts=this.starts.filter(row=>now-row.at<60_000);return this.starts.reduce((sum,row)=>sum+row.weight,0);}
  private allowed(q:QueueItem,now:number){
    if(this.recovering){if(this.active>0||now<this.nextRecoveryProbeAt)return false;return true;}
    if(q.priority===2&&this.publicActive>=this.publicLimit)return false;
    const observedFresh=this.usedWeight!==null&&Math.floor(this.weightObservedAt/60000)===Math.floor(now/60000),observed=observedFresh?this.usedWeight!:0,estimated=this.estimatedWeight(now),projected=Math.max(observed,estimated)+q.weight;
    if(q.priority===2&&projected>this.softPublicWeight)return false;
    if(q.priority===1&&projected>this.softBackgroundWeight)return false;
    return projected<=this.hardWeight;
  }
  private pump(){
    const now=Date.now();this.starts=this.starts.filter(row=>now-row.at<60_000);
    this.queue=this.queue.filter(q=>{if(now<this.blockedUntil||now>=q.expiresAt){q.reject(new Error(now<this.blockedUntil?`BINANCE_RATE_LIMIT_UNTIL:${this.blockedUntil}`:'BINANCE_REQUEST_QUEUE_TIMEOUT'));return false;}return true;});
    const starts1s=this.starts.filter(row=>now-row.at<1000).length;
    let started=starts1s;
    while(this.active<this.total&&started<this.startsPerSecond&&now>=this.blockedUntil){const index=this.queue.findIndex(q=>this.allowed(q,now));if(index<0)break;const [q]=this.queue.splice(index,1);this.active++;if(q!.priority===2)this.publicActive++;this.starts.push({at:now,weight:q!.weight});started++;if(this.recovering)this.nextRecoveryProbeAt=now+3000;q!.run();if(this.recovering)break;}
    if(this.queue.length&&!this.timer){const target=now<this.blockedUntil?this.blockedUntil:this.recovering?Math.max(now+20,this.nextRecoveryProbeAt):now+100;this.timer=setTimeout(()=>{this.timer=null;this.pump();},Math.max(20,Math.min(1000,target-now)));}
  }
  private restore(){if(!this.persistFile)return;try{const value=JSON.parse(readFileSync(this.persistFile,'utf8'));if(Number(value.blockedUntil)>0){this.blockedUntil=Number(value.blockedUntil);this.lastLimitedAt=Number(value.lastLimitedAt)||null;this.http418=Number(value.http418)||0;this.http429=Number(value.http429)||0;this.recovering=true;this.nextRecoveryProbeAt=Math.max(Date.now()+1000,this.blockedUntil);}}catch{}}
  private persist(){if(!this.persistFile)return;try{mkdirSync(path.dirname(this.persistFile),{recursive:true});writeFileSync(this.persistFile,JSON.stringify({scope:this.scope,blockedUntil:this.blockedUntil,lastLimitedAt:this.lastLimitedAt,http418:this.http418,http429:this.http429,updatedAt:Date.now()}));}catch{}}
}

const budgets=new Map<string,RequestBudget>();
export function getBinanceRequestBudget(environment:string){const scope=environment.toUpperCase()==='PRODUCTION'?'PRODUCTION':'TESTNET';let budget=budgets.get(scope);if(!budget){budget=new RequestBudget(6,4,8,{scope,persistKey:`binance-${scope.toLowerCase()}`});budgets.set(scope,budget);}return budget;}
export function binanceRequestBudgetsHealth(){return Object.fromEntries(['TESTNET','PRODUCTION'].map(scope=>[scope,getBinanceRequestBudget(scope).health()]));}
/** Backward-compatible TESTNET projection for existing diagnostics/tests. */
export const binanceRequestBudget=getBinanceRequestBudget('TESTNET');
