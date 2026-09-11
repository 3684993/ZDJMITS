/** Shared process budget: reserve two slots for private/account/order work. No write retries. */
export class RequestBudget {
  private active=0;private publicActive=0;private starts:number[]=[];private blockedUntil=0;
  private queue:Array<{priority:number;run:()=>void;reject:(error:Error)=>void;expiresAt:number}>=[];private timer:ReturnType<typeof setTimeout>|null=null;
  private weightObservedAt=0;
  private http418=0;private http429=0;private lastLimitedAt:number|null=null;
  private usedWeight:number|null=null;
  constructor(private readonly total=6,private readonly publicLimit=4,private readonly startsPerSecond=8){}
  async run<T>(priority:number,fn:()=>Promise<T>):Promise<T>{
    if(Date.now()<this.blockedUntil)throw new Error(`BINANCE_RATE_LIMIT_UNTIL:${this.blockedUntil}`);
    if(this.queue.length>=512)throw new Error('BINANCE_REQUEST_QUEUE_FULL');
    await new Promise<void>((resolve,reject)=>{this.queue.push({priority,run:resolve,reject,expiresAt:Date.now()+5000});this.queue.sort((a,b)=>a.priority-b.priority);this.pump();});
    try{return await fn();}finally{this.active--;if(priority===2)this.publicActive--;this.pump();}
  }
  observe(status:number,weight:string|undefined,retryAfter:string|undefined){
    if(weight!==undefined&&Number.isFinite(Number(weight))){const now=Date.now();this.usedWeight=Math.floor(now/60000)===Math.floor(this.weightObservedAt/60000)?Math.max(this.usedWeight??0,Number(weight)):Number(weight);this.weightObservedAt=now;}
    if(status===418||status===429){this.lastLimitedAt=Date.now();if(status===418)this.http418++;else this.http429++;}
    if(status===429||status===418){const seconds=Number(retryAfter??60),delay=Number.isFinite(seconds)?Math.max(1000,seconds*1000):60_000;this.blockedUntil=Math.max(this.blockedUntil,Date.now()+delay);this.pump();}
  }
  health(){return{active:this.active,publicActive:this.publicActive,queued:this.queue.length,usedWeight1m:this.usedWeight,blockedUntil:this.blockedUntil,status:Date.now()<this.blockedUntil?'RATE_LIMITED':'AVAILABLE',retryInMs:Math.max(0,this.blockedUntil-Date.now()),http418:this.http418,http429:this.http429,lastLimitedAt:this.lastLimitedAt};}
  private pump(){
    const now=Date.now();this.starts=this.starts.filter(t=>now-t<1000);
    this.queue=this.queue.filter(q=>{if(now<this.blockedUntil||now>=q.expiresAt){q.reject(new Error(now<this.blockedUntil?`BINANCE_RATE_LIMIT_UNTIL:${this.blockedUntil}`:'BINANCE_REQUEST_QUEUE_TIMEOUT'));return false;}return true;});
    // Public backfills yield before consuming the private/management reserve.
    const publicThrottled=this.usedWeight!==null&&this.usedWeight>=1000&&Math.floor(this.weightObservedAt/60000)===Math.floor(now/60000);
    while(this.active<this.total&&this.starts.length<this.startsPerSecond&&now>=this.blockedUntil){
      const index=this.queue.findIndex(q=>q.priority!==2||!publicThrottled&&this.publicActive<this.publicLimit);if(index<0)break;
      const [q]=this.queue.splice(index,1);this.active++;if(q!.priority===2)this.publicActive++;this.starts.push(now);q!.run();
    }
    if(this.queue.length&&!this.timer){this.timer=setTimeout(()=>{this.timer=null;this.pump();},Math.max(20,Math.min(1000,this.blockedUntil-now)));}
  }
}
export const binanceRequestBudget=new RequestBudget();
