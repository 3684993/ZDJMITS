/**
 * S03-A/S03-C: exit cost valuation and the executable price bound.
 *
 * Pure and offline. It reads no database, adapter, network, settings store or engine state,
 * and it is wired to no order path. Money is handled in integer milli-units (scale 1/1000 of
 * the quote currency) so the -9.99 / -10.00 / -10.01 boundary is exact and no epsilon can
 * forgive a breach; that scale is the reviewed decimal policy for this stage (CONTRACTS §1).
 *
 * Every input fact carries its own status. A missing or conflicting fact is never treated as
 * zero: the estimate is returned with a null net value and an explicit status so the policy
 * layer must answer BLOCKED_FACTS instead of guessing (I05).
 */
export const MILLI_SCALE=1_000;
export type MoneyStatus='EXACT'|'CONSERVATIVE_BOUND'|'UNKNOWN'|'CONFLICT';
export type CostKind='REALIZED_GROSS'|'ENTRY_FEE'|'PRIOR_EXIT_FEE'|'FUNDING'|'PROJECTED_EXIT_GROSS'|'PROJECTED_EXIT_FEE'|'UNCERTAINTY_BUFFER';

/** Settled items already belong to the cycle; projected items are estimates of the remaining exit. */
export type CostItem={
  id:string;kind:CostKind;cycleId:string;scope:string;settled:boolean;
  amount?:number|null;low?:number|null;high?:number|null;status:MoneyStatus;
  asset:string;rateToQuote?:number|null;rateAt?:number|null;sourceId:string|null;
};

export type EstimateInput={
  scope:string;cycleId:string;positionVersion:number;costVersion:string;
  remainingQuantityUnits:number;side:'LONG'|'SHORT';
  quoteAt:number;expiresAt:number;now:number;
  entryPrice:number;bid:number;ask:number;tickSize:number;stepSize:number;minNotional:number;
  quoteAsset:string;rateMaxAgeMs:number;
  items:CostItem[];
};

export type ExitEstimate={
  schemaVersion:'V396-EXIT-1';scope:string;cycleId:string;positionVersion:number;costVersion:string;
  quoteAt:number;expiresAt:number;quoteFresh:boolean;remainingQuantityUnits:number;side:'LONG'|'SHORT';
  grossRealizedToDate:number|null;incurredFees:number|null;signedFunding:number|null;
  projectedExitGross:number|null;projectedExitFee:number|null;uncertaintyBuffer:number|null;
  netIfAllClosed:number|null;conservativeNet:number|null;netLow:number|null;netHigh:number|null;
  factsStatus:MoneyStatus;sourceIds:string[];reasons:string[];
  orderType:'LIMIT';marketFallbackAllowed:false;estimateHash:string;
};

const toMilli=(value:number)=>Math.round(value*MILLI_SCALE);
const fromMilli=(milli:number)=>milli/MILLI_SCALE;
const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  const record=value as Record<string,unknown>;
  return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
};
export const stableHash=(value:unknown)=>{
  const text=canonical(value);
  let h1=0x811c9dc5>>>0,h2=0x1000193>>>0;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);h1=Math.imul(h1^c,16777619)>>>0;h2=Math.imul(h2+ c,2246822519)>>>0;}
  return `${h1.toString(16).padStart(8,'0')}${h2.toString(16).padStart(8,'0')}`;
};

/**
 * Subtractive kinds are reported as a positive magnitude in the estimate but always reduce the
 * cycle net. The uncertainty buffer is subtracted exactly like a fee (CONTRACTS §5) and is never
 * double-counted against slippage already expressed inside a bounded gross.
 */
