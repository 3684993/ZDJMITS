/** Success executes synchronously inline; only failed non-critical writes enter a coalesced retry queue. Authority-critical submission journals must call the store directly and propagate failure. */
export class RuntimeWriteBuffer {
  private pending=new Map<string,()=>void>();private failures=0;private overflow=0;private lastError:string|null=null;
  apply(key:string,write:()=>void){try{write();this.pending.delete(key);}catch(error){this.failures++;this.lastError=String(error);if(this.pending.has(key)||this.pending.size<5000)this.pending.set(key,write);else this.overflow++;}}
  flush(limit=25){let count=0;for(const [key,write] of this.pending){if(count++>=limit)break;try{write();this.pending.delete(key);}catch(error){this.lastError=String(error);break;}}if(!this.pending.size)this.lastError=null;}
  health(){return{status:this.pending.size||this.overflow?'DEGRADED':'READY',pendingWrites:this.pending.size,failures:this.failures,overflow:this.overflow,lastError:this.lastError};}
}
