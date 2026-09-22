import {createHash} from 'node:crypto';

/**
 * S07-C/D: trade memory, its retrieval and its attribution.
 *
 * A cycle is only a return sample when its net is actually known: funding that was never attributed,
 * a cycle that is still open, or a record that lost its identity are kept as what they are - censored
 * or unknown - and never folded into a mean. Retrieval has to show counter-examples, so a query that
 * finds only winners is reported as a coverage problem rather than as evidence. Attribution keeps the
 * original decision, the mark at handoff and the human's later behaviour in three separate numbers,
 * because "the human took over and it lost" is not the same claim as "the AI lost".
 */

export type MemoryOutcome='REALIZED_PROFIT'|'REALIZED_LOSS'|'CENSORED_OPEN'|'UNKNOWN_NET';

export type MemoryCycle={
  memoryId:string;
  cycleId:string;
  scope:string;
  symbol:string;
  direction:'LONG'|'SHORT';
  shape:string;
  volatilityBucket:string;
  horizonBucket:string;
  liquidityBucket:string;
  openedAt:number;
  closedAt:number|null;
  netPnlUsd:number|null;
  netRoiOnMargin:number|null;
  fundingStatus:'EXACT'|'UNKNOWN'|'CONFLICT';
  feeCompleteness:'COMPLETE'|'PARTIAL'|'UNKNOWN';
  outcome:MemoryOutcome;
  planRef:string|null;
  planVersion:number|null;
  mfePct:number|null;
  maePct:number|null;
  capitalUsageUsdSeconds:number|null;
  handoffAt:number|null;
  handoffMarkUsd:number|null;
  humanActions:Array<{at:number;kind:string;notionalUsd:number|null;deltaUnits:number|null}>;
  finalOwner:'AI'|'HUMAN'|'UNKNOWN';
  duplicateOf:string|null;
  provenance:string[];
};

export type MemoryQuery={direction?:'LONG'|'SHORT';shape?:string;volatilityBucket?:string;horizonBucket?:string;liquidityBucket?:string;limit?:number};

export type MemoryRetrieval={entries:MemoryEntry[];coverage:{matched:number;realizedSamples:number;censored:number;unknownNet:number;duplicatesRemoved:number;
  winners:number;losers:number;counterExamples:number};status:'READY'|'INSUFFICIENT_SAMPLES'|'NO_COUNTER_EXAMPLE';reasons:string[];retrievalHash:string};

export type MemoryEntry=MemoryCycle;

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

const bucket=(value:number,scale:number)=>!finite(value)?'UNKNOWN':`B${Math.max(0,Math.floor(Math.abs(value)/scale))}`;

