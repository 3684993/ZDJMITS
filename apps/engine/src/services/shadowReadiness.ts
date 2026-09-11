import type { RuntimeState } from '../state/runtimeState.js';
import type { SettingsStore } from '../config/settingsStore.js';

type ShadowEvent={id:string;type:string;ts:number;symbol?:string|null;payload:any};
const chainFields=['snapshotId','marketSnapshotId','portfolioSnapshotId','settingsVersion','capitalSnapshotId','exposureSnapshotId'];
const horizons:any={ '15m':15*60_000,'1h':60*60_000,'4h':4*60*60_000,'24h':24*60*60_000 };

export class ShadowReadinessService {
  private static readonly AUDIT_WINDOW_LIMIT=20000;
  private static readonly POSTERIOR_SAMPLE_LIMIT=500;
  private projectionCache:{at:number;value:any}|null=null;
  constructor(private readonly state:RuntimeState,private readonly store:SettingsStore){}
  private events(since=0,limit=ShadowReadinessService.AUDIT_WINDOW_LIMIT):ShadowEvent[]{const types=['SHADOW_SAMPLE_RECORDED','RUNTIME_STARTED','RUNTIME_STOPPED','SHADOW_VALID_OBSERVATION_STARTED','SHADOW_ONLY_AI_EVALUATED'];return (typeof (this.store as any).runtimeEventsRecent==='function'?(this.store as any).runtimeEventsRecent(since,types,limit):this.store.runtimeEvents(since,types,limit)) as ShadowEvent[];}
  private samples(since=0){return this.events(since).filter(e=>e.type==='SHADOW_SAMPLE_RECORDED');}
  classify(event:ShadowEvent,previousAt:number|null=null){
    const p=event.payload??{},snap=p.decisionSnapshot??{},ob=p.observationValidity??snap.observationValidity,dq=p.dataQuality??snap.dataQuality;
    const reasons:string[]=[];
    if(previousAt!==null&&event.ts-previousAt>90_000)reasons.push('RUNTIME_RESTART_GAP');
    if(!p.decisionChainId||chainFields.some(k=>snap[k]===undefined||snap[k]===null||snap[k]===''))reasons.push('CHAIN_INTEGRITY_VIOLATION');
    if(ob?.status==='INVALID')reasons.push(...(ob.invalidReasons??['OBSERVATION_INVALID']));
    else if(!ob){if(dq?.status==='UNTRUSTED'||dq?.status==='DEGRADED')reasons.push(...(dq.reasons??['DATA_QUALITY_DEGRADED']));const at=Number(String(snap.capitalSnapshotId??'').match(/(\d+)$/)?.[1]??0);if(!at||Math.abs(event.ts-at)>120_000)reasons.push('ACCOUNT_STALE');}
    if(p.error||p.internalError)reasons.push('INTERNAL_ERROR');
    if(reasons.includes('INTERNAL_ERROR'))return{classification:'INVALID_INTERNAL_ERROR',reasons};
    if(reasons.includes('RUNTIME_RESTART_GAP'))return{classification:'INVALID_RUNTIME_RESTART_GAP',reasons};
    if(reasons.includes('CHAIN_INTEGRITY_VIOLATION'))return{classification:'INVALID_CHAIN_INCOMPLETE',reasons};
    if(reasons.includes('ACCOUNT_STALE'))return{classification:'INVALID_ACCOUNT_STALE',reasons};
    if(reasons.some(x=>/STALE/.test(x)))return{classification:'INVALID_MARKET_STALE',reasons};
    if(reasons.length)return{classification:'INVALID_DATA_QUALITY',reasons};
    return{classification:'VALID',reasons:[]};
  }
  private posterior(rows:any[],validIds:Set<string>){
    const boundedRows=rows.slice(-ShadowReadinessService.POSTERIOR_SAMPLE_LIMIT),posteriorSince=boundedRows[0]?.event?.ts??Date.now()-24*60*60_000;
    const marks=(this.store as any).listShadowMarkSeries?.(posteriorSince,undefined,50000)??[],bySymbol=new Map<string,any[]>(),out:any={};
    for(const mark of marks){const list=bySymbol.get(mark.symbol)??[];list.push(mark);bySymbol.set(mark.symbol,list);}
    const lowerBound=(list:any[],ts:number)=>{let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>1;if(Number(list[mid].ts)<ts)lo=mid+1;else hi=mid;}return lo;};
    for(const [name,horizon] of Object.entries(horizons)){
      const values:any[]=[];
      for(const row of boundedRows){if(!validIds.has(row.event.id))continue;const p=row.event.payload??{},ref=p.decisionSnapshot?.reference??{};const initial=Number(ref.mark);if(!initial||Date.now()-row.event.ts<(horizon as number))continue;const list=bySymbol.get(String(row.event.symbol));if(!list?.length)continue;const start=lowerBound(list,row.event.ts),end=lowerBound(list,row.event.ts+(horizon as number)+1);if(end<=start)continue;const side=ref.side==='SHORT'?-1:1;let first=0,last=0,mfe=-Infinity,mae=Infinity;for(let i=start;i<end;i++){const ret=side*(Number(list[i].mark)-initial)/initial;if(i===start)first=ret;last=ret;mfe=Math.max(mfe,ret);mae=Math.min(mae,ret);}values.push({ret:last||first,mfe:mfe===-Infinity?null:mfe,mae:mae===Infinity?null:mae});}
      const min=Number((this.state.settings as any).riskGovernance?.shadow?.posteriorMinSamples??1);out[name]=values.length>=min?{available:true,samples:values.length,avgReturn:values.reduce((n,x)=>n+x.ret,0)/values.length,mfe:values.reduce((n,x)=>n+x.mfe,0)/values.length,mae:values.reduce((n,x)=>n+x.mae,0)/values.length,tpHits:0,invalidationHits:0}:{available:false,samples:values.length,avgReturn:null,mfe:null,mae:null,tpHits:0,invalidationHits:0,note:'INSUFFICIENT_SAMPLE_OR_HORIZON'};
    }
    return out;
  }
  private buildProjection(){
    const s:any=this.state.shadowRunner,epoch=s.validityEpochAt??s.startAt??0,allEvents=this.events(epoch),rows=allEvents.filter(e=>e.type==='SHADOW_SAMPLE_RECORDED'),classified:any[]=[];let previous:number|null=null;
    for(const event of rows){const c=this.classify(event,previous);classified.push({event,...c});previous=event.ts;}
    const counts:any={VALID:0,INVALID_DATA_QUALITY:0,INVALID_CHAIN_INCOMPLETE:0,INVALID_MARKET_STALE:0,INVALID_ACCOUNT_STALE:0,INVALID_RUNTIME_RESTART_GAP:0,INVALID_INTERNAL_ERROR:0};const invalidReasons:Record<string,number>={};
    for(const x of classified){counts[x.classification]=(counts[x.classification]??0)+1;for(const reason of x.reasons)invalidReasons[reason]=(invalidReasons[reason]??0)+1;}
    const total=classified.length,validIds=new Set(classified.filter(x=>x.classification==='VALID').map(x=>x.event.id)),chains=classified.map(x=>x.event.payload?.decisionChainId),coverage={decisionChain:total?chains.filter(Boolean).length/total:1,snapshot:total?classified.filter(x=>x.event.payload?.decisionSnapshot?.snapshotId).length/total:1,policyEnvelope:total?classified.filter(x=>x.event.payload?.decisionSnapshot?.settingsVersion).length/total:1,riskEnvelope:total?classified.filter(x=>x.event.payload?.decisionSnapshot?.riskEnvelope?.id||x.event.payload?.riskEnvelope?.id).length/total:1,entryIntent:null,tradeRecord:null,applicableNote:'Shadow observation deliberately stops before entry and never fabricates execution-chain records.'};
    const gaps:number[]=[];const gapTypes:any={plannedRestart:0,networkGap:0,dataPipelineGap:0};const starts=allEvents.filter(e=>e.type==='RUNTIME_STARTED');for(let i=1;i<classified.length;i++){const gap=classified[i].event.ts-classified[i-1].event.ts;if(gap>90_000){gaps.push(gap);const planned=starts.some(e=>e.ts>=classified[i-1].event.ts&&e.ts<=classified[i].event.ts);gapTypes[planned?'plannedRestart':'dataPipelineGap']++;}}
    const now=Date.now(),requiredUntil=s.validObservationRequiredUntil??null,complete=Boolean(requiredUntil&&now>=requiredUntil&&counts.VALID>0),markCoverage=(this.store as any).shadowMarkCoverage?.(epoch)??{samples:0,symbols:0,firstAt:null,lastAt:null};
    const shadowOnly=allEvents.filter(e=>e.type==='SHADOW_ONLY_AI_EVALUATED');
    return{status:complete?'READY_FOR_MANUAL_REVIEW':'SHADOW_READY',shadowRunnerStatus:s.status,startedAt:s.startAt,validityEpochAt:epoch,validObservationStartedAt:s.validObservationStartedAt??null,validObservationRequiredUntil:requiredUntil,validObservationDays:s.validObservationStartedAt?Math.min(7,(now-s.validObservationStartedAt)/86400000):0,elapsedMs:s.startAt?now-s.startAt:0,validObservationElapsedMs:s.validObservationStartedAt?now-s.validObservationStartedAt:0,sampleCount:Number(s.samples??total),auditWindowSampleCount:total,auditWindowLimit:ShadowReadinessService.AUDIT_WINDOW_LIMIT,auditWindowBounded:Number(s.samples??total)>total,validCount:counts.VALID,invalidCount:total-counts.VALID,classificationCounts:counts,invalidReasons,chainCoverage:coverage,decisionChainCoverage:coverage.decisionChain,entryChainCoverage:coverage.entryIntent,closedTradeChainCoverage:coverage.tradeRecord,dataQualityRate:total?counts.VALID/total:null,riskGateViolations:this.riskViolations(classified),hardRejects:classified.filter(x=>{const snap=x.event.payload?.decisionSnapshot??{},a=x.event.payload?.admissionDecision??(snap.admissionDecision&&typeof snap.admissionDecision==='object'?snap.admissionDecision:null);return a?.status?.startsWith('REJECT_');}).length,shadowOnlyAi:{runs:shadowOnly.length,placeDecisions:shadowOnly.filter(e=>e.payload?.decision==='PLACE_LONG'||e.payload?.decision==='PLACE_SHORT').length,noEntryIntent:true,noReservation:true,noBinanceOrder:true},protectionShadow:{wouldTriggerCount:classified.filter(x=>x.event.payload?.protectionShadow?.status==='WOULD_TRIGGER').length,automaticExitCount:0,automaticStopMarketCount:0},restartContinuity:{continuous:gaps.length===0,gapCount:gaps.length,gapsMs:gaps,gapsByType:gapTypes,lastRestartAt:starts.at(-1)?.ts??null},markSeriesCoverage:markCoverage,posterior:this.posterior(classified,validIds),lastSampleAt:classified.at(-1)?.event.ts??s.lastSampleAt,lastSampleError:null,readyForReview:complete,autoResume:false,entrySafetyMode:this.state.runtimeControl.entrySafetyMode,automaticResumeAllowed:false,source:'READ_ONLY_SHADOW_AUDIT_BOUNDED_WINDOW'};
  }
  private riskViolations(rows:any[]){const out:Record<string,number>={};for(const x of rows){const snap=x.event.payload?.decisionSnapshot??{},top=x.event.payload?.admissionDecision,a=top&&typeof top==='object'?top:(snap.admissionDecision&&typeof snap.admissionDecision==='object'?snap.admissionDecision:null);for(const v of Array.isArray(a?.reasons)?a.reasons:[])out[v]=(out[v]??0)+1;}return out;}
  private projection(){const now=Date.now();if(this.projectionCache&&now-this.projectionCache.at<30_000)return this.projectionCache.value;const value=this.buildProjection();this.projectionCache={at:now,value};return value;}
  readiness(){return this.projection();}
  metrics(){const p=this.projection();return{...p,latestSamples:this.samples(p.validityEpochAt).slice(-20).map(e=>({...e,classification:this.classify(e)}))};}
  violations(){const p=this.projection();return{status:p.status,invalidReasons:p.invalidReasons,riskGateViolations:p.riskGateViolations,continuityGaps:p.restartContinuity.gapsMs,automaticExitCount:0,automaticStopMarketCount:0,autoResume:false};}
  rootCauseAudit(){const since=this.state.shadowRunner.startAt??0,rows=this.samples(since),by:any={};for(const e of rows){const c=this.classify(e);if(!by[c.classification])by[c.classification]={count:0,sample:[]};by[c.classification].count++;if(by[c.classification].sample.length<100)by[c.classification].sample.push({sampleId:e.id,ts:e.ts,symbol:e.symbol,invalidReasons:c.reasons,observationValidity:e.payload?.observationValidity??e.payload?.decisionSnapshot?.observationValidity,admissionDecision:e.payload?.admissionDecision});}return{since,sampleCount:rows.length,byClassification:by,restartGaps:rows.map((e,i)=>i?e.ts-rows[i-1].ts:0).filter((x:number)=>x>90_000),note:'Historical audit only; it does not extend the new validity epoch or the new seven-day clock.'};}
  dailySummary(){const rows=this.samples((this.state.shadowRunner.validityEpochAt??this.state.shadowRunner.startAt??0)),days=new Map<string,any>();for(const e of rows){const day=new Date(e.ts).toISOString().slice(0,10),v=days.get(day)??{date:day,samples:0,valid:0,invalid:0};const c=this.classify(e);v.samples++;v[c.classification==='VALID'?'valid':'invalid']++;days.set(day,v);}return{items:[...days.values()],timezone:'UTC',source:'READ_ONLY_RUNTIME_EVENTS'};}
}







