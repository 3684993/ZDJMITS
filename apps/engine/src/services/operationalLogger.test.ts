import {it,expect} from 'vitest';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {gunzipSync} from 'node:zlib';
import {OperationalLogger,isTelemetry} from './operationalLogger.js';
it('reduces repeated telemetry while retaining parseable correlated events across rotations',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-log-'));const logger=new OperationalLogger(dir,{instanceId:'test',buildId:'hash',environment:'MOCK'},{maxFileBytes:1500});
 try{for(let i=0;i<1000;i++)logger.record({type:'CANDIDATE_RANKING_SHADOW',ts:Date.now(),payload:{huge:'x'.repeat(10000)}});
 for(let i=0;i<20;i++)logger.record({id:`e${i}`,type:'ENTRY_SUBMIT_ATTEMPTED',ts:Date.now(),symbol:'BTCUSDT',payload:{runId:`r${i}`,apiSecret:'never-export'}});
 await logger.close();const files=await readdir(dir),contents=await Promise.all(files.map(async f=>{const b=await readFile(path.join(dir,f));return f.endsWith('.gz')?gunzipSync(b).toString():b.toString();})),rows=contents.join('').trim().split('\n').map(s=>JSON.parse(s));
 expect(files.some(f=>f.endsWith('.gz'))).toBe(true);expect(rows.filter(r=>r.event==='ENTRY_SUBMIT_ATTEMPTED')).toHaveLength(20);expect(rows.find(r=>r.event==='TELEMETRY_HEARTBEAT').payload.counts.CANDIDATE_RANKING_SHADOW).toBe(1000);expect(contents.join('')).not.toContain('never-export');expect(Buffer.byteLength(contents.join(''))).toBeLessThan(100000);expect(logger.health().droppedOperational).toBe(0);
 }finally{await logger.close();await rm(dir,{recursive:true,force:true});}
});
it('classifies duplicate operational lifecycle facts as telemetry but keeps trading audit lossless',()=>{
 expect(isTelemetry('AI_RUN_STARTED')).toBe(true);expect(isTelemetry('AI_RUN_COMPLETED')).toBe(true);expect(isTelemetry('PRIVATE_SYNC_COMPLETED')).toBe(true);expect(isTelemetry('RECONCILIATION_COMPLETED')).toBe(true);
 expect(isTelemetry('ENTRY_SUBMIT_ATTEMPTED')).toBe(false);expect(isTelemetry('ENTRY_ORDER_CREATED')).toBe(false);expect(isTelemetry('ENTRY_FILLED')).toBe(false);expect(isTelemetry('TP_ORDER_REJECTED')).toBe(false);
});
