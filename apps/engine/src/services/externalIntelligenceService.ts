import {createHash} from 'node:crypto';
import type {SystemSettings} from '@zdj/contracts';
import type {RuntimeState} from '../state/runtimeState.js';
import type {SettingsStore} from '../config/settingsStore.js';
import type {EventBus} from '../events/eventBus.js';

export type ExternalIntelligenceSnapshot={
  id:string;provider:'ALPACA'|'FEDERAL_RESERVE'|'LOCAL_MARKET';instrument:string;venue:string;sourceId:string;url:string;
  eventAt:number;publishedAt:number;receivedAt:number;availableAt:number;expiresAt:number;closedBar:boolean|null;
  facts:Record<string,string|number|boolean|null>;quality:'OFFICIAL'|'AUTHENTICATED_MARKET_DATA'|'LOCAL_MARKET_FACTS';revision:string;contentHash:string;sourceConflicts?:string[];
};
type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value:string)=>value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
const tag=(xml:string,name:string)=>text(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]??'');

/** Shared read-only collector. It has no exchange adapter and cannot authorize or block Entry. */
export class ExternalIntelligenceService{
  private nextAttempt=new Map<string,number>();
  private researchSink:((snapshot:ExternalIntelligenceSnapshot)=>void)|null=null;
  constructor(private state:RuntimeState,private store:SettingsStore,private events:EventBus,private fetcher:FetchLike=fetch){}
  private settings():SystemSettings['externalIntelligence']{return this.state.settings.externalIntelligence;}
  status(){return this.store.listExternalProviderStates();}
  setResearchSink(sink:(snapshot:ExternalIntelligenceSnapshot)=>void){this.researchSink=sink;}
  private setStatus(provider:string,status:string,extra:Record<string,unknown>={}){const value={provider,status,updatedAt:Date.now(),...extra};this.state.externalProviderStatus.set(provider,value);this.store.setExternalProviderState(provider,value);return value;}
  private save(snapshot:ExternalIntelligenceSnapshot){const inserted=this.store.upsertExternalIntelligenceSnapshot(snapshot);if(inserted){this.state.externalIntelligence.set(snapshot.id,snapshot);this.researchSink?.(snapshot);this.events.publish('EXTERNAL_INTELLIGENCE_INGESTED',{sourceId:snapshot.sourceId,contentHash:snapshot.contentHash,availableAt:snapshot.availableAt,readOnly:true,entryPermission:false});}}
  async tick(force=false){
    const s=this.settings(),now=Date.now();
    if(!s.enabled){this.setStatus('ALPACA','DISABLED');this.setStatus('FEDERAL_RESERVE','DISABLED');return;}
    const tasks:Promise<void>[]=[];
    if(s.alpaca.enabled&&(force||(this.nextAttempt.get('ALPACA')??0)<=now))tasks.push(this.refreshAlpaca());else if(!s.alpaca.enabled)this.setStatus('ALPACA','DISABLED');
    if(s.federalReserve.enabled&&(force||(this.nextAttempt.get('FEDERAL_RESERVE')??0)<=now))tasks.push(this.refreshFederalReserve());else if(!s.federalReserve.enabled)this.setStatus('FEDERAL_RESERVE','DISABLED');
    await Promise.all(tasks);
  }
  async refreshAlpaca(){
    const s=this.settings(),provider='ALPACA',now=Date.now(),ref=s.alpaca.credentialRef;
    const [key,secret]=await Promise.all([this.store.getSecret(`${ref}:apiKey`).catch(()=>null),this.store.getSecret(`${ref}:apiSecret`).catch(()=>null)]);
    if(!key||!secret){this.nextAttempt.set(provider,now+s.refreshSeconds*1000);this.setStatus(provider,'UNCONFIGURED',{lastError:'READ_ONLY_CREDENTIALS_MISSING'});return;}
    const url=`https://data.alpaca.markets/v1beta3/crypto/${s.alpaca.feed}/bars?symbols=${encodeURIComponent('BTC/USD,ETH/USD')}&timeframe=15Min&limit=4&sort=desc`;
    try{
      const response=await this.fetcher(url,{headers:{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret},signal:AbortSignal.timeout(s.timeoutMs)});
      if(!response.ok)throw Object.assign(new Error(`ALPACA_HTTP_${response.status}`),{status:response.status});
      const body:any=await response.json(),receivedAt=Date.now();let saved=0;
      for(const instrument of ['BTC/USD','ETH/USD']){
        const bars=(body?.bars?.[instrument]??[]).map((x:any)=>({...x,at:Date.parse(String(x.t))})).filter((x:any)=>Number.isFinite(x.at)&&x.at+15*60_000<=receivedAt).sort((a:any,b:any)=>a.at-b.at),latest=bars.at(-1),prior=bars.at(-2);if(!latest)continue;
        const facts={open:Number(latest.o),high:Number(latest.h),low:Number(latest.l),close:Number(latest.c),volume:Number(latest.v??0),return15m:prior&&Number(prior.c)>0?Number(latest.c)/Number(prior.c)-1:null,feed:s.alpaca.feed};
        const sourceId=`alpaca:${instrument}:${latest.at}`,contentHash=hash({instrument,latest,facts}),snapshot:ExternalIntelligenceSnapshot={id:`ext_${contentHash.slice(0,24)}`,provider:'ALPACA',instrument,venue:'ALPACA_CRYPTO_SPOT',sourceId,url,eventAt:latest.at+15*60_000,publishedAt:latest.at+15*60_000,receivedAt,availableAt:receivedAt,expiresAt:receivedAt+s.alpaca.ttlSeconds*1000,closedBar:true,facts,quality:'AUTHENTICATED_MARKET_DATA',revision:contentHash,contentHash};this.save(snapshot);saved++;
      }
      this.nextAttempt.set(provider,receivedAt+s.refreshSeconds*1000);this.setStatus(provider,'READY',{lastSuccessAt:receivedAt,snapshotCount:saved,lastError:null});this.events.publish('EXTERNAL_INTELLIGENCE_REFRESHED',{provider,snapshotCount:saved,readOnly:true,entryPermission:false});
    }catch(error:any){const backoff=error?.status===429?Math.max(s.refreshSeconds*2,900):s.refreshSeconds;this.nextAttempt.set(provider,Date.now()+backoff*1000);this.setStatus(provider,error?.status===429?'BACKOFF':'DEGRADED',{lastError:error instanceof Error?error.message:String(error),nextAttemptAt:this.nextAttempt.get(provider)});}
  }
  async refreshFederalReserve(){
    const s=this.settings(),provider='FEDERAL_RESERVE',url=s.federalReserve.rssUrl;
    try{
      const response=await this.fetcher(url,{headers:{accept:'application/rss+xml, application/xml, text/xml'},signal:AbortSignal.timeout(s.timeoutMs)});if(!response.ok)throw Object.assign(new Error(`FED_RSS_HTTP_${response.status}`),{status:response.status});
      const xml=await response.text(),receivedAt=Date.now(),items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,10);let saved=0;
      for(const match of items){const item=match[1]!,title=tag(item,'title'),link=tag(item,'link'),description=tag(item,'description'),date=Date.parse(tag(item,'pubDate')||tag(item,'dc:date'));if(!title||!link||!Number.isFinite(date))continue;const sourceId=`fed:${link}`,facts={title,summary:description.slice(0,600)},contentHash=hash({sourceId,date,facts}),snapshot:ExternalIntelligenceSnapshot={id:`ext_${contentHash.slice(0,24)}`,provider:'FEDERAL_RESERVE',instrument:'USD_MACRO',venue:'FEDERAL_RESERVE_OFFICIAL_RSS',sourceId,url:link,eventAt:date,publishedAt:date,receivedAt,availableAt:receivedAt,expiresAt:receivedAt+s.federalReserve.ttlSeconds*1000,closedBar:null,facts,quality:'OFFICIAL',revision:contentHash,contentHash};this.save(snapshot);saved++;}
      this.nextAttempt.set(provider,receivedAt+s.refreshSeconds*1000);this.setStatus(provider,'READY',{lastSuccessAt:receivedAt,snapshotCount:saved,lastError:null});this.events.publish('EXTERNAL_INTELLIGENCE_REFRESHED',{provider,snapshotCount:saved,readOnly:true,entryPermission:false});
    }catch(error:any){const backoff=error?.status===429?Math.max(s.refreshSeconds*2,900):s.refreshSeconds;this.nextAttempt.set(provider,Date.now()+backoff*1000);this.setStatus(provider,error?.status===429?'BACKOFF':'DEGRADED',{lastError:error instanceof Error?error.message:String(error),nextAttemptAt:this.nextAttempt.get(provider)});}
  }
  context(symbol:string,asOf=Date.now()){
    const s=this.settings();if(!s.enabled||!s.feedToPrimary)return[];
    const rows=this.store.listExternalIntelligenceSnapshots(asOf,100).filter((x:ExternalIntelligenceSnapshot)=>x.availableAt<=asOf&&x.expiresAt>=asOf&&(['USD_MACRO','BTC/USD','ETH/USD'].includes(x.instrument)));
    const out:any[]=[];let chars=0,maxChars=s.maxContextTokens*4;
    for(const row of rows){const compact={sourceId:row.sourceId,provider:row.provider,instrument:row.instrument,venue:row.venue,eventAt:row.eventAt,publishedAt:row.publishedAt,availableAt:row.availableAt,expiresAt:row.expiresAt,quality:row.quality,facts:row.facts,targetSymbol:symbol},size=JSON.stringify(compact).length;if(chars+size>maxChars)continue;out.push(compact);chars+=size;if(out.length>=s.maxContextItems)break;}
    return out;
  }
}
