import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hash = v => v == null ? null : createHash('sha256').update(String(v)).digest('hex');
const pick = (v, keys) => Object.fromEntries(keys.filter(k => v?.[k] !== undefined).map(k => [k,v[k]]));
const at=Date.now();
async function get(path){const response=await fetch('http://127.0.0.1:8080'+path,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('HTTP_'+response.status);return response.json();}
const [h,c,s,p,o]=await Promise.all(['/health','/api/v3/diagnostics/closeout','/api/v3/diagnostics/private-sync','/api/v3/positions','/api/v3/orders'].map(get));
const result={observedAt:new Date(at).toISOString(),localMethods:['GET'],taskExchangeWrites:0,
 health:pick(h,['status','ready','pid','version']),identity:pick(h.runtime,['instanceId','pid','buildId','version','uptimeMs']),
 production:c.productionWriteBoundary,entry:c.pipeline.entryPermission,runtimeControl:pick(c.pipeline.runtimeControl,['mode','reasonCode','reasonText','pausedAt']),
 privateSync:pick(s.sync,['lastSuccessAt','lastFailureAt','consecutiveFailures','lastError','durationMs','inFlight','snapshotAgeMs']),
 takeProfitLocal:c.pipeline.takeProfit,privateAuthority:'LOCAL_CACHED_FACTS_ONLY_NOT_FRESH_SIGNED_EXCHANGE_PROOF',
 primary:pick(c.pipeline.primaryBrain,['status','runs','historicalRuns','idleReason','healthReason','lastRunAgeMs']),
 pipeline:pick(c.pipeline,['pipelineState','authoritativeBlocker','marketDataReason','freshMarkets','noEntryReason']),
 market:c.pipeline.market,analysis:c.pipeline.analysis,
 positions:p.map(x=>({...pick(x,['symbol','side','qty','quantity','tpStatus','openedAt']),positionIdHash:hash(x.id),tpOrderIdHash:hash(x.tpOrderId)})),
 takeProfit:o.takeProfit.filter(x=>p.some(v=>v.tpOrderId===x.id)).map(x=>({...pick(x,['symbol','side','qty','quantity','remainingQty','price','reduceOnly','status','verifiedAt','updatedAt']),idHash:hash(x.id),positionIdHash:hash(x.positionId),exchangeOrderIdHash:hash(x.exchangeOrderId),clientOrderIdHash:hash(x.clientOrderId)})),
 requestBudgets:Object.fromEntries(Object.entries(s.requests).map(([scope,b])=>[scope,{...pick(b,['status','active','queued','queuePressure','decisions']),recentDispatches:b.recentDispatches.map(x=>pick(x,['requestId','endpoint','source','purpose','decision','admittedAt','completedAt','status','networkTiming']))}]))};
writeFileSync(new URL('./runtime-snapshot.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({observedAt:result.observedAt,identity:result.identity,entry:result.entry,private:result.privateSync,tp:result.takeProfitLocal,positions:p.length,orders:o.takeProfit.length,production:result.production,primary:result.primary}));
