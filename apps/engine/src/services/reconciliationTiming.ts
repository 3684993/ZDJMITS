import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
type Phase={count:number;totalMs:number;maxMs:number;values:number[]};
type Cycle={id:string;startedAt:number;endedAt?:number;totalMs?:number;phases:Record<string,Phase>;counts:Record<string,number>;marks:Record<string,number>};
/** Bounded observation only. Authority-critical writes execute inline with original exceptions. */
class ReconciliationTiming {
  private context=new AsyncLocalStorage<Cycle>();private cycles:Cycle[]=[];private sequence=0;
  currentId(){return this.context.getStore()?.id??null;}
  active(){return Boolean(this.context.getStore());}
  async run<T>(work:()=>Promise<T>){const c:Cycle={id:`reconcile-${++this.sequence}`,startedAt:Date.now(),phases:{},counts:{},marks:{}};const start=performance.now();return this.context.run(c,async()=>{try{return await work();}finally{c.endedAt=Date.now();c.totalMs=performance.now()-start;this.cycles.push(c);if(this.cycles.length>64)this.cycles.shift();}});}
  measure<T>(name:string,work:()=>T):T{const c=this.context.getStore();if(!c)return work();const start=performance.now();try{return work();}finally{this.record(c,name,performance.now()-start);}}
  async remote<T>(name:string,work:()=>Promise<T>):Promise<T>{const c=this.context.getStore();if(!c)return work();const start=performance.now();try{return await work();}finally{this.record(c,name,performance.now()-start);}}
  private record(c:Cycle,name:string,ms:number){if(!c.phases[name]&&Object.keys(c.phases).length>=64)return;const p=c.phases[name]??(c.phases[name]={count:0,totalMs:0,maxMs:0,values:[]});p.count++;p.totalMs+=ms;p.maxMs=Math.max(p.maxMs,ms);if(p.values.length<64)p.values.push(ms);}
  count(name:string,n=1){const c=this.context.getStore();if(c)c.counts[name]=(c.counts[name]??0)+n;}
  mark(name:string){const c=this.context.getStore();if(c)c.marks[name]=performance.now();}
  elapsed(name:string,from:string){const c=this.context.getStore();if(c&&c.marks[from]!==undefined)this.record(c,name,performance.now()-c.marks[from]);}
  health(){const phases:Record<string,any>={};const keys=new Set(this.cycles.flatMap(c=>Object.keys(c.phases)));for(const key of keys){const p=this.cycles.map(c=>c.phases[key]).filter(Boolean),v=p.map(x=>x.totalMs).sort((a,b)=>a-b);phases[key]={count:p.reduce((n,x)=>n+x.count,0),maxMs:Math.max(...p.map(x=>x.maxMs)),p95CycleTotalMs:v[Math.floor((v.length-1)*.95)]??0,totalMs:p.reduce((n,x)=>n+x.totalMs,0)};}return{scope:'CURRENT_INSTANCE_BOUNDED64_COMPLETED_CYCLES',phases,recent:this.cycles.map(({phases,...c})=>({...c,phases:Object.fromEntries(Object.entries(phases).map(([key,{values,...p}])=>[key,p]))}))};}
}
export const reconciliationTiming=new ReconciliationTiming();
