#!/usr/bin/env node
import {appendFileSync, closeSync, mkdirSync, openSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const args=new Map(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>{
  const at=x.indexOf('=');return at<0?[x.slice(2),'true']:[x.slice(2,at),x.slice(at+1)];
}));
const apiBase=String(args.get('api')??'http://127.0.0.1:8080').replace(/\/$/,'');
const durationMinutes=Math.max(1,Number(args.get('duration-minutes')??120));
const intervalSeconds=Math.max(10,Number(args.get('interval-seconds')??60));
const outputPath=resolve(String(args.get('output')??'docs/reports/v396-high-frequency-entry-root-cause-20260928/monitor-120m.jsonl'));
const summaryPath=resolve(String(args.get('summary')??'docs/reports/v396-high-frequency-entry-root-cause-20260928/monitor-summary.json'));
const sqlitePath=resolve(String(args.get('sqlite')??'data/zdj-settings.sqlite'));
const durationMs=durationMinutes*60_000,intervalMs=intervalSeconds*1000,startAt=Date.now(),endAt=startAt+durationMs;
mkdirSync(dirname(outputPath),{recursive:true});mkdirSync(dirname(summaryPath),{recursive:true});
const fd=openSync(outputPath,'wx');
const suppressionSegments=[];let activeSegment=null,successfulSamples=0,failedSamples=0,previousDispatchAt=null,maxObservedTickAgeMs=0,sampleCount=0,lastObservedAt=null,maxSampleGapMs=0,productionWritesMax=0,productionWriteBoundaryKnown=true,allRuntimeBoundariesLocked=true,tpProtectionKnown=true,tpProtectionIntact=true,maxMissingTp=0;
const closeSegment=at=>{if(!activeSegment)return;suppressionSegments.push({...activeSegment,endedAt:at,durationMs:Math.max(0,at-activeSegment.startedAt)});activeSegment=null;};
const object=value=>value&&typeof value==='object'?value:{};
const numberOrNull=value=>Number.isFinite(Number(value))?Number(value):null;
const get=async route=>{
  const response=await fetch(`${apiBase}${route}`,{method:'GET',signal:AbortSignal.timeout(15_000),headers:{accept:'application/json'}});
  if(!response.ok)throw new Error(`HTTP_${response.status}:${route}`);
  return response.json();
};
const sample=async(index,scheduledAt)=>{
  const observedAt=Date.now();let snapshot=null,closeout=null,error=null;
  if(lastObservedAt!==null)maxSampleGapMs=Math.max(maxSampleGapMs,observedAt-lastObservedAt);lastObservedAt=observedAt;
  try{[snapshot,closeout]=await Promise.all([get('/api/v3/snapshot'),get('/api/v3/diagnostics/closeout')]);successfulSamples++;}
  catch(e){error=e instanceof Error?e.message:String(e);failedSamples++;}
  const s=object(snapshot),c=object(closeout),runtime=object(c.runtime),pipeline=object(c.pipeline),analysis=object(pipeline.analysis),work=object(pipeline.work),capacity=object(pipeline.capacityVisibility),admission=object(capacity.admission),reconciliation=object(c.reconciliation??pipeline.reconciliation),boundary=object(c.productionWriteBoundary??pipeline.writeBoundary),account=object(s.account),conversion=object(pipeline.entryConversion?.thirtyMinutes),suppression=object(analysis.suppression);
  const heartbeatAt=numberOrNull(analysis.heartbeatAt??analysis.lastTickAt),heartbeatAgeMs=numberOrNull(analysis.heartbeatAgeMs);
  if(heartbeatAgeMs!==null)maxObservedTickAgeMs=Math.max(maxObservedTickAgeMs,heartbeatAgeMs);
  const lastDispatchAt=numberOrNull(analysis.lastAttemptAt);
  if(previousDispatchAt!==null&&lastDispatchAt!==null&&lastDispatchAt>previousDispatchAt)closeSegment(observedAt);
  const noDispatchStart=lastDispatchAt??numberOrNull(analysis.observationStartedAt)??startAt;
  const reason=String(suppression.suppressionReason??analysis.reason??work.current??(error?'SAMPLE_FAILED':'UNKNOWN'));
  const blocker=String(suppression.authoritativeBlocker??admission.code??'');
  if(lastDispatchAt===null||lastDispatchAt===previousDispatchAt){
    if(!activeSegment||activeSegment.reason!==reason||activeSegment.blocker!==blocker){closeSegment(observedAt);activeSegment={startedAt:Math.max(startAt,noDispatchStart),reason,blocker};}
  }
  if(lastDispatchAt!==null)previousDispatchAt=lastDispatchAt;
  sampleCount++;
  const productionWrites=numberOrNull(boundary.productionWrites),testnetWrites=numberOrNull(boundary.testnetWrites);
  if(productionWrites===null)productionWriteBoundaryKnown=false;else productionWritesMax=Math.max(productionWritesMax,productionWrites);
  allRuntimeBoundariesLocked=allRuntimeBoundariesLocked&&boundary.lockedToTestnet===true;
  const positions=numberOrNull(account.activePositions),protectedTp=numberOrNull(account.activeTpOrders);
  if(positions===null||protectedTp===null)tpProtectionKnown=false;
  else {const missing=Math.max(0,positions-protectedTp);maxMissingTp=Math.max(maxMissingTp,missing);tpProtectionIntact=tpProtectionIntact&&missing===0;}
  const record={
    sample:index,scheduledAt:new Date(scheduledAt).toISOString(),observedAt:new Date(observedAt).toISOString(),sampleError:error,
    runtime:{pid:numberOrNull(runtime.pid),instanceId:runtime.instanceId??null,buildId:runtime.buildId??null,sourceHash:runtime.sourceHash??null,artifactHash:runtime.artifactHash??null,uptimeMs:numberOrNull(runtime.uptimeMs),health:s.health?.status??null},
    scheduler:{schedulerStatus:analysis.schedulerStatus??null,schedulerCycle:numberOrNull(analysis.schedulerCycle),heartbeatAt,heartbeatAgeMs,lastDispatchAttemptAt:lastDispatchAt,lastDispatchAt:lastDispatchAt,lastAnalysisSuccessAt:numberOrNull(analysis.lastSuccessAt),primaryDispatchAgeMs:numberOrNull(analysis.primaryDispatchAgeMs),state:analysis.reason??null,suppressionReason:suppression.suppressionReason??analysis.reason??null,authoritativeBlocker:blocker||null,nextEvaluationAt:numberOrNull(suppression.nextEvaluationAt??analysis.nextEvaluationAt),candidateCount:numberOrNull(suppression.candidateCount??analysis.capitalExecutableCount),capacityStatus:suppression.capacityStatus??admission.status??null,noDispatchDurationMs:Math.max(0,observedAt-noDispatchStart)},
    candidates:{pool:numberOrNull(s.supply?.counts?.poolCount),eligible:numberOrNull(s.universe?.eligible),routes:numberOrNull(pipeline.runtimeControl?.capital?.routedCandidates?.length),candidates:numberOrNull(analysis.capitalExecutableCount),conversion:{primaryCompleted:numberOrNull(conversion.primaryCompleted),place:numberOrNull(conversion.place),riskAllowed:numberOrNull(conversion.riskAllowed),tradePlanReady:numberOrNull(conversion.tradePlanReady),reservationCreated:numberOrNull(conversion.reservationCreated),intentCreated:numberOrNull(conversion.intentCreated),submitAttempted:numberOrNull(conversion.submitAttempted),orderSubmitted:numberOrNull(conversion.orderSubmitted),entryFilled:numberOrNull(conversion.entryFilled),blocked:conversion.blocked??[]}},
    risk:{bookStatus:admission.status??null,firstBinding:admission.code??null,entryUnknownHistorical:numberOrNull(reconciliation.entryUnknownHistorical),proofValid:numberOrNull(reconciliation.entryUnknownProofValid),occupyingRisk:numberOrNull(reconciliation.entryUnknownOccupyingRisk),activeClaims:numberOrNull(reconciliation.activeEntryClaims),pendingEntries:numberOrNull(account.pendingEntries),reservations:numberOrNull(pipeline.runtimeControl?.capital?.reservations?.length),grossUsedUsd:numberOrNull(capacity.exposure?.gross?.notionalUsd),grossLimitUsd:numberOrNull(capacity.exposure?.gross?.limitUsd),longFinalCapacityUsd:numberOrNull(admission.ceilingUsdBySide?.LONG),shortFinalCapacityUsd:numberOrNull(admission.ceilingUsdBySide?.SHORT),pendingLineage:capacity.pendingLineage??[]},
    execution:{tradePlanReady:numberOrNull(conversion.tradePlanReady),reservations:numberOrNull(conversion.reservationCreated),intents:numberOrNull(conversion.intentCreated),submit:numberOrNull(conversion.submitAttempted),orders:numberOrNull(conversion.orderSubmitted),fills:numberOrNull(conversion.entryFilled)},
    protection:{positions,protectedTp,missingTp:positions===null||protectedTp===null?null:Math.max(0,positions-protectedTp),unresolvedProtection:numberOrNull(reconciliation.tpUnknown)},
    writes:{testnetWrites,productionWrites,lockedToTestnet:boundary.lockedToTestnet??null},
  };
  appendFileSync(fd,`${JSON.stringify(record)}\n`,'utf8');
};

