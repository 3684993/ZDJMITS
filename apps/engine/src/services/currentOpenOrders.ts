import type {EntryOrder} from '@zdj/contracts';
import type {RuntimeState} from '../state/runtimeState.js';

export const EXCHANGE_OPEN_ORDER_STATUSES=new Set(['NEW','WORKING','PARTIALLY_FILLED']);
export const ORDER_TERMINAL_STATUSES=new Set(['FILLED','CANCELED','EXPIRED','REJECTED']);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

/** A symbol and a non-empty remote identity must agree. Conflicting second identities fail closed. */
export function exchangeOrderIdentityMatch(a:any,b:any):boolean {
  if(!text(a?.symbol)||a.symbol!==b?.symbol)return false;
  if(text(a.clientOrderId)&&text(b.clientOrderId)&&a.clientOrderId!==b.clientOrderId)return false;
  if(text(a.exchangeOrderId)&&text(b.exchangeOrderId)&&a.exchangeOrderId!==b.exchangeOrderId)return false;
  return Boolean((text(a.clientOrderId)&&a.clientOrderId===b.clientOrderId)||(text(a.exchangeOrderId)&&a.exchangeOrderId===b.exchangeOrderId));
}

export type OpenOrderReadback<T=EntryOrder>={status:'READY'|'STALE'|'UNAVAILABLE';verifiedAt:number|null;validUntil:number|null;items:T[]};

/** Read-only projection of a complete exchange snapshot. Local UNKNOWN is never proof of activity. */
export function projectCurrentOpenOrders(state:RuntimeState,rows:any[],verifiedAt:number,ttlMs:number,now=Date.now(),lastError:string|null=null) {
  const metadata={status:(!verifiedAt?'UNAVAILABLE':lastError||now<verifiedAt||now>verifiedAt+ttlMs?'STALE':'READY') as OpenOrderReadback['status'],
    verifiedAt:verifiedAt||null,validUntil:verifiedAt?verifiedAt+ttlMs:null};
  const entry:Array<EntryOrder&{economicMandate?:unknown;leverageVerified?:boolean}>=[],manual:any[]=[];
  if(!verifiedAt)return {entry:{...metadata,items:entry},manual:{...metadata,items:manual}};
  const seen=new Set<string>();
  for(const remote of rows){
    if(!EXCHANGE_OPEN_ORDER_STATUSES.has(String(remote.status)))continue;
    if(!text(remote.symbol)||(!text(remote.clientOrderId)&&!text(remote.exchangeOrderId)))continue;
    const identity=`${remote.symbol}:${remote.exchangeOrderId||remote.clientOrderId}`;
    if(seen.has(identity))continue;seen.add(identity);
    const entries=[...state.entryOrders.values()].filter(row=>exchangeOrderIdentityMatch(row,remote));
    const manuals=[...state.manualOrders.values()].filter(row=>exchangeOrderIdentityMatch(row,remote));
    const tps=[...state.tpOrders.values()].filter(row=>exchangeOrderIdentityMatch(row,remote));
    const proof=state.orderProvenance?.resolve?.({symbol:remote.symbol,clientOrderId:remote.clientOrderId,exchangeOrderId:remote.exchangeOrderId});
    if(proof?.proof?.some((item:string)=>item.startsWith('PROVENANCE_ROLE_CONFLICT')))continue;
    const roles=new Set<string>((proof?.rows??[]).map((row:any)=>String(row.role)));
    // TP/AI exit facts are protected exit orders even when the legacy adapter mapped v396x as Entry.
    if(tps.length||roles.has('TP')||roles.has('EXIT')||remote.side==='BUY'||remote.side==='SELL')continue;
    if(entries.length>1||manuals.length>1||(entries.length&&manuals.length)||roles.size>1)continue;
    const local=manuals[0]??entries[0];
    // A later local terminal fact wins over this older open-order snapshot, especially FILLED.
    if(local&&ORDER_TERMINAL_STATUSES.has(String(local.status))&&
      (local.status==='FILLED'||Number(local.updatedAt??0)>=Number(remote.verifiedAt??verifiedAt)))continue;
    if(manuals.length){
      manual.push({...manuals[0],exchangeOrderId:remote.exchangeOrderId,clientOrderId:remote.clientOrderId,
        quantity:remote.quantity,price:remote.price,filledQuantity:remote.filledQuantity,status:remote.status,
        factSource:remote.factSource,verifiedAt:remote.verifiedAt??verifiedAt});
    }else if(!roles.has('MANUAL')){
      const local=entries[0],mandate=local?state.entryIntents.get(local.intentId)?.economicMandate??null:null;
      entry.push(local?{...local,exchangeOrderId:remote.exchangeOrderId,clientOrderId:remote.clientOrderId,
        quantity:remote.quantity,price:remote.price,filledQuantity:remote.filledQuantity,status:remote.status,
        updatedAt:remote.updatedAt,factSource:remote.factSource,verifiedAt:remote.verifiedAt??verifiedAt,
        economicMandate:mandate,leverageVerified:Number.isFinite(local.leverage)&&local.leverage>0}:{...remote,leverageVerified:false});
    }
  }
  return{entry:{...metadata,items:entry},manual:{...metadata,items:manual}};
}
