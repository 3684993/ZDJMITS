import type { PoolItem, SystemSettings, UniverseCandidate } from '@zdj/contracts';
import { uid } from './math.js';
import { resolveUnderlying } from './portfolio.js';

export class DynamicPool {
  private items = new Map<string, PoolItem>();
  constructor(private settings:SystemSettings){}
  updateSettings(settings:SystemSettings){ this.settings=settings; }
  list(){ return [...this.items.values()].sort((a,b)=>b.score-a.score); }
  readyList(){ return this.list().filter(item=>item.state==='READY'); }
  refreshReadyView(dispatchable:Set<string>){for(const item of this.items.values())if(item.state!=='ANALYZING')item.state=dispatchable.has(item.symbol)?'READY':'WAITING';const target=Math.min(this.settings.selection.poolMax,this.settings.selection.poolTarget);while(this.readyList().length>target){const weakest=this.readyList().at(-1);if(!weakest)break;weakest.state='WAITING';}return this.readyList();}
  has(symbol:string){ return this.items.has(symbol); }
  remove(symbol:string, state:'REJECTED'|'EXPIRED'='REJECTED'){ const item=this.items.get(symbol); if(item){ item.state=state; this.items.delete(symbol); } return item; }
  markAnalyzing(symbol:string){ const item=this.items.get(symbol); if(item)item.state='ANALYZING'; }
  markReady(symbol:string){ const item=this.items.get(symbol); if(item)item.state='READY'; }
  replenish(candidates:UniverseCandidate[], now=Date.now(),dispatchable?:Set<string>):PoolItem[] {
    // poolMax is resident storage; poolTarget is the maximum dispatch-ready
    // view.  A WAITING resident therefore cannot consume a READY slot.
    const residentTarget=this.settings.selection.poolMax;
    const readyTarget=Math.min(residentTarget,this.settings.selection.poolTarget);
    const eligibleForPipeline=(x:UniverseCandidate)=>x.eligible&&x.rank>0&&x.pipelineEligible!==false&&(!dispatchable||dispatchable.has(x.symbol));
    const selectable=(x:UniverseCandidate)=>(x.residentEligible??x.eligible)&&x.rank>0;
    const current=new Map(candidates.filter(selectable).map(x=>[x.symbol,x]));
    // Transient execution occupancy changes READY/WAITING but does not evict a
    // qualified resident or destroy its market-data subscription.
    for(const [symbol,item] of this.items){const candidate=current.get(symbol);if(!candidate){this.items.delete(symbol);continue;}item.rank=candidate.rank;item.score=candidate.score;item.components=candidate.components;item.selectionGeneration=candidate.selectionGeneration;if(item.state!=='ANALYZING')item.state=eligibleForPipeline(candidate)?'READY':'WAITING';}
    const priority=(a:UniverseCandidate,b:UniverseCandidate)=>Number(eligibleForPipeline(b))-Number(eligibleForPipeline(a))||((b.schedulerPriority??b.score)-(a.schedulerPriority??a.score));
    const eligible=candidates.filter(x=>selectable(x)&&!this.items.has(x.symbol)).sort(priority);
    const underlying=(symbol:string)=>current.get(symbol)?.underlyingAsset??resolveUnderlying(symbol);
    const seen=new Set<string>();for(const item of this.list()){const key=underlying(item.symbol);if(seen.has(key))this.items.delete(item.symbol);else seen.add(key);}
    const add=(c:UniverseCandidate)=>{if([...this.items.keys()].some(symbol=>underlying(symbol)===underlying(c.symbol)))return false;this.items.set(c.symbol,{id:uid('pool'),symbol:c.symbol,rank:c.rank,score:c.score,components:c.components,state:eligibleForPipeline(c)?'READY':'WAITING',addedAt:now,expiresAt:now+5*60_000,selectionGeneration:c.selectionGeneration});return true;};
    const evictWeakest=(states:PoolItem['state'][])=>{const weakest=this.list().filter(item=>states.includes(item.state)).at(-1);if(weakest)this.items.delete(weakest.symbol);return weakest;};
    while(this.items.size>residentTarget)evictWeakest(['WAITING','ANALYZING','READY']);
    for(const candidate of eligible){if(this.items.size>=residentTarget)break;add(candidate);}
    // A new runnable candidate always displaces a WAITING resident (including a
    // just-cooled symbol).  READY-to-READY replacement still respects the
    // existing score delta, preserving bounded turnover.
    for(const candidate of eligible.filter(eligibleForPipeline)){
      if(this.items.has(candidate.symbol))continue;
      const sameUnderlying=this.list().find(item=>underlying(item.symbol)===underlying(candidate.symbol));
      if(sameUnderlying?.state==='WAITING')this.items.delete(sameUnderlying.symbol);
      else if(this.items.size>=residentTarget){const waiting=evictWeakest(['WAITING']);if(!waiting){const weakest=this.list().filter(item=>item.state==='READY').at(-1);if(!weakest||candidate.score-weakest.score<this.settings.selection.replacementDelta)continue;this.items.delete(weakest.symbol);}}
      add(candidate);
    }
    // A resident refresh deadline is not an eviction trigger when quality still passes.
    for(const item of this.items.values())if(item.expiresAt<=now)item.expiresAt=now+5*60_000;
    // Expiration may have opened capacity; refill during this same event cycle.
    // The ready view is derived from the same resident facts.  It remains
    // bounded by poolTarget but never treats WAITING/ANALYZING as readiness.
    while(this.readyList().length>readyTarget){const weakest=this.readyList().at(-1);if(!weakest)break;weakest.state='WAITING';}
    return this.list();
  }
}
