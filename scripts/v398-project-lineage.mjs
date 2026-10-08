// Offline production projector against bounded sanitized evidence, never live runtime.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {projectEntryLineage} from '../apps/engine/dist/services/entryLineage.js';
const dir='docs/reports/v398-entry-sizing-quality-review/evidence-20261008';
const read=name=>JSON.parse(readFileSync(`${dir}/${name}`,'utf8'));
const entities=JSON.parse(gunzipSync(readFileSync(`${dir}/bounded-entities.json.gz`)));
const runs=JSON.parse(gunzipSync(readFileSync(`${dir}/linked-primary-runs.json.gz`)));
const context={...entities,aiRuns:Object.values(runs),entryIntents:new Map(entities.entryIntents.map(r=>[r.id,r])),entryOrders:new Map(entities.entryOrders.map(r=>[r.id,r])),tradePlans:new Map(entities.tradePlans.map(r=>[r.planId,r]))};
const records=read('trade-records-bounded.json');
const rows=records.map(record=>({tradeId:record.tradeId,symbol:record.symbol,side:record.direction,cycleId:record.cycleId,status:record.status,lineage:projectEntryLineage(record,context)}));
writeFileSync(`${dir}/entry-quantity-lineage.jsonl.gz`,gzipSync(Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n'),{mtime:0}));
const cases=entities.positions.filter(p=>['ETHUSDT','AVAXUSDT'].includes(p.symbol)&&((p.symbol==='ETHUSDT'&&p.side==='LONG')||(p.symbol==='AVAXUSDT'&&p.side==='SHORT'))).map(position=>{
 const record=records.find(r=>r.cycleId===position.cycleId&&r.direction===position.side);
 const line=rows.find(r=>r.tradeId===record?.tradeId);
 const orders=entities.entryOrders.filter(o=>o.symbol===position.symbol&&o.side===position.side&&o.createdAt>=position.openedAt-60000&&o.filledQuantity>0);
 return {position,record,lineage:line?.lineage??null,independentFilledOrderIdentities:orders.map(o=>({intentId:o.intentId,orderId:o.id,exchangeOrderId:o.exchangeOrderId,clientOrderId:o.clientOrderId,quantity:o.quantity,filledQuantity:o.filledQuantity,price:o.price,status:o.status,createdAt:o.createdAt,updatedAt:o.updatedAt})),note:'Position addCount is not number of independently authorized add orders; older retention/partial stages remain separate'};
});
writeFileSync(`${dir}/eth-avax-case-facts.json`,JSON.stringify(cases,null,2)+'\n');
const recent=records.filter(r=>r.closedAt>=Date.UTC(2026,9,1,11,22,30));
const summary={records:records.length,fullLotExact:rows.filter(r=>r.lineage.complete).length,recentClosed:recent.length,recentFundingUnknown:recent.filter(r=>r.fundingAttributionStatus!=='EXACT').length,cases:cases.map(c=>({symbol:c.position.symbol,positionAddCount:c.position.addCount,recordLots:c.record?.entryLots?.length,retainedIndependentFilledOrders:c.independentFilledOrderIdentities.length,complete:c.lineage?.complete,reasons:c.lineage?.reasons}))};
writeFileSync(`${dir}/lineage-summary.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
