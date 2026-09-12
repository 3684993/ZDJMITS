// @ts-nocheck
import {privateAccountFresh} from './privateAccountReadiness.js';
import type { RuntimeMode, RuntimeReasonCode } from '@zdj/contracts';
import { evaluateCapitalAdmission } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import { directionBudget } from './riskReadiness.js';

const reasonText=(code:RuntimeReasonCode)=>({
  NONE:'运行中',MANUAL_PAUSE:'已手动暂停新建仓流水',MANUAL_RESUME:'已恢复新建仓流水',NO_CAPITAL:'没有满足最低保证金的可执行资金',NO_EXECUTABLE_CONTRACT:'当前候选没有可执行合约',PRIVATE_NOT_READY:'交易所私有数据未就绪',MARKET_NOT_READY:'行情数据未就绪',MIN_EXECUTABLE_CANDIDATES_NOT_MET:'可执行候选数低于阈值',AUTO_RESUMED:'资金/合约恢复后自动恢复',DAILY_RISK_LIMIT:'已触发日内风险限额，等待人工复核',MANUAL_RISK_OVERRIDE:'日内风险告警已人工复核；当前风险周期内允许 Testnet AUTO',DEGRADED:'运行控制处于降级状态',
}[code]);
const riskCycleKey=(at=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const nextRiskCycleAt=(at=Date.now())=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)),part=(type:string)=>Number(parts.find(x=>x.type===type)?.value);return Date.UTC(part('year'),part('month')-1,part('day')+1)-8*60*60_000;};
export const capitalFactVersion=(state:RuntimeState)=>JSON.stringify({
  assets:[...(state.account.assets??[])].map((asset:any)=>[asset.asset,asset.availableBalance,asset.walletBalance,asset.usdValue]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  positions:[...state.positions.values()].map((position:any)=>[position.symbol,position.side,position.quantity,position.markPrice,position.leverage]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  reservations:[...state.entryReservations.values()].filter((reservation:any)=>['RESERVED','WORKING'].includes(reservation.status)&&reservation.expiresAt>Date.now()).map((reservation:any)=>[reservation.id,reservation.underlying,reservation.quoteAsset,reservation.marginUsd,reservation.notionalUsd,reservation.status,reservation.expiresAt]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  orders:[...state.entryOrders.values()].filter((order:any)=>['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(order.status)).map((order:any)=>[order.symbol,order.status,order.quantity,order.filledQuantity]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  equity:state.account.equityUsd??null,
  risk:state.account.riskBaseline??null,
  limits:{portfolio:state.settings.portfolio,portfolioIntelligence:state.settings.portfolioIntelligence,riskGovernance:state.settings.riskGovernance},
});

export class RuntimeControlService {
  private entryRiskBlocked=false;
  private admissionDetails:unknown[]=[];
  capacityDiagnostics(){return{slots:this.state.entryCapacity(),newRiskBlocked:this.entryRiskBlocked,candidates:this.admissionDetails,capital:this.state.runtimeControl.capital};}
  constructor(private state:RuntimeState,private events:EventBus){}

  canDispatch(){return privateAccountFresh(this.state.account)&&!this.entryRiskBlocked&&this.state.executionGovernance?.mode==='AUTO_RUNNING'&&this.state.runtimeControl.mode==='RUNNING'&&(this.state.settings.riskGovernance?.entrySafetyMode??'AUTO')==='AUTO';}
  isPaused(){return !this.canDispatch();}

  manualRiskOverrideActive(at=Date.now()){
    const override=this.state.runtimeControl.manualRiskOverride;
    if(!override)return false;
    if(override.riskCycleKey===riskCycleKey(at)&&at<override.expiresAt)return true;
    this.state.runtimeControl={...this.state.runtimeControl,manualRiskOverride:null};
    this.events.publish('MANUAL_RISK_OVERRIDE_EXPIRED',{riskCycleKey:override.riskCycleKey,expiredAt:override.expiresAt});
    return false;
  }

  manualRiskOverrideStatus(at=Date.now()){
    const active=this.manualRiskOverrideActive(at),override=this.state.runtimeControl.manualRiskOverride;
    return {active,status:active?'MANUAL_RISK_OVERRIDE_ACTIVE':'INACTIVE',override,nextRiskCycleAt:nextRiskCycleAt(at),riskCycleKey:riskCycleKey(at)};
  }

  activateManualRiskOverride(input:{environment:string;executionMode:string;executionGovernanceMode:string;reason:string}){
    if(input.environment!=='TESTNET'||input.executionMode!=='TESTNET_ENABLED')throw new Error('TESTNET_MANUAL_RISK_OVERRIDE_ONLY');
    const current=this.state.runtimeControl;
    if(current.mode!=='PAUSED_DAILY_RISK_LIMIT'||input.executionGovernanceMode!=='AUTO_PAUSED_RISK')throw new Error('MANUAL_RISK_OVERRIDE_REQUIRES_ACTIVE_RISK_PAUSE');
    const now=Date.now(),risk:any=this.state.account.riskBaseline??{},override={status:'MANUAL_RISK_OVERRIDE_ACTIVE' as const,riskCycleKey:riskCycleKey(now),activatedAt:now,expiresAt:nextRiskCycleAt(now),previousState:{runtimeMode:current.mode,executionMode:input.executionGovernanceMode,pauseReason:current.reasonText},operatorAction:'MANUAL_RISK_PAUSE_OVERRIDE' as const,reason:input.reason.trim()||'Testnet 日内风险人工复核',riskMetrics:{capitalEpochRealizedPnlUsd:Number(risk.capitalEpochRealizedPnlUsd??0),riskDrawdownPct:Number(risk.riskDrawdownPct??0),equityUsd:Number(this.state.account.equityUsd??0)}};
    this.state.runtimeControl={...current,mode:'RUNNING',reasonCode:'MANUAL_RISK_OVERRIDE',reasonText:reasonText('MANUAL_RISK_OVERRIDE'),pausedAt:null,pauseSource:'MANUAL',autoResume:false,lastTransitionAt:now,manualRiskOverride:override};
    return override;
  }

  pauseManual(reason='用户手动暂停新建仓流水'){
    const now=Date.now();
    this.state.runtimeControl={...this.state.runtimeControl,mode:'PAUSED_MANUAL',reasonCode:'MANUAL_PAUSE',reasonText:reason,pausedAt:now,pauseSource:'MANUAL',autoResume:false,lastTransitionAt:now};
    this.events.publish('TRADING_PIPELINE_PAUSED_MANUAL',{mode:'PAUSED_MANUAL',reasonText:reason,capital:this.state.runtimeControl.capital});
    return this.state.runtimeControl;
  }

  resumeManual(){
    const now=Date.now();
    if(this.state.runtimeControl.mode==='RUNNING')return this.state.runtimeControl;
    const from=this.state.runtimeControl.mode;
    this.state.runtimeControl={...this.state.runtimeControl,mode:'RUNNING',reasonCode:'MANUAL_RESUME',reasonText:reasonText('MANUAL_RESUME'),pausedAt:null,pauseSource:'NONE',autoResume:true,lastTransitionAt:now};
    this.events.publish('TRADING_PIPELINE_RESUMED_MANUAL',{mode:'RUNNING',from,capital:this.state.runtimeControl.capital});
    return this.state.runtimeControl;
  }

  evaluate(force=false){
    const settings=this.state.settings.runtimeControl,now=Date.now(),current=this.state.runtimeControl;
    if(!force&&current.nextCapitalCheckAt&&now<current.nextCapitalCheckAt)return current;
    const candidates=this.state.universe.filter(candidate=>candidate.eligible&&candidate.rank>0);
    const positions=[...this.state.positions.values()].map(position=>({symbol:String(position.symbol),side:position.side as 'LONG'|'SHORT',quantity:Number(position.quantity),markPrice:Number(position.markPrice),leverage:Number(position.leverage)}));
    // Admission must scan the ranked Universe, not the current Pool.  Feeding a
    // partially depleted pool back into routing creates a self-locking two-item
    // loop and prevents high-frequency replacement of locally cooled symbols.
    const admission=evaluateCapitalAdmission({candidates,snapshots:[...this.state.snapshots.values()],settings:this.state.settings,positions,assets:this.state.account.assets});
    const slots=this.state.entryCapacity();if(slots.used>=slots.max){admission.summary.executableCandidateCount=0;admission.summary.routedCandidates=[];admission.summary.reasonCounts={POSITION_CAPACITY_FULL:admission.decisions.length};for(const row of admission.decisions){row.executable=false;row.reason='POSITION_CAPACITY_FULL';row.reasonText=`仓位容量 ${slots.used}/${slots.max}（持仓${slots.positions}、在途${slots.inFlight}、预留${slots.reserved}）`;}}
    this.admissionDetails=admission.decisions.map(row=>({symbol:row.symbol,underlying:row.underlying,executable:row.executable,reason:row.reason,reasonText:row.reasonText,long:row.longPlan,short:row.shortPlan}));
    const nextAt=now+settings.capitalCheckIntervalSeconds*1000,capitalEquity=Math.max(Number(this.state.account.equityUsd??0),this.state.account.assets.reduce((sum,row)=>sum+Number(row.usdValue??0),0),1),budget=directionBudget(this.state.settings,capitalEquity,[...this.state.positions.values()],now);
    const routed=admission.summary.routedCandidates.map(route=>{const quoteAvailable=this.state.account.assets.find(asset=>asset.asset===route.quoteAsset)?.availableBalance??0,quoteCapacity=Math.max(0,quoteAvailable*route.leverage*.995),recommendedLong=route.longRecommendedNotionalUsd??(route.longExecutable?route.marginUsd*route.leverage:0),recommendedShort=route.shortRecommendedNotionalUsd??(route.shortExecutable?route.marginUsd*route.leverage:0),longFeasible=Math.max(0,Math.min(recommendedLong,budget.longAvailableNotionalUsd,budget.grossAvailableNotionalUsd,quoteCapacity)),shortFeasible=Math.max(0,Math.min(recommendedShort,budget.shortAvailableNotionalUsd,budget.grossAvailableNotionalUsd,quoteCapacity)),minimum=route.minExecutableNotionalUsd??0;return{...route,longFeasibleNotionalUsd:longFeasible,shortFeasibleNotionalUsd:shortFeasible,longExecutable:route.longExecutable&&longFeasible+1e-8>=minimum,shortExecutable:route.shortExecutable&&shortFeasible+1e-8>=minimum};});
    const routeGeneration=candidates.length?Math.max(...candidates.map((candidate:any)=>candidate.selectionGeneration??0)):this.state.marketGeneration,summary={...admission.summary,routedCandidates:routed,executableCandidateCount:routed.filter(x=>x.longExecutable||x.shortExecutable).length,directionBudget:budget,generation:routeGeneration,capitalVersion:capitalFactVersion(this.state),nextRecheckAt:nextAt};
    this.state.runtimeControl={...current,capital:summary,nextCapitalCheckAt:nextAt};
    this.events.publish('CAPITAL_ROUTE_EVALUATED',{capitalVersion:summary.capitalVersion,selectionGeneration:routeGeneration,executableCandidateCount:summary.executableCandidateCount,evaluatedAt:summary.evaluatedAt});
    const governance=this.state.settings.riskGovernance,risk=this.state.account.riskBaseline,loss=Math.max(0,-Number(risk?.calendarDayRealizedPnlUsd??risk?.capitalEpochRealizedPnlUsd??0)),equity=Math.max(1,this.state.account.equityUsd??0),drawdownPct=Number(risk?.riskDrawdownPct??0),dailyLimitHit=governance.circuitBreakerEnabled&&((governance.maxDailyLossUsd>0&&loss>=governance.maxDailyLossUsd)||(governance.maxDailyLossPct>0&&loss/equity>=governance.maxDailyLossPct)||drawdownPct>governance.maxDailyDrawdownPct);
    const manualOverride=this.manualRiskOverrideActive(now);
    this.entryRiskBlocked=dailyLimitHit&&!manualOverride;
    if(this.state.settings.releasePolicy?.lifecycleVersion>=390&&current.mode!=='PAUSED_MANUAL'){
      if(current.mode==='PAUSED_DAILY_RISK_LIMIT'){
        this.state.runtimeControl={...this.state.runtimeControl,mode:'RUNNING',pausedAt:null,pauseSource:'NONE',autoResume:true};
        if(this.state.executionGovernance.mode==='AUTO_PAUSED_RISK')this.state.executionGovernance={...this.state.executionGovernance,mode:'AUTO_RUNNING'};
      }
      if(this.entryRiskBlocked){this.state.runtimeControl={...this.state.runtimeControl,reasonCode:'DAILY_RISK_LIMIT',reasonText:'新增风险额度受限；行情、研究、订单维护与退出持续运行'};return this.state.runtimeControl;}
    }
    if(dailyLimitHit&&!manualOverride&&current.mode!=='PAUSED_MANUAL'){const paused={...this.state.runtimeControl,mode:'PAUSED_DAILY_RISK_LIMIT' as const,reasonCode:'DAILY_RISK_LIMIT' as const,reasonText:reasonText('DAILY_RISK_LIMIT'),pausedAt:now,pauseSource:'AUTO' as const,autoResume:false,lastTransitionAt:now};this.state.runtimeControl=paused;if(this.state.executionGovernance?.mode==='AUTO_RUNNING')this.state.executionGovernance={...this.state.executionGovernance,mode:'AUTO_PAUSED_RISK',changedAt:now,reason:'DAILY_RISK_LIMIT'};this.events.publish('TRADING_PIPELINE_PAUSED_DAILY_RISK_LIMIT',{mode:paused.mode,loss,equity,drawdownPct,capitalEpochId:risk?.capitalEpochId});return paused;}
    const marketReady=this.state.snapshots.size>0,privateReady=privateAccountFresh(this.state.account),eligible=summary.executableCandidateCount>=settings.minExecutableCandidates;
    if(current.mode==='PAUSED_MANUAL')return this.state.runtimeControl;
    if(current.mode==='PAUSED_NO_EXECUTABLE_CONTRACT'){
      const resumed={...this.state.runtimeControl,mode:'RUNNING' as const,reasonCode:'NO_EXECUTABLE_CONTRACT' as const,reasonText:'持续扫描中：当前没有合格可执行机会',pausedAt:null,pauseSource:'NONE' as const,autoResume:true,lastTransitionAt:now};this.state.runtimeControl=resumed;this.events.publish('TRADING_PIPELINE_NO_CANDIDATE_PAUSE_REMOVED',{from:current.mode,capital:summary});
    }
    if(!marketReady||!privateReady){
      if(current.mode==='RUNNING')this.state.runtimeControl={...this.state.runtimeControl,reasonCode:!marketReady?'MARKET_NOT_READY':'PRIVATE_NOT_READY',reasonText:!privateReady?'私有账户事实待刷新；仅新增建仓等待，行情/订单/持仓维护继续'+(this.state.account.reason?'：'+this.state.account.reason:''):reasonText('MARKET_NOT_READY')};
      return this.state.runtimeControl;
    }
    if(current.mode!=='RUNNING'&&settings.autoResumeOnCapital&&eligible){
      const mode=current.mode,reason=mode==='PAUSED_NO_CAPITAL'||mode==='PAUSED_NO_EXECUTABLE_CONTRACT';
      if(reason){const resumed={...this.state.runtimeControl,mode:'RUNNING' as const,reasonCode:'AUTO_RESUMED' as const,reasonText:reasonText('AUTO_RESUMED'),pausedAt:null,pauseSource:'NONE' as const,autoResume:true,lastTransitionAt:now};this.state.runtimeControl=resumed;this.events.publish('TRADING_PIPELINE_AUTO_RESUMED',{from:mode,capital:summary});return resumed;}
    }
    if(this.state.runtimeControl.mode==='RUNNING'&&settings.autoPauseOnNoCapital&&!eligible){
      const noCapital=summary.usdtAvailable<=0&&summary.usdcAvailable<=0||summary.noUsdtMargin+summary.noUsdcMargin>0&&summary.executableCandidateCount===0;
      if(noCapital){const mode:RuntimeMode='PAUSED_NO_CAPITAL',code:RuntimeReasonCode='NO_CAPITAL';const paused={...this.state.runtimeControl,mode,reasonCode:code,reasonText:reasonText(code),pausedAt:now,pauseSource:'AUTO' as const,autoResume:true,lastTransitionAt:now};this.state.runtimeControl=paused;this.events.publish('TRADING_PIPELINE_PAUSED_NO_CAPITAL',{mode,reasonCode:code,reasonText:reasonText(code),capital:summary});return paused;}
      this.state.runtimeControl={...this.state.runtimeControl,mode:'RUNNING',reasonCode:'NO_EXECUTABLE_CONTRACT',reasonText:slots.used>=slots.max?`仓位容量已满 ${slots.used}/${slots.max}；继续候选更新与订单维护`:'持续扫描中：当前没有合格可执行机会',pausedAt:null,pauseSource:'NONE',autoResume:true};
    }
    if(this.state.runtimeControl.mode==='RUNNING'&&eligible&&['NO_EXECUTABLE_CONTRACT','MARKET_NOT_READY','PRIVATE_NOT_READY','DAILY_RISK_LIMIT'].includes(this.state.runtimeControl.reasonCode))this.state.runtimeControl={...this.state.runtimeControl,reasonCode:'NONE',reasonText:reasonText('NONE')};
    return this.state.runtimeControl;
  }
}
