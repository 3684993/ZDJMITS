import {attributeFunding,type CycleExposure} from './factLedgers.js';
import {DatabaseSync} from 'node:sqlite';

/**
 * P6: a real funding income ledger.
 *
 * V3.9.6 had no funding income table at all. The dashboard's "192 funding fees unconfirmed" was
 * counting TradeRecords whose `fundingAttributionStatus` was UNKNOWN (R7) - a statement about the
 * accounting, not about money received. Attributing funding needs the exchange's own income rows,
 * with their pagination coverage, so that a cycle can be told "exactly this much funding accrued
 * while it was open" and any gap can stay UNKNOWN instead of being filled with zero.
 */

export type FundingIncomeRow={
  incomeId:string;environment:string;accountId:string;asset:string;symbol:string|null;
  incomeType:'FUNDING_FEE'|'REALIZED_PNL'|'COMMISSION'|'TRANSFER'|'OTHER';
  income:number;time:number;
  /** What the page proved, so a caller can tell "no funding" from "we did not look". */
  source:string;observedAt:number;
};

export type FundingCoverage={environment:string;accountId:string;asset:string;sinceMs:number;untilMs:number;complete:boolean;pages:number;rows:number;observedAt:number;reason:string|null};

const DDL=`
CREATE TABLE IF NOT EXISTS v397_income_conflicts(environment TEXT NOT NULL,account_id TEXT NOT NULL,asset TEXT NOT NULL,income_type TEXT NOT NULL,income_id TEXT NOT NULL,time INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v396_funding_income(
  income_id TEXT NOT NULL,environment TEXT NOT NULL,account_id TEXT NOT NULL,asset TEXT NOT NULL,symbol TEXT,
  income_type TEXT NOT NULL,income REAL NOT NULL,time INTEGER NOT NULL,source TEXT NOT NULL,observed_at INTEGER NOT NULL,PRIMARY KEY(environment,account_id,income_type,income_id));
CREATE INDEX IF NOT EXISTS v396_funding_income_symbol_time ON v396_funding_income(environment,account_id,symbol,time);
CREATE INDEX IF NOT EXISTS v396_funding_income_time ON v396_funding_income(environment,account_id,asset,time);
CREATE TABLE IF NOT EXISTS v396_funding_coverage(environment TEXT NOT NULL,account_id TEXT NOT NULL,asset TEXT NOT NULL,
  since_ms INTEGER NOT NULL,until_ms INTEGER NOT NULL,pages INTEGER NOT NULL,rows INTEGER NOT NULL,observed_at INTEGER NOT NULL,
  complete INTEGER NOT NULL,reason TEXT,PRIMARY KEY(environment,account_id,asset,since_ms));
`;

const text=(value:unknown)=>{const s=String(value??'').trim();return s.length?s:null;};
const numberType=(value:unknown):FundingIncomeRow['incomeType']=>{
  const kind=String(value??'').trim().toUpperCase();
  return kind==='FUNDING_FEE'?'FUNDING_FEE':kind==='REALIZED_PNL'?'REALIZED_PNL':kind==='COMMISSION'?'COMMISSION':kind==='TRANSFER'?'TRANSFER':'OTHER';
};

export class FundingIncomeLedger {
  private db:DatabaseSync;
  constructor(file:string,private readonly identity:()=>{environment:string;account:string}){
    this.db=new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=3000;');
    this.db.exec(DDL);
    const cols=this.db.prepare('PRAGMA table_info(v396_funding_income)').all() as Array<{name:string;pk:number}>;
    if(cols.filter(c=>c.pk>0).length===1){
      this.db.exec('BEGIN IMMEDIATE');
      try{this.db.exec('ALTER TABLE v396_funding_income RENAME TO v396_funding_income_legacy_identity');this.db.exec(DDL);this.db.exec('INSERT INTO v396_funding_income SELECT * FROM v396_funding_income_legacy_identity; DROP TABLE v396_funding_income_legacy_identity;');this.db.exec(DDL);this.db.exec('COMMIT');}
      catch(error){this.db.exec('ROLLBACK');throw error;}
    }
  }

