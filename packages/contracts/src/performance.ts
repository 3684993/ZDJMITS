import {z} from 'zod';
export type MeasureStatus='MEASURED'|'UNKNOWN'|'STALE';
export type PerformanceWindow={coveredFrom:number|null;coveredTo:number|null;sampleCount:number;droppedSampleCount:number};
export type HostPerformanceSample={
  asOf:number;instanceId:string;source:'NODE_OS_CPU_TIMES_AND_MEMORY';sampleSource:'NODE_OS_CPU_TIMES_AND_MEMORY';ttlMs:number;
  cpu:{usagePct:number|null;status:MeasureStatus;logicalProcessors:number|null;intervalMs:number|null};
  memory:{totalBytes:number|null;freeBytes:number|null;usedBytes:number|null;status:MeasureStatus};
  engine:{pid:number;rssBytes:number|null;heapUsedBytes:number|null;heapTotalBytes:number|null;externalBytes:number|null};
};
export type HostPerformanceRead=HostPerformanceSample&{history:HostPerformanceSample[];window:PerformanceWindow};
const nullableNonnegative=z.number().finite().nonnegative().nullable();
export const GpuProcessSampleSchema=z.object({
  resourceId:z.string().max(64),port:z.union([z.literal(8081),z.literal(8083),z.literal(8084)]),pid:z.number().int().positive().nullable(),
  processStartedAt:nullableNonnegative,duty:z.enum(['SCOUT','REVIEW_BRAIN','PRIMARY_BRAIN']),
  luid:z.array(z.string().regex(/^0x[0-9a-f]+_0x[0-9a-f]+$/i)).max(8),
  measureStatus:z.enum(['MEASURED','UNKNOWN','STALE']),utilizationPct:z.number().finite().min(0).max(100).nullable(),
  dedicatedBytes:nullableNonnegative,sharedBytes:nullableNonnegative,
  // Process counters prove PID utilization, never physical PCI attribution.
  physicalDeviceIdVerified:z.literal(false),physicalDeviceId:z.null(),
});
export type GpuProcessSample=z.infer<typeof GpuProcessSampleSchema>;
export const GpuSnapshotSchema=z.object({schemaVersion:z.literal(1),asOf:z.number().finite().positive(),instanceId:z.string().min(1).max(80),
  sampleSource:z.literal('WINDOWS_WDDM_PROCESS_COUNTERS'),ttlMs:z.literal(45000),services:z.array(GpuProcessSampleSchema).max(3),
}).superRefine((s,c)=>{const ports=new Set<number>();for(const r of s.services){
  const duty=r.port===8081?'SCOUT':r.port===8083?'REVIEW_BRAIN':'PRIMARY_BRAIN';
  if(ports.has(r.port)||r.resourceId!==`llama:${r.port}`||r.duty!==duty||r.pid===null&&r.measureStatus==='MEASURED'||r.measureStatus==='MEASURED'&&r.utilizationPct===null)c.addIssue({code:'custom',message:'GPU_PROCESS_IDENTITY_INVALID'});
  ports.add(r.port);
}});
export type GpuSnapshot=z.infer<typeof GpuSnapshotSchema>;
export type GpuPerformanceRead={asOf:number|null;instanceId:string|null;sampleSource:'WINDOWS_WDDM_PROCESS_COUNTERS';ttlMs:45000;measureStatus:MeasureStatus;reason:string|null;services:GpuProcessSample[];history:GpuSnapshot[];window:PerformanceWindow;unit:{utilization:'% busiest process engine';memory:'bytes'}};
