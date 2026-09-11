import type { MarketSymbolSnapshot } from '@zdj/contracts';
import type { AccountState } from '../state/runtimeState.js';

const age = (now:number, ts:unknown) => Number.isFinite(Number(ts)) ? Math.max(0, now - Number(ts)) : null;
const domain = (name:string, status:string, required:boolean, ageMs:number|null, weight:number, reasons:string[]=[]) => ({name,status,required,ageMs,weight,reasons});

export function evaluateObservation(snapshot:MarketSymbolSnapshot, account:AccountState, now=Date.now(), limits:any={}):any {
  const x:any=snapshot, q=x.quote, b=x.orderBook, k=x.technical?.['1m'];
  const qa=age(now,q?.ts), ba=age(now,b?.ts), ka=age(now,k?.asOf), aa=age(now,account.asOf);
  const qr:string[]=[], br:string[]=[], kr:string[]=[], ar:string[]=[];
  if(!q || ![q.bid,q.ask,q.mark,q.last].every(Number.isFinite) || q.bid<=0 || q.ask<=0 || q.bid>q.ask) qr.push('QUOTE_INVALID');
  if(qa===null || qa>(limits.quoteTtlMs??20_000)) qr.push('QUOTE_STALE');
  if(!b || b.bids.length<2 || b.asks.length<2) br.push('BOOK_DEPTH_INSUFFICIENT');
  if(ba===null || ba>(limits.bookTtlMs??20_000)) br.push('BOOK_STALE');
  if(!k || !Number.isFinite(k.lastPrice) || k.sampleSize<=0) kr.push('KLINE_INVALID');
  if(ka===null || ka>(limits.klineTtlMs??125_000)) kr.push('KLINE_STALE');
  if(account.status!=='READY' || aa===null) ar.push('ACCOUNT_UNAVAILABLE');
  if(aa===null || aa>(limits.accountTtlMs??45_000)) ar.push('ACCOUNT_STALE');
  const suspicious=Number.isFinite(q?.mark)&&Number.isFinite(q?.last)&&q.mark>0&&Math.abs(q.mark-q.last)/q.mark>.03;
  if(suspicious) qr.push('PRICE_DIVERGENCE_SUSPICIOUS');
  const domains:any={
    PRICE_CORE:domain('PRICE_CORE',qr.filter(v=>v!=='PRICE_DIVERGENCE_SUSPICIOUS').length?'INVALID':suspicious?'SUSPICIOUS':'FRESH',true,qa,.30,qr),
    KLINE_CORE:domain('KLINE_CORE',kr.length?'INVALID':'FRESH',true,ka,.25,kr),
    ORDER_BOOK:domain('ORDER_BOOK',br.length?'INVALID':'FRESH',true,ba,.20,br),
    ACCOUNT_CORE:domain('ACCOUNT_CORE',ar.length?'STALE':'FRESH',true,aa,.15,ar),
    DERIVATIVES:domain('DERIVATIVES','UNAVAILABLE_BY_EXCHANGE',false,age(now,x.derivatives?.ts),.04,['OPTIONAL_DERIVATIVES_MISSING']),
    GLOBAL_REGIME:domain('GLOBAL_REGIME','OPTIONAL',false,null,.03,['CONTEXT_ONLY']),
    PORTFOLIO:domain('PORTFOLIO',account.status==='READY'?'FRESH':'OPTIONAL',false,aa,.02,[]),
    EXPERIENCE:domain('EXPERIENCE','OPTIONAL',false,null,.01,['CONTEXT_ONLY']),
  };
  const invalidReasons=[...new Set(Object.values(domains).filter((v:any)=>v.required&&v.status!=='FRESH'&&v.status!=='SUSPICIOUS').flatMap((v:any)=>v.reasons))];
  const total=Object.values(domains).reduce((n:number,v:any)=>n+Number(v.weight),0);
  const covered=Object.values(domains).filter((v:any)=>v.status==='FRESH'||v.status==='SUSPICIOUS'||(!v.required&&v.status==='UNAVAILABLE_BY_EXCHANGE')).reduce((n:number,v:any)=>n+Number(v.weight),0);
  return {status:invalidReasons.length?'INVALID':'VALID',checkedAt:now,invalidReasons,domains,weightedCompleteness:Number(covered)/Number(total),suspicious,optionalMissing:Object.values(domains).filter((v:any)=>!v.required&&v.status==='UNAVAILABLE_BY_EXCHANGE').map((v:any)=>v.name)};
}



