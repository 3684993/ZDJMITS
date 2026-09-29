import { resolveUnderlying, testnetFundsOnlyEntry } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import {portfolioRiskSnapshot} from './v396OfflineStages.js';

export type HumanManagedSeverity='LOW'|'MEDIUM'|'HIGH'|'CRITICAL';

const safePct=(part:number,total:number)=>total>0?part/total*100:0;
const severity=(input:{lossPctEquity:number;notionalPctEquity:number;tpDistancePct:number|null;fundingDragPctEquity:number}):{level:HumanManagedSeverity;score:number}=>{
  const score=Math.min(100,
    Math.max(0,input.lossPctEquity)*900+
    Math.max(0,input.notionalPctEquity)*70+
    Math.min(20,Math.max(0,input.tpDistancePct??0))*.8+
    Math.max(0,input.fundingDragPctEquity)*400
  );
  return{score:Number(score.toFixed(2)),level:score>=70?'CRITICAL':score>=40?'HIGH':score>=20?'MEDIUM':'LOW'};
};

/** Read-only HUMAN_MANAGED projection. Severity never authorizes an exit. */
export function projectHumanManaged(state:RuntimeState){
  const positions=[...state.positions.values()],equity=Math.max(0,Number(state.account.equityUsd??0)),
    grossNotional=positions.reduce((sum:number,p:any)=>sum+Math.abs(Number(p.quantity)*Number(p.markPrice??p.entryPrice)),0),
    rows=positions.filter((p:any)=>p.managementStatus==='HUMAN_MANAGED');
  const items=rows.map((p:any)=>{
    const notional=Math.abs(Number(p.quantity)*Number(p.markPrice??p.entryPrice)),margin=notional/Math.max(1,Number(p.leverage??1)),
      tp=p.tpOrderId?state.tpOrders.get(p.tpOrderId):[...state.tpOrders.values()].find((o:any)=>o.positionId===p.id&&o.status==='WORKING'),
      tpPrice=Number(tp?.price??0)>0?Number(tp!.price):null,
      distanceToTpPct=tpPrice&&Number(p.markPrice)>0?Math.abs(tpPrice/Number(p.markPrice)-1)*100:null,
      record=[...state.tradeRecords.values()].find((r:any)=>r.positionId===p.id&&r.status!=='CLOSED')??[...state.tradeRecords.values()].find((r:any)=>r.symbol===p.symbol&&r.direction===p.side&&r.status!=='CLOSED'),
      fundingImpact=record?.funding??null,fundingAttributionStatus=record?.fundingAttributionStatus??'UNKNOWN',
      lossPctEquity=equity>0?Math.max(0,-Number(p.unrealizedPnl??0))/equity:0,
      notionalPctEquity=equity>0?notional/equity:0,
      fundingDragPctEquity=equity>0&&Number(fundingImpact)<0?Math.abs(Number(fundingImpact))/equity:0,
      riskSeverity=severity({lossPctEquity,notionalPctEquity,tpDistancePct:distanceToTpPct,fundingDragPctEquity}),
      underlying=resolveUnderlying(p.symbol),underlyingNotional=positions.filter((x:any)=>resolveUnderlying(x.symbol)===underlying).reduce((sum:number,x:any)=>sum+Math.abs(Number(x.quantity)*Number(x.markPrice??x.entryPrice)),0);
    return{
      positionId:p.id,symbol:p.symbol,side:p.side,qty:p.quantity,entry:p.entryPrice,mark:p.markPrice,
      unrealizedPnl:p.unrealizedPnl,unrealizedPnlPercent:p.unrealizedPnlPercent,notional,margin,leverage:p.leverage,
      openedAt:p.openedAt,humanManagedSince:p.humanManagedAt,tpStatus:p.tpStatus,tpPrice,distanceToTpPct,tpSource:p.tpCoverageSource,
      // P7: the physical cycle facts travel with the row. A page that has to join the snapshot by
      // position id in order to show a hold duration ends up inventing its own provenance rule, and the
      // engine already owns the one that distinguishes a proven first fill from a first observation.
      cycleId:p.cycleId??null,physicalCycleKey:p.physicalCycleKey??`${p.symbol}:${p.side}`,firstObservedAt:p.firstObservedAt??null,
      entryTimeSource:p.entryTimeSource??null,lastAddAt:p.lastAddAt??null,addCount:Math.max(0,Number(p.addCount??0)),
      lastReviewAt:p.lastReviewAt??null,nextReviewAt:p.nextReviewAt??null,
      fundingImpact,fundingAttributionStatus,severity:riskSeverity.level,severityScore:riskSeverity.score,
      portfolioExposureContributionPct:safePct(notional,grossNotional),equityNotionalPct:safePct(notional,equity),
      underlyingExposureContributionPct:safePct(underlyingNotional,grossNotional),
      automationPermission:false,allowedHumanActions:['HOLD','REPLACE_TP','REBUILD_TP','REDUCE','EMERGENCY_CLOSE']
    };
  }).sort((a,b)=>b.severityScore-a.severityScore||a.symbol.localeCompare(b.symbol));
  const hmNotional=items.reduce((n,row)=>n+row.notional,0),settings=state.settings.positionManagement;
  const capsBreached=Boolean(settings.humanManagedAdmissionCapsEnabled&&(items.length>=settings.maxHumanManagedPositions||hmNotional>=equity*settings.maxHumanManagedNotionalPctEquity-1e-8));
  // P4/R8: this used to publish `newEntryBlockedByCaps` as if it were an Entry authority. Under the
  // precise funds-only mode the human-managed caps are an observation, and the high-level admission
  // chain already ignores them - so reporting them as a block was a wrong fact, not a conservative one.
  // The raw counts stay; only the authority claim changes, and only where the mode says so.
  const fundsOnly=testnetFundsOnlyEntry(state.settings);
  return{
    asOf:Date.now(),items,
    summary:{count:items.length,notionalUsd:hmNotional,unrealizedPnl:items.reduce((n,row)=>n+Number(row.unrealizedPnl??0),0),equityUsd:equity,
      caps:{enabled:settings.humanManagedAdmissionCapsEnabled,maxPositions:settings.maxHumanManagedPositions,maxNotionalPctEquity:settings.maxHumanManagedNotionalPctEquity,maxNotionalUsd:equity*settings.maxHumanManagedNotionalPctEquity},
      newEntryBlockedByCaps:!fundsOnly&&capsBreached,
      humanCapsDisposition:fundsOnly?(capsBreached?'OBSERVE_OVER_CAPS':'OBSERVE_WITHIN_CAPS'):(capsBreached?'BLOCKING':'WITHIN_CAPS'),
      humanCapsEnforced:!fundsOnly},
    policy:{humanHandoffMeansManualHold:true,automaticStopLoss:false,timeoutClose:false,panicClose:false,severityMayAutoExit:false},
    riskSnapshot:portfolioRiskSnapshot({equity,positions:positions.map((p:any)=>({scope:`${p.symbol}:${p.side}`,notional:Number(p.quantity)*Number(p.markPrice??p.entryPrice),unrealizedPnl:Number(p.unrealizedPnl??0),human:p.managementStatus==='HUMAN_MANAGED'})),claims:[],unknownClaims:positions.filter((p:any)=>p.entryTimeSource==='UNKNOWN').length,stressLoss:null,coverage:'UNKNOWN'})
  };
}