  /** Idempotent by the exchange's own income id, so a re-run of the same import changes nothing. */
  recordRows(rows:Array<Record<string,unknown>>):{inserted:number;duplicates:number;rejected:string[]}{
    const identity=this.identity(),environment=text(identity.environment),accountId=text(identity.account);
    let inserted=0,duplicates=0;const rejected:string[]=[];
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const row of rows){
        const asset=text(row.asset),time=Number(row.time??row.transactionTime),income=Number(row.income);
        const incomeId=text(row.incomeId??row.tranId);
        if(!environment||!accountId||!incomeId||!asset||!Number.isFinite(time)||!Number.isFinite(income)){rejected.push(String(row.incomeId??'ROW_IDENTITY_MISSING'));continue;}
        const statement=this.db.prepare(`INSERT INTO v396_funding_income(income_id,environment,account_id,asset,symbol,income_type,income,time,source,observed_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(environment,account_id,income_type,income_id) DO NOTHING`);
        const result=statement.run(incomeId,environment,accountId,asset,text(row.symbol),numberType(row.incomeType),income,Math.trunc(time),String(row.source??'INCOME_READ'),Math.trunc(Number(row.observedAt??Date.now())));
        if(result.changes)inserted++;else {duplicates++;const prior=this.db.prepare('SELECT income,asset,symbol,time FROM v396_funding_income WHERE environment=? AND account_id=? AND income_type=? AND income_id=?').get(environment,accountId,numberType(row.incomeType),incomeId) as any;
          if(prior&&(Number(prior.income)!==income||prior.asset!==asset||prior.symbol!==text(row.symbol)||Number(prior.time)!==Math.trunc(time))){
            this.db.prepare('INSERT INTO v397_income_conflicts VALUES(?,?,?,?,?,?,?)').run(environment,accountId,prior.asset,numberType(row.incomeType),incomeId,prior.time,JSON.stringify({prior,attempt:row}));rejected.push(`INCOME_IDENTITY_CONFLICT:${incomeId}`);
          }
        }
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return{inserted,duplicates,rejected};
  }

  /**
   * A coverage record is a separate assertion from the rows: "we pulled every page from T0 to T1 and
   * the last page was short" is what lets a cycle be called exactly-funded. Without it, absence of a
   * row means nothing, and the honest answer stays UNKNOWN.
   */
  recordCoverage(input:{asset:string;sinceMs:number;untilMs:number;pages:number;rows:number;complete:boolean;reason?:string|null;observedAt?:number}){
    const identity=this.identity(),environment=text(identity.environment),accountId=text(identity.account),asset=text(input.asset);
    if(!environment||!accountId||!asset||!Number.isFinite(Number(input.sinceMs))||!Number.isFinite(Number(input.untilMs)))return false;
    this.db.prepare(`INSERT INTO v396_funding_coverage(environment,account_id,asset,since_ms,until_ms,pages,rows,observed_at,complete,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(environment,account_id,asset,since_ms) DO UPDATE SET until_ms=excluded.until_ms,pages=excluded.pages,rows=excluded.rows,observed_at=excluded.observed_at,complete=excluded.complete,reason=excluded.reason`)
      .run(environment,accountId,asset,Math.trunc(input.sinceMs),Math.trunc(input.untilMs),Math.max(0,Math.trunc(input.pages)),Math.max(0,Math.trunc(input.rows)),
        Math.trunc(Number(input.observedAt??Date.now())),input.complete?1:0,input.reason??null);
    return true;
  }

  rowsFor(input:{asset:string;fromMs:number;toMs:number;symbol?:string|null}){
    const identity=this.identity();
    const clauses=['environment=?','account_id=?','asset=?','time>=?','time<=?'],params:unknown[]=[identity.environment,identity.account,input.asset,Math.trunc(input.fromMs),Math.trunc(input.toMs)];
    if(input.symbol){clauses.push('(symbol=? OR symbol IS NULL)');params.push(String(input.symbol).toUpperCase());}
    return this.db.prepare(`SELECT * FROM v396_funding_income WHERE ${clauses.join(' AND ')} ORDER BY time,income_id`).all(...params as never[]) as unknown as Array<Record<string,unknown>>;
  }

