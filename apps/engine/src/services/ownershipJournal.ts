import {DatabaseSync} from 'node:sqlite';
import {allocateSharedQuantity,transitionOwner,type Ownership,type OwnerState,type QuantityClaim} from './v396OfflineStages.js';

/** The ledger layout this build understands, and the oldest layout it will still open. */
export const OWNERSHIP_SCHEMA_VERSION=1;
export const MIN_SUPPORTED_OWNERSHIP_SCHEMA=1;
const OWNERSHIP_TABLES=['v396_owners','v396_outbox','v396_quantity_claims','v396_mandates','v396_claims_history'];

/** Durable offline foundation. No adapter, network or Engine lifecycle capabilities.
 * A caller must explicitly supply an isolated/migrated database; no default live path.
 * Runtime activation remains blocked until every write path uses the same journal.
 */
export class OwnershipJournal {
  private db:DatabaseSync;
  private readonly observedSchemaVersion:number;
  constructor(private readonly file:string){
    this.db=new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=3000;');
    // Read the stamp before any DDL. An older writer opening a newer ledger must refuse outright:
    // running its own CREATE TABLE IF NOT EXISTS would half-upgrade a schema it cannot read, and the
    // damage would only surface as wrong ownership truth later.
    const stamped=Number(this.db.prepare('PRAGMA user_version').get()?.user_version??0);
    this.observedSchemaVersion=stamped||OWNERSHIP_SCHEMA_VERSION;
    if(stamped>OWNERSHIP_SCHEMA_VERSION)throw new Error(`OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME:file=${stamped},runtime=${OWNERSHIP_SCHEMA_VERSION}`);
    if(stamped&&stamped<MIN_SUPPORTED_OWNERSHIP_SCHEMA)throw new Error(`OWNERSHIP_SCHEMA_UNSUPPORTED:file=${stamped},min=${MIN_SUPPORTED_OWNERSHIP_SCHEMA}`);
    if(stamped&&!this.expectedTablesPresent())throw new Error(`OWNERSHIP_SCHEMA_TABLES_MISSING:version=${stamped}`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS v396_owners(scope TEXT NOT NULL,cycle_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,cycle_id));
      CREATE TABLE IF NOT EXISTS v396_outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS v396_quantity_claims(id TEXT PRIMARY KEY,scope TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS v396_claim_scope ON v396_quantity_claims(scope);
      CREATE TABLE IF NOT EXISTS v396_mandates(scope TEXT NOT NULL,cycle_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,cycle_id));
      CREATE TABLE IF NOT EXISTS v396_claims_history(id TEXT PRIMARY KEY,payload TEXT NOT NULL,settled_at INTEGER NOT NULL);`);
    if(!stamped)this.db.exec(`PRAGMA user_version=${OWNERSHIP_SCHEMA_VERSION}`);
  }
  private expectedTablesPresent(){
    const present=new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
    return OWNERSHIP_TABLES.every(table=>present.has(table));
  }
  schemaInfo(){return{schemaVersion:this.observedSchemaVersion,runtimeSchemaVersion:OWNERSHIP_SCHEMA_VERSION,minSupported:MIN_SUPPORTED_OWNERSHIP_SCHEMA,tables:OWNERSHIP_TABLES};}
  /** Exposed for the S02 service layer so a fact and its outbox row always commit together. */
  transact<T>(fn:()=>T):T{return this.transaction(fn);}
  query<T>(sql:string,...params:unknown[]):T[]{return this.db.prepare(sql).all(...(params as never[])) as T[];}
  write(sql:string,...params:unknown[]){this.db.prepare(sql).run(...(params as never[]));}
  /** Online backup into a caller-chosen file; the destination must not be the live path. */
  async backupTo(targetFile:string){
    if(targetFile===this.file)throw new Error('BACKUP_TARGET_IS_LIVE_FILE');
    const {backup}=await import('node:sqlite');
    await backup(this.db,targetFile);
    return targetFile;
  }
  private transaction<T>(fn:()=>T):T{
    this.db.exec('BEGIN IMMEDIATE');
    try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  get(scope:string,cycleId:string):Ownership|null{
    const row=this.db.prepare('SELECT payload FROM v396_owners WHERE scope=? AND cycle_id=?').get(scope,cycleId);
    return row?JSON.parse(String(row.payload)) as Ownership:null;
  }
  private save(owner:Ownership){
    this.db.prepare('INSERT INTO v396_owners VALUES(?,?,?,?) ON CONFLICT(scope,cycle_id) DO UPDATE SET version=excluded.version,payload=excluded.payload').run(owner.scope,owner.cycleId,owner.ownerVersion,JSON.stringify(owner));
    // Owner and protection-mandate versions share scope/cycle/version numbers. Keep their
    // outbox namespaces disjoint so an expiry cannot collide with a Guardian mandate event.
    const id=`OWNERSHIP_CHANGED:${JSON.stringify([owner.scope,owner.cycleId,owner.ownerVersion])}`;
    this.db.prepare('INSERT INTO v396_outbox(id,payload) VALUES(?,?)').run(id,JSON.stringify({id,type:'OWNERSHIP_CHANGED',owner}));
  }
  initialize(input:{scope:string;cycleId:string;planRef:string|null;firstFillAt:number;durationMs:number|null;now:number;legacy:boolean}):Ownership{
    return this.transaction(()=>{
      if(!input.scope||!input.cycleId||!Number.isFinite(input.now)||!Number.isFinite(input.firstFillAt)||input.firstFillAt>input.now)throw new Error('INVALID_OWNER_IDENTITY');
      const existing=this.get(input.scope,input.cycleId);
      if(existing)return existing; // Later fills or recovery cannot extend the original deadline.
      const deadline=input.durationMs!=null&&Number.isSafeInteger(input.durationMs)&&input.durationMs>0?input.firstFillAt+input.durationMs:null;
      const active=!input.legacy&&Boolean(input.planRef)&&deadline!=null&&Number.isSafeInteger(deadline)&&deadline>input.now;
      const owner:Ownership={scope:input.scope,cycleId:input.cycleId,ownerState:active?'AI_ACTIVE':'HANDOFF_PENDING',ownerVersion:1,planRef:input.planRef,deadline,transitionedAt:input.now,reason:active?'FIRST_FILL_PLAN':'LEGACY_OR_INVALID_PLAN',acknowledgedAt:null};
      this.save(owner);return owner;
    });
  }
  transition(scope:string,cycleId:string,expectedVersion:number,next:OwnerState,now:number,reason:string):Ownership{
    return this.transaction(()=>{
      const current=this.get(scope,cycleId);if(!current)throw new Error('OWNER_NOT_FOUND');
      if(!Number.isFinite(now)||now<current.transitionedAt||!reason)throw new Error('INVALID_TRANSITION_CLOCK');
      // The named policy refusals come first: a rejected revival must say it needs a new
      // human authorization, and a closed cycle must say it is immutable.
      if(current.ownerState==='CLOSED'&&next!=='CLOSED')throw new Error('CLOSED_OWNER_IMMUTABLE');
      if(current.ownerState==='HUMAN_MANAGED'&&next==='AI_ACTIVE')throw new Error('HUMAN_REAUTHORIZATION_REQUIRED');
      const allowed:Record<OwnerState,OwnerState[]>={AI_ACTIVE:['HANDOFF_PENDING','CLOSED'],HANDOFF_PENDING:['HUMAN_MANAGED','CLOSED'],HUMAN_MANAGED:['CLOSED'],CLOSED:[]};
      if(!allowed[current.ownerState].includes(next))throw new Error('INVALID_OWNER_TRANSITION');
      const owner=transitionOwner(current,next,expectedVersion,now,reason);this.save(owner);return owner;
    });
  }
  expire(now:number):number{
    if(!Number.isFinite(now))throw new Error('INVALID_CLOCK');
    return this.transaction(()=>{
      let count=0;
      for(const row of this.db.prepare('SELECT payload FROM v396_owners').all()){
        const current=JSON.parse(String(row.payload)) as Ownership;
        if(current.ownerState==='AI_ACTIVE'&&(current.deadline==null||now>=current.deadline)){
          if(now<current.transitionedAt)throw new Error('CLOCK_ROLLBACK');
          this.save(transitionOwner(current,'HANDOFF_PENDING',current.ownerVersion,now,'AI_MANAGEMENT_EXPIRED'));count++;
        }
      }
      return count;
    });
  }
  reserve(claim:QuantityClaim,available:number,expectedOwnerVersion:number,now:number):QuantityClaim{
    return this.transaction(()=>{
      if(!claim.scope||!claim.cycleId||!claim.claimId||claim.status!=='ACTIVE'||claim.version!==1||!['AI','MANUAL','TP'].includes(claim.source))throw new Error('INVALID_CLAIM');
      const existing=this.db.prepare('SELECT payload FROM v396_quantity_claims WHERE id=?').get(claim.claimId);
      if(existing){const prior=JSON.parse(String(existing.payload)) as QuantityClaim;if(prior.scope!==claim.scope||prior.cycleId!==claim.cycleId||prior.source!==claim.source||prior.quantityUnits!==claim.quantityUnits)throw new Error('IDEMPOTENCY_CONFLICT');return prior;}
      const owner=this.get(claim.scope,claim.cycleId);
      if(!owner||owner.ownerVersion!==expectedOwnerVersion||owner.ownerState==='CLOSED'||!Number.isFinite(now)||now<owner.transitionedAt)throw new Error('OWNER_VERSION_CONFLICT');
      if(claim.source==='AI'&&(owner.ownerState!=='AI_ACTIVE'||owner.deadline==null||now>=owner.deadline))throw new Error('AI_AUTHORITY_REVOKED');
      if(claim.source==='MANUAL'&&owner.ownerState==='AI_ACTIVE')throw new Error('REVOKE_AI_BEFORE_MANUAL');
      const claims=this.db.prepare('SELECT payload FROM v396_quantity_claims WHERE scope=?').all(claim.scope).map(r=>JSON.parse(String(r.payload)) as QuantityClaim);
      if(!allocateSharedQuantity(claims,claim.quantityUnits,available).allowed)throw new Error('QUANTITY_BUDGET_EXCEEDED');
      this.db.prepare('INSERT INTO v396_quantity_claims VALUES(?,?,?)').run(claim.claimId,claim.scope,JSON.stringify(claim));return claim;
    });
  }
  pendingEvents(){return this.db.prepare('SELECT id,payload FROM v396_outbox WHERE delivered=0 ORDER BY rowid').all().map(r=>({id:String(r.id),payload:JSON.parse(String(r.payload))}));}
  markDelivered(id:string){this.db.prepare('UPDATE v396_outbox SET delivered=1 WHERE id=?').run(id);}
  close(){this.db.close();}
}
