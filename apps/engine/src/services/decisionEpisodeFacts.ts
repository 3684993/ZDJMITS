import type { DatabaseSync } from 'node:sqlite';
import { FACT_SCHEMA_VERSION } from '@zdj/contracts';

export function terminalDecision(run:any, previous:any=null) {
  let normalized:any=null;
  try { normalized=JSON.parse(run.normalizedPreview??'null'); } catch { /* Explicitly unavailable below. */ }
  let input:any=null;try{input=JSON.parse(run.inputPreview??'null');}catch{/* unavailable */}
  const quote=input?.packet?.market?.quote,anchorPrice=typeof quote?.mark==='number'&&Number.isFinite(quote.mark)?quote.mark:null,anchorPriceAt=typeof quote?.ts==='number'&&Number.isFinite(quote.ts)?quote.ts:null;
  const anchorValid=anchorPrice!=null&&anchorPriceAt!=null;
  return {factVersion:FACT_SCHEMA_VERSION,status:run.status,direction:run.direction??null,decision:run.decision??null,
    confidence:normalized?.confidence??null,reason:normalized?.reason??run.error??null,
    selectedCandidateId:normalized?.selectedCandidateId??null,targetPrice:finitePositive(normalized?.profitTakePlan?.targetPrice),targetHorizonMinutes:finitePositive(normalized?.profitTakePlan?.targetHorizonMinutes),
    normalizedAvailable:normalized!==null,rawDirection:run.rawDirection??null,rawDecision:run.rawDecision??null,
    terminalStage:run.terminalStage??(run.status==='FAILED'?'AI_FAILED':'SCHEMA_VALID'),
    inputTokens:run.inputTokens??null,outputTokens:run.outputTokens??null,
    marketAt:anchorPriceAt,availableAt:anchorPriceAt,decisionAt:run.completedAt??run.startedAt,anchorPrice,anchorPriceAt,predictionAnchor:anchorValid?'EIP_MARKET_QUOTE':'UNKNOWN',labelStatus:anchorValid?'VALID':'UNKNOWN',
    factAsOf:anchorPriceAt??run.startedAt,decidedAt:run.completedAt??run.startedAt,
    source:{table:'ai_runs_archive',runId:run.id},revision:previous?{previous,reason:'TERMINAL_AND_NORMALIZED_FIELD_REPAIR'}:null,
    shadowOnly:true,groundTruth:false};
}

const finitePositive=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;

/** Fixed horizons, sampled mark excursions, never a fill or candle-path claim. */
export function observedOutcome(db:DatabaseSync,symbol:string,at:number,initial:number|null,direction:string|null,now=Date.now(),targetPrice:number|null=null) {
  const initialRow=db.prepare('SELECT mark,ts FROM shadow_mark_series WHERE symbol=? AND ts<=? AND ts>=? ORDER BY ts DESC LIMIT 1').get(symbol,at,at-60_000) as any;
  const first=initial??initialRow?.mark??null;
  const definitions={m15:15,h1:60,h4:240,h24:1440,d3:4320,d7:10080};
  const horizons:Record<string,any>={};
  for(const [key,minutes] of Object.entries(definitions)) {
    const end=at+minutes*60_000;
    if(now<end||!first){horizons[key]=null;continue;}
    const rows=db.prepare('SELECT ts,mark FROM shadow_mark_series WHERE symbol=? AND ts>=? AND ts<=? ORDER BY ts').all(symbol,at,end) as Array<{ts:number;mark:number}>;
    const last=rows.at(-1);
    if(!last||end-last.ts>60_000){horizons[key]=null;continue;}
    const marketReturn=last.mark/first-1,sign=direction==='LONG'?1:direction==='SHORT'?-1:null;
    let maxGap=rows[0]!.ts-at;
    for(let i=1;i<rows.length;i++)maxGap=Math.max(maxGap,rows[i]!.ts-rows[i-1]!.ts);
    const covered=maxGap<=120_000;
    const path=sign===null?[]:rows.map(x=>sign*(x.mark/first-1));
    const targetHit=targetPrice!=null&&sign!==null?rows.find(row=>direction==='LONG'?row.mark>=targetPrice:row.mark<=targetPrice):null;
    horizons[key]={value:marketReturn,marketReturn,directionReturn:sign===null?null:sign*marketReturn,
      mfe:covered&&path.length?Math.max(0,...path):null,mae:covered&&path.length?(Math.min(0,...path)||0):null,
      at:last.ts,factAsOf:at,horizonMinutes:minutes,maturedAt:end,observedThrough:last.ts,
      source:'SHADOW_MARK_SERIES',coverage:covered?'SAMPLED_CONTIGUOUS':'SPARSE',maxGapMs:maxGap,
      targetPrice,targetHit:targetPrice==null?null:Boolean(targetHit),targetHitAt:targetHit?.ts??null,
      censorReason:targetPrice==null?'TARGET_NOT_AUTHORIZED':targetHit?'TARGET_HIT':'TARGET_NOT_HIT',
      executionAssumption:'NO_FILL_ASSUMED'};
  }
  return {factVersion:FACT_SCHEMA_VERSION,marketAt:at,anchorPrice:first,anchorPriceAt:at,firstMark:first,factAsOf:at,horizons,mfe:horizons.h24?.mfe??null,mae:horizons.h24?.mae??null,
    status:Object.values(horizons).some(Boolean)?'OBSERVED':now-at<900_000?'INSUFFICIENT_HORIZON':'UNKNOWN'};
}