/** Classifies one cycle from its accounting record. Nothing here is allowed to guess a number. */
export function memoryCycleOf(input:{
  cycleId:string;scope:string;symbol:string;direction:'LONG'|'SHORT';openedAt:number;closedAt:number|null;
  netPnlUsd:number|null;netRoiOnMargin?:number|null;fundingStatus:'EXACT'|'UNKNOWN'|'CONFLICT';feeCompleteness?:'COMPLETE'|'PARTIAL'|'UNKNOWN';
  shape?:string;atrPercent?:number|null;horizonMinutes?:number|null;quoteVolumeUsd24h?:number|null;
  mfePct?:number|null;maePct?:number|null;capitalUsageUsdSeconds?:number|null;
  planRef?:string|null;planVersion?:number|null;
  handoffAt?:number|null;handoffMarkUsd?:number|null;
  humanActions?:MemoryCycle['humanActions'];finalOwner?:'AI'|'HUMAN'|'UNKNOWN';duplicateOf?:string|null;provenance?:string[];
}):MemoryCycle{
  const closed=finite(input.closedAt)&&Number(input.closedAt)>0;
  const feeCompleteness=input.feeCompleteness??'UNKNOWN';
  // A live mark is not a result. Only a cycle that actually closed, with funding and fees proven,
  // contributes a realized number; anything else is named, never averaged.
  const factsProven=finite(input.netPnlUsd)&&input.fundingStatus==='EXACT'&&feeCompleteness==='COMPLETE';
  const netKnown=closed&&factsProven;
  const outcome:MemoryOutcome=!closed?'CENSORED_OPEN':(!factsProven?'UNKNOWN_NET':(Number(input.netPnlUsd)>=0?'REALIZED_PROFIT':'REALIZED_LOSS'));
  const base={
    cycleId:input.cycleId,scope:input.scope,symbol:input.symbol,direction:input.direction,openedAt:input.openedAt,closedAt:closed?Number(input.closedAt):null,
    netPnlUsd:netKnown?Number(input.netPnlUsd):null,netRoiOnMargin:netKnown&&finite(input.netRoiOnMargin)?Number(input.netRoiOnMargin):null,
    fundingStatus:input.fundingStatus,feeCompleteness,outcome,
    shape:String(input.shape??'UNKNOWN'),volatilityBucket:bucket(Number(input.atrPercent??Number.NaN),1),horizonBucket:bucket(Number(input.horizonMinutes??Number.NaN),60),
    liquidityBucket:bucket(Number(input.quoteVolumeUsd24h??Number.NaN),1_000_000_000),
    mfePct:finite(input.mfePct)?Number(input.mfePct):null,maePct:finite(input.maePct)?Number(input.maePct):null,
    capitalUsageUsdSeconds:finite(input.capitalUsageUsdSeconds)?Number(input.capitalUsageUsdSeconds):null,
    planRef:input.planRef??null,planVersion:finite(input.planVersion)?Number(input.planVersion):null,
    handoffAt:finite(input.handoffAt)?Number(input.handoffAt):null,handoffMarkUsd:finite(input.handoffMarkUsd)?Number(input.handoffMarkUsd):null,
    humanActions:input.humanActions??[],finalOwner:input.finalOwner??'UNKNOWN',duplicateOf:input.duplicateOf??null,provenance:input.provenance??[],
  };
  return{...base,memoryId:`mem_${hash([base.scope,base.cycleId,base.openedAt,base.direction])}`};
}

/** Realized samples only; every exclusion is stated rather than silently filtered out. */
export function returnSamples(cycles:MemoryCycle[]){
  const realized=cycles.filter(row=>row.outcome==='REALIZED_PROFIT'||row.outcome==='REALIZED_LOSS');
  return{realized,censored:cycles.filter(row=>row.outcome==='CENSORED_OPEN'),unknownNet:cycles.filter(row=>row.outcome==='UNKNOWN_NET')};
}

