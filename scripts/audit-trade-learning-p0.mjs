import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {projectTradeRecordRow,projectTradeRecordSummary} from '../apps/engine/dist/services/tradeRecordReadModel.js';
import {projectEntryLineage} from '../apps/engine/dist/services/entryLineage.js';
import {projectExitProvenance} from '../apps/engine/dist/services/exitProvenance.js';
import {OrderProvenanceRegistry} from '../apps/engine/dist/services/orderProvenanceRegistry.js';
import {FundingIncomeLedger,cycleFundingFact} from '../apps/engine/dist/services/fundingIncomeLedger.js';

// Frozen local evidence only: no network, no live SQLite, no runtime import or exchange adapter.
const source='docs/reports/v397-trade-entry-exit-quality-review-20261008';
const target='docs/reports/v397-trade-learning-p0-20261008';
const inputs={};
const read=name=>{const b=readFileSync(`${source}/${name}`);inputs[name]=createHash('sha256').update(b).digest('hex');return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));};
const all=read('trade-records-bounded.json'),before=read('recent-cycle-quality-metrics.json'),entities=read('analysis-entities-slim.json'),runs=read('linked-primary-runs.json');
const authorityBytes=readFileSync(`${target}/lineage-authority-subset.json.gz`),authority=JSON.parse(gunzipSync(authorityBytes).toString('utf8'));
inputs['lineage-authority-subset.json.gz']=createHash('sha256').update(authorityBytes).digest('hex');
for(const kind of ['entryIntents','entryOrders','tradePlans']){const key=kind==='tradePlans'?'planId':'id',merged=new Map(entities[kind].map(r=>[r[key],r]));for(const r of authority[kind])merged.set(r[key],r);entities[kind]=[...merged.values()];}
const context={...entities,aiRuns:Object.values(runs)};
for(const name of ['manualOrders','tpOrders','entryOrders','entryIntents'])context[name]=new Map(entities[name].map(r=>[r.id,r]));
context.tradePlans=new Map(entities.tradePlans.map(r=>[r.planId,r]));
const ids=new Set(before.map(r=>r.tradeId)),records=all.filter(r=>ids.has(r.tradeId));
if(records.length!==165)throw new Error('FROZEN_COHORT_NOT_165');
const rows=records.map(record=>{
 const projected=projectTradeRecordRow(record,{learningContext:context});
 const line=projectEntryLineage(record,context);
 const run=runs[record.entryRunId];
 return {tradeId:record.tradeId,symbol:record.symbol,cycleId:record.cycleId,exit:projectExitProvenance(record,context),fundingStatus:record.fundingAttributionStatus,funding:record.funding,lineage:line,originTemporalInvalid:!!run&&Number.isFinite(run.completedAt)&&record.openedAt!=null&&run.completedAt>record.openedAt,eligibility:projected.economicEligibility,moneyAsset:projected.moneyAsset};
});
const localFunding=JSON.parse(readFileSync(`${target}/local-funding-facts.json`,'utf8'));
const fundingLedger=new FundingIncomeLedger(':memory:',()=>({environment:'TESTNET',account:'binance-primary'}));
let localFundingProofs;
try {
  const scoped=localFunding.income.filter(r=>r.environment==='TESTNET'&&r.account_id==='binance-primary');
  fundingLedger.recordRows(scoped.map(r=>({incomeId:r.income_id,asset:r.asset,symbol:r.symbol,incomeType:r.income_type,income:r.income,time:r.time,source:r.source,observedAt:r.observed_at})));
  for(const r of localFunding.coverage.filter(r=>r.environment==='TESTNET'&&r.account_id==='binance-primary'))fundingLedger.recordCoverage({asset:r.asset,sinceMs:r.since_ms,untilMs:r.until_ms,pages:r.pages,rows:r.rows,complete:r.complete===1,observedAt:r.observed_at,reason:r.reason});
  localFundingProofs=records.map(record=>{const fact=cycleFundingFact(fundingLedger,record,all,1791455345489);return {tradeId:record.tradeId,symbol:record.symbol,status:fact.status,native:fact.fundingNative,reason:fact.reason,coverageComplete:fact.coverageComplete,observedFundingRows:fact.observedFundingRows,learningProof:fact.learningProof};});
} finally {fundingLedger.close();}
const counts=arr=>arr.reduce((a,v)=>(a[v]=(a[v]??0)+1,a),{});
const golden=JSON.parse(readFileSync('apps/engine/src/services/fixtures/p0-exit-golden.json','utf8'));
const cases=golden.map(c=>{
 const registry=new OrderProvenanceRegistry(':memory:',()=>({environment:'TESTNET',account:'binance-primary'}));
 try{for(const r of c.registry)registry.record(r);return {symbol:c.symbol,tradeId:c.record.tradeId,before:c.symbol==='ETHFIUSDC'?'CONFLICT':'SYSTEM_MANUAL',after:projectExitProvenance(c.record,{executionFills:c.fills,manualOrders:new Map(c.manualOrders.map(r=>[r.id,r])),tpOrders:new Map(c.tpOrders.map(r=>[r.id,r])),orderProvenance:registry})};}finally{registry.close();}
});
const summary={method:'FROZEN_LOCAL_BOUNDED_FACT_REPROJECTION_V397_P0',cohort:165,inputs,limitations:['No live exchange/history replay','5000 retained fills; missing fills are unknown, never reconstructed','183 linked run IDs include empty archived payloads','Registry coverage outside the two golden cases is not complete; local exact order compatibility is explicitly bounded','Counts are the identical frozen rolling-week cohort, not live post-deployment results'],before:{canonicalEligible:before.filter(r=>r.formalCanonicalNetEligible).length,fundingUnknown:before.filter(r=>r.funding==null).length,provenance:counts(before.map(r=>r.closeProvenance))},after:{canonicalEligible:rows.filter(r=>r.eligibility.canonicalPnlEligible).length,fundingUnknown:rows.filter(r=>r.fundingStatus!=='EXACT'||r.funding==null).length,composition:counts(rows.map(r=>r.exit.exitComposition)),identityConflict:rows.filter(r=>r.exit.identityConflict).length,originTemporalInvalid:rows.filter(r=>r.originTemporalInvalid).length,fullLotLineageExactCycles:rows.filter(r=>r.lineage.complete).length,fullLotLineageUncertainCycles:rows.filter(r=>!r.lineage.complete).length,lineageReasons:counts(rows.flatMap(r=>r.lineage.reasons)),canonicalReasons:counts(rows.flatMap(r=>r.eligibility.canonicalReasons))},boundedLocalFundingSupplement:{sourceAt:localFunding.at,incomeRows:localFunding.income.length,coverageRows:localFunding.coverage.length,provenZero:localFundingProofs.filter(r=>r.status==='EXACT'&&r.native?.amount===0).length,unknown:localFundingProofs.filter(r=>r.status!=='EXACT').length,reasons:counts(localFundingProofs.filter(r=>r.status!=='EXACT').map(r=>r.reason)),persistedIntoLiveRecords:false,canonicalPromotionPerformed:false},cases,nativeAssetSummary:projectTradeRecordSummary({records,learningContext:context,asOf:1791455345489})};
mkdirSync(target,{recursive:true});
writeFileSync(`${target}/frozen-p0-summary.json`,JSON.stringify(summary,null,2)+'\n');
writeFileSync(`${target}/bounded-local-funding-proof-results.json`,JSON.stringify(localFundingProofs,null,2)+'\n');
const lossless=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
writeFileSync(`${target}/frozen-p0-record-projections.jsonl.gz`,gzipSync(lossless,{level:9,mtime:0}));
writeFileSync(`${target}/frozen-p0-projection-integrity.json`,JSON.stringify({rows:rows.length,uncompressedBytes:lossless.length,uncompressedSha256:createHash('sha256').update(lossless).digest('hex'),compression:'lossless gzip'},null,2)+'\n');
console.log(JSON.stringify({before:summary.before,after:summary.after,boundedLocalFundingSupplement:summary.boundedLocalFundingSupplement,cases:cases.map(c=>({symbol:c.symbol,composition:c.after.exitComposition,finalizer:c.after.finalizer,conflict:c.after.identityConflict}))},null,2));
