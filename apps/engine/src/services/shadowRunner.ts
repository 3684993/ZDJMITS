import { uid } from '@zdj/core';
import type { EventBus } from '../events/eventBus.js';
import type { RuntimeState } from '../state/runtimeState.js';
import type { SettingsStore } from '../config/settingsStore.js';
import type { MarketDataHub } from './marketDataHub.js';
import { buildInvalidation, buildRiskEnvelope, evaluateProtectionShadow, marketDataQuality, weightedEvidence } from './riskReadiness.js';
import { evaluateObservation } from './shadowObservation.js';

export class ShadowRunner {
  private timer:NodeJS.Timeout|null=null;
  private running=false;
  constructor(private readonly state:RuntimeState,private readonly market:MarketDataHub,private readonly store:SettingsStore,private readonly events:EventBus){}
  start(){
    const now=Date.now(),s:any=this.state.shadowRunner;
    if(!s.startAt)s.startAt=now;
    if(!s.validityEpochAt){s.validityEpochAt=now;s.validObservationStartedAt=null;s.validObservationRequiredUntil=null;s.validObservationStreak=0;}
    s.status='RUNNING';
    this.events.publish('SHADOW_RUNNER_STARTED',{...s,autoResume:false,validityEpochAt:s.validityEpochAt});
    void this.sample();
    this.timer=setInterval(()=>void this.sample(),30_000);
  }
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  async sample(){
    if(this.running||this.state.shadowRunner.status==='STOPPED')return;
    this.running=true;
    try{
      const positions=[...this.state.positions.values()].slice(0,100),equity=this.state.account.equityUsd??0,s:any=this.state.shadowRunner,recordedMarks=new Set<string>();
      for(const p of positions){
        const snapshot=this.market.snapshot(p.symbol);if(!snapshot)continue;
        const now=Date.now(),chainId=`shadow_${p.symbol}_${now}_${uid('c').slice(-4)}`,snapshotId=uid('snapshot');
        const dq=marketDataQuality(snapshot),ob=evaluateObservation(snapshot,this.state.account,now,this.state.settings.riskGovernance.shadow);
        const invalidation=buildInvalidation(snapshot,p.side,Math.max(1,equity),snapshotId),protection=evaluateProtectionShadow(p,invalidation);
        const risk=buildRiskEnvelope({settings:this.state.settings,equity:Math.max(1,equity),positions,symbol:p.symbol,side:p.side,plannedNotional:0,reservedIntents:this.state.reservationSummary().active.length,workingOrders:this.state.activeEntrySymbols().size,dailyDrawdownPct:Math.max(0,-(this.state.account.realizedPnlUsd24h??0))/Math.max(1,equity),expectedAdverseMovePct:Math.max(.001,snapshot.technical['15m'].atrPercent/100),quoteMarginUsage:0});
        const evidence=weightedEvidence({quote:ob.domains.PRICE_CORE.status==='INVALID'?0:1,technical:ob.domains.KLINE_CORE.status==='INVALID'?0:1,derivatives:ob.domains.DERIVATIVES.status==='UNAVAILABLE_BY_EXCHANGE'?0:1,book:ob.domains.ORDER_BOOK.status==='INVALID'?0:.5,portfolio:1,riskEnvelope:risk.status==='PASS'?1:0,invalidation:invalidation.type==='DATA_INVALIDATED'?0:1});
        const admission={status:risk.status==='PASS'?'SHADOW_ONLY_REVIEW':risk.status,executionEligible:false,shadowOnly:true,noEntryIntent:true,noReservation:true,noBinanceOrder:true,reasons:risk.reasons};
        const decisionSnapshot:any={snapshotId,symbol:p.symbol,candidateId:null,marketSnapshotId:dq.snapshotId,portfolioSnapshotId:`portfolio_${now}`,settingsVersion:this.state.settings.settingsVersion,capitalSnapshotId:`capital_${this.state.account.asOf??0}`,exposureSnapshotId:risk.id,createdAt:now,dataQuality:dq,observationValidity:ob,admissionDecision:admission,riskEnvelope:risk,structuredInvalidation:invalidation,evidence,reference:{side:p.side,mark:snapshot.quote.mark,entryPrice:p.entryPrice,tpPrice:null}};
        this.store.upsertDecisionSnapshot(decisionSnapshot);this.store.recordShadowMark({id:`mark_${snapshotId}`,ts:now,symbol:p.symbol,mark:snapshot.quote.mark,bid:snapshot.quote.bid,ask:snapshot.quote.ask,snapshotId});recordedMarks.add(p.symbol);
        s.samples++;if(ob.status==='INVALID')s.dataQualityBlocks++;if(risk.status!=='PASS')s.exposureBlocks++;if(evidence.score<(this.state.settings.riskGovernance.highRiskEvidenceThreshold??.95)||ob.status==='INVALID')s.reviewBlocks++;if(protection.status==='WOULD_TRIGGER')s.wouldStops++;if(risk.status!=='PASS'||ob.status==='INVALID')s.violations++;
        if(ob.status==='VALID'){s.validObservationStreak=(s.validObservationStreak??0)+1;if(!s.validObservationStartedAt&&s.validObservationStreak>=2){s.validObservationStartedAt=now;s.validObservationRequiredUntil=now+7*24*60*60_000;this.events.publish('SHADOW_VALID_OBSERVATION_STARTED',{startedAt:now,requiredUntil:s.validObservationRequiredUntil,reason:'FIRST_STABLE_VALID_OBSERVATION'},p.symbol);}}else s.validObservationStreak=0;
        this.events.publish('SHADOW_SAMPLE_RECORDED',{decisionChainId:chainId,decisionSnapshot,riskEnvelope:risk,dataQuality:dq,observationValidity:ob,admissionDecision:admission,structuredInvalidation:invalidation,protectionShadow:protection,reviewRequired:evidence.score<.95||ob.status==='INVALID'},p.symbol);
      }
      // Outcome labels must exist even when a Primary decision never reaches a
      // position.  Track durable pending episodes plus current EIPs, while the
      // position loop above retains its richer snapshot linkage.
      const outcomeSymbols=new Set<string>([
        ...this.store.listOutcomeTrackingSymbols(Date.now()-4*60*60_000-2*60_000,100),
        ...this.state.eips.keys(),
      ]);
      for(const symbol of outcomeSymbols){
        if(recordedMarks.has(symbol))continue;
        const snapshot=this.market.snapshot(symbol),mark=Number(snapshot?.quote.mark);
        if(!snapshot||!Number.isFinite(mark)||mark<=0)continue;
        const ts=Date.now();
        this.store.recordShadowMark({id:`mark_outcome_${symbol}_${ts}`,ts,symbol,mark,bid:snapshot.quote.bid,ask:snapshot.quote.ask,snapshotId:null});
        recordedMarks.add(symbol);
      }
      s.lastSampleAt=Date.now();
    }finally{this.running=false;}
  }
  status(){const s:any=this.state.shadowRunner,now=Date.now();return{...s,elapsedMs:s.startAt?Math.max(0,now-s.startAt):0,validObservationElapsedMs:s.validObservationStartedAt?Math.max(0,now-s.validObservationStartedAt):0,remainingMs:s.validObservationRequiredUntil?Math.max(0,s.validObservationRequiredUntil-now):null,autoResume:false,automaticExitCount:0,automaticStopMarketCount:0};}
}