export function retrieveTradeMemory(cycles:MemoryCycle[],query:MemoryQuery={}):MemoryRetrieval{
  // Three is the contract: one winner, one counter-example and one more, never a padded list.
  const limit=Math.max(1,Math.min(3,Math.trunc(query.limit??3)));
  const reasons:string[]=[];
  const seen=new Set<string>(),deduped:MemoryCycle[]=[];
  let duplicatesRemoved=0;
  for(const row of [...cycles].sort((a,b)=>b.openedAt-a.openedAt||a.memoryId.localeCompare(b.memoryId))){
    if(row.duplicateOf){duplicatesRemoved++;continue;}
    const identity=`${row.scope}|${row.cycleId}`;
    if(seen.has(identity)){duplicatesRemoved++;continue;}
    seen.add(identity);
    deduped.push(row);
  }
  const matches=deduped.filter(row=>(!query.direction||row.direction===query.direction)
    &&(!query.shape||row.shape===query.shape)
    &&(!query.volatilityBucket||row.volatilityBucket===query.volatilityBucket)
    &&(!query.horizonBucket||row.horizonBucket===query.horizonBucket)
    &&(!query.liquidityBucket||row.liquidityBucket===query.liquidityBucket));
  const realizedList=returnSamples(matches).realized;
  const winners=realizedList.filter(row=>Number(row.netPnlUsd)>0),losers=realizedList.filter(row=>Number(row.netPnlUsd)<0);
  // A Top-3 that is all winners is not evidence; the counter-example is taken even when it loses,
  // and if none exists the retrieval says so instead of pretending the sample supports a claim.
  const picks:MemoryCycle[]=[];
  const push=(row:MemoryCycle|undefined)=>{if(row&&!picks.includes(row))picks.push(row);};
  push(winners[0]);push(losers[0]);push(winners[1]??losers[1]??realizedList.find(row=>!picks.includes(row)));
  const entries=picks.slice(0,limit);
  if(entries.length<limit)reasons.push(`INSUFFICIENT_MATCHED_SAMPLES:${entries.length}<${limit}`);
  if(!losers.length&&winners.length)reasons.push('NO_COUNTER_EXAMPLE_IN_MATCHED_SAMPLE');
  if(returnSamples(matches).censored.length)reasons.push(`RIGHT_CENSORED_EXCLUDED:${returnSamples(matches).censored.length}`);
  if(returnSamples(matches).unknownNet.length)reasons.push(`UNKNOWN_NET_EXCLUDED:${returnSamples(matches).unknownNet.length}`);
  return{entries,
    coverage:{matched:matches.length,realizedSamples:realizedList.length,censored:returnSamples(matches).censored.length,
      unknownNet:returnSamples(matches).unknownNet.length,duplicatesRemoved,winners:winners.length,losers:losers.length,
      counterExamples:Math.min(winners.length,losers.length)},
    status:!losers.length&&winners.length?'NO_COUNTER_EXAMPLE':entries.length<limit?'INSUFFICIENT_SAMPLES':'READY',
    reasons:[...new Set(reasons)],
    retrievalHash:`ret_${hash({query,entries:entries.map(row=>row.memoryId),coverage:{matched:matches.length}})}`};
}

/**
 * S07-D: one bridge, three numbers. The AI's own result stops at the handoff mark; what the human did
 * afterwards is attributed to the human; the whole cycle is the sum. Losing a handoff mark means the
 * split cannot be computed, and then nothing is claimed at all.
 */
export function attributeCycleOutcome(input:{cycle:MemoryCycle;netAtCutoverUsd:number|null;finalNetUsd:number|null}){
  if(input.cycle.handoffAt==null){
    if(!finite(input.finalNetUsd))return{computable:false,aiAttributedUsd:null,humanIncrementUsd:null,cycleTotalUsd:null,reasons:['REALIZED_NET_UNKNOWN'],cutoverMarkUsd:null};
    return{computable:true,aiAttributedUsd:Number(input.finalNetUsd),humanIncrementUsd:0,cycleTotalUsd:Number(input.finalNetUsd),
      reasons:['NO_HANDOFF_AI_OWNED_WHOLE_CYCLE'],cutoverMarkUsd:null};
  }
  const mark=finite(input.netAtCutoverUsd)?Number(input.netAtCutoverUsd):finite(input.cycle.handoffMarkUsd)?Number(input.cycle.handoffMarkUsd):null;
  if(mark===null||!finite(input.finalNetUsd))
    return{computable:false,aiAttributedUsd:null,humanIncrementUsd:null,cycleTotalUsd:null,
      reasons:[!finite(input.finalNetUsd)?'REALIZED_NET_UNKNOWN':'CUTOVER_MARK_UNPROVEN'],cutoverMarkUsd:mark};
  return{computable:true,aiAttributedUsd:mark,humanIncrementUsd:Number(input.finalNetUsd)-mark,cycleTotalUsd:Number(input.finalNetUsd),
    reasons:['CUTOVER_BRIDGE_APPLIED'],cutoverMarkUsd:mark};
}
