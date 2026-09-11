import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function summarize(samples){
 const rows=samples.filter(s=>s.phase!=='PRE_READY'),active=new Map(),episodes=[],totals={};let denominator=0,quote=0,book=0;
 const stamp=s=>Date.parse(s.timestamp),last=rows.length?stamp(rows.at(-1)):null;
 for(const s of rows){const at=stamp(s),present=new Set();denominator+=s.hotTotal??0;
  for(const [symbol,r]of Object.entries(s.symbols??{})){if(Number.isFinite(r.quoteAgeMs)&&r.quoteAgeMs>=0&&r.quoteAgeMs<=15000)quote++;if(Number.isFinite(r.bookAgeMs)&&r.bookAgeMs>=0&&r.bookAgeMs<=15000)book++;
   for(const tf of ['1m','5m','15m']){const k=symbol+':'+tf,f=r.frames?.[tf],ok=f?.isClosed===true&&f.followingBoundary===true&&f.gapCount===0&&!(r.reasons??[]).includes('TECHNICAL_'+tf+'_SEQUENCE_INVALID');present.add(k);totals[tf]=(totals[tf]??0)+(ok?1:0);
    if(!ok&&!active.has(k))active.set(k,{symbol,timeframe:tf,startObservedAt:at,previousHealthyAt:null});
    if(ok&&active.has(k)){const e=active.get(k);episodes.push({...e,endObservedAt:at,durationMs:at-e.startObservedAt,censored:false});active.delete(k);}
   }
  }
  for(const[k,e]of active)if(!present.has(k)){episodes.push({...e,endObservedAt:at,durationMs:at-e.startObservedAt,censored:true,reason:'LEFT_HOT_POOL_OR_MISSING_SAMPLE'});active.delete(k);}
 }
 for(const e of active.values())episodes.push({...e,endObservedAt:null,durationMs:last-e.startObservedAt,censored:true,reason:'WINDOW_END'});
 const recovered=episodes.filter(e=>!e.censored).map(e=>e.durationMs).sort((a,b)=>a-b),percentile=p=>recovered.length?recovered[Math.ceil(p*recovered.length)-1]:null;
 return{schemaVersion:'V3.9.2-TRAJECTORY-1',formalSamples:rows.length,preReadySamples:samples.length-rows.length,denominator,strictFreshness:Object.fromEntries(['1m','5m','15m'].map(tf=>[tf,denominator?(totals[tf]??0)/denominator:null])),quoteRate:denominator?quote/denominator:null,bookRate:denominator?book/denominator:null,episodes,recoveryObservedMs:{p50:percentile(.5),p95:percentile(.95),max:recovered.at(-1)??null},maxSamplingGapMs:rows.length>1?Math.max(...rows.slice(1).map((s,i)=>stamp(s)-stamp(rows[i]))):null,limitations:'Durations are observed sample transitions, not exact exchange events. Left-pool and window-end intervals are censored, never counted as recovery. API failures after formal start remain in raw evidence; missing Hot identity makes coverage UNKNOWN.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const dir=process.argv[2],rows=fs.readFileSync(path.join(dir,'samples.jsonl'),'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(JSON.parse);fs.writeFileSync(path.join(dir,'trajectories.json'),JSON.stringify(summarize(rows),null,2));}
