/**
 * P6: the quote-asset conversion contract.
 *
 * A position in a USDC contract settles in USDC. The V3.9.6 AI-exit path passed `quoteAsset:'USDT'`
 * for every position and `fx:null` (R7), so a USDC fee or funding amount entered a USDT ledger with no
 * conversion stated either way. This module makes that explicit: a value is either in the base unit,
 * or it carries a timestamped rate, or it is UNKNOWN. `fx:null` is never read as "one".
 */

export type BaseUnit='USDT';

export type QuoteConversion={
  fromAsset:string;
  toAsset:BaseUnit;
  /** The rate applied. Null only when the conversion could not be proven. */
  rate:number|null;
  rateAt:number|null;
  source:string|null;
  status:'PROVEN'|'IDENTITY_UNPROVEN'|'RATE_STALE'|'RATE_ABSENT'|'NOT_APPLICABLE';
  ageMs:number|null;
};

/** Assets that settle one-for-one against the base unit; anything else needs a rate. */
const BASE_ALIASES=new Set(['USDT']);
const COLLATERAL_EQUIVALENT=new Set(['USDT']);

/**
 * @param rateProvider returns the observed rate at a time, or null. It is injected so the conversion
 * rule can be tested without a market feed and so no caller can pass `null` and get a silent 1.
 */
export function convertToBaseUnit(input:{amount:number|null;fromAsset:unknown;now:number;maxAgeMs:number;
  rateProvider?:null|((asset:string,at:number)=>{rate:number;observedAt:number;source:string}|null)}):QuoteConversion&{amountBase:number|null}{
  const from=String(input.fromAsset??'').trim().toUpperCase();
  if(!from)return{fromAsset:'UNKNOWN',toAsset:'USDT',rate:null,rateAt:null,source:null,status:'IDENTITY_UNPROVEN',ageMs:null,amountBase:null};
  if(input.amount==null||!Number.isFinite(Number(input.amount)))
    return{fromAsset:from,toAsset:'USDT',rate:null,rateAt:null,source:null,status:'RATE_ABSENT',ageMs:null,amountBase:null};
  if(COLLATERAL_EQUIVALENT.has(from))
    return{fromAsset:from,toAsset:'USDT',rate:1,rateAt:input.now,source:'BASE_UNIT_IDENTITY',status:'NOT_APPLICABLE',ageMs:0,amountBase:Number(input.amount)};
  const observed=input.rateProvider?.(from,input.now)??null;
  if(!observed||!Number.isFinite(Number(observed.rate))||Number(observed.rate)<=0)
    return{fromAsset:from,toAsset:'USDT',rate:null,rateAt:null,source:null,status:'RATE_ABSENT',ageMs:null,amountBase:null};
  const age=input.now-Number(observed.observedAt);
  if(!(age>=0&&age<=Math.max(1_000,input.maxAgeMs)))
    return{fromAsset:from,toAsset:'USDT',rate:Number(observed.rate),rateAt:Number(observed.observedAt),source:observed.source??null,status:'RATE_STALE',ageMs:Math.max(0,age),amountBase:null};
  return{fromAsset:from,toAsset:'USDT',rate:Number(observed.rate),rateAt:Number(observed.observedAt),source:observed.source??null,status:'PROVEN',ageMs:Math.max(0,age),
    amountBase:Number(input.amount)*Number(observed.rate)};
}

/** The asset a position's contract actually settles in, taken from its symbol suffix. */
export function quoteAssetOfSymbol(symbol:unknown){
  const upper=String(symbol??'').trim().toUpperCase();
  for(const asset of ['USDT','USDC','BUSD'])if(upper.endsWith(asset))return asset;
  return 'UNKNOWN';
}

export function isBaseUnit(asset:unknown){return BASE_ALIASES.has(String(asset??'').trim().toUpperCase());}
