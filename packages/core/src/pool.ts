import type { PoolItem, SystemSettings, UniverseCandidate } from '@zdj/contracts';
import { uid } from './math.js';
import { resolveUnderlying } from './portfolio.js';

export class DynamicPool {
  private items = new Map<string, PoolItem>();
  constructor(private settings:SystemSettings){}
  updateSettings(settings:SystemSettings){ this.settings=settings; }
  list(){ return [...this.items.values()].sort((a,b)=>b.score-a.score); }
  has(symbol:string){ return this.items.has(symbol); }
  remove(symbol:string, state:'REJECTED'|'EXPIRED'='REJECTED'){ const item=this.items.get(symbol); if(item){ item.state=state; this.items.delete(symbol); } return item; }
  markAnalyzing(symbol:string){ const item=this.items.get(symbol); if(item)item.state='ANALYZING'; }
  markReady(symbol:string){ const item=this.items.get(symbol); if(item)item.state='READY'; }
  replenish(candidates:UniverseCandidate[], now=Date.now()):PoolItem[] {
    const readyTarget=Math.min(this.settings.selection.poolMax,this.settings.selection.poolTarget);
    const eligibleForPipeline=(x:UniverseCandidate)=>x.eligible&&x.rank>0&&x.pipelineEligible!==false;
    const selectable=(x:UniverseCandidate)=>(x.residentEligible??x.eligible)&&x.rank>0;
    const current=new Map(candidates.filter(selectable).map(x=>[x.symbol,x]));
    for(const [symbol,item] of this.items){const candidate=current.get(symbol);if(!candidate){this.items.delete(symbol);continue;}item.rank=candidate.rank;item.score=candidate.score;item.components=candidate.components;item.selectionGeneration=candidate.selectionGeneration;if(item.state!=='ANALYZING')item.state=eligibleForPipeline(candidate)?'READY':'WAITING';}
    const underlying=(symbol:string)=>current.get(symbol)?.underlyingAsset??resolveUnderlying(symbol);
    const seen=new Set<string>();for(const item of this.list()){const key=underlying(item.symbol);if(seen.has(key))this.items.delete(item.symbol);else seen.add(key);}
    const weakestWaiting=()=>this.list().filter(item=>item.state==='WAITING').at(-1);
    while(this.items.size>this.settings.selection.poolMax){const remove=weakestWaiting()??this.list().at(-1);if(!remove)break;this.items.delete(remove.symbol);}
    const add=(c:UniverseCandidate)=>{if([...this.items.keys()].some(symbol=>underlying(symbol)===underlying(c.symbol)))return false;this.items.set(c.symbol,{id:uid('pool'),symbol:c.symbol,rank:c.rank,score:c.score,components:c.components,state:eligibleForPipeline(c)?'READY':'WAITING',addedAt:now,expiresAt:now+5*60_000,selectionGeneration:c.selectionGeneration});return true;};
    const missing=()=>candidates.filter(x=>selectable(x)&&!this.items.has(x.symbol)&&![...this.items.keys()].some(symbol=>underlying(symbol)===underlying(x.symbol)));
    // Execution-ready capacity is independent from WAITING resident occupancy.
    // READY candidates always get first claim on readyTarget; WAITING residents
    // may remain visible but cannot make the execution view appear full.
    for(const candidate of missing().filter(eligibleForPipeline).sort((a,b)=>(b.schedulerPriority??b.score)-(a.schedulerPriority??a.score))){
      if(this.list().filter(item=>item.state==='READY').length>=readyTarget)break;
      if(this.items.size>=this.settings.selection.poolMax){const waiting=weakestWaiting();if(!waiting)break;this.items.delete(waiting.symbol);}
      add(candidate);
    }
    for(const candidate of missing().sort((a,b)=>Number(eligibleForPipeline(b))-Number(eligibleForPipeline(a))||(b.schedulerPriority??b.score)-(a.schedulerPriority??a.score))){
      if(this.items.size>=readyTarget)break;
      add(candidate);
    }
    const alternatives=missing().filter(eligibleForPipeline).sort((a,b)=>(b.schedulerPriority??b.score)-(a.schedulerPriority??a.score));
    if(this.items.size>=readyTarget&&alternatives.length&&this.list().filter(item=>item.state==='READY').length>=readyTarget){const weakest=this.list().filter(item=>item.state==='READY').at(-1),strongest=alternatives[0];if(weakest&&strongest&&strongest.score-weakest.score>=this.settings.selection.replacementDelta){this.items.delete(weakest.symbol);add(strongest);}}
    for(const item of this.items.values())if(item.expiresAt<=now)item.expiresAt=now+5*60_000;
    return this.list();
  }
}