const SUBTRACTIVE_KINDS=new Set<CostKind>(['ENTRY_FEE','PRIOR_EXIT_FEE','PROJECTED_EXIT_FEE','UNCERTAINTY_BUFFER']);
const KIND_AGGREGATE:Record<CostKind,'grossRealizedToDate'|'incurredFees'|'signedFunding'|'projectedExitGross'|'projectedExitFee'|'uncertaintyBuffer'>={
  REALIZED_GROSS:'grossRealizedToDate',ENTRY_FEE:'incurredFees',PRIOR_EXIT_FEE:'incurredFees',FUNDING:'signedFunding',
  PROJECTED_EXIT_GROSS:'projectedExitGross',PROJECTED_EXIT_FEE:'projectedExitFee',UNCERTAINTY_BUFFER:'uncertaintyBuffer',
};

/** Signed contribution of a settled or projected item to the cycle net: costs subtract, pnl/funding add. */
const signedMilli=(kind:CostKind,milli:number)=>SUBTRACTIVE_KINDS.has(kind)?-Math.abs(milli):milli;

export function buildExitEstimate(input:EstimateInput):ExitEstimate{
  const reasons:string[]=[];
  const structural:(condition:boolean,code:string)=>boolean=(condition,code)=>{if(!condition)reasons.push(code);return condition;};
  structural(!!input.scope&&!!input.cycleId,'IDENTITY_MISSING');
  structural(Number.isSafeInteger(input.positionVersion)&&input.positionVersion>0,'POSITION_VERSION_INVALID');
  structural(!!input.costVersion,'COST_VERSION_MISSING');
  structural(Number.isSafeInteger(input.remainingQuantityUnits)&&input.remainingQuantityUnits>0,'REMAINING_QUANTITY_INVALID');
  structural(['LONG','SHORT'].includes(input.side),'SIDE_INVALID');
  structural(Number.isFinite(input.quoteAt)&&Number.isFinite(input.expiresAt)&&input.expiresAt>input.quoteAt,'QUOTE_WINDOW_INVALID');
  structural(Number.isFinite(input.now),'NOW_INVALID');
  const quoteFresh=input.now<=input.expiresAt;
  structural(quoteFresh,'QUOTE_EXPIRED');
  structural(Number.isFinite(input.entryPrice)&&input.entryPrice>0,'ENTRY_PRICE_INVALID');
  structural(Number.isFinite(input.tickSize)&&input.tickSize>0,'TICK_SIZE_INVALID');
  structural(Number.isFinite(input.stepSize)&&input.stepSize>0,'STEP_SIZE_INVALID');
  structural(Number.isFinite(input.minNotional)&&input.minNotional>0,'MIN_NOTIONAL_INVALID');
  const exitPrice=input.side==='LONG'?input.bid:input.ask;
  structural(Number.isFinite(exitPrice)&&exitPrice>0,'EXIT_QUOTE_MISSING');

  const seen=new Set<string>();
  const aggregates:{key:string;milli:number;low:number;high:number;magnitude:number;status:MoneyStatus}[]=[];
  const sourceIds:string[]=[];
  for(const item of input.items){
    if(!item.id||seen.has(item.id)){reasons.push(`DUPLICATE_COST_ITEM:${item.id||'<empty>'}`);continue;}
    seen.add(item.id);
    if(item.scope!==input.scope||item.cycleId!==input.cycleId){reasons.push(`FOREIGN_CYCLE_FACT:${item.id}`);continue;}
    if(!Number.isFinite(input.rateMaxAgeMs)||input.rateMaxAgeMs<=0)reasons.push('RATE_MAX_AGE_INVALID');
    if(item.sourceId)sourceIds.push(item.sourceId);
    const aggregate=aggregates.find(row=>row.key===KIND_AGGREGATE[item.kind]);
    const target=aggregate??{key:KIND_AGGREGATE[item.kind],milli:0,low:0,high:0,magnitude:0,status:'EXACT' as MoneyStatus};
    if(!aggregate)aggregates.push(target);
    if(item.status==='UNKNOWN'||item.status==='CONFLICT'){target.status=item.status;continue;}
    const values=[item.amount,item.low,item.high].filter(value=>value!=null);
    if(values.some(value=>!Number.isFinite(value))||item.amount===undefined&&item.low==null){target.status='CONFLICT';continue;}
    if(item.asset!==input.quoteAsset){
      const fresh=item.rateAt!=null&&Number.isFinite(item.rateAt)&&input.now-item.rateAt<=input.rateMaxAgeMs&&input.now>=item.rateAt;
      if(!(item.rateToQuote!=null&&item.rateToQuote>0)||!fresh){target.status='UNKNOWN';reasons.push(`UNCONVERTED_COST:${item.id}`);continue;}
      if(item.asset==='USDC'&&input.quoteAsset==='USDT')reasons.push(`SEPARATE_STABLE_ASSET:${item.id}`);
    }
    const rate=item.asset===input.quoteAsset?1:item.rateToQuote!;
    const milliOf=(value:number)=>toMilli(value*rate);
    const signed=(kind:CostKind,amountMilli:number)=>signedMilli(kind,amountMilli);
    if(item.status==='CONSERVATIVE_BOUND'){
      if(item.low==null||item.high==null||item.low>item.high){target.status='CONFLICT';continue;}
      target.low+=signed(item.kind,milliOf(item.low));target.high+=signed(item.kind,milliOf(item.high));
      if(SUBTRACTIVE_KINDS.has(item.kind))target.magnitude+=Math.abs(milliOf(item.high));
      if(target.status==='EXACT')target.status='CONSERVATIVE_BOUND';
      continue;
    }
    if(SUBTRACTIVE_KINDS.has(item.kind)&&(item.amount??0)<0){target.status='CONFLICT';reasons.push(`NEGATIVE_COST:${item.id}`);continue;}
    target.milli+=signed(item.kind,milliOf(item.amount??0));
    if(SUBTRACTIVE_KINDS.has(item.kind))target.magnitude+=Math.abs(milliOf(item.amount??0));
  }
  for(const projected of ['projectedExitGross','projectedExitFee','uncertaintyBuffer'] as const){
    // A projection that was never supplied is not zero: an exit must not look cheap because the
    // caller forgot to model the remaining gross, fee or buffer (I05).
    if(!aggregates.some(row=>row.key===projected)){aggregates.push({key:projected,milli:0,low:0,high:0,magnitude:0,status:'UNKNOWN'});reasons.push(`MISSING_PROJECTION:${projected}`);}
  }
  const read=(key:string)=>aggregates.find(row=>row.key===key);
  const statuses=aggregates.map(row=>row?.status??'EXACT');
  const factsStatus:MoneyStatus=statuses.includes('CONFLICT')?'CONFLICT':statuses.includes('UNKNOWN')?'UNKNOWN':statuses.includes('CONSERVATIVE_BOUND')?'CONSERVATIVE_BOUND':'EXACT';
  if(reasons.includes('QUOTE_EXPIRED'))reasons.push('QUOTE_STALE_FOR_AUTHORITY');

  // Sum by status class: an exact row has one value, a bounded row has a worst and best case.
  // The conservative end is what authority may use; an exact point only exists when nothing is
  // bounded, and no value exists at all when a fact is UNKNOWN or CONFLICTING (I05).
  const settled=factsStatus==='EXACT'||factsStatus==='CONSERVATIVE_BOUND';
  const baseMilli=aggregates.reduce((sum,row)=>sum+row.milli,0);
  const lowMilli=aggregates.reduce((sum,row)=>sum+row.milli+(row.status==='CONSERVATIVE_BOUND'?Math.min(row.low,row.high):0),0);
  const highMilli=aggregates.reduce((sum,row)=>sum+row.milli+(row.status==='CONSERVATIVE_BOUND'?Math.max(row.low,row.high):0),0);
  const subtractiveFields=new Set(['incurredFees','projectedExitFee','uncertaintyBuffer']);
  const field=(key:string)=>{const row=read(key);if(!row||!settled||row.status!=='EXACT')return null;return fromMilli(subtractiveFields.has(key)?row.magnitude:row.milli);};
  const estimate:ExitEstimate={
    schemaVersion:'V396-EXIT-1',scope:input.scope,cycleId:input.cycleId,positionVersion:input.positionVersion,costVersion:input.costVersion,
    quoteAt:input.quoteAt,expiresAt:input.expiresAt,quoteFresh,factsStatus,
    remainingQuantityUnits:input.remainingQuantityUnits,side:input.side,
    grossRealizedToDate:field('grossRealizedToDate'),incurredFees:field('incurredFees'),signedFunding:field('signedFunding'),
    projectedExitGross:field('projectedExitGross'),projectedExitFee:field('projectedExitFee'),uncertaintyBuffer:field('uncertaintyBuffer'),
    netIfAllClosed:factsStatus==='EXACT'?fromMilli(baseMilli):null,
    conservativeNet:settled?fromMilli(factsStatus==='EXACT'?baseMilli:lowMilli):null,
    netLow:settled?fromMilli(factsStatus==='EXACT'?baseMilli:lowMilli):null,
    netHigh:settled?fromMilli(factsStatus==='EXACT'?baseMilli:highMilli):null,
    sourceIds:[...new Set(sourceIds)].sort(),reasons:[...new Set(reasons)].sort(),
    orderType:'LIMIT',marketFallbackAllowed:false,estimateHash:'',
  };
  estimate.estimateHash=stableHash({
    scope:estimate.scope,cycleId:estimate.cycleId,positionVersion:estimate.positionVersion,costVersion:estimate.costVersion,
    quoteAt:estimate.quoteAt,expiresAt:estimate.expiresAt,factsStatus:estimate.factsStatus,
    remainingQuantityUnits:estimate.remainingQuantityUnits,side:estimate.side,
    grossRealizedToDate:estimate.grossRealizedToDate,incurredFees:estimate.incurredFees,signedFunding:estimate.signedFunding,
    projectedExitGross:estimate.projectedExitGross,projectedExitFee:estimate.projectedExitFee,uncertaintyBuffer:estimate.uncertaintyBuffer,
    netIfAllClosed:estimate.netIfAllClosed,netLow:estimate.netLow,netHigh:estimate.netHigh,sourceIds:estimate.sourceIds,
  });
  return estimate;
}

