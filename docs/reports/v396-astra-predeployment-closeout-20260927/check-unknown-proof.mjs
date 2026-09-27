// Pure offline adversarial readback: imports only the built occupancy predicates, no runtime/store/network.
import {writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..');
const {hasVerifiedNoActiveRisk,entryOrderOccupiesRisk,entryIdentityTombstone,durableEntryClaimActive}=await import(pathToFileURL(path.join(root,'apps/engine/dist/services/entryRiskOccupancy.js')).href);
const now=1790491200000;
const order={id:'offline_unknown',intentId:'offline_intent',symbol:'FIXTUREUSDT',side:'LONG',status:'UNKNOWN',clientOrderId:'offline_client',exchangeOrderId:null,quantity:1,price:100,filledQuantity:0,activeRiskExposure:false};
const valid={status:'VERIFIED_NO_ACTIVE_RISK',sources:['BINANCE_EXACT_ORDER_NOT_FOUND','BINANCE_OPEN_ORDERS_IDENTITY_ABSENT','BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT','BINANCE_LONG_SHORT_POSITION_ZERO'],checkedAt:now-1000,validUntil:now+60000,identityTombstone:entryIdentityTombstone(order)};
const cases=[['valid-proof',{},true],['expired',{validUntil:now-1},false],['identity-mismatch',{identityTombstone:'ENTRY:OTHER:other'},false],['null-checked-at',{checkedAt:null},false],['missing-sources',{sources:[]},false],['future-checked-at',{checkedAt:now+600000},false]];
const results=cases.map(([id,over,expectedValid])=>{const row={...order,activeRiskEvidence:{...valid,...over}},actualValid=hasVerifiedNoActiveRisk(row,now);return{id,evidence:row.activeRiskEvidence,expectedValid,actualValid,occupiesRisk:entryOrderOccupiesRisk(row,now),durableClaimActive:durableEntryClaimActive(row,now),invariantPass:actualValid===expectedValid};});
const report={schema:'V396_UNKNOWN_PROOF_NEGATIVE_CONTROL_1',classification:'SYNTHETIC_OFFLINE_COUNTEREXAMPLE_NOT_RUNTIME_EVIDENCE',now,source:'apps/engine/src/services/entryRiskOccupancy.ts:10',results,blockers:results.filter(row=>!row.invariantPass).map(row=>row.id),resolution:'HUMAN_DECISION_REQUIRED: predicate hardening changes actual occupancy/claim behavior, prohibited by closeout Phase 2. Do not repair solely in telemetry and hide execution discrepancy.'};
writeFileSync(path.join(out,'unknown-proof-negative-control.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=report.blockers.length?2:0;
