import {DatabaseSync} from 'node:sqlite';

/**
 * Durable proof that an exchange order was created by this engine.
 *
 * V3.9.6 decided system origin from a client-order-id prefix regex, so a real system exit fill
 * carrying the `v396x...` identity was still labelled EXTERNAL_OR_UNLINKED whenever the matching
 * entry order row had already been retired (R5). A prefix is not provenance: this registry records
 * the identity at the moment the order is minted, keyed by environment + account + clientOrderId,
 * and a fill is only called system-generated when a row here says so.
 */
export type OrderProvenanceRole='ENTRY'|'TP'|'EXIT'|'MANUAL';
export type OrderProvenanceRow={
  environment:string;accountId:string;symbol:string;clientOrderId:string;exchangeOrderId:string|null;
  role:OrderProvenanceRole;intentId:string|null;orderId:string|null;cycleId:string|null;
  source:string;firstSeenAt:number;lastSeenAt:number;
};

const DDL=`
CREATE TABLE IF NOT EXISTS v397_order_provenance_conflicts(environment TEXT NOT NULL,account_id TEXT NOT NULL,symbol TEXT NOT NULL,client_order_id TEXT NOT NULL,exchange_order_id TEXT,reason TEXT NOT NULL,payload TEXT NOT NULL,observed_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS v397_provenance_conflict_identity ON v397_order_provenance_conflicts(environment,account_id,symbol,client_order_id,exchange_order_id);
CREATE TABLE IF NOT EXISTS v396_order_provenance(
  environment TEXT NOT NULL,account_id TEXT NOT NULL,symbol TEXT NOT NULL,client_order_id TEXT NOT NULL,
  exchange_order_id TEXT,role TEXT NOT NULL,intent_id TEXT,order_id TEXT,cycle_id TEXT,source TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,payload TEXT NOT NULL,
  PRIMARY KEY(environment,account_id,client_order_id));
CREATE INDEX IF NOT EXISTS v396_order_provenance_exchange ON v396_order_provenance(environment,account_id,symbol,exchange_order_id);
CREATE INDEX IF NOT EXISTS v396_order_provenance_cycle ON v396_order_provenance(environment,account_id,cycle_id);
`;

const text=(value:unknown)=>{const s=String(value??'').trim();return s.length?s:null;};

export class OrderProvenanceRegistry {
  private db:DatabaseSync;
  /**
   * The registry is a single shared ledger across entry, TP and manual orders, but the caller's
   * environment/account is the engine's own identity. Passing it once as a fallback keeps every
   * writer from having to re-derive it while still letting an offline repair tool scope rows
   * explicitly - and an explicit identity always wins over the fallback.
   */
  constructor(file:string,private readonly identity?:()=>{environment:string;account:string}){
    this.db=new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=3000;');
    this.db.exec(DDL);
  }

  private scoped(input:{environment?:string;accountId?:string}){
    const fallback=this.identity?.()??{environment:'',account:''};
    return{environment:text(input.environment)??fallback.environment,accountId:text(input.accountId)??fallback.account};
  }