/**
 * S03-A step 1: derive the remaining exit gross and fee from the exit-side quote. A slippage
 * band turns the result into a conservative bound instead of pretending the mid is fillable;
 * the mark price is never an input here because it is not a tradable price.
 */
export function deriveProjectedExit(input:{side:'LONG'|'SHORT';entryPrice:number;quantityUnits:number;stepSize:number;price:number;feeRate:number;slippageBps?:number}):{projectedExitGross:number|null;projectedExitFee:number|null;status:MoneyStatus;grossLow:number|null;grossHigh:number|null}{
  const unitQty=input.quantityUnits*input.stepSize;
  const slip=Math.max(0,Number(input.slippageBps??0))/10_000;
  if(!Number.isFinite(unitQty)||!Number.isFinite(input.entryPrice)||!Number.isFinite(input.price)||!Number.isFinite(input.feeRate)||!Number.isFinite(slip)||unitQty<=0||input.entryPrice<=0||input.price<=0||input.feeRate<0)
    return{projectedExitGross:null,projectedExitFee:null,status:'UNKNOWN',grossLow:null,grossHigh:null};
  const raw=(price:number)=>(input.side==='LONG'?price-input.entryPrice:input.entryPrice-price)*unitQty;
  const face=fromMilli(toMilli(raw(input.price)));
  const conservative=fromMilli(toMilli(raw(input.side==='LONG'?input.price*(1-slip):input.price*(1+slip))));
  const fee=fromMilli(toMilli(input.price*unitQty*input.feeRate));
  if(slip===0)return{projectedExitGross:face,projectedExitFee:fee,status:'EXACT',grossLow:null,grossHigh:null};
  return{projectedExitGross:conservative,projectedExitFee:fee,status:'CONSERVATIVE_BOUND',grossLow:Math.min(face,conservative),grossHigh:Math.max(face,conservative)};
}

