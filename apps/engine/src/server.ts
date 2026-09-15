import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { EngineRuntime } from './runtime/appRuntime.js';
import { createApiRouter } from './api/router.js';
import { createRuntimeSettingsResourcesRouter } from './api/runtimeSettingsResources.js';
import { attachWs } from './realtime/wsServer.js';
import { BUILD_VERSION, RELEASE_VERSION } from '@zdj/contracts';

export function createHttpServer(runtime:EngineRuntime){
  const app=express(),loop=monitorEventLoopDelay({resolution:10}),latencies:number[]=[];loop.enable();let lastCpu=process.cpuUsage(),lastCpuAt=performance.now(),cpuPercent=0;
  const httpMetrics=()=>{const now=performance.now(),cpu=process.cpuUsage(lastCpu),elapsed=Math.max(1,now-lastCpuAt);cpuPercent=(cpu.user+cpu.system)/1000/elapsed*100;lastCpu=process.cpuUsage();lastCpuAt=now;const sorted=[...latencies].sort((a,b)=>a-b),pct=(p:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]!:0,mem=process.memoryUsage();return{asOf:Date.now(),requests:latencies.length,latencyMs:{p50:pct(.5),p95:pct(.95),p99:pct(.99),max:sorted.at(-1)??0},eventLoopDelayMs:{p50:Number((loop.percentile(50)/1e6).toFixed(3)),p95:Number((loop.percentile(95)/1e6).toFixed(3)),p99:Number((loop.percentile(99)/1e6).toFixed(3)),max:Number((loop.max/1e6).toFixed(3))},cpuPercent:Number(cpuPercent.toFixed(2)),memory:{rss:mem.rss,heapUsed:mem.heapUsed,heapTotal:mem.heapTotal}};};
  app.disable('x-powered-by');app.use((req,res,next)=>{const started=performance.now(),id=String(req.header('x-request-id')??randomUUID());res.setHeader('x-request-id',id);res.once('finish',()=>{latencies.push(Number((performance.now()-started).toFixed(3)));if(latencies.length>2048)latencies.shift();});next();});
  app.get('/live',(_q,res)=>res.json({status:'LIVE',service:'zdj-engine-v3',pid:process.pid,ts:Date.now()}));
  app.get('/api/v3/diagnostics/http',(_q,res)=>res.json(httpMetrics()));
  app.use(express.json({limit:'2mb'}));
  app.get('/health',(_q,res)=>{const health=runtime.readiness(),status=runtime.runtimeStatus(),production=runtime.state.settings.connections.exchange.environment==='PRODUCTION';res.status(health.ready?200:503).json(production?{status:health.status,ready:health.ready,service:'zdj-engine-v3',version:RELEASE_VERSION,pid:process.pid,ts:Date.now()}:{...health,service:'zdj-engine-v3',version:RELEASE_VERSION,buildVersion:BUILD_VERSION,pid:process.pid,ts:Date.now(),runtime:status,shadow:runtime.shadow.status(),autoResume:status.autoResume,autoFrozen:status.autoFrozen});});
  app.use('/api/v3',(req,res,next)=>{if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const origin=req.header('origin');if(origin){try{if(new URL(origin).host!==req.header('host'))return res.status(403).json({error:{message:'MANAGEMENT_ORIGIN_REJECTED'}});}catch{return res.status(403).json({error:{message:'MANAGEMENT_ORIGIN_INVALID'}});}}if(runtime.state.settings.connections.exchange.environment==='PRODUCTION'){const expected=process.env.ZDJ_MANAGEMENT_TOKEN??'',presented=req.header('x-zdj-management-token')??req.header('authorization')?.replace(/^Bearer\s+/i,'')??'';const a=Buffer.from(expected),b=Buffer.from(presented);if(!expected||a.length!==b.length||!timingSafeEqual(a,b))return res.status(403).json({error:{message:'PRODUCTION_MANAGEMENT_AUTH_REQUIRED'}});}next();});
  app.use('/api/v3',createRuntimeSettingsResourcesRouter(runtime));
  app.use('/api/v3',createApiRouter(runtime));const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../dashboard/dist');
  if(existsSync(dist)){app.use(express.static(dist,{setHeaders:(res,file)=>{if(file.includes(`${path.sep}assets${path.sep}`))res.setHeader('Cache-Control','public,max-age=31536000,immutable');else res.setHeader('Cache-Control','no-cache');}}));app.use((req,res,next)=>{if(req.path.startsWith('/api/')||req.path==='/ws'||req.path==='/health')return next();res.setHeader('Cache-Control','no-cache');res.sendFile(path.join(dist,'index.html'));});}
  app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:{message:err instanceof Error?err.message:String(err)}});});
  const server=createServer(app);attachWs(server,runtime.events);return{app,server};
}
