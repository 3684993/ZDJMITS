import type { Candle, MarketSymbolSnapshot, Quote, Timeframe } from '@zdj/contracts';
import type { MarketDataProvider } from '../types.js';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import { buildTechnicalCard, resolveUnderlying } from '@zdj/core';

async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length); let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i]!);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker())); return out;
}
const budgetDeferred=(error:unknown)=>String(error instanceof Error?error.message:error).startsWith('BINANCE_REQUEST_BUDGET_DEFERRED:');
export class MarketDataHub {
  private snapshotFlights=new Map<string,Promise<MarketSymbolSnapshot>>();
  private rulesUpdatedAt=new Map<string,number>();
  private ownershipEpoch=new Map<string,number>();
  private retained=new Set<string>();
  private retentionManaged=false;
  private liveTechnicalFailures=new Set<string>();
  private technicalBlocked=new Map<string,{timeframe:string;sequence:string;at:number}>();
  private targetedRefreshDeferredUntil=0;
  private rememberFailure(key:string,symbol:string,timeframe:string,sequence:string){this.liveTechnicalFailures.add(key);this.technicalBlocked.set(`${symbol}:${timeframe}`,{timeframe,sequence,at:Date.now()});while(this.liveTechnicalFailures.size>512)this.liveTechnicalFailures.delete(this.liveTechnicalFailures.values().next().value!);while(this.technicalBlocked.size>128)this.technicalBlocked.delete(this.technicalBlocked.keys().next().value!);}
  private loadSnapshot(symbol:string,epoch=this.epoch(symbol)){const key=`${symbol}:${epoch}`,existing=this.snapshotFlights.get(key);if(existing)return existing;const flight=this.provider.getSnapshot(symbol).finally(()=>this.snapshotFlights.delete(key));this.snapshotFlights.set(key,flight);return flight;}
  private recovery=new Map<string,{attempt:number;nextRetryAt:number;lastSuccessAt:number|null;reason:string|null}>();
  constructor(private provider:MarketDataProvider,private state:RuntimeState,private events:EventBus){}
  /** Membership ownership is explicit; stale async responses may only write their captured epoch. */
  setRetentionSymbols(symbols:Iterable<string>){
    const next=new Set([...symbols].map(symbol=>symbol.toUpperCase()));
    for(const symbol of new Set([...this.retained,...next]))if(this.retained.has(symbol)!==next.has(symbol))this.ownershipEpoch.set(symbol,(this.ownershipEpoch.get(symbol)??0)+1);
    this.retained=next;this.retentionManaged=true;this.provider.setLiveSymbols?.([...next]);
    for(const symbol of [...this.state.snapshots.keys()])if(!next.has(symbol)){this.state.snapshots.delete(symbol);this.recovery.delete(symbol);this.rulesUpdatedAt.delete(symbol);}
  }
  retentionSymbols(){return new Set(this.retained);}
  /** Discovery is deliberately light-weight: it must not alter retention or hydrate cards. */
  async discover(limit:number,priority:string[]=[]){
    const listed=await (this.provider.discoverSymbols?.(limit,priority)??this.provider.listSymbols(limit,priority));
    return [...new Set(listed.map(symbol=>symbol.toUpperCase()))];
  }
  /** Retention is owned by the caller. This is safe for cohort delta hydration. */
  async hydrateSymbols(symbols:string[]){return this.refreshSymbols(symbols);}
  private epoch(symbol:string){return this.ownershipEpoch.get(symbol)??0;}
  private canWrite(symbol:string,epoch:number){return !this.retentionManaged||(this.retained.has(symbol)&&this.epoch(symbol)===epoch);}
  async tick(){
    await this.provider.tick?.();
    for(const [symbol,snapshot] of this.state.snapshots){
      const epoch=this.epoch(symbol);if(!this.canWrite(symbol,epoch))continue;
      let live=snapshot;
      try{
        // Quote/book facts feed management independently of strict Entry cards.
        live=this.provider.hydrateLiveMarket?.(snapshot)??this.provider.hydrateLive?.(snapshot)??snapshot;
        if(live&&this.canWrite(symbol,epoch))this.state.snapshots.set(symbol,live);
      }catch(error){
        // One malformed/gapped stream must not abort the global market tick.
        // Keep the strict symbol-level readiness failure visible and let the
        // normal recovery loop refresh that symbol independently.
        this.events.publish('MARKET_SYMBOL_ERROR',{message:error instanceof Error?error.message:String(error),scope:'LIVE_HYDRATE'},symbol);
        continue;
      }
      if(!this.provider.hydrateLiveTechnical)continue;
      try{
        const technical=this.provider.hydrateLiveTechnical(live);
        if(technical&&this.canWrite(symbol,epoch)){this.state.snapshots.set(symbol,technical);if(technical!==live)for(const tf of ['1m','5m','15m'] as const)if(technical.technical?.[tf]!==live.technical?.[tf])this.technicalBlocked.delete(`${symbol}:${tf}`);}
      }catch(error){
        // Keep the new quote/book; the bad closed sequence remains unusable
        // for Entry and is reported once per symbol/timeframe/sequence.
        const card=live.technical?.['1m'],detail=error&&typeof error==='object'?error as {technicalTimeframe?:string;technicalSequence?:string}:null,message=error instanceof Error?error.message:String(error),timeframe=detail?.technicalTimeframe??'1m',sequence=detail?.technicalSequence??String(card?.barCloseTime??card?.asOf??'unknown'),key=`${symbol}:${timeframe}:${sequence}:${message}`;
        if(this.liveTechnicalFailures.has(key))continue;
        this.rememberFailure(key,symbol,timeframe,sequence);
        this.events.publish('MARKET_SYMBOL_ERROR',{message,scope:'LIVE_HYDRATE_TECHNICAL',timeframe,sequence:sequence==='unknown'?null:sequence},symbol);
      }
    }
  }
  async refresh(limit:number){
    const generation=++this.state.marketGeneration;
    const priority=[...new Set([
      ...(this.state.settings.selection?.assetDirectory?.approvedLiquid??[]),
      ...(this.state.positionSymbols?.()??[]),
      ...(this.state.activeEntrySymbols?.()??[]),
    ].map((x:string)=>String(x).toUpperCase()))];
    const symbols=await this.discover(limit,priority); if(!symbols.includes('BTCUSDT'))symbols.unshift('BTCUSDT'); if(!symbols.includes('ETHUSDT'))symbols.unshift('ETHUSDT');
    const requested=[...new Set(symbols)];this.setRetentionSymbols([...this.retained,...requested]);
    const snapshots=await mapLimit(requested,this.state.settings.connections.marketDataMode==='BINANCE'?4:16,async symbol=>{
      const epoch=this.epoch(symbol);try{return{symbol,epoch,snapshot:await this.loadSnapshot(symbol,epoch)};}catch(error){this.events.publish('MARKET_SYMBOL_ERROR',{message:error instanceof Error?error.message:String(error)},symbol);return null;}
    });
    let loaded=0; for(const result of snapshots){if(!result||!this.canWrite(result.symbol,result.epoch))continue;this.state.snapshots.set(result.symbol,result.snapshot);this.rulesUpdatedAt.set(result.symbol,Date.now());loaded++;}
    const planned=this.provider.collectionCoverage?.()??priority.map(requested=>{const exact=/USD[TC]$/.test(requested),found=symbols.find(symbol=>exact?symbol===requested:resolveUnderlying(symbol)===requested);return{requested,symbol:found??null,status:found?'COLLECTED' as const:'UNAVAILABLE' as const,reason:found?null:'NO_EXECUTION_MARKET_DATA'};});
    const coverage=planned.map(row=>row.symbol&&!this.state.snapshots.has(row.symbol)?{...row,status:'UNAVAILABLE' as const,reason:'SNAPSHOT_REFRESH_FAILED'}:row),directory=this.state.settings.selection?.assetDirectory??{version:'UNCONFIGURED',approvedLiquid:[]},approved=new Set(directory.approvedLiquid.map((x:string)=>String(x).toUpperCase())),approvedCoverage=coverage.filter(row=>approved.has(resolveUnderlying(row.symbol??row.requested))||approved.has(row.requested));
    this.events.publish('APPROVED_ASSET_COLLECTION_COVERAGE',{directoryVersion:directory.version,total:approvedCoverage.length,collected:approvedCoverage.filter(x=>x.status==='COLLECTED').length,unavailable:approvedCoverage.filter(x=>x.status==='UNAVAILABLE').length,coverage:approvedCoverage,occupiedCoverage:coverage.filter(row=>!approvedCoverage.includes(row))});
    this.events.publish('MARKET_REFRESHED',{requested:symbols.length,loaded,generation}); return loaded;
  }
  async refreshSymbols(symbols:string[]){const unique=[...new Set(symbols.map(x=>x.toUpperCase()))],now=Date.now();if(now<this.targetedRefreshDeferredUntil)return 0;let deferred:string|null=null;const snapshots=await mapLimit(unique,2,async symbol=>{if(deferred)return null;const epoch=this.epoch(symbol);try{return{symbol,epoch,snapshot:await this.loadSnapshot(symbol,epoch)};}catch(error){const message=error instanceof Error?error.message:String(error);if(budgetDeferred(error)){if(!deferred){deferred=message;this.targetedRefreshDeferredUntil=Date.now()+60_000;this.events.publish('MARKET_REFRESH_DEFERRED',{scope:'TARGETED_REFRESH',message,requested:unique.length,symbol,retryAt:this.targetedRefreshDeferredUntil});}return null;}this.events.publish('MARKET_SYMBOL_ERROR',{message,scope:'TARGETED_REFRESH'},symbol);return null;}});let loaded=0;for(const result of snapshots)if(result&&this.canWrite(result.symbol,result.epoch)){this.state.snapshots.set(result.symbol,result.snapshot);this.rulesUpdatedAt.set(result.symbol,Date.now());loaded++;}if(loaded)this.targetedRefreshDeferredUntil=0;this.events.publish('MARKET_TARGETED_REFRESHED',{requested:unique.length,loaded,deferred:deferred!==null});return loaded;}
  /** Slow cards, derivatives and contract rules refresh independently when their own facts are due. */
  async refreshSlowFields(symbols:Iterable<string>){
    const unique=[...new Set([...symbols].map(s=>s.toUpperCase()))],frames:[Timeframe,number,number][]=[['1h',80,3_600_000],['4h',80,14_400_000],['1d',80,86_400_000],['1w',80,604_800_000]];let updated=0;
    await mapLimit(unique,2,async symbol=>{
      const epoch=this.epoch(symbol),current=this.state.snapshots.get(symbol);if(!current)return;
      const now=Date.now(),dueFrames=frames.filter(([tf,,period])=>{const card=current.technical?.[tf],boundary=Math.floor(now/period)*period,expected=(now-boundary<=10_000?boundary-period:boundary)-1,close=Number(card?.barCloseTime??card?.asOf);return !Number.isFinite(close)||close<expected;});
      const derivativesDue=!Number.isFinite(current.derivatives?.ts)||now-current.derivatives.ts>=300_000;
      const rulesDue=!Number.isFinite(this.rulesUpdatedAt.get(symbol))||now-(this.rulesUpdatedAt.get(symbol)??0)>=900_000;
      if(!derivativesDue&&!rulesDue&&!dueFrames.length)return;
      try{
        const [derivatives,quote,...candles]=await Promise.all([
          derivativesDue?this.provider.getDerivatives(symbol):Promise.resolve(current.derivatives),
          rulesDue?this.provider.getQuote(symbol):Promise.resolve(current.quote),
          ...dueFrames.map(([tf,n])=>this.provider.getCandles(symbol,tf,n)),
        ]);
        if(!this.canWrite(symbol,epoch))return;
        // A live tick can replace quote/book while slow REST is in flight. Re-read after
        // await and merge only the slow facts; never restore the pre-await snapshot.
        const latest=this.state.snapshots.get(symbol);if(!latest)return;
        const technical={...latest.technical};for(let i=0;i<dueFrames.length;i++){const [tf]=dueFrames[i]!,rows=candles[i]!;if(rows.length)technical[tf]=buildTechnicalCard(tf,rows);}
        const contractQuote=rulesDue?{...latest.quote,tickSize:quote.tickSize,stepSize:quote.stepSize,minQty:quote.minQty,minNotional:quote.minNotional}:latest.quote;
        this.state.snapshots.set(symbol,{...latest,quote:contractQuote,derivatives,technical});if(rulesDue)this.rulesUpdatedAt.set(symbol,now);updated++;
      }catch(error){this.events.publish('MARKET_SYMBOL_ERROR',{scope:'SLOW_FIELDS',message:error instanceof Error?error.message:String(error)},symbol);}
    });
    this.events.publish('MARKET_SLOW_FIELDS_REFRESHED',{requested:unique.length,updated});return updated;
  }
  fieldFreshness(symbol:string,now=Date.now()){
    const snapshot=this.state.snapshots.get(symbol);if(!snapshot)return{symbol,status:'MISSING',fields:{}};
    const age=(ts:any,maxAgeMs:number)=>Number.isFinite(ts)?{ageMs:Math.max(0,now-ts),maxAgeMs,fresh:now-ts<=maxAgeMs}:{ageMs:null,maxAgeMs,fresh:false};
    return{symbol,status:'AVAILABLE',fields:{quote:age(snapshot.quote.ts,15_000),book:age(snapshot.orderBook.ts,15_000),'1m':age(snapshot.technical['1m']?.asOf,125_000),'5m':age(snapshot.technical['5m']?.asOf,605_000),'15m':age(snapshot.technical['15m']?.asOf,1_805_000),'1h':age(snapshot.technical['1h']?.asOf,7_205_000),'4h':age(snapshot.technical['4h']?.asOf,28_805_000),'1d':age(snapshot.technical['1d']?.asOf,172_805_000),'1w':age(snapshot.technical['1w']?.asOf,1_209_605_000),derivatives:age(snapshot.derivatives.ts,305_000),contractRules:age(this.rulesUpdatedAt.get(symbol),900_000)}};
  }
  setLiveSymbols(symbols:string[]){this.provider.setLiveSymbols?.(symbols);}
  snapshot(symbol:string):MarketSymbolSnapshot|undefined{return this.state.snapshots.get(symbol);}
  /** Zero-I/O execution quote. Never falls through to provider REST. */
  cachedQuote(symbol:string):Quote|undefined{
    const snapshot=this.state.snapshots.get(symbol)?.quote,live=this.provider.cachedQuote?.(symbol);
    if(!snapshot)return live;
    if(!live)return snapshot;
    return Number(live.ts)>=Number(snapshot.ts)?live:snapshot;
  }
  async freshQuote(symbol:string):Promise<Quote>{return this.provider.getQuote(symbol);}
  candles(symbol:string,timeframe:Timeframe,limit=120):Promise<Candle[]>{return this.provider.getCandles(symbol,timeframe,limit);}
  cachedCandles(symbol:string,timeframe:Timeframe,limit=120):Candle[]{return this.provider.cachedCandles?.(symbol,timeframe,limit)??[];}
  quotes(){return new Map([...this.state.snapshots].map(([s,v])=>[s,v.quote]));}
  metrics(){const stream=this.provider.streamMetrics?.()??{state:'REST_ONLY'};return{...(stream as object),recoveryQueue:[...this.recovery.values()].filter(x=>x.nextRetryAt>Date.now()).length};}
  primaryReadyReasons(symbol:string,now=Date.now()){
    const s=this.state.snapshots.get(symbol),reasons:string[]=[];if(!s)return['SNAPSHOT_MISSING'];
    for(const blocked of this.technicalBlocked.values())if(this.technicalBlocked.get(`${symbol}:${blocked.timeframe}`)===blocked)reasons.push(`TECHNICAL_${blocked.timeframe}_SEQUENCE_INVALID`);
    const validAge=(ts:number,maxAge:number,label:string)=>{if(!Number.isFinite(ts))reasons.push(`${label}_TIMESTAMP_INVALID`);else if(ts>now+5_000)reasons.push(`${label}_TIMESTAMP_FUTURE`);else if(now-ts>maxAge)reasons.push(`${label}_STALE`);};
    validAge(s.quote?.ts,15_000,'QUOTE');validAge(s.orderBook?.ts,15_000,'ORDER_BOOK');
    for(const [tf,period] of [['1m',60_000],['5m',300_000],['15m',900_000]] as const){
      const card=s.technical?.[tf],label=`TECHNICAL_${tf}`;if(!card){reasons.push(`${label}_MISSING`);continue;}
      const close=Number(card.barCloseTime??card.asOf),boundary=Math.floor(now/period)*period,expectedClose=(now-boundary<=10_000?boundary-period:boundary)-1;
      if(card.isClosed===false)reasons.push(`${label}_NOT_CLOSED`);
      // Retain the historical age diagnostic for legacy cards while applying
      // the stronger boundary contract to V3.9.2 cards with bar metadata.
      validAge(close,period*2+5_000,label);
      if(!Number.isFinite(close))reasons.push(`${label}_TIMESTAMP_INVALID`);
      else {if(close>now+5_000)reasons.push(`${label}_FUTURE`);if(card.barCloseTime!==undefined&&(close+1)%period!==0)reasons.push(`${label}_BOUNDARY_INVALID`);if(card.barCloseTime!==undefined&&close<expectedClose)reasons.push(`${label}_MISSING_LATEST_CLOSED`);}
      if(tf==='15m'&&card.sampleSize<240)reasons.push('TECHNICAL_15m_WARMING');
    }
    return [...new Set(reasons)];
  }
  hotFreshnessDiagnostics(now=Date.now()){
    const periods={"1m":60_000,"5m":300_000,"15m":900_000} as const,graceMs=10_000;
    return this.state.pool.list().map(item=>{const s=this.state.snapshots.get(item.symbol);if(!s)return{symbol:item.symbol,state:item.state,status:'MISSING',reasons:['SNAPSHOT_MISSING']};const frames=Object.fromEntries(Object.entries(periods).map(([tf,period])=>{const boundary=Math.floor(now/period)*period,expectedClose=now-boundary<=graceMs?boundary-period-1:boundary-1,card=s.technical?.[tf as keyof typeof s.technical],actualClose=Number(card?.barCloseTime??card?.asOf),finite=Number.isFinite(actualClose),gapCount=finite?Math.max(0,Math.floor((expectedClose-actualClose)/period)):null;return[tf,{expectedClose,actualClose:finite?actualClose:null,isClosed:card?.isClosed===true,receivedAt:Number.isFinite(card?.receivedAt)?card!.receivedAt:null,gapCount,followingBoundary:finite&&card?.isClosed===true&&actualClose>=expectedClose}];}));const reasons=this.primaryReadyReasons(item.symbol,now);return{symbol:item.symbol,state:item.state,status:reasons.length?'DEGRADED':'READY',quoteAgeMs:Number.isFinite(s.quote.ts)?now-s.quote.ts:null,bookAgeMs:Number.isFinite(s.orderBook.ts)?now-s.orderBook.ts:null,frames,reasons};});
  }
  freshness(){const now=Date.now();let quoteFresh=0,orderBookFresh=0,klineFresh=0;const stale:string[]=[];const poolSymbols=new Set(this.state.pool.list().map(x=>x.symbol));let poolBooks=0;for(const s of this.state.snapshots.values()){const q=now-s.quote.ts<=15_000,b=now-s.orderBook.ts<=15_000,k=now-s.technical['1m'].asOf<=125_000&&now-s.technical['5m'].asOf<=605_000&&now-s.technical['15m'].asOf<=1_805_000;if(q)quoteFresh++;if(b)orderBookFresh++;if(k)klineFresh++;if(poolSymbols.has(s.symbol)&&b)poolBooks++;if(this.primaryReadyReasons(s.symbol,now).length)stale.push(s.symbol);}const total=this.state.snapshots.size;return{fresh:total-stale.length,total,quoteFresh,orderBookFresh,klineFresh,quoteFreshRatio:total?quoteFresh/total:0,klineFreshRatio:total?klineFresh/total:0,poolBookFreshRatio:poolSymbols.size?poolBooks/poolSymbols.size:1,stale};}
  async recoverStale(){const now=Date.now();const priority=new Set([...this.state.positionSymbols(),...this.state.activeEntrySymbols(),...[...this.state.candidateLifecycle??[]].filter(([,row]:any)=>['SCOUT_QUEUED','SCOUT_RUNNING','PRIMARY_QUEUED','PRIMARY_RUNNING','WAIT_FOR_PRICE','WAIT_EXECUTION_RANGE'].includes(row?.status)).map(([symbol])=>String(symbol).toUpperCase()),'BTCUSDT','ETHUSDT',...this.state.pool.list().map(x=>x.symbol)]);const stale=[...new Set([...this.freshness().stale,...[...priority].filter(symbol=>!this.state.snapshots.has(symbol))])].filter(symbol=>(this.recovery.get(symbol)?.nextRetryAt??0)<=now).sort((a,b)=>Number(priority.has(b))-Number(priority.has(a))||(this.recovery.get(a)?.lastSuccessAt??0)-(this.recovery.get(b)?.lastSuccessAt??0)).slice(0,4);if(!stale.length)return 0;const snapshots=await mapLimit(stale,2,async symbol=>{const epoch=this.epoch(symbol),prior=this.recovery.get(symbol)??{attempt:0,nextRetryAt:0,lastSuccessAt:null,reason:null};try{const snapshot=await this.loadSnapshot(symbol,epoch);this.recovery.set(symbol,{attempt:0,nextRetryAt:now+60_000,lastSuccessAt:Date.now(),reason:null});return {symbol,epoch,snapshot};}catch(error){const message=error instanceof Error?error.message:String(error),attempt=prior.attempt+1;const banned=Number(message.match(/banned until (\d+)/i)?.[1]??0);const delay=banned>Date.now()?banned-Date.now()+5_000:Math.min(priority.has(symbol)?30_000:15*60_000,5_000*2**Math.min(attempt-1,8));const nextRetryAt=Date.now()+delay;this.recovery.set(symbol,{attempt,nextRetryAt,lastSuccessAt:prior.lastSuccessAt,reason:message});this.events.publish('MARKET_RECOVERY_FAILED',{dataType:'QUOTE_KLINE',reason:message,httpStatus:Number(message.match(/HTTP (\d+)/)?.[1]??0)||null,attempt,lastSuccessAt:prior.lastSuccessAt,nextRetryAt},symbol);return null;}});let recovered=0;for(const result of snapshots)if(result&&this.canWrite(result.symbol,result.epoch)){this.state.snapshots.set(result.symbol,result.snapshot);this.rulesUpdatedAt.set(result.symbol,Date.now());recovered++;}this.events.publish('MARKET_FRESHNESS_RECOVERED',{requested:stale.length,recovered,pending:[...this.recovery.values()].filter(x=>x.nextRetryAt>Date.now()).length});return recovered;}
  stop(){this.provider.stop?.();}
}