try{
  for(let index=0,scheduledAt=startAt;scheduledAt<=endAt;index++,scheduledAt=startAt+index*intervalMs){
    const waitMs=scheduledAt-Date.now();if(waitMs>0)await new Promise(resolvePromise=>setTimeout(resolvePromise,waitMs));
    await sample(index,scheduledAt);
  }
  closeSegment(Date.now());
}finally{closeSync(fd);}

let heartbeatEvidence={status:'UNAVAILABLE',count:null,firstAt:null,lastAt:null,maxGapMs:null,gapsOver60s:null};
try{
  const db=new DatabaseSync(sqlitePath,{readOnly:true});db.exec('PRAGMA query_only=ON');
  const row=db.prepare(`WITH ordered AS (SELECT ts,LAG(ts) OVER (ORDER BY ts) prior FROM runtime_events WHERE type='ANALYSIS_DISPATCH_HEARTBEAT' AND ts BETWEEN ? AND ?) SELECT COUNT(*) count,MIN(ts) firstAt,MAX(ts) lastAt,MAX(ts-prior) maxGapMs,SUM(CASE WHEN ts-prior>60000 THEN 1 ELSE 0 END) gapsOver60s FROM ordered`).get(startAt,endAt);
  heartbeatEvidence={status:'READ_ONLY_SQLITE',count:Number(row.count),firstAt:Number(row.firstAt),lastAt:Number(row.lastAt),maxGapMs:row.maxGapMs==null?null:Number(row.maxGapMs),gapsOver60s:Number(row.gapsOver60s??0)};db.close();
}catch(e){heartbeatEvidence={...heartbeatEvidence,error:e instanceof Error?e.message:String(e)};}
const durationsByReason={};for(const segment of suppressionSegments)durationsByReason[segment.reason]=(durationsByReason[segment.reason]??0)+segment.durationMs;
const continuousSamplingProven=maxSampleGapMs<=65_000;
const productionWriteBoundaryProven=failedSamples===0&&productionWriteBoundaryKnown&&productionWritesMax===0&&allRuntimeBoundariesLocked;
const takeProfitProtectionProven=failedSamples===0&&tpProtectionKnown&&tpProtectionIntact;
const summary={
  startedAt:new Date(startAt).toISOString(),endedAt:new Date(endAt).toISOString(),durationMinutes,intervalSeconds,sampleCount,successfulSamples,failedSamples,
  complete:Date.now()>=endAt&&lastObservedAt>=endAt&&sampleCount===Math.floor(durationMs/intervalMs)+1&&failedSamples===0&&continuousSamplingProven&&productionWriteBoundaryProven&&takeProfitProtectionProven,
  heartbeatSampleCompleteness:sampleCount?successfulSamples/sampleCount:0,heartbeatEvents:heartbeatEvidence,maxObservedSchedulerTickAgeMs:maxObservedTickAgeMs,
  maxSampleGapMs,
  noDispatchSegments:suppressionSegments,noDispatchDurationByReasonMs:durationsByReason,
  productionWritesMax:productionWriteBoundaryKnown?productionWritesMax:null,productionWriteBoundaryProven,
  continuousSamplingProven,takeProfitProtectionProven,maxMissingTp,
  jsonlPath:outputPath,sqliteEvidence:heartbeatEvidence.status,
};
writeFileSync(summaryPath,`${JSON.stringify(summary,null,2)}\n`,'utf8');
process.stdout.write(`${JSON.stringify({complete:summary.complete,sampleCount,successfulSamples,failedSamples,heartbeatEvents:heartbeatEvidence,maxObservedSchedulerTickAgeMs:maxObservedTickAgeMs,summaryPath})}\n`);
if(!summary.complete||heartbeatEvidence.status!=='READ_ONLY_SQLITE'||heartbeatEvidence.gapsOver60s>0)process.exitCode=2;
