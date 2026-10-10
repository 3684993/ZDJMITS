// Deterministic OFFLINE simulation, no Engine, model, exchange or sockets.
import {AiPhysicalResourceScheduler} from '../../apps/engine/dist/services/aiPhysicalResourceScheduler.js';
import {writeFileSync} from 'node:fs';
const resource=(id,port,role)=>({id,baseUrl:`http://127.0.0.1:${port}/v1`,role,enabled:true,status:'ONLINE',maxConcurrency:1});
const home={PRIMARY_BRAIN:resource('primary',8084,'PRIMARY_BRAIN'),REVIEW_BRAIN:resource('review',8083,'REVIEW_BRAIN')};
const identities=Object.values(home).map(r=>({endpoint:r.baseUrl,physicalServiceId:r.id,modelSha256:'a'.repeat(64),templateSha256:'a'.repeat(64),contextSize:32768,outputContractHash:'a'.repeat(64),generationConfigHash:'a'.repeat(64)}));
const jobs=Array.from({length:100},(_,i)=>({id:i,at:i*20,role:i%5===4?'REVIEW_BRAIN':'PRIMARY_BRAIN',duration:i%5===4?40:80,deadline:i*20+6000}));
const p95=a=>a.length?[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1]:null;
function replay(borrowIdle){
 const scheduler=new AiPhysicalResourceScheduler({borrowIdle,identities}),queue=[],active=[],completed=[];let next=0;
 for(let t=0;t<10000;t+=10){
  for(const r of [...active])if(r.end<=t){r.lease.release();active.splice(active.indexOf(r),1);completed.push(r);}
  while(jobs[next]?.at<=t)queue.push(jobs[next++]);
  // Owed review has dispatch priority. Primary borrowing cannot displace it.
  queue.sort((a,b)=>(a.role==='REVIEW_BRAIN'?0:1)-(b.role==='REVIEW_BRAIN'?0:1)||a.at-b.at);
  for(const j of [...queue]){
   const owed=queue.some(k=>k.role==='REVIEW_BRAIN'&&k!==j),target=scheduler.select(home[j.role],Object.values(home),j.role==='PRIMARY_BRAIN'&&owed);
   if(!target)continue;const lease=scheduler.tryAcquire(target);if(!lease)throw new Error('NON_ATOMIC_DISPATCH');
   queue.splice(queue.indexOf(j),1);active.push({...j,start:t,end:t+j.duration,target:target.id,lease});
  }
  if(next===jobs.length&&!queue.length&&!active.length)break;
 }
 const primary=completed.filter(j=>j.role==='PRIMARY_BRAIN'),review=completed.filter(j=>j.role==='REVIEW_BRAIN');
 return{mode:borrowIdle?'PROVEN_EQUIVALENT_IDLE_BORROW':'FIXED_HOME',jobCount:jobs.length,completed:completed.length,primaryCount:primary.length,reviewCount:review.length,primaryQueueP95Ms:p95(primary.map(j=>j.start-j.at)),reviewQueueP95Ms:p95(review.map(j=>j.start-j.at)),reviewOverdue:review.filter(j=>j.start>j.deadline).length,failure:0,exchangeWrites:0,entryAuthorizations:0,borrowed:completed.filter(j=>j.target!==home[j.role].id).length};
}
const report={scope:'OFFLINE SYNTHETIC IDENTICAL JOBS; NOT LIVE GPU OR AUTHORIZATION REPLAY',jobsHashInput:jobs,baseline:replay(false),candidate:replay(true)};
if(report.baseline.completed!==100||report.candidate.completed!==100||report.candidate.reviewOverdue)throw new Error('REPLAY_INCOMPLETE');
writeFileSync('docs/reports/v398-performance-dashboard-20261010/lease-offline-replay.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({baseline:report.baseline,candidate:report.candidate}));
