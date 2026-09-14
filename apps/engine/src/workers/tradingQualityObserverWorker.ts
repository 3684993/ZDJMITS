import {parentPort,workerData} from 'node:worker_threads';
import {TradingQualityV393EvidenceStore} from '../services/tradingQualityV393EvidenceStore.js';
import {buildEpisodeEvidence,fillAnchoredPath} from '../services/tradingEpisodeEvidence.js';
import {candidateShadowComparator,entryQualityView,positionQualityView,exitQualityView} from '../services/tradingQualityV393.js';
import {summarizeEntryQuality} from '../services/tradingQualityBaseline.js';
const {file,manifest}=workerData,store=new TradingQualityV393EvidenceStore(file);
store.freezeManifest(manifest);
const paths=new Map<string,any[]>(),enrollmentByCycle:Record<string,any>={},registered=new Set<string>();
for(const row of store.snapshot(manifest.experimentId).enrollment)enrollmentByCycle[row.subjectId]=row.evidence;
let lastPrune=0;
parentPort!.on('message',(s:any)=>{
 try{
  if(s.now>manifest.followupEndAt){parentPort!.postMessage({status:'WINDOW_COMPLETE',asOf:s.now,enrollmentByCycle,authorization:'NONE'});return;}
  const droppedReasons:string[]=[];
  const quotes=new Map(s.quotes.map((q:any)=>[q.symbol,q])),episodes:any[]=[],positionViews:any[]=[],exitViews:any[]=[];
  const append=(lifecycle:any,subjectId:string,sourceIds:string[],payload:any,maturity:any='OPEN')=>{const r=store.append(manifest.experimentId,{lifecycle,subjectId,sourceIds,sourceRevisions:payload,metricVersion:manifest.metricVersion,asOf:s.now,maturity,payload});if(r.degradation!=="READY")droppedReasons.push(...r.reasons);return r;};
  const pathFor=(id:string,symbol:string,start:number,end:number)=>{
    const q:any=quotes.get(symbol),rows=paths.get(id)??[];
    if(q&&q.ts>=start&&q.ts<=end&&q.ts<=s.now&&s.now-q.ts<=5000&&!rows.some(r=>r.ts===q.ts))rows.push({ts:q.ts,mark:q.mark,bid:q.bid,ask:q.ask});
    const bounded=rows.slice(-400);paths.set(id,bounded);return bounded;
  };
  for(const record of s.records){
    const intent=s.intents.find((i:any)=>i.id===record.entryIntentId),run=intent?s.runs.find((r:any)=>r.id===intent.brainRunId):null;
    if(!intent||!run||!record.cycleId)continue;
    const enrollment={decisionAt:run.startedAt,intentCreatedAt:intent.createdAt,cycleCreatedAt:record.createdAt,source:'NEW_DECISION' as const,environment:manifest.environment,accountScope:manifest.accountScope,codeHead:manifest.codeHead,configHash:manifest.configHash,policyVersion:manifest.policyVersion,metricVersion:manifest.metricVersion,ruleHash:manifest.ruleHash};
    if(!enrollmentByCycle[record.cycleId]){const admitted=store.enroll(manifest.experimentId,record.cycleId,enrollment);if(admitted.enrolled)enrollmentByCycle[record.cycleId]=enrollment;}
    if(!enrollmentByCycle[record.cycleId])continue;
    const input={run,intent,orders:s.orders,fills:s.fills,tradeRecords:[record],now:s.now},first=buildEpisodeEvidence(input);
    const start=first.firstFillAt;if(start==null)continue;
    const end=Math.max(start,first.completeFillAt??start)+900000;
    const marks=pathFor(record.cycleId,record.symbol,start,end),ep=buildEpisodeEvidence({...input,marks});episodes.push(ep);
    append('ENTRY',record.cycleId,[intent.id,...ep.fillIds],{...entryQualityView({episodeId:intent.id,path:ep.path,timeToPositive:ep.timeToPositive}),episode:ep},s.now>=end?'MATURE':'OPEN');
    if(record.status==='CLOSED'&&record.closedAt!=null){
      const exitMarks=pathFor(`exit:${record.cycleId}`,record.symbol,record.closedAt,record.closedAt+900000);
      const post=record.exitAveragePrice?fillAnchoredPath({side:record.direction,fillPrice:record.exitAveragePrice,fillAt:record.closedAt,marks:exitMarks,now:s.now}):[];
      const v=exitQualityView({cycleId:record.cycleId,realizedCaptureBps:null,mfeBps:null,realizedNetExFundingUsd:record.tradingNetPnlExFunding??null,canonicalNetUsd:null,exitPostMarkoutBps:Object.fromEntries(post.map(p=>[String(p.horizonMs),p.lastSignedBps])),postExitReference:'FIXED_HORIZON',partialFillCount:record.exitFillCount,feeUsd:record.totalFee});exitViews.push(v);append('EXIT',record.cycleId,record.linkedFillIds,v);
    }
  }
  for(const p of s.positions){
    const v=positionQualityView({cycleId:p.cycleId??p.id,unrealizedPnl:p.unrealizedPnl,holdingMs:Math.max(0,s.now-p.openedAt),underwaterMs:0,maeBps:null,mfeBps:null,tpReachable:null,opportunityFresh:null,profitAvailable:null,humanManaged:p.managementStatus==='HUMAN_MANAGED'});
    const truthful={...v,underwaterMs:null,findings:v.findings.filter(f=>f!=='UNDERWATER_NORMAL'),underwaterStatus:'DURATION_UNKNOWN',cohort:enrollmentByCycle[p.cycleId]?'PROSPECTIVE':'LEGACY_OR_TRANSITIONAL'};
    positionViews.push(truthful);append('POSITION',p.cycleId??p.id,[p.id],truthful);
  }
  for(const setId of new Set<string>(s.candidates.map((c:any)=>c.candidateSetId))){
    if(registered.has(setId)||s.now>=manifest.entryEnrollmentEndAt)continue;
    const candidates=s.candidates.filter((c:any)=>c.candidateSetId===setId),rank=candidateShadowComparator(candidates),r=store.observeCandidateSet({experimentId:manifest.experimentId,candidateSetId:setId,candidates,maxCandidates:8,windowMs:900000,observedAt:s.now,preselectedAlternativeId:rank[1]?.candidateId??null,sourceIds:candidates.map((c:any)=>c.candidateId),sourceRevisions:candidates});
    if(r.degradation==='EVIDENCE_DEGRADED')droppedReasons.push(...r.reasons);
    registered.add(setId);if(registered.size>10000)registered.delete(registered.values().next().value!);
  }
  store.recordCachedQuotes(manifest.experimentId,s.quotes,s.now);
  if(s.now-lastPrune>60000){store.prune(s.now);lastPrune=s.now;}
  for(const [id,rows] of paths)if(rows.length&&rows.at(-1).ts<s.now-1800000)paths.delete(id);
  const snapshot=store.snapshot(manifest.experimentId,s.now);
  parentPort!.postMessage({status:droppedReasons.length?'EVIDENCE_DEGRADED':snapshot.health.degradation,droppedReasons,asOf:s.now,enrollmentByCycle,counts:{enrolled:Object.keys(enrollmentByCycle).length,recentEvidenceReturned:snapshot.evidence.length,marks:snapshot.markCount,positions:positionViews.length,exits:exitViews.length},quality:summarizeEntryQuality(episodes),positions:positionViews,exits:exitViews,health:snapshot.health,limitations:['MEASUREMENT_ONLY','QUOTE_RECEIVED_AT_IS_CACHE_OBSERVATION_TIME','FUNDING_PROVENANCE_UNAVAILABLE','UNDERWATER_DURATION_UNKNOWN','CANDIDATE_SELECTION_CAUSALITY_UNPROVEN'],safetyIntegrity:'INCONCLUSIVE',measurementReadiness:'INCONCLUSIVE',economicAcceptance:'INCONCLUSIVE',authorization:'NONE'});
 }catch(error){parentPort!.postMessage({status:'EVIDENCE_DEGRADED',error:String(error),authorization:'NONE'});}
});
