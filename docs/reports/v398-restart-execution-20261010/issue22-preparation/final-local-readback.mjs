import {writeFileSync} from 'node:fs';
const get=async route=>{const r=await fetch('http://127.0.0.1:8080'+route,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('LOCAL_HTTP_'+r.status);return r.json();};
const [h,c,p]=await Promise.all(['/health','/api/v3/diagnostics/closeout','/api/v3/diagnostics/private-sync'].map(get));
const result={observedAt:new Date().toISOString(),localMethods:['GET'],taskExchangeRequests:0,taskExchangeWrites:0,lifecycleAttempts:0,identity:{pid:h.pid,instanceId:h.runtime.instanceId,buildId:h.runtime.buildId,status:h.status},privateSync:{snapshotAgeMs:p.sync.snapshotAgeMs,consecutiveFailures:p.sync.consecutiveFailures,lastError:p.sync.lastError},localTp:c.pipeline.takeProfit,production:c.productionWriteBoundary,signedTpAuthority:'NO_NEW_SIGNED_SAMPLE_THIS_PREPARATION; 06:21_SAMPLE_IS_HISTORY_REFRESH_BEFORE_CUTOVER',acceptance24h:'NOT_STARTED',t0:null};
writeFileSync(new URL('./preparation-final-local.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