export type PriceBoundResult={
  executable:boolean;reason:string|null;orderType:'LIMIT';marketFallbackAllowed:false;
  limitPrice:number|null;targetNet:number|null;achievedNet:number|null;worseningAllowed:false;
};

/**
 * S03-C: the worst exit price that still keeps the conservative cycle net at or above the
 * target. LONG rounds the sell floor up to a tick and SHORT rounds the buy ceiling down, so
 * rounding can never widen what the authority would accept; the rounded price is then
 * re-evaluated and rejected if it fails. There is no market fallback in this stage.
 */
export function exitPriceBound(input:{
  side:'LONG'|'SHORT';remainingQuantityUnits:number;stepSize:number;tickSize:number;entryPrice:number;
  exitFeeRate:number;fixedNetMilli:number;targetNet:number;minNotional:number;now:number;maxPrice?:number;
}):PriceBoundResult{
  const reject=(reason:string):PriceBoundResult=>({executable:false,reason,orderType:'LIMIT',marketFallbackAllowed:false,limitPrice:null,targetNet:input.targetNet,achievedNet:null,worseningAllowed:false});
  if(!Number.isFinite(input.targetNet)||!Number.isFinite(input.exitFeeRate)||input.exitFeeRate<0)return reject('BOUND_INPUT_INVALID');
  if(!(input.tickSize>0)||!(input.stepSize>0)||!(input.remainingQuantityUnits>0)||!(input.entryPrice>0))return reject('BOUND_MARKET_INPUT_INVALID');
  if(!Number.isFinite(input.fixedNetMilli))return reject('BOUND_FIXED_NET_INVALID');
  const targetMilli=toMilli(input.targetNet),quantityUnits=input.remainingQuantityUnits*input.stepSize;
  const netAt=(price:number)=>{
    const gross=input.side==='LONG'?(price-input.entryPrice)*quantityUnits:(input.entryPrice-price)*quantityUnits;
    return toMilli(gross)-toMilli(Math.abs(gross)*input.exitFeeRate);
  };
  const achieved=(price:number)=>input.fixedNetMilli+netAt(price);
  const ceiling=input.maxPrice!=null&&Number.isFinite(input.maxPrice)&&input.maxPrice>input.entryPrice?input.maxPrice:input.entryPrice*10;
  const floorTick=input.tickSize;
  const solve=()=>{
    let lo=floorTick,hi=ceiling;
    if(input.side==='LONG'?achieved(hi)<targetMilli:achieved(lo)<targetMilli)return null;
    for(let i=0;i<200;i++){const mid=(lo+hi)/2;if(achieved(mid)>=targetMilli)hi=mid;else lo=mid;if(hi-lo<=input.tickSize/4)break;}
    return hi;
  };
  const raw=input.side==='LONG'?solve():(()=>{
    let lo=floorTick,hi=ceiling;
    if(achieved(lo)<targetMilli)return null;
    for(let i=0;i<200;i++){const mid=(lo+hi)/2;if(achieved(mid)>=targetMilli)lo=mid;else hi=mid;if(hi-lo<=input.tickSize/4)break;}
    return lo;
  })();
  if(raw==null||!Number.isFinite(raw)||raw<=0)return reject('BOUND_UNREACHABLE');
  const ticks=Math.ceil(raw/input.tickSize-1e-9);
  const limitPrice=input.side==='LONG'?ticks*input.tickSize:Math.floor(raw/input.tickSize)*input.tickSize;
  if(!(limitPrice>0)||Math.abs(limitPrice/input.tickSize-Math.round(limitPrice/input.tickSize))>1e-9)return reject('BOUND_TICK_ALIGN_FAILED');
  if(limitPrice*quantityUnits<input.minNotional)return reject('BOUND_NOTIONAL_TOO_SMALL');
  const achievedNet=fromMilli(achieved(limitPrice));
  if(achievedNet+1e-9<input.targetNet)return reject('BOUND_REVERIFY_FAILED');
  return {executable:true,reason:null,orderType:'LIMIT',marketFallbackAllowed:false,limitPrice,targetNet:input.targetNet,achievedNet,worseningAllowed:false};
}
