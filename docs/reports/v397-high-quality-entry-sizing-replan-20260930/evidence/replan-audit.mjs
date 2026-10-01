import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const settingsDb = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', {readOnly:true});
const qualityDb = new DatabaseSync('D:/MITS/data/trading-quality.sqlite', {readOnly:true});
settingsDb.exec('PRAGMA query_only=ON'); qualityDb.exec('PRAGMA query_only=ON');
const now=Date.now(), since=now-72*3600_000;
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value}catch{return null}};
const quantiles=values=>{const x=values.filter(Number.isFinite).sort((a,b)=>a-b),at=p=>x.length?x[Math.floor((x.length-1)*p)]:null;return{n:x.length,p10:at(.1),p50:at(.5),p90:at(.9),max:at(1),mean:x.length?x.reduce((a,b)=>a+b,0)/x.length:null}};
const countBy=(rows,key)=>rows.reduce((out,row)=>(out[key(row)]=(out[key(row)]??0)+1,out),{});
const settingsRow=settingsDb.prepare('select version,payload,updated_at from settings where id=1').get();
const settings=parse(settingsRow.payload);
const runRows=settingsDb.prepare("select payload from ai_runs_archive where started_at>=? and status='COMPLETED' order by started_at").all(since).map(row=>parse(row.payload)).filter(Boolean);
const primary=runRows.filter(row=>row.role==='PRIMARY_BRAIN');
const scout=runRows.filter(row=>row.role==='SCOUT');
const point=qualityDb.prepare('select ts,mark from tq_marks where scope=? and symbol=? and ts>=? and ts<=? order by ts limit 1');
const bounds=qualityDb.prepare('select min(ts) first,max(ts) last,min(mark) low,max(mark) high,count(*) n from tq_marks where scope=? and symbol=? and ts>=? and ts<=?');
const scopes=qualityDb.prepare('select distinct scope from tq_episodes').all().map(row=>row.scope);
if(scopes.length!==1||!String(scopes[0]).startsWith('TESTNET:'))throw new Error('TESTNET_QUALITY_SCOPE_NOT_UNIQUE');
const scope=scopes[0];
const entryOrders=settingsDb.prepare("select payload from runtime_entities where kind='entryOrders'").all().map(row=>parse(row.payload));
const intents=settingsDb.prepare("select payload from runtime_entities where kind='entryIntents'").all().map(row=>parse(row.payload));
const intentByRun=new Map(intents.map(row=>[row.brainRunId,row]));
const trendRows=[];
for(const run of primary){
  const normalized=parse(run.normalizedPreview), preview=parse(run.inputPreview), packet=preview?.packet;
  const direction=run.direction??normalized?.tradeSide??normalized?.direction;
  if(!['LONG','SHORT'].includes(direction)||!packet?.market?.technical)continue;
  const trends=Object.fromEntries(['15m','4h','1d'].map(tf=>[tf,packet.market.technical[tf]?.trend??'UNKNOWN']));
  const expected=direction==='LONG'?'UP':'DOWN';
  const alignment=trends['15m']===expected&&trends['4h']===expected&&trends['1d']===expected?'ALL_15M_4H_1D':trends['4h']===expected&&trends['1d']===expected?'HIGHER_4H_1D':trends['15m']===expected?'15M_ONLY':'NO_PRIMARY_ALIGNMENT';
  const completedAt=run.completedAt??run.startedAt, base=point.get(scope,run.symbol,completedAt,completedAt+120_000), sign=direction==='LONG'?1:-1;
  const outcomes={};
  for(const [label,ms] of [['5m',300_000],['15m',900_000],['30m',1_800_000],['60m',3_600_000]]){
    const end=completedAt+ms<=now?point.get(scope,run.symbol,completedAt+ms,completedAt+ms+120_000):null;
    outcomes[label]=base&&end?sign*(end.mark/base.mark-1)*100:null;
  }
  const intent=intentByRun.get(run.id), orders=entryOrders.filter(row=>row.intentId===intent?.id), filled=orders.some(row=>Number(row.filledQuantity)>0);
  const plan=normalized?.profitTakePlan, horizon=Number(plan?.targetHorizonMinutes), target=Number(plan?.targetPrice);
  let targetReach=null;
  if(base&&Number.isFinite(horizon)&&horizon>0&&Number.isFinite(target)&&target>0&&completedAt+horizon*60_000<=now){
    const b=bounds.get(scope,run.symbol,completedAt,completedAt+horizon*60_000), covered=Boolean(b&&b.first<=completedAt+120_000&&b.last>=completedAt+horizon*60_000-120_000&&b.n>=3);
    targetReach=covered?(direction==='LONG'?b.high>=target:b.low<=target):null;
  }
  trendRows.push({runId:run.id,symbol:run.symbol,completedAt,direction,decision:run.decision,trends,alignment,filled,latencyMs:run.latencyMs,outcomes,targetHorizonMinutes:Number.isFinite(horizon)?horizon:null,targetReach});
}
const group=(rows)=>Object.fromEntries(['5m','15m','30m','60m'].map(h=>[h,quantiles(rows.map(row=>row.outcomes[h]))]));
const trendGroups={};
for(const key of ['ALL_15M_4H_1D','HIGHER_4H_1D','15M_ONLY','NO_PRIMARY_ALIGNMENT']){const rows=trendRows.filter(row=>row.alignment===key);trendGroups[key]={count:rows.length,filled:rows.filter(row=>row.filled).length,outcomes:group(rows)};}
const targetRows=trendRows.filter(row=>row.targetReach!==null);
const scoutPairs=[];
for(const p of primary){const preceding=[...scout].reverse().find(s=>s.symbol===p.symbol&&s.completedAt&&s.completedAt<=p.startedAt&&p.startedAt-s.completedAt<=60_000);if(preceding)scoutPairs.push({primaryRunId:p.id,scoutRunId:preceding.id,scoutLatencyMs:preceding.latencyMs,primaryLatencyMs:p.latencyMs,serialMs:(p.completedAt??p.startedAt)-preceding.startedAt,handoffPresent:String(p.inputPreview??'').includes('SCOUT_FACTS_NON_AUTHORITATIVE')});}
const result={asOf:now,windowHours:72,scope,settings:{version:settingsRow.version,updatedAt:settingsRow.updated_at,environment:settings.connections.exchange.environment,executionMode:settings.connections.executionMode,scoutEnabled:settings.ai.scoutEnabled,decisionTimeoutMs:settings.ai.decisionTimeoutMs,entryMarginUsd:settings.portfolio.entryMarginUsd,baseMarginUsd:settings.portfolioIntelligence.baseMarginUsd,minMarginUsd:settings.portfolioIntelligence.minMarginUsd,minNetProfitUsd:settings.takeProfit.minNetProfitUsd,minNetProfitRoiPct:settings.takeProfit.minNetProfitRoiPct,economicAdmissionMode:settings.tradeEconomics.admissionMode,profitFloorDisposition:settings.takeProfit.authorizedTargetProfitFloorDisposition},runs:{primary:primary.length,scout:scout.length,primaryLatencyMs:quantiles(primary.map(row=>row.latencyMs)),scoutLatencyMs:quantiles(scout.map(row=>row.latencyMs)),paired:scoutPairs.length,serialLatencyMs:quantiles(scoutPairs.map(row=>row.serialMs)),handoffPresent:scoutPairs.filter(row=>row.handoffPresent).length,primaryDecisions:countBy(primary,row=>row.decision??'NULL')},trend:{eligible:trendRows.length,byAlignment:countBy(trendRows,row=>row.alignment),byDirection:countBy(trendRows,row=>row.direction),groups:trendGroups},targetReach:{matureCovered:targetRows.length,reached:targetRows.filter(row=>row.targetReach).length,rate:targetRows.length?targetRows.filter(row=>row.targetReach).length/targetRows.length:null,byHorizon:countBy(targetRows,row=>String(row.targetHorizonMinutes)),unknownOrImmature:trendRows.length-targetRows.length},rows:trendRows,scoutPairs};
fs.writeFileSync(new URL('./replan-audit.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,rows:undefined,scoutPairs:undefined},null,2));
settingsDb.close();qualityDb.close();