  /** Idempotent by identity. A second writer claiming a different symbol for one client id is a conflict, not an update. */
  record(input:{environment?:string;accountId?:string;symbol:string;clientOrderId:string;exchangeOrderId?:string|null;
    role:OrderProvenanceRole;intentId?:string|null;orderId?:string|null;cycleId?:string|null;source:string;observedAt?:number}):{recorded:boolean;conflict:string|null}{
    const identity=this.scoped(input);
    const environment=identity.environment,accountId=identity.accountId,symbol=(text(input.symbol)??'').toUpperCase(),clientOrderId=text(input.clientOrderId);
    if(!environment||!accountId||!symbol||!clientOrderId)return{recorded:false,conflict:'PROVENANCE_IDENTITY_MISSING'};
    const at=Number.isSafeInteger(Number(input.observedAt))?Number(input.observedAt):Date.now();
    const row:OrderProvenanceRow={environment,accountId,symbol,clientOrderId,exchangeOrderId:text(input.exchangeOrderId),
      role:input.role,intentId:text(input.intentId),orderId:text(input.orderId),cycleId:text(input.cycleId),source:String(input.source),firstSeenAt:at,lastSeenAt:at};
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT payload FROM v396_order_provenance WHERE environment=? AND account_id=? AND client_order_id=?').get(environment,accountId,clientOrderId) as {payload:string}|undefined;
      if(existing){
        const prior=JSON.parse(String(existing.payload)) as OrderProvenanceRow;
        const conflict=prior.symbol!==symbol?`PROVENANCE_SYMBOL_CONFLICT:${prior.symbol}!=${symbol}`:prior.role!==row.role?'PROVENANCE_ROLE_CONFLICT':prior.cycleId&&row.cycleId&&prior.cycleId!==row.cycleId?'PROVENANCE_CYCLE_CONFLICT':prior.exchangeOrderId&&row.exchangeOrderId&&prior.exchangeOrderId!==row.exchangeOrderId?'PROVENANCE_IDENTITY_CONFLICT':null;
        if(conflict){this.db.prepare('INSERT INTO v397_order_provenance_conflicts VALUES(?,?,?,?,?,?,?,?)').run(environment,accountId,prior.symbol,clientOrderId,prior.exchangeOrderId,conflict,JSON.stringify({prior,attempt:row}),at);return{recorded:false,conflict};}
        const merged:OrderProvenanceRow={...prior,exchangeOrderId:prior.exchangeOrderId??row.exchangeOrderId,cycleId:prior.cycleId??row.cycleId,
          intentId:prior.intentId??row.intentId,orderId:prior.orderId??row.orderId,source:`${prior.source}+${row.source}`,lastSeenAt:Math.max(prior.lastSeenAt,row.lastSeenAt)};
        this.db.prepare('UPDATE v396_order_provenance SET exchange_order_id=?,cycle_id=?,intent_id=?,order_id=?,source=?,last_seen_at=?,payload=? WHERE environment=? AND account_id=? AND client_order_id=?')
          .run(merged.exchangeOrderId,merged.cycleId,merged.intentId,merged.orderId,merged.source,merged.lastSeenAt,JSON.stringify(merged),environment,accountId,clientOrderId);
        return{recorded:true,conflict:null};
      }
      this.db.prepare('INSERT INTO v396_order_provenance(environment,account_id,symbol,client_order_id,exchange_order_id,role,intent_id,order_id,cycle_id,source,first_seen_at,last_seen_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(environment,accountId,symbol,clientOrderId,row.exchangeOrderId,row.role,row.intentId,row.orderId,row.cycleId,row.source,row.firstSeenAt,row.lastSeenAt,JSON.stringify(row));
      return{recorded:true,conflict:null};
    });
  }

  /**
   * Proof is deliberately conjunctive: symbol must match and at least one of the two order ids must
   * match a recorded row. A random id that merely looks like a system id resolves to UNRESOLVED,
   * which is what keeps a prefix from being mistaken for provenance.
   */
  resolve(input:{environment?:string;accountId?:string;symbol:string;clientOrderId?:string|null;exchangeOrderId?:string|null}):{status:'SYSTEM_PROVEN'|'UNRESOLVED';rows:OrderProvenanceRow[];proof:string[]}{
    const identity=this.scoped(input);
    const symbol=(text(input.symbol)??'').toUpperCase();
    if(!symbol)return{status:'UNRESOLVED',rows:[],proof:[]};
    const clientOrderId=text(input.clientOrderId),exchangeOrderId=text(input.exchangeOrderId);
    if(!clientOrderId&&!exchangeOrderId)return{status:'UNRESOLVED',rows:[],proof:['NO_ORDER_IDENTITY']};
    const clauses:string[]=['symbol=?'];const params:unknown[]=[symbol];
    if(identity.environment){clauses.push('environment=?');params.push(identity.environment);}
    if(identity.accountId){clauses.push('account_id=?');params.push(identity.accountId);}
    const rows=this.db.prepare(`SELECT payload FROM v396_order_provenance WHERE ${clauses.join(' AND ')}`).all(...params as never[])
      .map(row=>JSON.parse(String(row.payload)) as OrderProvenanceRow);
    const matched=rows.filter(row=>(clientOrderId&&row.clientOrderId===clientOrderId)||(exchangeOrderId&&row.exchangeOrderId===exchangeOrderId));
    if(!matched.length)return{status:'UNRESOLVED',rows:[],proof:['PROVENANCE_REGISTRY_HAS_NO_MATCH']};
    const rejected=this.db.prepare('SELECT reason FROM v397_order_provenance_conflicts WHERE environment=? AND account_id=? AND symbol=? AND (client_order_id=? OR exchange_order_id=?)').all(identity.environment,identity.accountId,symbol,clientOrderId??'',exchangeOrderId??'');
    if(rejected.length)return{status:'UNRESOLVED',rows:[],proof:[...new Set(rejected.map(r=>String(r.reason)))]};
    if(matched.some(r=>clientOrderId&&r.clientOrderId===clientOrderId&&exchangeOrderId&&r.exchangeOrderId&&r.exchangeOrderId!==exchangeOrderId))return{status:'UNRESOLVED',rows:[],proof:['PROVENANCE_IDENTITY_CONFLICT']};
    const scopes=new Set(matched.map(r=>`${r.environment}|${r.accountId}`));
    if(scopes.size!==1)return{status:'UNRESOLVED',rows:[],proof:['PROVENANCE_SCOPE_CONFLICT']};
    const distinctRoles=new Set(matched.map(row=>row.role));
    const distinctCycles=new Set(matched.map(row=>row.cycleId).filter(Boolean));
    if(distinctCycles.size>1)return{status:'UNRESOLVED',rows:[],proof:['PROVENANCE_CYCLE_CONFLICT']};
    if(distinctRoles.size>1)return{status:'UNRESOLVED',rows:[],proof:[`PROVENANCE_ROLE_CONFLICT:${[...distinctRoles].join('|')}`]};
    return{status:'SYSTEM_PROVEN',rows:matched,proof:[`REGISTRY_ROLE_${[...distinctRoles][0]}`,clientOrderId?'CLIENT_ORDER_ID':'EXCHANGE_ORDER_ID']};
  }

  list(input?:{environment?:string;accountId?:string;role?:OrderProvenanceRole;limit?:number}):OrderProvenanceRow[]{
    const clauses:string[]=[],params:unknown[]=[];
    if(input?.environment){clauses.push('environment=?');params.push(input.environment);}
    if(input?.accountId){clauses.push('account_id=?');params.push(input.accountId);}
    if(input?.role){clauses.push('role=?');params.push(input.role);}
    const where=clauses.length?` WHERE ${clauses.join(' AND ')}`:'';
    const limit=Number.isSafeInteger(Number(input?.limit))?Math.max(1,Math.min(5000,Number(input?.limit))):2000;
    return this.db.prepare(`SELECT payload FROM v396_order_provenance${where} ORDER BY last_seen_at DESC LIMIT ?`).all(...params as never[],limit)
      .map(row=>JSON.parse(String(row.payload)) as OrderProvenanceRow);
  }

  count(){return Number(this.db.prepare('SELECT COUNT(*) c FROM v396_order_provenance').get()?.c??0);}
  countsByRole(){return this.db.prepare('SELECT role,COUNT(*) c FROM v396_order_provenance GROUP BY role').all().map(row=>({role:String(row.role),count:Number(row.c)}));}
  close(){this.db.close();}

  private transaction<T>(fn:()=>T):T{
    this.db.exec('BEGIN IMMEDIATE');
    try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