  /**
   * Coverage for one holding window. It is `exact` only when a completed coverage row encloses the
   * window AND every funding event inside it is known; a zero with incomplete coverage is still
   * unknown, because funding settles on a schedule and a quiet window proves nothing about a gap.
   */
  attribution(input:{asset:string;symbol:string;fromMs:number;toMs:number;ownership?:{record:any;exposures:CycleExposure[];universeComplete:boolean}}){
    const rows=this.rowsFor(input);
    const funding=rows.filter(row=>String(row.income_type)==='FUNDING_FEE');
    const coverage=this.db.prepare('SELECT * FROM v396_funding_coverage WHERE environment=? AND account_id=? AND asset=? ORDER BY since_ms').all(this.identity().environment,this.identity().account,input.asset) as Array<Record<string,unknown>>;
    const enclosing=coverage.filter(row=>Number(row.since_ms)<=input.fromMs&&Number(row.until_ms)>=input.toMs&&Number(row.complete)===1);
    let through=input.fromMs;const completeWindows=coverage.filter(row=>Number(row.complete)===1&&Number(row.observed_at)>=Number(row.until_ms));
    for(const row of completeWindows){if(Number(row.since_ms)>through)break;if(Number(row.until_ms)>=through)through=Math.max(through,Number(row.until_ms));}
    const coverageComplete=Number.isFinite(input.fromMs)&&Number.isFinite(input.toMs)&&input.fromMs>0&&input.toMs>=input.fromMs&&through>=input.toMs;
    const used=completeWindows.filter(r=>Number(r.until_ms)>=input.fromMs&&Number(r.since_ms)<=input.toMs);
    const verifiedAt=used.length?Math.min(...used.map(r=>Number(r.observed_at))):0;
    const identityConflict=Number((this.db.prepare("SELECT COUNT(*) n FROM v397_income_conflicts WHERE environment=? AND account_id=? AND asset=? AND income_type='FUNDING_FEE' AND time>=? AND time<=?").get(this.identity().environment,this.identity().account,input.asset,input.fromMs,input.toMs) as any).n)>0;
    const late=funding.some(r=>Number(r.observed_at)>verifiedAt);
    const allocation=input.ownership?attributeFunding({record:input.ownership.record,asset:input.asset,accountScope:`${this.identity().environment}|${this.identity().account}`,proof:{accountScope:`${this.identity().environment}|${this.identity().account}`,cycleId:input.ownership.record.cycleId,asset:input.asset,from:input.fromMs,to:input.toMs,verifiedAt,coverageIds:used.map(r=>`coverage:${r.since_ms}:${r.until_ms}:${r.observed_at}`),complete:coverageComplete,exposureUniverseComplete:input.ownership.universeComplete},income:funding.map(r=>({id:String(r.income_id),asset:String(r.asset),symbol:r.symbol==null?null:String(r.symbol),type:String(r.income_type),amount:Number(r.income),at:Number(r.time),observedAt:Number(r.observed_at)})),exposures:input.ownership.exposures}):null;
    const exact=coverageComplete&&!late&&!identityConflict&&(allocation?allocation.status==='EXACT':funding.length===0);
    const total=allocation?.amount??0;
    const reason=exact?null:identityConflict?'FUNDING_IDENTITY_CONFLICT':!coverageComplete?(coverage.length?'COVERAGE_DOES_NOT_ENCLOSE_WINDOW':'COVERAGE_UNRECORDED'):late?'LATE_FUNDING_REQUIRES_REVERIFICATION':allocation?.reasons.join('|')||'FUNDING_OWNER_NOT_PROVEN';
    return{
      status:exact?'EXACT':'UNKNOWN' as 'EXACT'|'UNKNOWN',
      fundingUsd:exact&&input.asset==='USDT'?total:null,
      observedFundingRows:funding.length,
      coverageComplete,
      fundingNative:exact?{asset:input.asset,amount:total}:null,
      allocation,
      learningProof:exact&&input.ownership&&input.ownership.record.cycleId?{accountScope:`${this.identity().environment}|${this.identity().account}`,cycleId:input.ownership.record.cycleId,asset:input.asset,amount:total,from:input.fromMs,to:input.toMs,verifiedAt,coverageIds:used.map(r=>`coverage:${r.since_ms}:${r.until_ms}:${r.observed_at}`),allocations:allocation?.allocations??[]}:null,
      coverage:coverageComplete?{sinceMs:input.fromMs,untilMs:through,pages:completeWindows.reduce((n,r)=>n+Number(r.pages),0),rows:funding.length}:null,
      // Reported separately so a partial import is never read as "there was no funding".
      partialCoverageRows:coverage.filter(row=>Number(row.complete)!==1).length,
      reason,
    };
  }

