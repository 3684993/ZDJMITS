from pathlib import Path
p=Path('apps/engine/src/config/entryClaimStatsIndex.ts');p.write_text('''import {durableEntryClaimActive,isHistoricalUnknownEntryOrder} from '../services/entryRiskOccupancy.js';
export type ClaimRow={intent_id:string;active:number;released_at:number;payload:string;scope:string;isolation_mode:string;isolation_key:string};
type Fact={id:string;active:boolean;released:boolean;status:string;historical:boolean;order:any;mode:string;scope:string;effective:boolean;due:number|null;version:number};
/** Derived counters only; submission authority still reads exact SQLite rows and validates proof. */
export class EntryClaimStatsIndex {
  private rows=new Map<string,Fact>();private heap:Array<{at:number;id:string;version:number}>=[];private sequence=0;private lastNow=0;
  private totals={durableTasks:0,activeClaims:0,activeUnknownClaims:0,storedActiveClaims:0,reactivatedByProofValidation:0,releasedClaims:0,releasedUnknownClaims:0};
  private modes=new Map<string,{rows:number;activeClaims:number;scopes:Map<string,number>}>();
  private add(f:Fact,sign:number){const t=this.totals;t.durableTasks+=sign;t.activeClaims+=sign*Number(f.effective);t.activeUnknownClaims+=sign*Number(f.effective&&f.historical);t.storedActiveClaims+=sign*Number(f.active);t.reactivatedByProofValidation+=sign*Number(f.effective&&!f.active);t.releasedClaims+=sign*Number(f.released);t.releasedUnknownClaims+=sign*Number(f.released&&f.status==='UNKNOWN');const m=this.modes.get(f.mode)??{rows:0,activeClaims:0,scopes:new Map<string,number>()};m.rows+=sign;m.activeClaims+=sign*Number(f.effective);const n=(m.scopes.get(f.scope)??0)+sign;if(n)m.scopes.set(f.scope,n);else m.scopes.delete(f.scope);this.modes.set(f.mode,m);}
  private evaluate(f:Fact,now:number){f.effective=f.active||!f.order||durableEntryClaimActive(f.order,now);const e=f.order?.activeRiskEvidence;f.due=!f.active&&f.historical&&typeof e?.checkedAt==='number'&&Number.isSafeInteger(e.checkedAt)&&e.checkedAt>now?e.checkedAt:!f.effective&&typeof e?.validUntil==='number'?e.validUntil:null;f.version=++this.sequence;if(f.due!==null&&f.due>now)this.push({at:f.due,id:f.id,version:f.version});}
  update(row:ClaimRow,now:number){this.remove(row.intent_id);let source:any=null;try{source=JSON.parse(row.payload)?.order??null;}catch{}const keys=['id','symbol','status','clientOrderId','exchangeOrderId','filledQuantity','exchangeTerminalStatus','activeRiskExposure','activeRiskEvidence','remoteAudit'];const order=source?Object.fromEntries(keys.map(k=>[k,source[k]])):null;const f:Fact={id:row.intent_id,active:row.active===1,released:row.released_at>0,status:String(order?.status??'UNREADABLE'),historical:Boolean(order)&&isHistoricalUnknownEntryOrder(order),order,mode:row.isolation_mode||'UNDERLYING_LEGACY',scope:row.isolation_key||row.scope,effective:true,due:null,version:0};this.evaluate(f,now);this.rows.set(f.id,f);this.add(f,1);this.compact();}
  remove(id:string){const f=this.rows.get(id);if(f){this.add(f,-1);this.rows.delete(id);}}
  private push(v:{at:number;id:string;version:number}){const h=this.heap;h.push(v);let i=h.length-1;while(i>0){const p=(i-1)>>1;if(h[p].at<=v.at)break;h[i]=h[p];i=p;}h[i]=v;}
  private pop(){const h=this.heap,first=h[0],last=h.pop()!;if(h.length){let i=0;while(i*2+1<h.length){let c=i*2+1;if(c+1<h.length&&h[c+1].at<h[c].at)c++;if(h[c].at>=last.at)break;h[i]=h[c];i=c;}h[i]=last;}return first;}
  private compact(){if(this.heap.length<=this.rows.size*2+128)return;this.heap=[];for(const f of this.rows.values())if(f.due!==null)this.push({at:f.due,id:f.id,version:f.version});}
  stats(now:number){if(now<this.lastNow){this.heap=[];for(const f of this.rows.values()){this.add(f,-1);this.evaluate(f,now);this.add(f,1);}}this.lastNow=now;while(this.heap.length&&this.heap[0].at<=now){const next=this.pop(),f=this.rows.get(next.id);if(!f||f.version!==next.version)continue;this.add(f,-1);this.evaluate(f,now);this.add(f,1);}return{evaluatedAt:now,...this.totals,claimSemantics:'CURRENT_STRICT_PROOF_OR_STORED_ACTIVE',releasedAtSemantics:'HISTORICAL_RELEASE_NOT_CURRENT_VALIDITY',byIsolationMode:Object.fromEntries(['SUBMISSION_ONLY','UNDERLYING_LEGACY'].map(mode=>{const m=this.modes.get(mode);return[mode,{rows:m?.rows??0,activeClaims:m?.activeClaims??0,distinctIsolationScopes:m?.scopes.size??0}];})),vetoEnforced:(this.modes.get('UNDERLYING_LEGACY')?.activeClaims??0)>0};}
}
''',encoding='utf-8')
p=Path('apps/engine/src/config/settingsStore.ts');s=p.read_text(encoding='utf-8');s="import {EntryClaimStatsIndex,type ClaimRow} from './entryClaimStatsIndex.js';\nimport {reconciliationTiming} from '../services/reconciliationTiming.js';\n"+s;s=s.replace('  private transactionActive = false;', '  private transactionActive = false;\n  private entryClaimStatsIndex:EntryClaimStatsIndex|null=null;')
marker='  private async defaults() {';a=s.index(marker);end=s.rfind('  }',0,a);s=s[:end]+'''    // Derived invalidation IDs are transactional with exact journal writes, including external SQL edits.
    this.db.exec(`CREATE TABLE IF NOT EXISTS entry_claim_stat_changes(intent_id TEXT PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS entry_claim_stats_insert AFTER INSERT ON entry_execution_tasks BEGIN INSERT OR IGNORE INTO entry_claim_stat_changes VALUES(NEW.intent_id); END;
      CREATE TRIGGER IF NOT EXISTS entry_claim_stats_update AFTER UPDATE ON entry_execution_tasks BEGIN INSERT OR IGNORE INTO entry_claim_stat_changes VALUES(NEW.intent_id); END;
      CREATE TRIGGER IF NOT EXISTS entry_claim_stats_delete AFTER DELETE ON entry_execution_tasks BEGIN INSERT OR IGNORE INTO entry_claim_stat_changes VALUES(OLD.intent_id); END;`);
    this.entryClaimStatsIndex=new EntryClaimStatsIndex();
    const now=Date.now();for(const row of this.db.prepare('SELECT intent_id,active,released_at,payload,scope,isolation_mode,isolation_key FROM entry_execution_tasks').iterate() as Iterable<ClaimRow>)this.entryClaimStatsIndex.update(row,now);
    this.db.exec('DELETE FROM entry_claim_stat_changes'); // Consumed derived IDs only, never execution history.
'''+s[end:]
s=s.replace('  saveEntryExecution(value:EntryExecutionRecord){',"  saveEntryExecution(value:EntryExecutionRecord){return reconciliationTiming.measure('journal.entry',()=>this.saveEntryExecutionRecord(value));}\n  private saveEntryExecutionRecord(value:EntryExecutionRecord){\n    reconciliationTiming.count('entryJournalSaveCalls');")
s=s.replace("const payload=JSON.stringify(value);\n    this.db.prepare('UPDATE entry_execution_tasks", "const payload=reconciliationTiming.measure('journal.entry.serialize',()=>JSON.stringify(value));\n    const changed=reconciliationTiming.measure('journal.entry.sqliteWrite',()=>this.db.prepare('UPDATE entry_execution_tasks")
s=s.replace("value.intent.id,nextActive,payload,releasedByProof?1:0);", "value.intent.id,nextActive,payload,releasedByProof?1:0));reconciliationTiming.count('entryJournalSqlChangedRows',Number(changed.changes));")
s=s.replace('  saveManualExecution(value: ManualExecutionRecord) {',"  saveManualExecution(value:ManualExecutionRecord){return reconciliationTiming.measure('journal.manual',()=>this.saveManualExecutionRecord(value));}\n  private saveManualExecutionRecord(value: ManualExecutionRecord) {\n    reconciliationTiming.count('manualJournalSaveCalls');")
s=s.replace("const active=activeOrderStatus(value.order.status)?1:0,payload=JSON.stringify(value);\n    this.db.prepare('UPDATE execution_tasks", "const active=activeOrderStatus(value.order.status)?1:0,payload=reconciliationTiming.measure('journal.manual.serialize',()=>JSON.stringify(value));\n    const changed=reconciliationTiming.measure('journal.manual.sqliteWrite',()=>this.db.prepare('UPDATE execution_tasks")
s=s.replace('.run(active,payload,Date.now(),value.intent.id,active,payload);',".run(active,payload,Date.now(),value.intent.id,active,payload));reconciliationTiming.count('manualJournalSqlChangedRows',Number(changed.changes));")
s=s.replace('  entryExecutionClaimStats(){', '''  entryExecutionClaimStats(){
    if(this.transactionActive||!this.entryClaimStatsIndex)return this.scanEntryExecutionClaimStats();
    const now=Date.now(),index=this.entryClaimStatsIndex;
    const changed=this.db.prepare('SELECT c.intent_id,t.active,t.released_at,t.payload,t.scope,t.isolation_mode,t.isolation_key FROM entry_claim_stat_changes c LEFT JOIN entry_execution_tasks t ON t.intent_id=c.intent_id').all() as ClaimRow[];
    for(const row of changed){if(row.payload===null)index.remove(row.intent_id);else index.update(row,now);this.db.prepare('DELETE FROM entry_claim_stat_changes WHERE intent_id=?').run(row.intent_id);}
    return index.stats(now);
  }
  private scanEntryExecutionClaimStats(){''')
p.write_text(s,encoding='utf-8')
