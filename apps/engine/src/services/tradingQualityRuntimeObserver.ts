import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TradingQualityExperimentManifestSchema,type TradingQualityExperimentManifest} from '@zdj/contracts';
import type {RuntimeState} from '../state/runtimeState.js';
export const qualityDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** One bounded in-flight snapshot. The worker has no adapter or trading authority. */
export class TradingQualityRuntimeObserver {
  private worker:Worker|null=null;
  private busy=false;
  private lastSent=0;
  private result:any={status:'STARTING',authorization:'NONE'};
  readonly manifest:TradingQualityExperimentManifest;
  private readonly configHash:string;
  private readonly accountScope:string;
  constructor(dataDir:string,private state:RuntimeState){
    const now=Date.now(),exchange=state.settings.connections.exchange;
    this.configHash=qualityDigest(state.settings);
    this.accountScope=qualityDigest({environment:exchange.environment,credentialRef:exchange.credentialRef});
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
    const codeHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
    const file=path.join(dataDir,'v393-experiment-manifest.json');
    if(existsSync(file))this.manifest=TradingQualityExperimentManifestSchema.parse(JSON.parse(readFileSync(file,'utf8')));
    else {
      this.manifest=TradingQualityExperimentManifestSchema.parse({experimentId:`v393-shadow-${now}`,environment:exchange.environment,accountScope:this.accountScope,codeHead,configHash:this.configHash,policyVersion:'V393-SHADOW-1',metricVersion:'V393-MARK-OBSERVED-1',ruleHash:qualityDigest({mode:'SHADOW',selection:'UNCHANGED',entry:'UNCHANGED'}),analysisPlanHash:qualityDigest({purpose:'MEASUREMENT_ONLY',horizons:[30000,60000,180000,300000,900000],maxGapMs:5000,scope:'NO_ECONOMIC_ACCEPTANCE',candidateSampling:'DETERMINISTIC_TOP_8',safety:'INCONCLUSIVE_UNTIL_AUDITED'}),decisionStartAt:now,entryEnrollmentEndAt:now+24*3600000,followupEndAt:now+48*3600000,authoritativeClock:'SYSTEM_UTC',enrollmentRuleVersion:'V393-ENROLL-1',transitionalRule:'BASELINE_PREEXISTING_ORDER_IS_TRANSITIONAL',exclusionReasons:[],runtimeSessions:[],createdAt:now});
      writeFileSync(file,JSON.stringify(this.manifest,null,2),{flag:'wx'});
    }
    if(this.manifest.codeHead!==codeHead||this.manifest.configHash!==this.configHash||this.manifest.accountScope!==this.accountScope)throw new Error('V393_MANIFEST_SCOPE_OR_VERSION_MISMATCH');
    this.worker=new Worker(new URL('../workers/tradingQualityObserverWorker.js',import.meta.url),{workerData:{file:path.join(dataDir,'v393-evidence.sqlite'),manifest:this.manifest},resourceLimits:{maxOldGenerationSizeMb:192}});
    this.worker.on('message',message=>{this.busy=false;this.result=message;});
    this.worker.on('error',error=>{this.busy=false;this.result={status:'EVIDENCE_DEGRADED',error:String(error),authorization:'NONE'};this.worker=null;});
    this.worker.on('exit',code=>{if(this.worker){this.worker=null;this.result={...this.result,status:'EVIDENCE_DEGRADED',exitCode:code};}});
  }
  tick(now=Date.now()){
    if(this.busy&&now-this.lastSent>30000)this.result={...this.result,status:'EVIDENCE_DEGRADED',error:'WORKER_TIMEOUT_NO_RESTART'};
    if(!this.worker||this.busy||now-this.lastSent<5000)return;
    if(qualityDigest(this.state.settings)!==this.configHash){this.result={...this.result,status:'EVIDENCE_DEGRADED',error:'CONFIG_CHANGED_NEW_EXPERIMENT_REQUIRED'};return;}
    const records=[...this.state.tradeRecords.values()].filter(r=>r.createdAt>=this.manifest.decisionStartAt||r.status==='OPEN'||r.status==='PARTIALLY_CLOSED').sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,164);
    const intentIds=new Set(records.map(r=>r.entryIntentId).filter(Boolean)),intents=[...this.state.entryIntents.values()].filter(i=>intentIds.has(i.id)).slice(0,64),runIds=new Set(intents.map(i=>i.brainRunId));
    const orders=[...this.state.entryOrders.values()].filter(o=>intentIds.has(o.intentId)).slice(0,128),orderIds=new Set(orders.map(o=>o.exchangeOrderId));
    const fills=this.state.executionFills.filter(f=>orderIds.has(f.orderId)||records.some(r=>r.cycleId&&r.cycleId===f.cycleId)).slice(-2000);
    const candidates=this.state.universe.slice(0,64).map(c=>({candidateId:`${c.symbol}:${c.selectionGeneration}`,candidateSetId:String(c.selectionGeneration),symbol:c.symbol,legal:c.eligible,selected:false,rank:c.rank??999,directionAligned:null,timingVerified:null,eventAgeMs:null,locationDistanceAtr:null,conservativePayoffBps:null,spreadBps:null,depthUsd:null,riskCapacity:null,observedAt:now}));
    const quotes=[...this.state.snapshots].map(([symbol,m])=>({symbol,ts:m.quote.ts,mark:m.quote.mark,bid:m.quote.bid,ask:m.quote.ask,receivedAt:now})).slice(0,164);
    this.busy=true;this.lastSent=now;
    this.worker.postMessage({now,records,intents,orders,fills,runs:this.state.aiRuns.filter(r=>runIds.has(r.id)).map(r=>({id:r.id,symbol:r.symbol,startedAt:r.startedAt})),positions:[...this.state.positions.values()].slice(0,100),candidates,quotes});
  }
  report(){return{...this.result,manifest:this.manifest,entryEnforceAuthorized:false,profitRealizationAuthorized:false};}
  readContext(){return{experimentManifest:this.result.status==='READY'?this.manifest:undefined,enrollmentByCycle:this.result.enrollmentByCycle??{},accountScope:this.accountScope};}
  close(){const worker=this.worker;this.worker=null;if(worker)void worker.terminate();}
}
