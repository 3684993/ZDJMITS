/** These clocks bound waiting/preparation, independently of the configured model timeout. */
export const ENTRY_PRIMARY_SLOT_WAIT_MS = 30_000;
export const ENTRY_PACKET_PREPARATION_MS = 45_000;

export class EntryAnalysisCancelled extends Error {
  readonly cancelled = true;
  constructor(readonly code:string) { super(code); this.name='EntryAnalysisCancelled'; }
}

/** One analysis owns one signal. Late I/O may refresh caches but cannot resume this analysis. */
export class EntryAnalysisContext {
  private controller = new AbortController();
  private monitor: ReturnType<typeof setInterval>;
  private reason:string|null=null;
  readonly startedAt=Date.now();
  constructor(private currentKey:()=>string, private expectedKey=currentKey()) {
    this.monitor=setInterval(()=>this.checkContext(),100);
    this.monitor.unref?.();
  }
  get signal(){return this.controller.signal;}
  private checkContext(){if(this.currentKey()!==this.expectedKey)this.cancel('ENTRY_ANALYSIS_CONTEXT_CHANGED');}
  cancel(code:string){if(!this.signal.aborted){this.reason=code;this.controller.abort(new EntryAnalysisCancelled(code));}}
  check(){this.checkContext();if(this.signal.aborted)throw new EntryAnalysisCancelled(this.reason??'ENTRY_ANALYSIS_CANCELLED');}
  async run<T>(stage:string,task:()=>Promise<T>,timeoutMs?:number):Promise<T>{
    this.check();
    const deadlineAt=timeoutMs===undefined?Infinity:Date.now()+timeoutMs;
    const checkStage=()=>{if(Date.now()>=deadlineAt)this.cancel(`ENTRY_${stage}_DEADLINE_EXCEEDED`);this.check();};
    let timer:ReturnType<typeof setTimeout>|undefined;
    let listener:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{
      listener=()=>reject(new EntryAnalysisCancelled(this.reason??'ENTRY_ANALYSIS_CANCELLED'));
      this.signal.addEventListener('abort',listener,{once:true});
      if(timeoutMs!==undefined)timer=setTimeout(()=>this.cancel(`ENTRY_${stage}_DEADLINE_EXCEEDED`),timeoutMs);
    });
    try{const result=await Promise.race([Promise.resolve().then(()=>{checkStage();return task();}),cancelled]);checkStage();return result;}
    finally{if(timer)clearTimeout(timer);this.signal.removeEventListener('abort',listener);}
  }
  dispose(){clearInterval(this.monitor);}
}
