// Operator-authorized CPU sampling of the proven localhost Engine; no trading calls.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const pid=Number(process.argv[2]),seconds=Number(process.argv[3]??45);
const loopSeconds=Number(process.argv[4]??seconds);
if(loopSeconds<seconds||loopSeconds>600)throw Error('Bounded fresh-loop duration required');
if(!Number.isInteger(pid)||pid<=0||seconds<1||seconds>60)throw Error('Bounded pid/duration required');
const root=path.dirname(fileURLToPath(import.meta.url));
if(typeof process._debugProcess!=='function')throw Error('Node debugger pid activation unavailable');
process._debugProcess(pid); // Same activation used by the Node inspect -p CLI.
let target;
for(let i=0;i<20;i++){
  try{target=(await(await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(1000)})).json())[0];if(target)break}catch{}
  await new Promise(r=>setTimeout(r,250));
}
if(!target||!target.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9229/'))throw Error('Loopback inspector absent');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let id=0;const pending=new Map();
ws.onmessage=e=>{const v=JSON.parse(String(e.data)),p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result)}};
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('RPC timeout '+method))},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}))});
const owner=await rpc('Runtime.evaluate',{expression:'process.pid',returnByValue:true});
if(owner.result?.value!==pid){ws.close();throw Error('Inspector owner mismatch; refusing to sample or close unrelated inspector');}
try{
  const diagnostic=await rpc('Runtime.evaluate',{expression:"(()=>{if(globalThis.__zdjReactivityProbe)throw Error('Probe already exists');const p=process.getBuiltinModule('node:perf_hooks');globalThis.__zdjReactivityProbe={loop:p.monitorEventLoopDelay({resolution:10}),start:Date.now(),memory:process.memoryUsage()};globalThis.__zdjReactivityProbe.loop.enable();return {startedAt:globalThis.__zdjReactivityProbe.start,memory:globalThis.__zdjReactivityProbe.memory};})()",returnByValue:true});
  if(diagnostic.exceptionDetails)throw Error('Diagnostic initialization failed');
  await rpc('Profiler.enable');await rpc('Profiler.setSamplingInterval',{interval:1000});await rpc('Profiler.start');
  await new Promise(r=>setTimeout(r,seconds*1000));
  const {profile}=await rpc('Profiler.stop');writeFileSync(path.join(root,'live-cpu.cpuprofile'),JSON.stringify(profile));
  if(loopSeconds>seconds)await new Promise(r=>setTimeout(r,(loopSeconds-seconds)*1000));
  const interval=await rpc('Runtime.evaluate',{expression:"(()=>{const p=globalThis.__zdjReactivityProbe;if(!p)throw Error('Probe missing');p.loop.disable();const r={startedAt:p.start,endedAt:Date.now(),scope:'FRESH_PROFILE_INTERVAL_ONLY',eventLoopDelayMs:{max:p.loop.max/1e6,p95:p.loop.percentile(95)/1e6,p99:p.loop.percentile(99)/1e6},memoryBefore:p.memory,memoryAfter:process.memoryUsage()};delete globalThis.__zdjReactivityProbe;return r;})()",returnByValue:true});
  writeFileSync(path.join(root,'fresh-profile-interval.json'),JSON.stringify(interval.result?.value??interval,null,2));
  const counts=new Map(),nodes=new Map(profile.nodes.map(n=>[n.id,n]));for(const sample of profile.samples??[])counts.set(sample,(counts.get(sample)??0)+1);
  const hot=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([key,n])=>({samples:n,...nodes.get(key)?.callFrame}));
  writeFileSync(path.join(root,'cpu-profile-hot.json'),JSON.stringify({pid,seconds,totalSamples:profile.samples?.length,hot},null,2));
  console.log(JSON.stringify({pid,seconds,totalSamples:profile.samples?.length,hot:hot.slice(0,12)}));
}finally{
  try{await rpc('Runtime.evaluate',{expression:"if(globalThis.__zdjReactivityProbe){globalThis.__zdjReactivityProbe.loop.disable();delete globalThis.__zdjReactivityProbe;} undefined"})}catch{}
  // Only close the inspector activated by this operator probe; no engine stop/restart.
  try{await rpc('Runtime.evaluate',{expression:"setImmediate(()=>process.getBuiltinModule('node:inspector').close()); undefined"})}catch{}
  ws.close();
}
