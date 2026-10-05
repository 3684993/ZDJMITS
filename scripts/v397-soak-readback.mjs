// Read-only runtime evidence. No settings, credentials, or exchange write endpoints.
import {writeFileSync} from 'node:fs';
import path from 'node:path';

const base=process.argv[2]??'http://127.0.0.1:8080';
const out=process.argv[3];
if(!/^http:\/\/127\.0\.0\.1:8080\/?$/.test(base)||!out)throw new Error('LOCAL_8080_AND_OUTPUT_REQUIRED');
async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`${url}:HTTP_${response.status}`);return response.json();}
const [health,snapshot,pipeline,closeout,governance,incidents,web]=await Promise.all([
  get(`${base}/health`),get(`${base}/api/v3/snapshot`),get(`${base}/api/v3/pipeline`),
  get(`${base}/api/v3/diagnostics/closeout`),get(`${base}/api/v3/diagnostics/binance-governance`),
  get(`${base}/api/v3/operational-incidents`).catch(error=>({unavailable:String(error)})),
  fetch(`${base}/`,{signal:AbortSignal.timeout(15_000)}).then(response=>({status:response.status,contentType:response.headers.get('content-type')})),
]);
const ai=await Promise.all([8081,8083,8084].map(async port=>{try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(5000)});return{port,httpStatus:response.status,body:response.ok?await response.json().catch(()=>null):null};}catch(error){return{port,error:String(error)};}}));
const routes=(governance.routes??[]).map(route=>({environment:route.environment,rest:route.rest,ws:route.ws,egress:route.egress,recentFailures:route.recentFailures,requestBudget:{status:route.requestBudget?.status,observationTrust:route.requestBudget?.observationTrust,admissionObservedWeight1m:route.requestBudget?.admissionObservedWeight1m,requestWeightLimit1m:route.requestBudget?.requestWeightLimit1m,laneStats:route.requestBudget?.laneStats,attribution:route.requestBudget?.attribution,recentDispatches:(route.requestBudget?.recentDispatches??[]).slice(-30)}}));
const result={capturedAt:new Date().toISOString(),readOnly:true,web,health:{status:health.status,ready:health.ready,pid:health.pid,buildVersion:health.buildVersion,version:health.version},runtime:closeout.runtime,persistence:closeout.persistence,productionWriteBoundary:closeout.productionWriteBoundary,pipeline:{state:pipeline.pipelineState,marketDataReason:pipeline.marketDataReason,marketDataDetail:pipeline.marketDataDetail,marketDataIsolation:pipeline.marketDataIsolation,privateSync:pipeline.privateSync,capacity:pipeline.capacity,capacityVisibility:pipeline.capacityVisibility,entryPermission:pipeline.entryPermission,pendingEntries:pipeline.pendingEntries,analysis:pipeline.analysis,aiHealth:pipeline.aiHealth,noEntryReason:pipeline.noEntryReason},account:snapshot.account,localAccounting:snapshot.localAccounting,tradeNetPnl:snapshot.tradeNetPnl,tradeFundingUnknownCount:snapshot.tradeFundingUnknownCount,executionTruth:snapshot.executionTruth,entryOrders:snapshot.entryOrders?.filter(row=>['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(row.status)),positionCount:snapshot.positions?.length,positions:snapshot.positions?.map(row=>({symbol:row.symbol,side:row.side,quantity:row.quantity,tpStatus:row.tpStatus})),tpOrderCount:snapshot.tpOrders?.length,ai,binanceRoutes:routes,incidents};
writeFileSync(path.resolve(out),`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({output:path.resolve(out),capturedAt:result.capturedAt,build:result.health.buildVersion,positions:result.positionCount,activeIncidents:result.incidents.active?.length??null,productionWrites:result.productionWriteBoundary?.productionWrites??null}));
