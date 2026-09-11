import type {RuntimeState} from '../state/runtimeState.js';
import type {SettingsStore} from '../config/settingsStore.js';
import type {EventBus} from '../events/eventBus.js';
import type {AiFabric} from './aiFabric.js';
import type {ExternalIntelligenceSnapshot} from './externalIntelligenceService.js';
import {createHash} from 'node:crypto';

/** Restart-safe, single-concurrency research queue. It has no exchange adapter. */
export class ExternalResearchService{
  private running=false;
  constructor(private state:RuntimeState,private store:SettingsStore,private ai:AiFabric,private events:EventBus){}
  enqueue(snapshot:ExternalIntelligenceSnapshot){
    if(this.metrics().queued>=64){this.events.publish('EXTERNAL_RESEARCH_QUEUE_FULL',{sourceId:snapshot.sourceId,capacity:64});return false;}
    const inserted=this.store.enqueueExternalResearch(snapshot);
    if(inserted)this.events.publish('EXTERNAL_RESEARCH_QUEUED',{sourceId:snapshot.sourceId,contentHash:snapshot.contentHash,availableAt:snapshot.availableAt,entryPermission:false});
    this.ai.setResearchQueue(this.metrics().queued);return inserted;
  }
  enqueueMarketChanges(now=Date.now()) {
    if(!this.state.settings.externalIntelligence.researchEnabled)return false;
    const facts:Record<string,string|number|boolean|null>={};
    for(const candidate of this.state.pool.list()){
      const market=this.state.snapshots.get(candidate.symbol);if(!market||now-market.quote.ts>15000)continue;
      const trend=market.technical['15m'];if(!trend||now-trend.asOf>1805000)continue;
      facts[`${candidate.symbol}.trend15m`]=trend.trend;
      facts[`${candidate.symbol}.trend5m`]=market.technical['5m']?.trend??null;
    }
    if(!Object.keys(facts).length)return false;
    const contentHash=createHash('sha256').update(JSON.stringify(facts)).digest('hex'),eventAt=Math.max(...this.state.pool.list().map(candidate=>Number(this.state.snapshots.get(candidate.symbol)?.technical?.['15m']?.barCloseTime??0)));
    return this.enqueue({id:`market_${contentHash}`,provider:'LOCAL_MARKET',instrument:'QUALIFIED_POOL',venue:this.state.settings.connections.exchange.environment,sourceId:`market-changes:${contentHash}`,url:'local://qualified-market-facts',eventAt,publishedAt:now,receivedAt:now,availableAt:now,expiresAt:now+30*60_000,closedBar:eventAt>0?true:null,facts,quality:'LOCAL_MARKET_FACTS',revision:contentHash,contentHash});
  }
  metrics(){return{enabled:this.state.settings.externalIntelligence.researchEnabled,feedToPrimary:this.state.settings.externalIntelligence.feedToPrimary,maxConcurrency:1,...this.store.externalResearchMetrics()};}
  async tick(){
    if(this.running||!this.state.settings.externalIntelligence.researchEnabled)return;
    const task=this.store.nextExternalResearch();if(!task){this.ai.setResearchQueue(0);return;}
    this.running=true;this.ai.setResearchQueue(this.metrics().queued);
    try{if(task.payload.expiresAt<Date.now()){this.store.completeExternalResearch(task.contentHash,{sourceId:task.payload.sourceId,entities:[],facts:[],conflicts:[],disposition:'EXPIRED_BEFORE_MODEL'});this.events.publish('EXTERNAL_RESEARCH_EXPIRED',{sourceId:task.payload.sourceId,modelCalls:0});return;}const result=await this.ai.researchExternal(task.payload);this.store.completeExternalResearch(task.contentHash,result);}
    catch(error){this.store.failExternalResearch(task.contentHash,error instanceof Error?error.message:String(error),task.attempts);}
    finally{this.running=false;this.ai.setResearchQueue(this.metrics().queued);}
  }
}
