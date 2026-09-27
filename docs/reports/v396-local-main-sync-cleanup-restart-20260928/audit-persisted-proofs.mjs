import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..'),target=path.join(out,'persisted-proof-input.json');
const sha=x=>createHash('sha256').update(x).digest('hex');
if(process.argv.includes('--capture')){
 const receipt=JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json','utf8').replace(/^\uFEFF/,''));
 const diagnostic=await(await fetch('http://127.0.0.1:8080/api/v3/diagnostics/closeout')).json();
 const dbPath=path.join(diagnostic.runtime.runtimeDataDir,'zdj-settings.sqlite'),db=new DatabaseSync(dbPath,{readOnly:true});
 db.exec('PRAGMA query_only=ON; BEGIN');
 const capturedAt=Date.now(),tasks=db.prepare('SELECT intent_id,scope,active,released_at,payload FROM entry_execution_tasks ORDER BY intent_id').all(),runtime=db.prepare('SELECT payload,updated_at FROM runtime_state WHERE id=1').get();
 const entities=db.prepare("SELECT entity_id,payload FROM runtime_entities WHERE kind='entryOrders'").all();
 const version=db.prepare('SELECT version FROM settings WHERE id=1').get();db.exec('COMMIT');db.close();
 const select=order=>Object.fromEntries(['id','intentId','symbol','side','clientOrderId','exchangeOrderId','status','filledQuantity','quantity','price','createdAt','updatedAt','reservationId','exchangeTerminalStatus','activeRiskExposure','activeRiskEvidence','remoteAudit'].filter(key=>Object.hasOwn(order,key)).map(key=>[key,order[key]]));
 const interesting=order=>order?.status==='UNKNOWN'||(['FILLED','CANCELED','EXPIRED','REJECTED'].includes(order?.status)&&order.exchangeTerminalStatus==='UNKNOWN');
 const durable=tasks.map(row=>({...row,record:JSON.parse(row.payload)}));
 const snapshot=runtime?JSON.parse(runtime.payload):{};
 if(snapshot._entityLists?.entryOrders){const byId=new Map(entities.map(row=>[row.entity_id,JSON.parse(row.payload)]));snapshot.entryOrders=snapshot._entityLists.entryOrders.ids.map(id=>{if(!byId.has(id))throw Error('MISSING_ENTRY_ENTITY:'+id);return[id,byId.get(id)];});}
 const record={schema:'V396_PERSISTED_PROOF_INPUT_1',capturedAt,dbPath,mode:'SQLITE_READ_ONLY_QUERY_ONLY_READ_TRANSACTION',receipt,runtimeIdentity:{pid:diagnostic.runtime.pid,instanceId:diagnostic.runtime.instanceId,buildId:diagnostic.runtime.buildId,runtimeDataDir:diagnostic.runtime.runtimeDataDir},settingsVersion:version.version,runtimeUpdatedAt:runtime?.updated_at??null,totalDurableRows:tasks.length,totalRuntimeEntryRows:(snapshot.entryOrders??[]).length,
 durable:durable.filter(row=>interesting(row.record.order)).map(row=>({intentId:row.intent_id,scope:row.scope,storedActive:row.active,releasedAt:row.released_at,payloadSha256:sha(row.payload),order:select(row.record.order)})),
 runtime:(snapshot.entryOrders??[]).map(([,order])=>order).filter(interesting).map(order=>({order:select(order)})),
 limits:'Same SQLite read transaction; API identity request precedes it. This is a post-start read-only observation of the deployed strict-proof build. Input is allowlisted; no Settings values/secrets are retained.'};
 record.selectedRowsHash=sha(JSON.stringify({durable:record.durable,runtime:record.runtime}));writeFileSync(target,JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({capturedAt,durable:record.durable.length,runtime:record.runtime.length,settingsVersion:record.settingsVersion,selectedRowsHash:record.selectedRowsHash}));
}else{
 const input=JSON.parse(readFileSync(target,'utf8')),module=await import(pathToFileURL(path.join(root,'apps/engine/dist/services/entryRiskOccupancy.js')).href),now=input.capturedAt;
 const old=order=>order.activeRiskExposure===false&&order.activeRiskEvidence?.status==='VERIFIED_NO_ACTIVE_RISK'&&Number.isFinite(Number(order.activeRiskEvidence.checkedAt))&&Number(order.activeRiskEvidence.validUntil)>now&&order.activeRiskEvidence.identityTombstone===module.entryIdentityTombstone(order);
 const oldClaim=order=>['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(order.status)&&!(order.status==='UNKNOWN'&&!order.exchangeOrderId&&Number(order.filledQuantity??0)===0&&old(order));
 const runtimeById=new Map(input.runtime.map(row=>[row.order.id,row.order]));
 const startupDurable=input.durable.map(row=>{const runtimeOrder=runtimeById.get(row.order.id),useRuntime=runtimeOrder&&runtimeOrder.updatedAt>row.order.updatedAt;return{...row,order:useRuntime?runtimeOrder:row.order,usedNewerRuntime:!!useRuntime};});
 const populations={durable:input.durable,runtime:input.runtime,startupDurable};
 const groups={};for(const group of Object.keys(populations)){const rows=populations[group].map(row=>{const order=row.order,oldProof=Boolean(old(order)),validation=module.validateNoActiveRiskProof(order,now),newProof=validation.valid,oldOccupancy=!oldProof,newOccupancy=module.entryOrderOccupiesRisk(order,now),oldDurableClaim=oldClaim(order),newDurableClaim=module.durableEntryClaimActive(order,now);return {id:order.id,intentId:row.intentId??order.intentId,status:order.status,usedNewerRuntime:row.usedNewerRuntime??false,storedActive:row.storedActive??null,releasedAt:row.releasedAt??null,oldProof,newProof,validation,oldOccupancy,newOccupancy,oldDurableClaim,newDurableClaim,proofChanged:oldProof!==newProof,occupancyChanged:oldOccupancy!==newOccupancy,claimChanged:oldDurableClaim!==newDurableClaim,storedClaimWouldReactivate:row.storedActive===0&&newDurableClaim};});
 const count=key=>rows.filter(row=>row[key]).length;groups[group]={count:rows.length,usedNewerRuntime:count('usedNewerRuntime'),oldProofValid:count('oldProof'),newProofValid:count('newProof'),proofChanged:count('proofChanged'),occupancyChanged:count('occupancyChanged'),claimChanged:count('claimChanged'),storedClaimWouldReactivate:count('storedClaimWouldReactivate'),invalidReasons:rows.filter(row=>!row.newProof).reduce((a,row)=>(a[row.validation.reason]=(a[row.validation.reason]??0)+1,a),{}),rows};}
 writeFileSync(path.join(out,'persisted-proof-impact.json'),JSON.stringify({schema:'V396_PERSISTED_PROOF_IMPACT_1',evaluatedAt:now,inputHash:input.selectedRowsHash,groups,liveDataWrites:0,note:'Before/after semantics on the SAME captured snapshot and timestamp. Durable and runtime copies overlap; do not sum as unique orders. Stored active-bit discrepancies are reported separately from predicate changes. startupDurable models appRuntime choosing a strictly newer runtime order before saving/loading each durable row; it is not a performed deployment.'},null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([key,{rows,...summary}])=>[key,summary])),null,2));
}
