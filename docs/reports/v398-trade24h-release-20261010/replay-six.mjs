// Local read-only evidence replay. Raw IDs stay in the restricted input directory.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {projectExitProvenance} from '../../../apps/engine/dist/services/exitProvenance.js';
import {isGenericTpObservation} from '../../../apps/engine/dist/services/orderProvenanceRegistry.js';
const privateDir=process.argv[2];if(!privateDir)throw new Error('PRIVATE_INPUT_REQUIRED');
const db=new DatabaseSync('D:/MITS/data/v396-ownership.sqlite',{readOnly:true});db.exec('PRAGMA query_only=ON');
const proof=JSON.parse(readFileSync(new URL('./six-cycles-sanitized.json',import.meta.url)));
const wanted=new Set(proof.cases.map(x=>x.recordHash));const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const cases=[];
for(const name of readdirSync(privateDir).filter(x=>x.startsWith('detail-'))){
 const detail=JSON.parse(readFileSync(`${privateDir}/${name}`)),record=detail.rawRecord;
 if(!wanted.has(hash(record.tradeId)))continue;
 const resolve=input=>{
  const rows=db.prepare('SELECT payload FROM v396_order_provenance WHERE symbol=? AND (client_order_id=? OR exchange_order_id=?)').all(input.symbol,input.clientOrderId,String(input.exchangeOrderId)).map(x=>JSON.parse(x.payload));
  if(rows.length!==1)return{status:'UNRESOLVED',rows:[],proof:['PROVENANCE_SCOPE_OR_IDENTITY_CONFLICT']};
  const current=rows[0];const history=db.prepare('SELECT reason,payload FROM v397_order_provenance_conflicts WHERE environment=? AND account_id=? AND symbol=? AND (client_order_id=? OR exchange_order_id=?)').all(current.environment,current.accountId,input.symbol,input.clientOrderId,String(input.exchangeOrderId));
  const comparison={...current,exchangeOrderId:current.exchangeOrderId??String(input.exchangeOrderId)};
  const rejected=history.filter(x=>!isGenericTpObservation(x.reason,x.payload,comparison));
  return rejected.length?{status:'UNRESOLVED',rows:[],proof:[...new Set(rejected.map(x=>x.reason))]}:{status:'SYSTEM_PROVEN',rows,proof:['HISTORICAL_GENERIC_OBSERVATION_RECLASSIFIED']};
 };
 const started=performance.now();const result=projectExitProvenance(record,{executionFills:detail.linkedFills,manualOrders:new Map(),tpOrders:new Map(),orderProvenance:{resolve}});
 cases.push({symbol:record.symbol,recordHash:hash(record.tradeId),cycleHash:hash(record.cycleId),before:detail.record.closeProvenance,after:result.closeProvenance,identityConflict:result.identityConflict,quantityConflict:result.quantityConflict,coverageComplete:result.proofCoverage.complete,terminalFinalizer:result.finalizerIsTerminalProof,conflictReasons:result.conflictReasons,replayMs:performance.now()-started});
}
db.close();writeFileSync(new URL('./six-cycles-replay.json',import.meta.url),JSON.stringify({readOnly:true,exchangeRequests:0,databaseWrites:0,cases},null,2)+'\n');console.log(JSON.stringify(cases));
