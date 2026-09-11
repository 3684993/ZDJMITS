import type { PoolItem, SystemSettings, UniverseCandidate } from '@zdj/contracts';
import { entryProfileParameters } from './profiles.js';
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
    const target=Math.min(this.settings.selection.poolMax,this.settings.selection.poolTarget);
    const eligibleForPipeline=(x:UniverseCandidate)=>x.eligible&&x.rank>0&&x.pipelineEligible!==false;
    const selectable=(x:UniverseCandidate)=>(x.residentEligible??x.eligible)&&x.rank>0;
    const current=new Map(candidates.filter(selectable).map(x=>[x.symbol,x]));
    // Transient execution occupancy changes READY/WAITING but does not evict a
    // qualified resident or destroy its market-data subscription.
    for(const [symbol,item] of this.items){const candidate=current.get(symbol);if(!candidate){this.items.delete(symbol);continue;}item.rank=candidate.rank;item.score=candidate.score;item.components=candidate.components;item.selectionGeneration=candidate.selectionGeneration;if(item.state!=='ANALYZING')item.state=eligibleForPipeline(candidate)?'READY':'WAITING';}
    while(this.items.size>this.settings.selection.poolMax){const weakest=this.list().at(-1);if(!weakest)break;this.items.delete(weakest.symbol);}
    const eligible=candidates.filter(x=>selectable(x)&&!this.items.has(x.symbol)).sort((a,b)=>(b.schedulerPriority??b.score)-(a.schedulerPriority??a.score));
    const underlying=(symbol:string)=>current.get(symbol)?.underlyingAsset??resolveUnderlying(symbol);
    const seen=new Set<string>();for(const item of this.list()){const key=underlying(item.symbol);if(seen.has(key))this.items.delete(item.symbol);else seen.add(key);}
    const add=(c:UniverseCandidate)=>{if([...this.items.keys()].some(symbol=>underlying(symbol)===underlying(c.symbol)))return;this.items.set(c.symbol,{id:uid('pool'),symbol:c.symbol,rank:c.rank,score:c.score,components:c.components,state:eligibleForPipeline(c)?'READY':'WAITING',addedAt:now,expiresAt:now+5*60_000,selectionGeneration:c.selectionGeneration});};
    while(this.items.size<target && eligible.length)add(eligible.shift()!);
    if(this.items.size>=target && eligible.length){ const weakest=this.list().at(-1); const strongest=eligible.find(c=>![...this.items.keys()].some(symbol=>underlying(symbol)===underlying(c.symbol))); if(weakest&&strongest&&strongest.score-weakest.score>=this.settings.selection.replacementDelta&&weakest.state==='READY'){ this.items.delete(weakest.symbol); add(strongest); }}
    // A resident refresh deadline is not an eviction trigger when quality still passes.
    for(const item of this.items.values())if(item.expiresAt<=now)item.expiresAt=now+5*60_000;
    // Expiration may have opened capacity; refill during this same event cycle.
    for(const c of eligible)if(this.items.size<target&&!this.items.has(c.symbol))add(c);
    return this.list();
  }
}
