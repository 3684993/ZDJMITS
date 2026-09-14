import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import type {RuntimeState} from '../state/runtimeState.js';
import type {DomainEvent,EventBus} from '../events/eventBus.js';
import {buildOpportunityEvidence,qualityPolicy} from './opportunityEvidence.js';
import {buildEpisodeEvidence} from './tradingEpisodeEvidence.js';
import {candidateFunnel,summarizeEntryQuality} from './tradingQualityBaseline.js';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows=(db:DatabaseSync,scope:string,kind:string):any[]=>db.prepare('SELECT payload FROM tq_facts WHERE scope=? AND kind=?').all(scope,kind).map(r=>JSON.parse(String(r.payload)));

/** Dedicated additive evidence DB. No writes to trading state or exchange. */
export class TradingQualityCollector {
  private db:DatabaseSync;
  private cache=new Map<string,string>();
  private lastSample=0;
  private dirty=true;
  private session=randomUUID();
  private error:string|null=null;
  private listener:(e:DomainEvent)=>void;
  constructor(file:string,private state:RuntimeState,private events:EventBus){
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS tq_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tq_facts(scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,ts INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,kind,id));
      CREATE INDEX IF NOT EXISTS tq_facts_time ON tq_facts(scope,kind,ts);
      CREATE TABLE IF NOT EXISTS tq_marks(scope TEXT NOT NULL,symbol TEXT NOT NULL,ts INTEGER NOT NULL,mark REAL NOT NULL,bid REAL,ask REAL,received_at INTEGER NOT NULL,PRIMARY KEY(scope,symbol,ts));
      CREATE TABLE IF NOT EXISTS tq_episodes(scope TEXT NOT NULL,intent_id TEXT NOT NULL,updated_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,intent_id));
      INSERT OR IGNORE INTO tq_migrations VALUES(1,${Date.now()});`);
    (this.state as any).tradingQualityEvidenceReady=true;
    this.listener=e=>{try{this.onEvent(e);}catch(error){this.error=String(error);(this.state as any).tradingQualityEvidenceReady=false;if(qualityPolicy(this.state.settings).mode==='ENFORCE'&&['TRADING_QUALITY_OPPORTUNITY','TRADING_QUALITY_PRIMARY_LINK','ENTRY_SUBMIT_ATTEMPTED'].includes(e.type))throw error;}};
    events.on('event',this.listener);
  }
  private scope(){const x=this.state.settings.connections.exchange;return `${x.environment}:${hash(x.credentialRef).slice(0,16)}`;}
  private put(kind:string,id:string,value:unknown,ts=Date.now()){
    const scope=this.scope(),payload=JSON.stringify(value),key=`${scope}:${kind}:${id}`;
    if(this.cache.get(key)===payload)return;
    const sql=kind==='opportunities'?'INSERT OR IGNORE INTO tq_facts VALUES(?,?,?,?,?)':'INSERT INTO tq_facts VALUES(?,?,?,?,?) ON CONFLICT(scope,kind,id) DO UPDATE SET ts=excluded.ts,payload=excluded.payload';
    this.db.prepare(sql).run(scope,kind,id,ts,payload);
    this.cache.set(key,payload);if(this.cache.size>30000)this.cache.clear();
  }
  private onEvent(e:DomainEvent){
    const p=e.payload as any;
    if(e.type==='TRADING_QUALITY_FUNDING_FACT')this.put('fundingFacts',hash(p),p,e.ts);
    if(e.type==='TRADING_QUALITY_OPPORTUNITY'){this.put('opportunities',p.opportunity.opportunityId+':'+p.opportunity.version,p,e.ts);this.put('opportunityObservations',`${p.opportunity.opportunityId}:${p.packetId}`,p,e.ts);}
    if(e.type==='TRADING_QUALITY_PRIMARY_LINK')this.put('primaryLinks',p.runId,p,e.ts);
    if(e.type.startsWith('AI_RUN_')&&p?.id&&p.role==='PRIMARY_BRAIN')this.put('runs',p.id,{id:p.id,symbol:p.symbol,decision:p.decision,status:p.status,startedAt:p.startedAt,completedAt:p.completedAt,normalizedPreview:p.normalizedPreview},e.ts);
    if(e.type==='EXCHANGE_FILL_ATTRIBUTED'||e.type==='EXCHANGE_FILL_UNATTRIBUTED'){
      const f=p.fill;this.put('fills',`${f.symbol}:${f.tradeId}`,f,e.ts);this.dirty=true;
    }
    if(/^(ENTRY_|TRADING_QUALITY_|CANDIDATE_LIFECYCLE|TRADE_RECORD_|RECONCILIATION_COMPLETED)/.test(e.type)){
      this.put('events',`${this.session}:${e.id}`,e,e.ts);this.dirty=true;
      // Capture before runtime maps can advance/reprice/trim. Never infer a fill.
      this.captureState();
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
      // Quote timestamps, not poll timestamps: a cached quote cannot fill a path gap.
      for(const m of this.state.snapshots.values()){
        const q=m.quote;if(q.ts>now||now-q.ts>5000||!Number.isFinite(q.mark)||q.mark<=0)continue;
        this.db.prepare('INSERT OR IGNORE INTO tq_marks VALUES(?,?,?,?,?,?,?)').run(this.scope(),m.symbol,q.ts,q.mark,q.bid,q.ask,now);
      }
      if(now-this.lastSample>=5000){
        this.lastSample=now;
        for(const c of this.state.universe){
          const m=this.state.snapshots.get(c.symbol),opportunity=m&&p.mode!=='OFF'?buildOpportunityEvidence(m,this.state.settings,now):null;
          const candidateId=`${c.symbol}:${c.selectionGeneration}`,row={candidateId,candidate:c,lifecycle:this.state.candidateLifecycle.get(c.symbol)??null,opportunity,observedAt:now};
          this.put('candidates',candidateId,row,now);
          if(opportunity){this.put('opportunities',`${opportunity.opportunityId}:${opportunity.version}`,{opportunity,candidateId,stage:'CANDIDATE_SHADOW'},now);this.put('opportunityObservations',`${opportunity.opportunityId}:${now}`,{opportunity,candidateId,stage:'CANDIDATE_SHADOW'},now);}
        }
        this.materialize(now);
      }
      this.error=null;(this.state as any).tradingQualityEvidenceReady=true;
    }catch(error){this.error=String(error);(this.state as any).tradingQualityEvidenceReady=false;}
  }
  private materialize(now:number){
    const scope=this.scope(),intents=rows(this.db,scope,'intents'),orders=rows(this.db,scope,'orders').filter(o=>o.exchangeOrderId),fills=rows(this.db,scope,'fills'),trades=rows(this.db,scope,'trades');
    // Unknown unsent orders remain visible too; drop only the duplicate pre-submit snapshot.
    orders.push(...rows(this.db,scope,'orders').filter(o=>!o.exchangeOrderId&&!orders.some(x=>x.id===o.id)));
    const p=qualityPolicy(this.state.settings);
    for(const intent of intents){
      if(!intent.brainRunId)continue;
      const input={run:{id:intent.brainRunId,symbol:intent.symbol},intent,orders,fills,tradeRecords:trades,now,
        adverseBoundaryBps:p.adverseBoundaryBps,favorableBoundaryBps:p.favorableBoundaryBps};
      const first=buildEpisodeEvidence(input);
      if(!this.dirty&&first.firstFillAt!==null&&now-first.firstFillAt>920000)continue;
      const marks=first.firstFillAt===null?[]:this.db.prepare('SELECT ts,mark,bid,ask FROM tq_marks WHERE scope=? AND symbol=? AND ts>=? AND ts<=? ORDER BY ts').all(scope,intent.symbol,first.firstFillAt,first.firstFillAt+900000) as any[];
      const ep=buildEpisodeEvidence({...input,marks});
      this.db.prepare('INSERT INTO tq_episodes VALUES(?,?,?,?) ON CONFLICT(scope,intent_id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload').run(scope,intent.id,now,JSON.stringify(ep));
    }
    this.dirty=false;
  }
  health(){return{status:this.error?'DEGRADED':'READY',error:this.error,scope:this.scope(),lastSampleAt:this.lastSample};}
  report(){return tradingQualityReport(this.db,this.scope());}
  close(){this.events.off('event',this.listener);this.db.close();}
}

export function tradingQualityReport(db:DatabaseSync,scope:string){
  const episodes=db.prepare('SELECT payload FROM tq_episodes WHERE scope=?').all(scope).map(r=>JSON.parse(String(r.payload)));
  const candidates=rows(db,scope,'candidates'),opportunities=rows(db,scope,'opportunities'),runs=rows(db,scope,'runs'),links=rows(db,scope,'primaryLinks');
  const uniqueRuns=[...new Map([...runs,...links.map(l=>({id:l.runId,...l.decision,opportunity:l.opportunity}))].map(r=>[r.id,r])).values()];
  const orders=rows(db,scope,'orders').filter(o=>o.exchangeOrderId),fills=rows(db,scope,'fills'),intents=rows(db,scope,'intents');
  const quality=summarizeEntryQuality(episodes);
  const complete=Object.values(quality.byHorizon).some(h=>h.coverage.complete>0);
  return {schemaVersion:'TQ-BASELINE-2',scope,generatedAt:Date.now(),quality,episodes,
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
