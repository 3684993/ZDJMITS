import { resolveUnderlying } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import type { MarketDataHub } from './marketDataHub.js';

/** Owns only inventory membership.  It neither authorizes Entry nor changes reservations. */
export class MarketCohort {
  private members=new Set<string>(); private joinedAt=new Map<string,number>(); private flight:Promise<number>|null=null; private retryAt=0; private lastDiscoveryKey=''; private noResultKey='';
  constructor(private state:RuntimeState,private market:MarketDataHub,private events:EventBus,private now=()=>Date.now()){}
  protectedSymbols(){return new Set([...this.state.positionSymbols(),...this.state.activeEntrySymbols(),...[...this.state.candidateLifecycle].filter(([,row]:any)=>['SCOUT_QUEUED','SCOUT_RUNNING','PRIMARY_QUEUED','PRIMARY_RUNNING','WAIT_FOR_PRICE','WAIT_EXECUTION_RANGE'].includes(row?.status)).map(([symbol])=>String(symbol).toUpperCase()),'BTCUSDT','ETHUSDT']);}
  symbols(){return new Set(this.members);}
  private retain(){this.market.setRetentionSymbols(new Set([...this.members,...this.protectedSymbols()]));}
  private blocked(){const c:any=this.state.runtimeControl?.capital,reason=String(this.state.runtimeControl?.reasonCode??'');return this.state.runtimeControl?.mode!=='RUNNING'||this.state.executionGovernance?.mode==='AUTO_PAUSED_RISK'||/CAPITAL|CAPACITY|RISK|SYSTEMIC/.test(reason)||Boolean(c&&c.executableCandidateCount===0);}
  async tick(reason='PERIODIC'){
    if(this.flight)return this.flight;
    const now=this.now(),cfg:any=this.state.settings.selection.cohort??{size:100,hydrateBatchSize:20,refillBackoffSeconds:60};
    this.retain();
    if(now<this.retryAt||(this.blocked()&&this.members.size>0)){this.events.publish('MARKET_COHORT_DEFERRED',{reason,blocked:this.blocked(),retryAt:this.retryAt,size:this.members.size,supplyBootstrap:this.members.size===0});return 0;}
    const key=`${this.state.settings.selection.assetDirectory?.version??''}:${this.state.generation}`;
    this.rotateStale(now,cfg);
    const ready=[...this.members].filter(symbol=>Boolean(this.market.snapshot(symbol))).length,gap=Math.max(0,cfg.size-this.members.size),low=ready<cfg.readyLowWatermark;
    if((!gap&&!low)||this.noResultKey===key)return 0;
    this.flight=this.refill(Math.min(gap,cfg.hydrateBatchSize),key,reason).finally(()=>this.flight=null);
    return this.flight;
  }
  private async refill(batch:number,key:string,reason:string){
    if(batch<=0){this.lastDiscoveryKey=key;return 0;}
    const cfg:any=this.state.settings.selection.cohort,priority=[...(this.state.settings.selection.assetDirectory?.approvedLiquid??[]),...this.protectedSymbols()];
    try{
      const discovered=await this.market.discover(Math.max(cfg.size,batch),priority), seen=new Set(this.members),underlyings=new Set([...this.members].map(resolveUnderlying));
      const candidates=discovered.filter(symbol=>!seen.has(symbol)&&!underlyings.has(resolveUnderlying(symbol))).slice(0,batch);
      if(!candidates.length){this.noResultKey=key;this.retryAt=this.now()+Math.max(1,cfg.refillBackoffSeconds)*1000;this.events.publish('MARKET_COHORT_NO_NEW_RESULT',{reason,key,retryAt:this.retryAt,members:this.members.size});return 0;}
      // Retain candidates before I/O; failed cards never become members.
      this.market.setRetentionSymbols(new Set([...this.market.retentionSymbols(),...candidates]));
      const loaded=await this.market.hydrateSymbols(candidates),ready=candidates.filter(symbol=>this.market.snapshot(symbol));
      for(const symbol of ready){this.members.add(symbol);this.joinedAt.set(symbol,this.now());}
      this.retain(); this.lastDiscoveryKey=key; this.noResultKey=ready.length?'':key; this.retryAt=ready.length?0:this.now()+Math.max(1,cfg.refillBackoffSeconds)*1000;
      this.events.publish('MARKET_COHORT_REFILLED',{reason,requested:candidates.length,loaded,members:this.members.size,retention:this.market.retentionSymbols().size});
      return loaded;
    }catch(error){const delay=Math.max(1,cfg.refillBackoffSeconds)*1000;this.noResultKey=key;this.retryAt=this.now()+delay;this.events.publish('MARKET_COHORT_FAILED',{reason,message:error instanceof Error?error.message:String(error),retryAt:this.retryAt});return 0;}
  }
  private rotateStale(now:number,cfg:any){const protectedSymbols=this.protectedSymbols(),maxAge=Math.max(1,cfg.staleMemberRotationMinutes??cfg.rotationMinutes??120)*60_000;for(const symbol of [...this.members])if(!protectedSymbols.has(symbol)&&now-(this.joinedAt.get(symbol)??now)>=maxAge){this.members.delete(symbol);this.joinedAt.delete(symbol);this.events.publish('MARKET_COHORT_RETIRED',{symbol,reason:'STALE_ROTATION'});}}
  remove(symbol:string){this.members.delete(symbol.toUpperCase());this.joinedAt.delete(symbol.toUpperCase());this.retain();}
}
