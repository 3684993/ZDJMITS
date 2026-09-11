// Finite read-only observation. No Engine lifecycle or exchange write capability.
import {readFile,writeFile} from 'node:fs/promises';
const initial=JSON.parse(await readFile('data/runtime/engine-instance.json','utf8'));
const output='docs/reports/v391-continuous-observation-20260910.json',samples=[],startedAt=Date.now();let readyAt=null,status='WARMUP';
const get=async path=>{const t=performance.now(),r=await fetch('http://127.0.0.1:8080'+path,{signal:AbortSignal.timeout(5000)});return {http:r.status,latencyMs:performance.now()-t,body:await r.json()};};
while(Date.now()-startedAt<25*3600000){
 const sample={at:Date.now()};
 try{const [live,closeout,http,logging,p0,health]=await Promise.all(['/live','/api/v3/diagnostics/closeout','/api/v3/diagnostics/http','/api/v3/diagnostics/logging','/api/v3/diagnostics/p0-entry-integrity','/health'].map(get));
  if(live.body.pid!==initial.pid)throw new Error('ENGINE_BASELINE_CHANGED');
  const d=closeout.body,p=d.pipeline,hot=d.hot??[];sample.latencyMs={live:live.latencyMs,closeout:closeout.latencyMs};sample.httpMetrics=http.body;sample.privateStatus=p.binancePrivate.status;sample.privateAgeMs=p.binancePrivate.snapshotAgeMs;sample.pool=p.pool;sample.hot=hot;sample.reconciliation=p.reconciliation;sample.tp=p.takeProfit;sample.p0=p0.body;sample.logging=logging.body;sample.productionWriteBoundary=d.productionWriteBoundary;sample.work=p.work;
  sample.hotClosedFresh=hot.filter(row=>row.frames&&Object.values(row.frames).every(frame=>frame.followingBoundary)).length;
  sample.engineReady=health.http===200&&health.body.ready===true;
  if(!readyAt&&sample.engineReady&&p.scheduler.status==='RUNNING'&&p.binancePrivate.status==='READY'){readyAt=Date.now();status='RUNNING';}
 }catch(error){sample.error=error.message;if(error.message==='ENGINE_BASELINE_CHANGED')status='INVALIDATED';}
 samples.push(sample);
 if(!readyAt&&Date.now()-startedAt>15*60000)status='BOOTSTRAP_TIMEOUT';
 if(readyAt&&Date.now()-readyAt>=24*3600000)status='OBSERVATION_WINDOW_COMPLETE_REQUIRES_GATE_REVIEW';
 await writeFile(output,JSON.stringify({status,observerPid:process.pid,engine:initial,startedAt,readyAt,asOf:Date.now(),exchangeWrites:0,engineLifecycleActions:0,samples},null,2));
 if(!['WARMUP','RUNNING'].includes(status))break;
 await new Promise(resolve=>setTimeout(resolve,30000));
}
