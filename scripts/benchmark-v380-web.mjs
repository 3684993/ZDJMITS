import {mkdtemp,rm,stat} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import express from 'express';import {performance} from 'node:perf_hooks';
import {SettingsStore} from '../apps/engine/dist/config/settingsStore.js';import {EngineRuntime} from '../apps/engine/dist/runtime/appRuntime.js';import {createApiRouter} from '../apps/engine/dist/api/router.js';
const pct=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
const root=path.resolve('.'),archiveDir=await mkdtemp(path.join(os.tmpdir(),'zdj-v380-archive-')),snapshotDir=await mkdtemp(path.join(os.tmpdir(),'zdj-v380-snapshot-'));
let runtime,server,store;
try{
  store=new SettingsStore(path.join(root,'config'),archiveDir);await store.load();store.db.exec('PRAGMA synchronous=OFF; BEGIN IMMEDIATE');
  const insert=store.db.prepare('INSERT INTO ai_runs_archive(run_id,symbol,started_at,status,payload,updated_at,role,model,decision,direction,completed_at,latency_ms,input_tokens,output_tokens,short_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),filler='x'.repeat(40_000);
  for(let i=0;i<20_000;i++){const id=`run_${String(i).padStart(6,'0')}`,symbol=i%2?'ETHUSDT':'BTCUSDT',startedAt=1_800_000_000_000-Math.floor(i/2),row={id,symbol,startedAt,status:'COMPLETED',role:'PRIMARY_BRAIN',model:'qwen3.5:27b',decision:i%5?'NO_DIRECTION_EDGE':'WAIT_FOR_PRICE',direction:i%2?'LONG':'SHORT',inputPreview:filler};insert.run(id,symbol,startedAt,'COMPLETED',JSON.stringify(row),startedAt,'PRIMARY_BRAIN','qwen3.5:27b',row.decision,row.direction,startedAt+100,100,100,20,null);}
  store.db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
  const times20=[],times100=[],timesFilter=[];let page20,page100;
  for(let i=0;i<60;i++){let t=performance.now();page20=store.listAiRunSummaries({from:0,page:1,limit:20});times20.push(performance.now()-t);t=performance.now();page100=store.listAiRunSummaries({from:0,page:20,limit:100});times100.push(performance.now()-t);t=performance.now();store.listAiRunSummaries({from:0,page:5,limit:20,symbol:'BTCUSDT',decision:'WAIT_FOR_PRICE'});timesFilter.push(performance.now()-t);}
  const archiveBytes=(await stat(path.join(archiveDir,'zdj-settings.sqlite'))).size;
  store.close();store=null;
  runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:snapshotDir});const app=express();app.use('/api/v3',createApiRouter(runtime));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const port=server.address().port,snapshotTimes=[];let snapshotBytes=0;
  for(let i=0;i<60;i++){const t=performance.now(),response=await fetch(`http://127.0.0.1:${port}/api/v3/snapshot`),body=await response.arrayBuffer();snapshotTimes.push(performance.now()-t);snapshotBytes=body.byteLength;}
  console.log(JSON.stringify({archive:{rows:20000,bytes:archiveBytes,list20:{bytes:Buffer.byteLength(JSON.stringify(page20)),p50Ms:pct(times20,.5),p95Ms:pct(times20,.95)},list100:{bytes:Buffer.byteLength(JSON.stringify(page100)),p50Ms:pct(times100,.5),p95Ms:pct(times100,.95)},filtered:{p50Ms:pct(timesFilter,.5),p95Ms:pct(timesFilter,.95)}},snapshot:{bytes:snapshotBytes,p50Ms:pct(snapshotTimes,.5),p95Ms:pct(snapshotTimes,.95)}},null,2));
}finally{if(server)await new Promise(resolve=>server.close(resolve));runtime?.stop();store?.close();await rm(archiveDir,{recursive:true,force:true});await rm(snapshotDir,{recursive:true,force:true});}
