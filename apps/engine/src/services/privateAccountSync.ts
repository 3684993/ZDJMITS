import { randomUUID } from 'node:crypto';

/** All REST refresh triggers share one flight; only the same settings generation may publish. */
export class PrivateAccountSync {
  private flight:Promise<void>|null=null;
  private lastStartedAt=0;
  private stats={requestId:null as string|null,lastSuccessAt:null as number|null,lastFailureAt:null as number|null,consecutiveFailures:0,coalesced:0,lastError:null as string|null,durationMs:0};
  constructor(private readonly context:{configured:()=>boolean;generation:()=>number;read:()=>Promise<any>;get:()=>any;set:(value:any)=>void;emit:(type:string,payload:unknown)=>void}){}
  health(){return{...this.stats,inFlight:Boolean(this.flight),snapshotAgeMs:this.stats.lastSuccessAt===null?null:Date.now()-this.stats.lastSuccessAt};}
  sync(trigger='POLL'):Promise<void>{
    const account=this.context.get();if(account.status==='READY'&&typeof account.asOf==='number'&&Date.now()-account.asOf>60_000)this.context.set({...account,status:'UNAVAILABLE',reason:'PRIVATE_DATA_STALE'});
    if(this.flight){this.stats.coalesced++;return this.flight;}
    if(trigger==='USER_DATA'&&Date.now()-this.lastStartedAt<2000){this.stats.coalesced++;return Promise.resolve();}
    this.lastStartedAt=Date.now();
    this.flight=this.run(trigger).finally(()=>{this.flight=null;});return this.flight;
  }
  private async run(trigger:string){
    const c=this.context;if(!c.configured()){c.set({...c.get(),status:'NOT_CONFIGURED',reason:'Credentials unavailable',asOf:null});return;}
    const generation=c.generation(),requestId=randomUUID(),startedAt=Date.now();this.stats.requestId=requestId;
    c.emit('PRIVATE_SYNC_STARTED',{requestId,trigger,generation,startedAt});
    try{
      const account=await c.read();if(generation!==c.generation()){c.emit('PRIVATE_SYNC_DISCARDED',{requestId,reason:'SETTINGS_GENERATION_CHANGED'});return;}
      const recovered=this.stats.consecutiveFailures>0;
      this.stats={...this.stats,lastSuccessAt:account.asOf??Date.now(),consecutiveFailures:0,lastError:null,durationMs:Date.now()-startedAt};
      c.set({...account,status:'READY',source:'BINANCE_TESTNET_ACCOUNT',reason:null,riskBaseline:c.get().riskBaseline??null});
      c.emit(recovered?'PRIVATE_SYNC_RECOVERED':'PRIVATE_SYNC_COMPLETED',{requestId,trigger,generation,durationMs:this.stats.durationMs,lastSuccessAt:this.stats.lastSuccessAt,enrichment:account.enrichment??null});
    }catch(error){
      if(generation!==c.generation())return;
      const reason=String(error instanceof Error?error.message:error).replace(/(signature|apiKey|apiSecret)=[^&\s]+/gi,'$1=[REDACTED]');
      this.stats={...this.stats,lastFailureAt:Date.now(),consecutiveFailures:this.stats.consecutiveFailures+1,lastError:reason,durationMs:Date.now()-startedAt};
      c.set({...c.get(),status:'UNAVAILABLE',reason});
      c.emit('PRIVATE_SYNC_FAILED',{requestId,trigger,generation,...this.stats,errorCode:/429|418/.test(reason)?'RATE_LIMIT':/timeout|timed out/i.test(reason)?'TIMEOUT':/401|403|-2015/.test(reason)?'AUTH_OR_PERMISSION':'TRANSPORT_OR_RESPONSE'});
    }
  }
}
