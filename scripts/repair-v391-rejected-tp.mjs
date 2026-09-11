// One-time, evidence-constrained LOCAL ledger correction. No exchange write methods.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {confirmedTpSubmissionRejection} from '../data-test/v391-deploy/engine/services/tpSubmissionOutcome.js';
const proof=JSON.parse(await readFile('docs/reports/v391-tp-legacy-proof-20260910.json','utf8'));
if(Date.now()-proof.at>30*60_000)throw new Error('REFRESH_EXACT_ORDER_PROOFS_REQUIRED');
const identity=JSON.parse(await readFile('data/runtime/engine-instance.json','utf8'));
let alive=false;try{process.kill(identity.pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')throw error;}
if(alive)throw new Error('ENGINE_MUST_BE_STOPPED_FOR_LEDGER_MIGRATION');
const db=new DatabaseSync('data/zdj-settings.sqlite'),changes=[];
db.exec('BEGIN IMMEDIATE');
try{for(const item of proof.proofs){const {order,lookup,events}=item;if(!lookup.notFound||lookup.code!==-2013)throw new Error('EXACT_ABSENCE_REQUIRED');
 const prepared=events.find(e=>e.type==='TP_SUBMISSION_PREPARED'&&e.payload.order?.id===order.id&&e.payload.order?.clientOrderId===order.clientOrderId);
 if(!prepared)throw new Error('EXACT_PREPARED_EVENT_REQUIRED');
 const after=events.filter(e=>e.ts>=prepared.ts&&e.payload.positionId===order.positionId),failure=after.find(e=>e.type==='TP_REPAIR_FAILED'&&confirmedTpSubmissionRejection(e.payload.message));
 if(!failure||after.some(e=>e.ts>prepared.ts&&e.ts<=failure.ts&&e.type==='TP_SUBMISSION_PREPARED')||after.some(e=>e.type==='TP_PROTECTED'&&e.payload.order?.id===order.id))throw new Error('AMBIGUOUS_SUBMISSION_PROOF');
 const row=db.prepare("SELECT payload FROM runtime_entities WHERE kind='tpOrders' AND entity_id=?").get(order.id);if(!row)throw new Error('LOCAL_ORDER_MISSING');const current=JSON.parse(row.payload);
 if(current.status!=='UNKNOWN'||current.clientOrderId!==order.clientOrderId||current.exchangeOrderId)throw new Error('LOCAL_ORDER_CHANGED_ABORT');
 const updated={...current,status:'REJECTED',updatedAt:Date.now()},event={orderId:order.id,clientOrderId:order.clientOrderId,previousStatus:'UNKNOWN',status:'REJECTED',exchangeCode:-2022,preparedEventId:prepared.id,failureEventId:failure.id,exactLookupAt:proof.at,exactLookupCode:-2013,exchangeWrites:0};
 db.prepare("UPDATE runtime_entities SET payload=? WHERE kind='tpOrders' AND entity_id=?").run(JSON.stringify(updated),order.id);
 db.prepare('INSERT INTO runtime_events(id,type,ts,symbol,payload) VALUES(?,?,?,?,?)').run('v391-rejected-'+order.id,'TP_LEGACY_REJECTION_CONFIRMED',Date.now(),order.symbol,JSON.stringify(event));changes.push({before:current,after:updated,evidence:event});
 }db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
await writeFile('docs/reports/v391-tp-ledger-migration-20260910.json',JSON.stringify({at:Date.now(),changes,exchangeWrites:0},null,2));console.log(JSON.stringify({corrected:changes.length,status:'REJECTED',exchangeWrites:0}));
