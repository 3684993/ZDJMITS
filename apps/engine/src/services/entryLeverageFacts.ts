import type {RuntimeState} from '../state/runtimeState.js';
import type {ExchangeTradeAdapter} from '../types.js';
import type {EventBus} from '../events/eventBus.js';
import {testnetFundsOnlyEntry} from '@zdj/core';
import {canonicalizeMarginBrackets,type MarginBracketTier} from './portfolioRiskAuthority.js';
import {createHash} from 'node:crypto';
import {noSeparateAddBlock} from './noSeparateAdd.js';

type Fact={scope:string;observedAt:number;validUntil:number;contentHash:string;tiers:MarginBracketTier[]};
const scopeOf=(state:RuntimeState)=>JSON.stringify([state.settings.connections.exchange.environment,state.settings.connections.exchange.credentialRef]);
const factHash=(row:unknown)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function entryLeverageTiers(state:RuntimeState,symbol:string,now:number){
  const fact:Fact|undefined=(state as any).entryLeverageFacts?.get(symbol);
  return fact&&fact.scope===scopeOf(state)&&now>=fact.observedAt&&now<fact.validUntil?fact.tiers:state.marginTierCoverage?.tiersBySymbol?.[symbol]??[];
}

/** TESTNET signed GET facts, separate from the operator's committed portfolio risk policy. */
export class EntryLeverageFactRecovery {
  private inFlight=false;private nextReadAt=0;
  constructor(private state:RuntimeState,private exchange:ExchangeTradeAdapter,private events:EventBus){}
  async refreshMissing(now=Date.now()){
    if(this.inFlight||now<this.nextReadAt||!testnetFundsOnlyEntry(this.state.settings)||!this.exchange.fetchMaintenanceMarginBrackets)return;
    const symbols=this.state.universe.filter((x:any)=>x.eligible&&x.rank>0&&x.pipelineEligible!==false&&
      !entryLeverageTiers(this.state,x.symbol,now).length&&
      (!noSeparateAddBlock(this.state,x.symbol,'LONG',undefined,now)||!noSeparateAddBlock(this.state,x.symbol,'SHORT',undefined,now)))
      .sort((a:any,b:any)=>a.rank-b.rank).slice(0,3).map((x:any)=>x.symbol);
    if(!symbols.length)return;
    this.inFlight=true;this.nextReadAt=now+60_000;
    const scope=scopeOf(this.state),credentialRef=String(this.state.settings.connections.exchange.credentialRef);
    try{
      const read=await this.exchange.fetchMaintenanceMarginBrackets(symbols,{maxInFlight:1,credentialRef});
      const completedAt=Date.now();
      if(scope!==scopeOf(this.state)||read.environment!=='TESTNET'||read.credentialRef!==credentialRef||
        !Number.isSafeInteger(read.observedAt)||read.observedAt<now||read.observedAt>completedAt||completedAt-read.observedAt>30_000)
        throw Error('ENTRY_LEVERAGE_FACT_SCOPE_OR_TIME_CONFLICT');
      const normalized=canonicalizeMarginBrackets(read);
      if(!normalized.ok||symbols.some(symbol=>!normalized.dataset.some(x=>x.symbol===symbol))||normalized.dataset.some(x=>!symbols.includes(x.symbol)))
        throw Error('ENTRY_LEVERAGE_FACT_INCOMPLETE_OR_INVALID');
      const cache:Map<string,Fact>=(this.state as any).entryLeverageFacts??=new Map();
      for(const row of normalized.dataset){
        cache.set(row.symbol,{scope,observedAt:read.observedAt,validUntil:read.observedAt+600_000,contentHash:factHash(row),tiers:row.tiers});
        this.events.publish('ENTRY_LEVERAGE_FACT_READY',{symbol:row.symbol,source:'BINANCE_TESTNET_SIGNED_GET',observedAt:read.observedAt,validUntil:read.observedAt+600_000,contentHash:factHash(row),settingsChanged:false,portfolioAuthorityChanged:false},row.symbol);
      }
      while(cache.size>128)cache.delete(cache.keys().next().value!);
    }catch(error){this.events.publish('ENTRY_LEVERAGE_FACT_UNAVAILABLE',{symbols,reason:error instanceof Error?error.message:String(error),nextReadAt:this.nextReadAt,failClosed:true});}
    finally{this.inFlight=false;}
  }
}