  coverageSummary(){
    const identity=this.identity();
    const rows=this.db.prepare('SELECT asset,COUNT(*) c,MIN(time) mn,MAX(time) mx FROM v396_funding_income WHERE environment=? AND account_id=? GROUP BY asset').all(identity.environment,identity.account) as Array<{asset:string;c:number;mn:number;mx:number}>;
    const coverage=this.db.prepare('SELECT asset,SUM(complete) complete_windows,COUNT(*) windows,MAX(CASE WHEN complete=1 THEN until_ms END) until_ms FROM v396_funding_coverage WHERE environment=? AND account_id=? GROUP BY asset').all(identity.environment,identity.account) as Array<{asset:string;complete_windows:number;windows:number;until_ms:number}>;
    const fundingRows=this.db.prepare("SELECT COUNT(*) c FROM v396_funding_income WHERE environment=? AND account_id=? AND income_type='FUNDING_FEE'").all(identity.environment,identity.account)[0] as {c:number};
    return{rows:rows.reduce((sum,row)=>sum+Number(row.c),0),fundingRows:Number(fundingRows.c??0),byAsset:rows,coverage,
      complete:coverage.length>0&&coverage.every(row=>Number(row.complete_windows)>0),
      coveredSinceMs:coverage.length?Number((this.db.prepare('SELECT MIN(since_ms) n FROM v396_funding_coverage WHERE environment=? AND account_id=? AND complete=1').get(identity.environment,identity.account) as any)?.n??0)||null:null,
      coveredUntilMs:coverage.length?Math.max(...coverage.map(row=>Number(row.until_ms))):null};
  }

  close(){this.db.close();}
}

/** Income lacks hedge-side identity. Nonzero overlapping cycles cannot each own the whole amount. */
export function cycleFundingFact(ledger:FundingIncomeLedger,record:any,records:any[],now:number){
  const asset=String(record.symbol).endsWith('USDC')?'USDC':String(record.symbol).endsWith('USDT')?'USDT':'UNKNOWN';
  const fromMs=Number(record.openedAt??0),toMs=Number(record.closedAt??record.observedClosedAt??now);
  const fact=ledger.attribution({asset,symbol:record.symbol,fromMs,toMs,ownership:{record,exposures:[],universeComplete:false}});
  const overlaps=records.some(other=>other.tradeId!==record.tradeId&&!other.duplicateOf&&other.canonical!==false&&other.symbol===record.symbol&&
    Number(other.openedAt??0)<=toMs&&Number(other.closedAt??other.observedClosedAt??now)>=fromMs);
  const reason=asset==='UNKNOWN'?'FUNDING_QUOTE_ASSET_UNKNOWN':overlaps&&fact.observedFundingRows>0?'FUNDING_CYCLE_ALLOCATION_AMBIGUOUS':fact.reason;
  return {...fact,status:reason?'UNKNOWN' as const:fact.status,fundingUsd:reason?null:fact.fundingUsd,reason};
}
