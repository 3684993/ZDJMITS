/** Pure S01 projections. They consume persisted facts and never invent a zero for a missing fact. */
export type FactStatus='EXACT'|'CONSERVATIVE_BOUND'|'UNKNOWN'|'CONFLICT';
export type RiskFactCoverage={status:FactStatus;currentRisk:'UNKNOWN'|'CURRENT_NO_ACTIVE_RISK'|'DURABLE_TERMINAL_PROVEN'|'CONFLICT';sources:string[];missing:string[];checkedAt:number;validUntil:number|null};

export function riskFactCoverage(input:{terminalStatus?:string|null;openOrderIdentity?:boolean;fillIdentity?:boolean;positionAttributed?:boolean;positionZero?:boolean;historyCovered?:boolean;checkedAt:number;validUntil?:number|null}):RiskFactCoverage{
  const sources:string[]=[],missing:string[]=[];
  if(input.openOrderIdentity===false)sources.push('OPEN_ORDER_IDENTITY_ABSENT');else if(input.openOrderIdentity!==true)missing.push('OPEN_ORDER_IDENTITY');
  if(input.fillIdentity===false)sources.push('FILL_IDENTITY_ABSENT');else if(input.fillIdentity!==true)missing.push('FILL_IDENTITY');
  if(input.positionZero===true)sources.push('POSITION_ZERO');else if(input.positionAttributed===true)sources.push('POSITION_ATTRIBUTED');else missing.push('POSITION_FACT');
  if(input.historyCovered===false)missing.push('HISTORY_COVERAGE');
  if(input.terminalStatus&&['FILLED','CANCELED','EXPIRED','REJECTED'].includes(input.terminalStatus))sources.push(`TERMINAL_${input.terminalStatus}`);
  const conflict=input.positionAttributed===false||input.terminalStatus==='CONFLICT';
  const durable=!conflict&&Boolean(input.terminalStatus&&['FILLED','CANCELED','EXPIRED','REJECTED'].includes(input.terminalStatus))&&input.historyCovered!==false;
  const noRisk=!conflict&&input.openOrderIdentity===false&&input.fillIdentity===false&&(input.positionZero===true||input.positionAttributed===true)&&input.historyCovered!==false;
  return{status:conflict?'CONFLICT':durable||noRisk?'EXACT':'UNKNOWN',currentRisk:conflict?'CONFLICT':durable?'DURABLE_TERMINAL_PROVEN':noRisk?'CURRENT_NO_ACTIVE_RISK':'UNKNOWN',sources,missing,checkedAt:input.checkedAt,validUntil:input.validUntil??null};
}

export type CollectorWindowSummary={segmentId:string;startedAt:number;endedAt:number;sampleCount:number;countDelta:number|null;hours:number|null;ratePerHour:number|null;peak:number;reset:boolean;identity:string};
export function collectorWindowSummary(input:{segmentId:string;identity:string;startedAt:number;endedAt:number;startCount:number|null;endCount:number|null;peak:number;reset?:boolean}):CollectorWindowSummary{
  const duration=Math.max(0,input.endedAt-input.startedAt),hours=duration>0?duration/3_600_000:null;
  const delta=input.startCount!=null&&input.endCount!=null&&!input.reset?input.endCount-input.startCount:null;
  return{segmentId:input.segmentId,startedAt:input.startedAt,endedAt:input.endedAt,sampleCount:delta==null?0:Math.max(0,delta),countDelta:delta,hours,ratePerHour:delta!=null&&hours&&hours>0?delta/hours:null,peak:Math.max(0,input.peak),reset:Boolean(input.reset),identity:input.identity};
}

export type PrimaryObservation='HEALTHY_IDLE'|'MARKET_PAUSE'|'RESOURCE_FAULT'|'RUNNING';
export function primaryObservation(input:{paused:boolean;marketOpen:boolean;resourceFault:boolean;lastRunAt:number|null;now:number;maxIdleMs:number}):PrimaryObservation{
  if(input.resourceFault)return'RESOURCE_FAULT';
  if(input.paused||!input.marketOpen)return input.paused||!input.marketOpen?'MARKET_PAUSE':'HEALTHY_IDLE';
  if(input.lastRunAt!=null&&input.now-input.lastRunAt<=input.maxIdleMs)return'RUNNING';
  return'HEALTHY_IDLE';
}
