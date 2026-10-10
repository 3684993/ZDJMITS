import {open} from 'node:fs/promises';
import path from 'node:path';
import {GpuSnapshotSchema,type GpuPerformanceRead,type GpuSnapshot} from '@zdj/contracts';
const maxBytes=65536;
async function readBounded(file:string){
  const handle=await open(file,'r');
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maxBytes)throw new Error('GPU_SNAPSHOT_SIZE');
    const buffer=Buffer.alloc(maxBytes+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>maxBytes)throw new Error('GPU_SNAPSHOT_SIZE');return buffer.subarray(0,bytesRead).toString('utf8').replace(/^\uFEFF/,'');
  }finally{await handle.close();}
}
export function createGpuPerformanceReader(options:{file?:string;now?:()=>number;readText?:()=>Promise<string>}={}){
  const now=options.now??Date.now,readText=options.readText??(()=>readBounded(options.file??path.resolve('scripts/performance/gpu-snapshot.json')));
  let history:GpuSnapshot[]=[],dropped=0,cached:GpuSnapshot|null=null,checkedAt=-Infinity,reason:string|null=null;
  let flight:Promise<void>|null=null;
  async function refresh(){try{
    const raw=await readText();if(Buffer.byteLength(raw)>maxBytes)throw new Error('GPU_SNAPSHOT_SIZE');
    const sample=GpuSnapshotSchema.parse(JSON.parse(raw));
    if(sample.asOf>now()+1000)throw new Error('GPU_SNAPSHOT_FUTURE');
    if(cached&&sample.instanceId===cached.instanceId&&sample.asOf<cached.asOf)throw new Error('GPU_SNAPSHOT_REGRESSION');
    if(cached?.instanceId!==sample.instanceId){history=[];dropped=0;}
    if(cached?.asOf!==sample.asOf||cached.instanceId!==sample.instanceId){history.push(sample);if(history.length>361){history.shift();dropped++;}}
    cached=sample;reason=null;
  }catch{reason='GPU_SNAPSHOT_UNAVAILABLE_OR_INVALID';}finally{checkedAt=now();}}
  async function read():Promise<GpuPerformanceRead>{
    if(now()-checkedAt>=10000){if(!flight)flight=refresh().finally(()=>{flight=null;});await flight;}
    const status=reason?'UNKNOWN':!cached?'UNKNOWN':now()-cached.asOf>45000?'STALE':'MEASURED';
    return {asOf:cached?.asOf??null,instanceId:cached?.instanceId??null,sampleSource:'WINDOWS_WDDM_PROCESS_COUNTERS',ttlMs:45000,measureStatus:status,reason,
      services:status==='MEASURED'?cached!.services.map(r=>({...r})):cached?.services.map(r=>({...r,measureStatus:status,utilizationPct:null,dedicatedBytes:null,sharedBytes:null}))??[],
      history:structuredClone(history),window:{coveredFrom:history[0]?.asOf??null,coveredTo:history.at(-1)?.asOf??null,sampleCount:history.length,droppedSampleCount:dropped},unit:{utilization:'% busiest process engine',memory:'bytes'}};
  }
  return {read};
}
