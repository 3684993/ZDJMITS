import type {ExecutionFill, TradeRecord} from '@zdj/contracts';
import type {CostItem, EstimateInput, MoneyStatus} from './s03ExitCostEstimator.js';

/**
 * J1/S03: turns the accounting facts the Engine already keeps into the estimator's input, and
 * nothing else. Its whole job is to refuse: a missing fee, an unattributed funding row, a fill
 * borrowed from another cycle or an unproven FX rate must surface as an UNKNOWN fact so the policy
 * answers BLOCKED_FACTS. A zero is never written where a fact is absent (I05).
 */

export type ExitCostFactSource={
  now:number;
  scope:string;
  cycleId:string;
  symbol:string;
  side:'LONG'|'SHORT';
  positionVersion:number;
  remainingQuantityUnits:number;
  stepSize:number;
  tickSize:number;
  minNotional:number;
  entryPrice:number|null;
  bid:number|null;
  ask:number|null;
  quoteAt:number|null;
  expiresAt:number|null;
  rateMaxAgeMs:number;
  costVersion:string|null;
  quoteAsset:string;
  /** Only needed when a cost was paid in another asset; it must carry its own stamp. */
  fx:{rateToQuote:number|null;rateAt:number|null}|null;
  record:TradeRecord|null;
  fills:ExecutionFill[];
  fees:{takerRate:number;makerRate:number;assumption:'TAKER'|'MAKER';uncertaintyBufferBps:number}|null;
  /** Top-of-book notional the exit can absorb; unknown depth is not assumed to be infinite. */
  depthNotionalUsd:number|null;
};

export type ExitCostFacts={
  ready:boolean;
  blockers:string[];
  statuses:{gross:MoneyStatus;entryFee:MoneyStatus;exitFee:MoneyStatus;funding:MoneyStatus;projection:MoneyStatus};
  coverage:{fills:number;entryFills:number;exitFills:number;sourceIds:string[]};
  input:EstimateInput|null;
};

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const statusOf=(known:boolean):MoneyStatus=>known?'EXACT':'UNKNOWN';

