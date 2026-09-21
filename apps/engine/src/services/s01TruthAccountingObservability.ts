/** S01 facts used by reconciliation, collectors and runtime health. No missing fact becomes zero. */
export type FactStatus='EXACT'|'CONSERVATIVE_BOUND'|'UNKNOWN'|'CONFLICT';
export type RiskState='UNKNOWN'|'CURRENT_NO_ACTIVE_RISK'|'DURABLE_TERMINAL_PROVEN'|'CONFLICT';
export type RiskFactCoverage={status:FactStatus;currentRisk:RiskState;sources:string[];missing:string[];checkedAt:number;validUntil:number|null;reason:string};
export type RiskCoverageInput={now:number;checkedAt?:number|null;validUntil?:number|null;historyCovered?:boolean;terminalStatus?:string|null;activeOrderIdentity?:boolean;fillIdentity?:boolean;positionRelation?:'ABSENT'|'UNRELATED_PROVEN'|'ATTRIBUTED'|'AMBIGUOUS';identityTombstone?:string|null;evidenceIdentityTombstone?:string|null};
export function riskFactCoverage(input:RiskCoverageInput):RiskFactCoverage{
  const sources:string[]=[],missing:string[]=[],checkedAt=Number(input.checkedAt??NaN),validUntil=input.validUntil==null?null:Number(input.validUntil),history=input.historyCovered===true;
  if(!history)missing.push('HISTORY_COVERAGE');
  if(input.activeOrderIdentity===false)sources.push('OPEN_ORDER_IDENTITY_ABSENT');else if(input.activeOrderIdentity!==true)missing.push('OPEN_ORDER_IDENTITY');
  if(input.fillIdentity===false)sources.push('FILL_IDENTITY_ABSENT');else if(input.fillIdentity!==true)missing.push('FILL_IDENTITY');
  const relation=input.positionRelation;if(relation==='ABSENT')sources.push('POSITION_ZERO');else if(relation==='UNRELATED_PROVEN')sources.push('POSITION_PRESENT_PROVEN_OTHER_CYCLE');else if(relation==='ATTRIBUTED')sources.push('POSITION_ATTRIBUTED_TO_ENTRY');else missing.push('POSITION_ATTRIBUTION');
  if(input.terminalStatus&&['FILLED','CANCELED','EXPIRED','REJECTED'].includes(input.terminalStatus))sources.push(`TERMINAL_${input.terminalStatus}`);
  const timeValid=Number.isFinite(checkedAt)&&checkedAt<=input.now&&(validUntil!==null&&Number.isFinite(validUntil)&&validUntil>input.now),identityValid=(!input.identityTombstone&&!input.evidenceIdentityTombstone)||Boolean(input.identityTombstone&&input.evidenceIdentityTombstone&&input.identityTombstone===input.evidenceIdentityTombstone);
  const conflict=input.activeOrderIdentity===true||input.fillIdentity===true||relation==='ATTRIBUTED'||relation==='AMBIGUOUS'||!identityValid||input.terminalStatus==='CONFLICT',base=!conflict&&history&&input.activeOrderIdentity===false&&input.fillIdentity===false&&(relation==='ABSENT'||relation==='UNRELATED_PROVEN'),noRisk=base&&timeValid,durable=base&&timeValid&&Boolean(input.terminalStatus&&['FILLED','CANCELED','EXPIRED','REJECTED'].includes(input.terminalStatus));
  if(!timeValid&&base)missing.push('FRESHNESS');
  const currentRisk:RiskState=conflict?'CONFLICT':durable?'DURABLE_TERMINAL_PROVEN':noRisk?'CURRENT_NO_ACTIVE_RISK':'UNKNOWN';
  return{status:conflict?'CONFLICT':durable||noRisk?'EXACT':'UNKNOWN',currentRisk,sources,missing,checkedAt,validUntil,reason:conflict?'CONFLICTING_RISK_FACTS':durable?'POSITIVE_TERMINAL_AND_CURRENT_RISK_ABSENT':noRisk?'CURRENT_RISK_ABSENT_WITH_FRESH_COVERAGE':'INSUFFICIENT_OR_STALE_COVERAGE'};
}
export type CollectorSample={identity:string;at:number;count:number};
export type CollectorWindowSummary={segmentId:string;identity:string;startedAt:number;endedAt:number;sampleCount:number;countDelta:number|null;hours:number|null;ratePerHour:number|null;peak:number;reset:boolean;reason:string|null};
export function collectorWindowSummary(samples:CollectorSample[],segmentId='segment-0'):CollectorWindowSummary{
  const valid=samples.filter(s=>s&&typeof s.identity==='string'&&Number.isFinite(s.at)&&Number.isFinite(s.count)&&s.count>=0).sort((a,b)=>a.at-b.at);if(!valid.length)return{segmentId,identity:'UNKNOWN',startedAt:0,endedAt:0,sampleCount:0,countDelta:null,hours:null,ratePerHour:null,peak:0,reset:true,reason:'NO_VALID_SAMPLES'};
  let start=0,reset=false,reason:string|null=null;for(let i=1;i<valid.length;i++)if(valid[i]!.identity!==valid[start]!.identity||valid[i]!.count<valid[i-1]!.count){start=i;reset=true;reason=valid[i]!.identity!==valid[i-1]!.identity?'IDENTITY_CHANGED':'COUNTER_RESET';}
  const rows=valid.slice(start),first=rows[0]!,last=rows.at(-1)!,duration=last.at-first.at,hours=duration>0?duration/3_600_000:null,delta=rows.length>1?last.count-first.count:null;
  return{segmentId,identity:first.identity,startedAt:first.at,endedAt:last.at,sampleCount:rows.length,countDelta:delta,hours,ratePerHour:delta!=null&&hours?delta/hours:null,peak:Math.max(...rows.map(s=>s.count)),reset,reason};
}
export type PrimaryObservation='HEALTHY_IDLE'|'MARKET_PAUSE'|'RUNTIME_PAUSED'|'RESOURCE_FAULT'|'RUNNING';
export function primaryObservation(input:{runtimePaused:boolean;marketOpen:boolean;resourceFault:boolean;idleReason?:string|null;lastRunAt:number|null;now:number;maxIdleMs:number}):PrimaryObservation{
  if(input.resourceFault)return'RESOURCE_FAULT';if(input.runtimePaused)return'RUNTIME_PAUSED';if(!input.marketOpen)return'MARKET_PAUSE';if(input.lastRunAt!=null&&input.now-input.lastRunAt<=input.maxIdleMs)return'RUNNING';if(input.idleReason==='PRIMARY_MODEL_OFFLINE'||input.idleReason==='AI_RESOURCE_BUSY')return'RESOURCE_FAULT';return'HEALTHY_IDLE';
}
