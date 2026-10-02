import { randomUUID } from 'node:crypto';

type PrivateSyncErrorCode='REGION_RESTRICTED'|'RATE_LIMIT'|'TIMEOUT'|'AUTH_OR_PERMISSION'|'TRANSPORT_OR_RESPONSE';
function failureCode(reason:string):PrivateSyncErrorCode{
  if(/\bHTTP\s+451\b/i.test(reason))return 'REGION_RESTRICTED';
  if(/\bHTTP\s+(429|418)\b|BINANCE_RATE_LIMIT|BINANCE_REQUEST_BUDGET_DEFERRED/i.test(reason))return 'RATE_LIMIT';
  if(/timeout|timed out/i.test(reason))return 'TIMEOUT';
  if(/\bHTTP\s+(401|403)\b|-2015\b/.test(reason))return 'AUTH_OR_PERMISSION';
  return 'TRANSPORT_OR_RESPONSE';
}

/** All REST refresh triggers share one flight; only the same settings generation may publish. */
export class PrivateAccountSync {
  private flight:Promise<void>|null=null;
  private lastStartedAt=0;
  private retryGeneration:number|null=null;
  private credentialEpoch=0;
  private stats={requestId:null as string|null,lastSuccessAt:null as number|null,lastFailureAt:null as number|null,consecutiveFailures:0,coalesced:0,lastError:null as string|null,lastErrorCode:null as PrivateSyncErrorCode|null,durationMs:0,nextRetryAt:null as number|null,retryDelayMs:0,deferredRetries:0};
  constructor(private readonly context:{configured:()=>boolean;generation:()=>number;read:()=>Promise<any>;get:()=>any;set:(value:any)=>void;emit:(type:string,payload:unknown)=>void}){}
  health(){return{...this.stats,inFlight:Boolean(this.flight),snapshotAgeMs:this.stats.lastSuccessAt===null?null:Date.now()-this.stats.lastSuccessAt};}
  sync(trigger='POLL'):Promise<void>{
    if(trigger==='CREDENTIALS_CHANGED'){
      // SecretStore credential replacement does not increment Settings version.
      // Invalidate old private responses and retry state, then reuse the same flight boundary.
      this.credentialEpoch++;this.retryGeneration=null;
      this.stats={...this.stats,nextRetryAt:null,retryDelayMs:0,consecutiveFailures:0};
      return this.flight?this.flight.then(()=>this.sync('CREDENTIALS_REFRESH')):this.sync('CREDENTIALS_REFRESH');
    }
    const account=this.context.get();if(account.status==='READY'&&typeof account.asOf==='number'&&Date.now()-account.asOf>60_000)this.context.set({...account,status:'UNAVAILABLE',reason:'PRIVATE_DATA_STALE'});
    if(this.flight){this.stats.coalesced++;return this.flight;}
    // Failed reads cannot refresh account evidence. Suppress repeated refresh triggers,
    // retaining the last exchange facts and the original failure until a real read succeeds.
    if(this.retryGeneration!==null&&this.retryGeneration!==this.context.generation()){
      this.retryGeneration=null;this.stats={...this.stats,nextRetryAt:null,retryDelayMs:0,consecutiveFailures:0};
    }
    if(this.context.configured()&&this.stats.nextRetryAt!==null&&Date.now()<this.stats.nextRetryAt){
      this.stats.deferredRetries++;return Promise.resolve();
    }
    if(trigger==='USER_DATA'&&Date.now()-this.lastStartedAt<2000){this.stats.coalesced++;return Promise.resolve();}
    this.lastStartedAt=Date.now();
    this.flight=this.run(trigger).finally(()=>{this.flight=null;});return this.flight;
  }
  private async run(trigger:string){
    const c=this.context;if(!c.configured()){c.set({...c.get(),status:'NOT_CONFIGURED',reason:'Credentials unavailable',asOf:null});return;}
    const generation=c.generation(),credentialEpoch=this.credentialEpoch,requestId=randomUUID(),startedAt=Date.now();this.stats.requestId=requestId;
    c.emit('PRIVATE_SYNC_STARTED',{requestId,trigger,generation,startedAt});
    try{
      const account=await c.read();if(generation!==c.generation()||credentialEpoch!==this.credentialEpoch){c.emit('PRIVATE_SYNC_DISCARDED',{requestId,reason:credentialEpoch!==this.credentialEpoch?'CREDENTIALS_CHANGED':'SETTINGS_GENERATION_CHANGED'});return;}
      const recovered=this.stats.consecutiveFailures>0;
      this.retryGeneration=null;
      this.stats={...this.stats,lastSuccessAt:account.asOf??Date.now(),consecutiveFailures:0,lastError:null,lastErrorCode:null,durationMs:Date.now()-startedAt,nextRetryAt:null,retryDelayMs:0};
      c.set({...account,status:'READY',source:'BINANCE_TESTNET_ACCOUNT',reason:null,riskBaseline:c.get().riskBaseline??null});
      c.emit(recovered?'PRIVATE_SYNC_RECOVERED':'PRIVATE_SYNC_COMPLETED',{requestId,trigger,generation,durationMs:this.stats.durationMs,lastSuccessAt:this.stats.lastSuccessAt,enrichment:account.enrichment??null});
    }catch(error){
      if(generation!==c.generation()||credentialEpoch!==this.credentialEpoch)return;
      const reason=String(error instanceof Error?error.message:error).replace(/(signature|apiKey|apiSecret)=[^&\s]+/gi,'$1=[REDACTED]');
      const errorCode=failureCode(reason),retryDelayMs=errorCode==='REGION_RESTRICTED'?60_000:Math.min(60_000,Math.max(5_000,this.stats.retryDelayMs*2));
      this.retryGeneration=generation;
      this.stats={...this.stats,lastFailureAt:Date.now(),consecutiveFailures:this.stats.consecutiveFailures+1,lastError:reason,lastErrorCode:errorCode,durationMs:Date.now()-startedAt,retryDelayMs,nextRetryAt:Date.now()+retryDelayMs};
      c.set({...c.get(),status:'UNAVAILABLE',reason});
      c.emit('PRIVATE_SYNC_FAILED',{requestId,trigger,generation,...this.stats,errorCode});
    }
  }
}