export function assembleExitCostFacts(source:ExitCostFactSource):ExitCostFacts{
  const blockers:string[]=[];
  const refuse=(ok:boolean,code:string)=>{if(!ok)blockers.push(code);};
  refuse(Boolean(source.scope)&&source.scope!=='null','IDENTITY_MISSING:scope');
  refuse(Boolean(source.cycleId),'IDENTITY_MISSING:cycleId');
  refuse(Boolean(source.symbol),'IDENTITY_MISSING:symbol');
  refuse(Number.isSafeInteger(source.positionVersion)&&source.positionVersion>0,'POSITION_VERSION_INVALID');
  refuse(Number.isSafeInteger(source.remainingQuantityUnits)&&source.remainingQuantityUnits>0,'REMAINING_QUANTITY_INVALID');
  refuse(['LONG','SHORT'].includes(source.side),'SIDE_INVALID');
  refuse(finite(source.stepSize)&&source.stepSize>0,'STEP_SIZE_INVALID');
  refuse(finite(source.tickSize)&&source.tickSize>0,'TICK_SIZE_INVALID');
  refuse(finite(source.minNotional)&&source.minNotional>0,'MIN_NOTIONAL_INVALID');
  refuse(finite(source.entryPrice)&&source.entryPrice>0,'ENTRY_PRICE_INVALID');
  refuse(finite(source.quoteAt)&&source.quoteAt<=source.now,'QUOTE_NOT_YET_AVAILABLE');
  refuse(finite(source.expiresAt)&&source.expiresAt>(source.quoteAt??0),'QUOTE_WINDOW_INVALID');
  refuse(Boolean(source.costVersion),'COST_VERSION_MISSING');
  refuse(Number.isFinite(source.rateMaxAgeMs)&&source.rateMaxAgeMs>0,'RATE_MAX_AGE_INVALID');

  const record=source.record;
  if(!record)blockers.push('CYCLE_RECORD_UNPROVEN');
  else{
    if(record.symbol!==source.symbol)blockers.push(`FOREIGN_SYMBOL_FACT:${record.symbol}`);
    if(String(record.cycleId??'')!==String(source.cycleId??''))blockers.push(`FOREIGN_CYCLE_FACT:record:${record.cycleId??'null'}`);
  }
  const fees=source.fees;
  if(!fees||!finite(fees.takerRate)||!finite(fees.makerRate)||fees.takerRate<0||fees.makerRate<0||!finite(fees.uncertaintyBufferBps)||fees.uncertaintyBufferBps<0)
    blockers.push('FEE_MODEL_UNPROVEN');

  const exitSide=source.side==='LONG'?'SELL':'BUY';
  const entryFills:ExecutionFill[]=[],exitFills:ExecutionFill[]=[],foreign:string[]=[];
  const seen=new Set<string>();
  for(const fill of source.fills){
    if(fill.symbol!==source.symbol){foreign.push(`symbol:${fill.tradeId}`);continue;}
    if(String(fill.cycleId??'')!==String(source.cycleId??'')){foreign.push(`cycle:${fill.tradeId}`);continue;}
    const key=`${fill.symbol}:${fill.tradeId}`;
    if(seen.has(key)){foreign.push(`duplicate:${fill.tradeId}`);continue;}
    seen.add(key);
    (fill.side===exitSide?exitFills:entryFills).push(fill);
  }
  if(foreign.length)blockers.push(`FOREIGN_CYCLE_FACT:${foreign.sort().join(',')}`);
  if(!entryFills.length)blockers.push('ENTRY_FILL_UNPROVEN');

  const sum=(rows:ExecutionFill[],pick:(fill:ExecutionFill)=>number|null)=>{
    if(!rows.length)return null;
    let total=0;
    for(const row of rows){const value=pick(row);if(!finite(value))return null;total+=value;}
    return total;
  };
  // No exit fill for a proven cycle is the fact "nothing realized yet", which is a zero; a fill
  // whose commission or PnL never arrived is unknown and must stay unknown (I05).
  const grossKnown=entryFills.length>0&&(exitFills.length===0||exitFills.every(fill=>finite(fill.realizedPnl)));
  const entryFeeKnown=entryFills.length>0&&entryFills.every(fill=>finite(fill.commissionUsd));
  const exitFeeKnown=exitFills.length===0||exitFills.every(fill=>finite(fill.commissionUsd));
  const fundingKnown=Boolean(record)&&record.fundingAttributionStatus==='EXACT'&&finite(record.funding);
  if(!entryFeeKnown)blockers.push('ENTRY_FEE_UNKNOWN');
  if(!exitFeeKnown)blockers.push('EXIT_FEE_UNKNOWN');
  if(!grossKnown)blockers.push('REALIZED_GROSS_UNKNOWN');
  if(!fundingKnown)blockers.push('FUNDING_ATTRIBUTION_UNKNOWN');
  const convertedInOtherAsset=[...new Set([...entryFills,...exitFills].map(fill=>fill.commissionAsset).filter(asset=>asset&&asset!==source.quoteAsset))];
  if(convertedInOtherAsset.length&&!(source.fx&&finite(source.fx.rateToQuote)&&source.fx.rateToQuote>0&&finite(source.fx.rateAt)))
    blockers.push(`FX_RATE_UNPROVEN:${convertedInOtherAsset.sort().join(',')}`);

  const statuses={gross:statusOf(grossKnown),entryFee:statusOf(entryFeeKnown),exitFee:statusOf(exitFeeKnown),funding:statusOf(fundingKnown),projection:'UNKNOWN' as MoneyStatus};
  const settled=(id:string,kind:CostItem['kind'],amount:number|null,status:MoneyStatus):CostItem=>(
    {id,kind,cycleId:source.cycleId,scope:source.scope,settled:true,amount,status,asset:source.quoteAsset,sourceId:`${source.costVersion??'cost'}:${id}`}
  );
  const items:CostItem[]=[
    settled('gross-realized','REALIZED_GROSS',sum(exitFills,f=>finite(f.realizedPnl)?f.realizedPnl:null),statuses.gross),
    settled('entry-fee','ENTRY_FEE',sum(entryFills,f=>finite(f.commissionUsd)?f.commissionUsd:null),statuses.entryFee),
    settled('prior-exit-fee','PRIOR_EXIT_FEE',sum(exitFills,f=>finite(f.commissionUsd)?f.commissionUsd:null),statuses.exitFee),
    settled('funding','FUNDING',fundingKnown?Number(record!.funding):null,statuses.funding),
  ];

  const exitPrice=source.side==='LONG'?source.bid:source.ask;
  const remainingNotional=finite(exitPrice)&&exitPrice>0&&finite(source.stepSize)?source.remainingQuantityUnits*source.stepSize*exitPrice:0;
  let projection:MoneyStatus='UNKNOWN';
  if(finite(exitPrice)&&exitPrice>0&&fees&&finite(source.entryPrice)&&source.entryPrice>0
    &&Number.isSafeInteger(source.remainingQuantityUnits)&&source.remainingQuantityUnits>0&&finite(source.stepSize)&&source.stepSize>0){
    if(!(finite(source.depthNotionalUsd)&&source.depthNotionalUsd>=remainingNotional))blockers.push('EXIT_DEPTH_INSUFFICIENT');
    else{
      const unit=source.remainingQuantityUnits*source.stepSize;
      const gross=(source.side==='LONG'?exitPrice-source.entryPrice:source.entryPrice-exitPrice)*unit;
      const notional=exitPrice*unit;
      const fee=notional*(fees.assumption==='MAKER'?fees.makerRate:fees.takerRate);
      const slip=notional*Math.max(0,fees.uncertaintyBufferBps)/10_000;
      const projected=(id:string,kind:CostItem['kind'],value:number,bandwidth:number):CostItem=>({
        id,kind,cycleId:source.cycleId,scope:source.scope,settled:false,amount:null,
        low:Math.min(value,value-bandwidth),high:Math.max(value,value+bandwidth),status:'CONSERVATIVE_BOUND',
        asset:source.quoteAsset,sourceId:`${source.costVersion??'cost'}:${id}`,
      });
      items.push(projected('projected-gross','PROJECTED_EXIT_GROSS',gross,slip));
      items.push(projected('projected-fee','PROJECTED_EXIT_FEE',-fee,slip*0));
      items.push({id:'uncertainty-buffer',kind:'UNCERTAINTY_BUFFER',cycleId:source.cycleId,scope:source.scope,settled:false,
        amount:notional*Math.max(0,fees.uncertaintyBufferBps)/10_000,status:'EXACT',asset:source.quoteAsset,sourceId:`${source.costVersion??'cost'}:uncertainty-buffer`});
      projection='CONSERVATIVE_BOUND';
    }
  }else blockers.push('PROJECTED_EXIT_UNPRICED');
  if(projection==='UNKNOWN'&&!items.some(item=>item.kind==='PROJECTED_EXIT_GROSS'))
    items.push({id:'projected-gross',kind:'PROJECTED_EXIT_GROSS',cycleId:source.cycleId,scope:source.scope,settled:false,amount:null,status:'UNKNOWN',asset:source.quoteAsset,sourceId:`${source.costVersion??'cost'}:projected-gross`});
  statuses.projection=projection;

  const ready=blockers.length===0;
  const input:EstimateInput|null=ready?{
    scope:source.scope,cycleId:source.cycleId,positionVersion:source.positionVersion,costVersion:String(source.costVersion),
    remainingQuantityUnits:source.remainingQuantityUnits,side:source.side,
    quoteAt:Number(source.quoteAt),expiresAt:Number(source.expiresAt),now:source.now,
    entryPrice:Number(source.entryPrice),bid:Number(source.bid),ask:Number(source.ask),
    tickSize:source.tickSize,stepSize:source.stepSize,minNotional:source.minNotional,
    quoteAsset:source.quoteAsset,rateMaxAgeMs:source.rateMaxAgeMs,items,
  }:null;
  return{ready,blockers,statuses,
    coverage:{fills:entryFills.length+exitFills.length,entryFills:entryFills.length,exitFills:exitFills.length,sourceIds:items.map(row=>String(row.sourceId))},
    input};
}
