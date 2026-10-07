import {DatabaseSync,type StatementSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import type {RuntimeState} from '../state/runtimeState.js';
import type {DomainEvent,EventBus} from '../events/eventBus.js';
import {buildOpportunityEvidence,qualityPolicy} from './opportunityEvidence.js';
import {buildEpisodeEvidence} from './tradingEpisodeEvidence.js';
import {candidateFunnel,summarizeEntryQuality} from './tradingQualityBaseline.js';
import {collectorWindowSummary} from './s01TruthAccountingObservability.js';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows=(db:DatabaseSync,scope:string,kind:string):any[]=>db.prepare('SELECT payload FROM tq_facts WHERE scope=? AND kind=?').all(scope,kind).map(r=>JSON.parse(String(r.payload)));

/** Dedicated additive evidence DB. No writes to trading state or exchange. */
export class TradingQualityCollector {
  private db:DatabaseSync;
  private cache=new Map<string,string>();
  private prepared=new Map<string,StatementSync>();
  private prepare(sql:string){let statement=this.prepared.get(sql);if(!statement){statement=this.db.prepare(sql);this.prepared.set(sql,statement);}return statement;}
  private lastSample=0;
  private lastRetention=0;
  private lastCheckpoint=0;
  private workHydrated=false;
  private session=randomUUID();
  private observedEvents=0;
  private error:string|null=null;
  private listener:(e:DomainEvent)=>void;
  constructor(file:string,private state:RuntimeState,private events:EventBus){
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=1000; PRAGMA journal_size_limit=33554432; PRAGMA wal_autocheckpoint=1000;
      CREATE TABLE IF NOT EXISTS tq_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tq_facts(scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,ts INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,kind,id));
      CREATE INDEX IF NOT EXISTS tq_facts_time ON tq_facts(scope,kind,ts);
      CREATE INDEX IF NOT EXISTS tq_facts_intent ON tq_facts(scope,kind,json_extract(payload,'$.intentId'));
      CREATE INDEX IF NOT EXISTS tq_facts_fill_order ON tq_facts(scope,kind,json_extract(payload,'$.symbol'),json_extract(payload,'$.orderId'));
      CREATE INDEX IF NOT EXISTS tq_facts_trade_entry_intent ON tq_facts(scope,kind,json_extract(payload,'$.entryIntentId'));
      CREATE INDEX IF NOT EXISTS tq_facts_trade_entry_run ON tq_facts(scope,kind,json_extract(payload,'$.entryRunId'));
      CREATE TABLE IF NOT EXISTS tq_marks(scope TEXT NOT NULL,symbol TEXT NOT NULL,ts INTEGER NOT NULL,mark REAL NOT NULL,bid REAL,ask REAL,received_at INTEGER NOT NULL,PRIMARY KEY(scope,symbol,ts));
      CREATE TABLE IF NOT EXISTS tq_episodes(scope TEXT NOT NULL,intent_id TEXT NOT NULL,updated_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,intent_id));
      CREATE TABLE IF NOT EXISTS tq_episode_work(scope TEXT NOT NULL,intent_id TEXT NOT NULL,symbol TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,first_fill_at INTEGER,observation_until INTEGER,matured INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(scope,intent_id));
      CREATE TABLE IF NOT EXISTS tq_candidate_state(scope TEXT NOT NULL,candidate_id TEXT NOT NULL,fingerprint TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(scope,candidate_id));
      CREATE TABLE IF NOT EXISTS tq_collector_samples(scope TEXT NOT NULL,identity TEXT NOT NULL,at INTEGER NOT NULL,event_count INTEGER NOT NULL,PRIMARY KEY(scope,identity,at));
      CREATE TABLE IF NOT EXISTS tq_entry_mandates(scope TEXT NOT NULL,mandate_id TEXT NOT NULL,intent_id TEXT NOT NULL,plan_id TEXT,quote_asset TEXT NOT NULL,side TEXT NOT NULL,settings_version INTEGER NOT NULL,facts_hash TEXT NOT NULL,persisted_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,mandate_id));
      CREATE UNIQUE INDEX IF NOT EXISTS tq_entry_mandates_intent ON tq_entry_mandates(scope,intent_id);
      INSERT OR IGNORE INTO tq_migrations VALUES(1,${Date.now()});`);
    this.prepare('INSERT OR IGNORE INTO tq_migrations VALUES(2,?)').run(Date.now());
    (this.state as any).tradingQualityEvidenceReady=true;
    this.listener=e=>{try{this.onEvent(e);}catch(error){this.error=String(error);(this.state as any).tradingQualityEvidenceReady=false;if(qualityPolicy(this.state.settings).mode==='ENFORCE'&&['TRADING_QUALITY_OPPORTUNITY','TRADING_QUALITY_PRIMARY_LINK','ENTRY_SUBMIT_ATTEMPTED'].includes(e.type))throw error;}};
    events.on('event',this.listener);
  }
  private scope(){const x=this.state.settings.connections.exchange;return `${x.environment}:${hash(x.credentialRef).slice(0,16)}`;}
  private markEpisodeDirty(intentId:string|undefined,symbol=''){
    if(!intentId)return;
    this.prepare(`INSERT INTO tq_episode_work(scope,intent_id,symbol,dirty,first_fill_at,observation_until,matured,updated_at)
      VALUES(?,?,?,1,NULL,NULL,0,?) ON CONFLICT(scope,intent_id) DO UPDATE SET
      symbol=CASE WHEN excluded.symbol='' THEN tq_episode_work.symbol ELSE excluded.symbol END,dirty=1,updated_at=excluded.updated_at`).run(this.scope(),intentId,symbol,Date.now());
  }
  private exactEntryIntent(fill:any){
    if(fill?.attributionStatus!=='SYSTEM_ATTRIBUTED'||!fill.symbol||!fill.orderId||!['LONG','SHORT'].includes(fill.direction)||fill.side!==(fill.direction==='LONG'?'BUY':'SELL'))return null;
    const order=[...this.state.entryOrders.values()].find(row=>row.symbol===fill.symbol&&row.exchangeOrderId===fill.orderId);
    if(!order)return null;
    const intent=this.state.entryIntents.get(order.intentId);
    if(!intent?.brainRunId||intent.id!==order.intentId||intent.symbol!==fill.symbol||intent.side!==fill.direction)return null;
    return{intent,order};
  }
  private registerExactFill(fill:any,now=Date.now()){
    const linked=this.exactEntryIntent(fill);if(!linked||!Number.isFinite(fill.executionTime)||fill.executionTime>now)return;
    const horizon=qualityPolicy(this.state.settings).positionObservationHorizonMs,until=fill.executionTime+horizon;
    this.prepare(`INSERT INTO tq_episode_work(scope,intent_id,symbol,dirty,first_fill_at,observation_until,matured,updated_at)
      VALUES(?,?,?,1,?,?,?,?) ON CONFLICT(scope,intent_id) DO UPDATE SET symbol=excluded.symbol,
      first_fill_at=CASE WHEN tq_episode_work.first_fill_at IS NULL THEN excluded.first_fill_at ELSE MIN(tq_episode_work.first_fill_at,excluded.first_fill_at) END,
      observation_until=CASE WHEN tq_episode_work.first_fill_at IS NULL OR excluded.first_fill_at<tq_episode_work.first_fill_at THEN excluded.observation_until ELSE tq_episode_work.observation_until END,
      dirty=1,matured=excluded.matured,updated_at=excluded.updated_at`).run(this.scope(),linked.intent.id,linked.intent.symbol,fill.executionTime,until,now>=until?1:0,now);
  }
  private put(kind:string,id:string,value:unknown,ts=Date.now()){
    const scope=this.scope(),payload=JSON.stringify(value),key=`${scope}:${kind}:${id}`;
    // Session-qualified event IDs are unique. They must not evict the retained
    // entity cache, and require no read-before-write or duplicate payload copy.
    const cached=kind!=='events',fingerprint=cached?createHash('sha256').update(payload).digest('hex'):'';
    if(cached&&this.cache.get(key)===fingerprint)return;
    if(cached&&!this.cache.has(key)){
      const existing=this.prepare('SELECT payload FROM tq_facts WHERE scope=? AND kind=? AND id=?').get(scope,kind,id) as any;
      if(existing?.payload===payload){this.remember(key,fingerprint);return;}
    }
    const sql=kind==='opportunities'?'INSERT OR IGNORE INTO tq_facts VALUES(?,?,?,?,?)':'INSERT INTO tq_facts VALUES(?,?,?,?,?) ON CONFLICT(scope,kind,id) DO UPDATE SET ts=excluded.ts,payload=excluded.payload';
    this.prepare(sql).run(scope,kind,id,ts,payload);
    if(cached)this.remember(key,fingerprint);
    const row=value as any;
    if(kind==='intents')this.markEpisodeDirty(row?.id??id,row?.symbol??'');
    else if(kind==='orders')this.markEpisodeDirty(row?.intentId,row?.symbol??'');
    else if(kind==='fills')this.registerExactFill(row,Date.now());
    else if(kind==='trades')this.markEpisodeDirty(row?.entryIntentId,row?.symbol??'');
  }
  private remember(key:string,fingerprint:string){
    this.cache.delete(key);this.cache.set(key,fingerprint);
    if(this.cache.size>30000)this.cache.delete(this.cache.keys().next().value!);
  }
  private onEvent(e:DomainEvent){
    this.observedEvents++;
    const p=e.payload as any;
    if(e.type==='TRADING_QUALITY_FUNDING_FACT')this.put('fundingFacts',hash(p),p,e.ts);
    if(e.type==='ENTRY_INTENT_CREATED'){
      const intent=p?.intent,mandate=intent?.economicMandate;
      if(mandate?.schemaVersion==='V397-ENTRY-ECONOMIC-MANDATE-1'){
        this.prepare(`INSERT INTO tq_entry_mandates(scope,mandate_id,intent_id,plan_id,quote_asset,side,settings_version,facts_hash,persisted_at,payload)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,mandate_id) DO UPDATE SET payload=excluded.payload
          WHERE tq_entry_mandates.intent_id=excluded.intent_id AND tq_entry_mandates.facts_hash=excluded.facts_hash`).run(
          this.scope(),mandate.mandateId,intent.id,intent.planId??null,mandate.quoteAsset,mandate.side,mandate.settingsVersion,mandate.factsHash,e.ts,JSON.stringify(mandate));
      }
    }
    if(e.type==='TRADING_QUALITY_OPPORTUNITY'){this.put('opportunities',p.opportunity.opportunityId+':'+p.opportunity.version,p,e.ts);this.put('opportunityObservations',`${p.opportunity.opportunityId}:${p.packetId}`,p,e.ts);}
    if(e.type==='TRADING_QUALITY_PRIMARY_LINK')this.put('primaryLinks',p.runId,p,e.ts);
    if(e.type.startsWith('AI_RUN_')&&p?.id&&p.role==='PRIMARY_BRAIN')this.put('runs',p.id,{id:p.id,symbol:p.symbol,decision:p.decision,status:p.status,startedAt:p.startedAt,completedAt:p.completedAt,normalizedPreview:p.normalizedPreview},e.ts);
    if(e.type==='EXCHANGE_FILL_ATTRIBUTED'||e.type==='EXCHANGE_FILL_UNATTRIBUTED'){
      const f=p.fill;this.put('fills',`${f.symbol}:${f.tradeId}`,f,e.ts);this.registerExactFill(f,e.ts);
    }
    if(/^(ENTRY_|TRADING_QUALITY_|CANDIDATE_LIFECYCLE|TRADE_RECORD_|RECONCILIATION_COMPLETED)/.test(e.type)){
      this.put('events',`${this.session}:${e.id}`,e,e.ts);
      // Capture before runtime maps can advance/reprice/trim. Never infer a fill.
      this.captureState();
    }
  }
  private persistCandidateShadow(candidateId:string,candidate:any,lifecycle:any,opportunity:any,now:number){
    const scope=this.scope();
    const material={
      candidate:{symbol:candidate.symbol,selectionGeneration:candidate.selectionGeneration,rank:candidate.rank,score:candidate.score,
        lifecycle:candidate.lifecycle,eligible:candidate.eligible,exclusionReasons:candidate.exclusionReasons},
      lifecycle:lifecycle?{status:lifecycle.status??null,reason:lifecycle.reason??null,eligible:lifecycle.eligible??null,
        exclusionReasons:lifecycle.exclusionReasons??null}:null,
      opportunity:opportunity?{opportunityId:opportunity.opportunityId,version:opportunity.version,
        disposition:opportunity.disposition,blockers:opportunity.blockers}:null,
    };
    const fingerprint=hash(material);
    const current=()=>this.prepare('SELECT fingerprint,revision FROM tq_candidate_state WHERE scope=? AND candidate_id=?').get(scope,candidateId) as any;
    if(current()?.fingerprint===fingerprint)return;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=current();
      if(previous?.fingerprint===fingerprint){this.db.exec('COMMIT');return;}
      const revision=Number(previous?.revision??0)+1;
      const observation={candidateId,candidate,lifecycle,opportunity,stage:'CANDIDATE_SHADOW',revision,materialFingerprint:fingerprint,observedAt:now};
      const observationId=`CANDIDATE_SHADOW:${candidateId}:${revision}`;
      this.prepare('INSERT INTO tq_facts VALUES(?,?,?,?,?)').run(scope,'opportunityObservations',observationId,now,JSON.stringify(observation));
      this.prepare(`INSERT INTO tq_facts VALUES(?,?,?,?,?) ON CONFLICT(scope,kind,id) DO UPDATE SET ts=excluded.ts,payload=excluded.payload`)
        .run(scope,'candidates',candidateId,now,JSON.stringify({candidateId,candidate,lifecycle,opportunity,observedAt:now}));
      if(opportunity){
        const value={opportunity,candidateId,stage:'CANDIDATE_SHADOW'};
        this.prepare('INSERT OR IGNORE INTO tq_facts VALUES(?,?,?,?,?)').run(scope,'opportunities',`${opportunity.opportunityId}:${opportunity.version}`,now,JSON.stringify(value));
      }
      this.prepare(`INSERT INTO tq_candidate_state VALUES(?,?,?,?,?) ON CONFLICT(scope,candidate_id) DO UPDATE SET
        fingerprint=excluded.fingerprint,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(scope,candidateId,fingerprint,revision,now);
      this.db.exec('COMMIT');
      this.cache.delete(`${scope}:candidates:${candidateId}`);
    }catch(error){
      try{this.db.exec('ROLLBACK');}catch{}
      throw error;
    }
  }
  private captureState(){
    for(const i of this.state.entryIntents.values())this.put('intents',i.id,i,i.createdAt);
    for(const o of this.state.entryOrders.values())this.put('orders',`${o.id}:${o.exchangeOrderId??'UNSUBMITTED'}`,o,o.updatedAt);
    for(const f of this.state.executionFills)this.put('fills',`${f.symbol}:${f.tradeId}`,f,f.executionTime);
    for(const t of this.state.tradeRecords.values())this.put('trades',t.tradeId,t,t.updatedAt);
    for(const l of this.state.lifecycles.values())this.put('cycles',l.cycleId,l);
    for(const p of this.state.positions.values())this.put('positions',p.id,p);
    for(const r of this.state.entryReservations.values())this.put('reservations',r.id,r);
  }
  tick(now=Date.now()){
    try{
      this.captureState();
      const p=qualityPolicy(this.state.settings);
      this.hydrateEpisodeWork(now,p.positionObservationHorizonMs);
      const scope=this.scope();
      this.prepare('UPDATE tq_episode_work SET dirty=1,matured=1,updated_at=? WHERE scope=? AND matured=0 AND observation_until IS NOT NULL AND observation_until<=?').run(now,scope,now);
      const windows=this.prepare('SELECT intent_id,symbol,first_fill_at,observation_until FROM tq_episode_work WHERE scope=? AND matured=0 AND first_fill_at IS NOT NULL AND observation_until>?').all(scope,now) as any[];
      // Quote timestamps, not poll timestamps: cached quotes cannot fill path gaps. Only exact,
      // attributed episodes inside their observation window authorize raw path storage.
      const activeBySymbol=new Map<string,any[]>();for(const w of windows){const list=activeBySymbol.get(w.symbol)??[];list.push(w);activeBySymbol.set(w.symbol,list);}
      for(const [symbol,active] of activeBySymbol){
        const m=this.state.snapshots.get(symbol),q=m?.quote;if(!q||q.ts>now||now-q.ts>5000||!Number.isFinite(q.mark)||q.mark<=0)continue;
        const eligible=active.filter(w=>q.ts>=w.first_fill_at&&q.ts<=w.observation_until);if(!eligible.length)continue;
        const result=this.prepare('INSERT OR IGNORE INTO tq_marks VALUES(?,?,?,?,?,?,?)').run(scope,symbol,q.ts,q.mark,q.bid,q.ask,now);
        if(Number(result.changes)>0)for(const w of eligible)this.prepare('UPDATE tq_episode_work SET dirty=1,updated_at=? WHERE scope=? AND intent_id=?').run(now,scope,w.intent_id);
      }
      if(now-this.lastSample>=5000){
        this.lastSample=now;
        const scope=this.scope(),eventCount=this.observedEvents;
        this.prepare('INSERT OR IGNORE INTO tq_collector_samples(scope,identity,at,event_count) VALUES(?,?,?,?)').run(scope,this.session,now,eventCount);
        this.prepare('DELETE FROM tq_collector_samples WHERE at<?').run(now-7*86_400_000);
        for(const c of this.state.universe){
          const m=this.state.snapshots.get(c.symbol),opportunity=m&&p.mode!=='OFF'?buildOpportunityEvidence(m,this.state.settings,now):null;
          const candidateId=`${c.symbol}:${c.selectionGeneration}`,lifecycle=this.state.candidateLifecycle.get(c.symbol)??null;
          this.persistCandidateShadow(candidateId,c,lifecycle,opportunity,now);
        }
        this.materialize(now);
      }
      if(now-this.lastRetention>=60_000){
        this.lastRetention=now;
        const day=86_400_000,batch=2000;
        this.prepare('DELETE FROM tq_marks WHERE rowid IN (SELECT rowid FROM tq_marks WHERE ts<? LIMIT ?)').run(now-2*day,batch);
        this.prepare("DELETE FROM tq_facts WHERE rowid IN (SELECT rowid FROM tq_facts WHERE kind='opportunityObservations' AND ts<? LIMIT ?)").run(now-7*day,batch);
        this.prepare("DELETE FROM tq_facts WHERE rowid IN (SELECT rowid FROM tq_facts WHERE kind='events' AND ts<? LIMIT ?)").run(now-14*day,batch);
        this.prepare('DELETE FROM tq_candidate_state WHERE rowid IN (SELECT rowid FROM tq_candidate_state WHERE updated_at<? LIMIT ?)').run(now-7*day,batch);
      }
      if(now-this.lastCheckpoint>=5*60_000){this.lastCheckpoint=now;try{this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');}catch{}}
      this.error=null;(this.state as any).tradingQualityEvidenceReady=true;
    }catch(error){this.error=String(error);(this.state as any).tradingQualityEvidenceReady=false;}
  }
  private hydrateEpisodeWork(now:number,horizon:number){
    if(this.workHydrated)return;
    const scope=this.scope(),seen=new Set<string>(),recent=this.prepare(`SELECT payload FROM tq_facts WHERE scope=? AND kind='fills' AND ts>=? AND ts<=?`).all(scope,now-horizon-60_000,now) as any[];
    const candidates=new Map<string,any>();
    for(const row of recent){try{const f=JSON.parse(String(row.payload));if(f.attributionStatus==='SYSTEM_ATTRIBUTED')candidates.set(f.fillId??`${f.symbol}:${f.tradeId}`,f);}catch{}}
    for(const f of this.state.executionFills)if(f.attributionStatus==='SYSTEM_ATTRIBUTED')candidates.set(f.fillId??`${f.symbol}:${f.tradeId}`,f);
    const firstFills=new Map<string,{fill:any;intent:any}>();
    for(const f of candidates.values()){
      const linked=this.exactEntryIntent(f);if(!linked)continue;
      const previous=firstFills.get(linked.intent.id);if(!previous||f.executionTime<previous.fill.executionTime)firstFills.set(linked.intent.id,{fill:f,intent:linked.intent});
    }
    for(const [intentId,{fill,intent}] of firstFills){
      if(seen.has(intentId))continue;seen.add(intentId);
      const projected=this.prepare('SELECT 1 AS ok FROM tq_episodes WHERE scope=? AND intent_id=?').get(scope,intentId) as any;
      const existing=this.prepare('SELECT first_fill_at FROM tq_episode_work WHERE scope=? AND intent_id=?').get(scope,intentId) as any;
      if(!projected||now<Number(existing?.first_fill_at??fill.executionTime)+horizon)this.registerExactFill(fill,now);
    }
    // Upgrade/restart repair is one-time: only intents missing their durable projection are added.
    for(const intent of this.state.entryIntents.values())if(intent.brainRunId&&!this.prepare('SELECT 1 AS ok FROM tq_episodes WHERE scope=? AND intent_id=?').get(scope,intent.id))this.markEpisodeDirty(intent.id,intent.symbol);
    this.workHydrated=true;
  }
  private materialize(now:number){
    const scope=this.scope(),p=qualityPolicy(this.state.settings),pending=this.prepare('SELECT intent_id,symbol,first_fill_at,observation_until FROM tq_episode_work WHERE scope=? AND dirty=1 ORDER BY updated_at,intent_id LIMIT 500').all(scope) as any[];
    for(const work of pending){
      const intentRow=this.prepare("SELECT payload FROM tq_facts WHERE scope=? AND kind='intents' AND id=?").get(scope,work.intent_id) as any;if(!intentRow)continue;
      const intent=JSON.parse(String(intentRow.payload));
      if(!intent.brainRunId)continue;
      let orders=this.prepare("SELECT payload FROM tq_facts WHERE scope=? AND kind='orders' AND json_extract(payload,'$.intentId')=?").all(scope,intent.id).map((r:any)=>JSON.parse(String(r.payload))) as any[];
      // Retain unknown unsent facts, while omitting duplicate pre-submit snapshots once an
      // exchange identity exists.
      const submittedIds=new Set(orders.filter(o=>o.exchangeOrderId).map(o=>o.id));orders=orders.filter(o=>o.exchangeOrderId||!submittedIds.has(o.id));
      const exchangeIds=[...new Set(orders.map(o=>o.exchangeOrderId).filter(Boolean))] as string[];
      const fills=exchangeIds.length?this.prepare(`SELECT payload FROM tq_facts WHERE scope=? AND kind='fills' AND json_extract(payload,'$.symbol')=? AND json_extract(payload,'$.orderId') IN (${exchangeIds.map(()=>'?').join(',')})`).all(scope,intent.symbol,...exchangeIds).map((r:any)=>JSON.parse(String(r.payload))) as any[]:[];
      const fillIds=[...new Set(fills.map(f=>f.fillId).filter(Boolean))] as string[],orderIds=[...new Set(orders.flatMap(o=>[o.id,o.exchangeOrderId].filter(Boolean)))] as string[];
      const clauses=["json_extract(payload,'$.entryIntentId')=?","json_extract(payload,'$.entryRunId')=?"],tradeArgs:any[]=[scope,intent.id,intent.brainRunId];
      if(fillIds.length){clauses.push(`EXISTS(SELECT 1 FROM json_each(tq_facts.payload,'$.linkedFillIds') f WHERE f.value IN (${fillIds.map(()=>'?').join(',')}))`);tradeArgs.push(...fillIds);}
      if(orderIds.length){clauses.push(`EXISTS(SELECT 1 FROM json_each(tq_facts.payload,'$.entryOrderIds') o WHERE o.value IN (${orderIds.map(()=>'?').join(',')}))`);tradeArgs.push(...orderIds);}
      const trades=this.prepare(`SELECT payload FROM tq_facts WHERE scope=? AND kind='trades' AND (${clauses.join(' OR ')})`).all(...tradeArgs).map((r:any)=>JSON.parse(String(r.payload))) as any[];
      const input={run:{id:intent.brainRunId,symbol:intent.symbol},intent,orders,fills,tradeRecords:trades,now,
        adverseBoundaryBps:p.adverseBoundaryBps,favorableBoundaryBps:p.favorableBoundaryBps};
      const first=buildEpisodeEvidence(input);
      if(first.completeFillAt!==null){const fullUntil=first.completeFillAt+p.positionObservationHorizonMs;if(fullUntil>Number(work.observation_until??0)){work.observation_until=fullUntil;this.prepare('UPDATE tq_episode_work SET observation_until=?,matured=? WHERE scope=? AND intent_id=?').run(fullUntil,now>=fullUntil?1:0,scope,intent.id);}}
      const until=Number(work.observation_until??(first.firstFillAt===null?0:first.firstFillAt+p.positionObservationHorizonMs));
      const marks=first.firstFillAt===null?[]:this.prepare('SELECT ts,mark,bid,ask FROM tq_marks WHERE scope=? AND symbol=? AND ts>=? AND ts<=? ORDER BY ts').all(scope,intent.symbol,first.firstFillAt,Math.min(now,until)) as any[];
      const ep=buildEpisodeEvidence({...input,marks});
      this.prepare('INSERT INTO tq_episodes VALUES(?,?,?,?) ON CONFLICT(scope,intent_id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload').run(scope,intent.id,now,JSON.stringify(ep));
      this.prepare('UPDATE tq_episode_work SET dirty=0,updated_at=? WHERE scope=? AND intent_id=?').run(now,scope,intent.id);
    }
  }
  health(){return{status:this.error?'DEGRADED':'READY',error:this.error,scope:this.scope(),lastSampleAt:this.lastSample};}
  /** HTTP-safe operational summary. The full report intentionally remains an offline/internal
   * diagnostic because materialising every evidence payload on the Engine thread can be expensive. */
  summary(){
    const scope=this.scope(),scalar=(sql:string,...args:any[])=>Number((this.prepare(sql).get(...args) as any)?.count??0);
    const factRows=this.prepare('SELECT kind,COUNT(*) AS count FROM tq_facts WHERE scope=? GROUP BY kind ORDER BY kind').all(scope) as any[];
    return{schemaVersion:'TQ-HTTP-SUMMARY-1',scope,generatedAt:Date.now(),status:this.error?'DEGRADED':'READY',error:this.error,lastSampleAt:this.lastSample,
      counts:{episodes:scalar('SELECT COUNT(*) AS count FROM tq_episodes WHERE scope=?',scope),
        episodeWork:scalar('SELECT COUNT(*) AS count FROM tq_episode_work WHERE scope=?',scope),
        dirtyEpisodeWork:scalar('SELECT COUNT(*) AS count FROM tq_episode_work WHERE scope=? AND dirty=1',scope),
        marks:scalar('SELECT COUNT(*) AS count FROM tq_marks WHERE scope=?',scope),
        collectorSamples:scalar('SELECT COUNT(*) AS count FROM tq_collector_samples WHERE scope=?',scope)},
      factsByKind:Object.fromEntries(factRows.map(row=>[String(row.kind),Number(row.count??0)])),
      fullReportAvailableOffline:true,authorization:'NONE' as const};
  }
  report(){return tradingQualityReport(this.db,this.scope());}
  close(){this.events.off('event',this.listener);try{this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}this.db.close();}
}

export function tradingQualityReport(db:DatabaseSync,scope:string){
  const episodes=db.prepare('SELECT payload FROM tq_episodes WHERE scope=?').all(scope).map(r=>JSON.parse(String(r.payload)));
  const candidates=rows(db,scope,'candidates'),opportunities=rows(db,scope,'opportunities'),runs=rows(db,scope,'runs'),links=rows(db,scope,'primaryLinks');
  const uniqueRuns=[...new Map([...runs,...links.map(l=>({id:l.runId,...l.decision,opportunity:l.opportunity}))].map(r=>[r.id,r])).values()];
  const orders=rows(db,scope,'orders').filter(o=>o.exchangeOrderId),fills=rows(db,scope,'fills'),intents=rows(db,scope,'intents');
  const quality=summarizeEntryQuality(episodes);
  const complete=Object.values(quality.byHorizon).some(h=>h.coverage.complete>0);
  const hasSamples=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tq_collector_samples'").get());
  const samples=hasSamples?db.prepare('SELECT identity,at,event_count AS count FROM tq_collector_samples WHERE scope=? ORDER BY at').all(scope) as any[]:[];
  return {schemaVersion:'TQ-BASELINE-2',scope,generatedAt:Date.now(),quality,episodes,collectorMetric:'OBSERVED_DOMAIN_EVENTS_NOT_EXCHANGE_REQUESTS',collectorWindow:collectorWindowSummary(samples.map(row=>({identity:String(row.identity),at:Number(row.at),count:Number(row.count)})),`collector:${scope}`),
    funnel:candidateFunnel({candidates:candidates.length,primaryRuns:uniqueRuns.length,place:uniqueRuns.filter(r=>String(r.decision).startsWith('PLACE_')).length,
      wait:uniqueRuns.filter(r=>r.decision==='WAIT_FOR_PRICE').length,reselect:uniqueRuns.filter(r=>r.decision==='RESELECT_SYMBOL').length,intents:intents.length,
      orders:new Set(orders.map(o=>o.id)).size,fills:new Set(fills.filter(f=>f.attributionStatus==='SYSTEM_ATTRIBUTED'&&orders.some(o=>o.symbol===f.symbol&&o.exchangeOrderId===f.orderId)).map(f=>`${f.symbol}:${f.orderId}`)).size,
      uniqueOpportunities:new Set(opportunities.map(o=>o.opportunity.opportunityId)).size,uniqueSymbols:new Set(candidates.map(c=>c.candidate.symbol)).size}),
    opportunityDispositions:opportunities.reduce((a,o)=>(a[o.opportunity.disposition]=(a[o.opportunity.disposition]??0)+1,a),{} as Record<string,number>),
    unassignedFills:fills.filter(f=>!orders.some(o=>o.symbol===f.symbol&&o.exchangeOrderId===f.orderId)).length,
    gate:{status:complete&&candidates.length&&episodes.some(e=>e.linkStatus==='LINKED')?'BASELINE_READY':'INCONCLUSIVE',profitability:'NOT_EVALUATED',historicalBackfill:'NO_SYNTHETIC_HISTORY'},
    facts:{candidates,opportunities,primaryLinks:links,fundingFacts:rows(db,scope,'fundingFacts'),fundingAllocation:'UNKNOWN_UNLESS_EXACT_RECORD_FACT'},
  };
}
