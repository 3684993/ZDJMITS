// Finite read-only acceptance observer. Never starts/stops the Engine or calls exchange APIs.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),samples=[],startedAt=Date.now();
async function get(path){const start=performance.now(),response=await fetch('http://127.0.0.1:8080'+path,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`HTTP_${response.status}:${path}`);return {body:await response.json(),ms:performance.now()-start};}
while(samples.length<120){
 const sample={at:Date.now()};
 try{
  const [p,s,storage,logging,p0,priv,write]=await Promise.all(['/api/v3/pipeline','/api/v3/snapshot','/api/v3/diagnostics/storage','/api/v3/diagnostics/logging','/api/v3/diagnostics/p0-entry-integrity','/api/v3/diagnostics/private-sync','/api/v3/runtime/risk-pause/preview'].map(get));
  const pool=s.body.pool,stale=new Set(p.body.freshMarkets.stale),freshPool=pool.filter(row=>!stale.has(row.symbol)).length;
  Object.assign(sample,{pipeline:p.body.pipelineState,private:p.body.binancePrivate,privateSync:priv.body.sync,poolCount:pool.length,poolReady:pool.filter(row=>row.state==='READY').length,poolFullyFresh:freshPool,globalKlineFreshRatio:p.body.freshMarkets.klineFreshRatio,capacity:p.body.capacity,noEntryReason:p.body.noEntryReason,tp:p.body.takeProfit,reconciliation:p.body.reconciliation,ai:s.body.aiResources.map(({model,totalRuns,failures,currentStatus,idleReason})=>({model,totalRuns,failures,currentStatus,idleReason})),storage:storage.body,logging:logging.body,p0:p0.body,writeBoundary:write.body.writeBoundary,latencyMs:{pipeline:p.ms,snapshot:s.ms}});
  if(logging.body.currentFile)sample.logBytes=(await stat(logging.body.currentFile)).size;
  const ps=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process -Id 8044,19692 -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress"],{windowsHide:true});sample.processes=JSON.parse(ps.stdout.trim());
 }catch(error){sample.error=error.message;}
 samples.push(sample);let soak;try{soak=JSON.parse(await readFile('docs/reports/v390-admission-soak.json','utf8'));}catch{}
 const complete=soak?.status==='COMPLETE'||soak?.status==='FAILED';
 await writeFile('docs/reports/v390-online-observation.json',JSON.stringify({status:complete?'COMPLETE':'RUNNING',startedAt,asOf:Date.now(),exchangeCalls:0,engineLifecycleActions:0,samples},null,2));
 if(complete)break;
 await new Promise(resolve=>setTimeout(resolve,30000));
}
