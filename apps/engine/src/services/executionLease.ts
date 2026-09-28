import {reservationDebitsAvailableFunds} from './entryFundingCommitment.js';
import type { RuntimeState } from '../state/runtimeState.js';

export interface ExecutionLease {
  id:string;
  symbol:string;
  quoteAsset:string;
  reservedMarginUsd:number;
  createdAt:number;
  expiresAt:number;
}
const stores=new WeakMap<RuntimeState,Map<string,ExecutionLease>>();
const store=(state:RuntimeState)=>{let value=stores.get(state);if(!value){value=new Map();stores.set(state,value);}return value;};
const prune=(state:RuntimeState,now=Date.now())=>{const value=store(state);for(const [id,lease] of value)if(now>=lease.expiresAt)value.delete(id);return value;};

export function activeExecutionLeaseMargin(state:RuntimeState,quoteAsset:string,now=Date.now(),excludeId?:string){return [...prune(state,now).values()].filter(row=>row.id!==excludeId&&row.quoteAsset===quoteAsset).reduce((sum,row)=>sum+Math.max(0,row.reservedMarginUsd),0);}
export function acquireExecutionLease(state:RuntimeState,input:{symbol:string;quoteAsset:string;reservedMarginUsd:number;ttlMs:number},now=Date.now()):{ok:true;lease:ExecutionLease}|{ok:false;reason:string}{
  const requested=Math.max(0,Number(input.reservedMarginUsd));if(!Number.isFinite(requested)||requested<=0)return{ok:false,reason:'EXECUTION_LEASE_NO_CAPACITY'};
  const available=Number(state.account.assets.find((asset:any)=>asset.asset===input.quoteAsset)?.availableBalance??0),active=activeExecutionLeaseMargin(state,input.quoteAsset,now),reservations=[...state.entryReservations.values()].filter((row:any)=>reservationDebitsAvailableFunds(state,row,now)&&row.quoteAsset===input.quoteAsset).reduce((sum:number,row:any)=>sum+Math.max(0,Number(row.marginUsd??0)),0);
  if(available-reservations-active+1e-8<requested)return{ok:false,reason:'EXECUTION_LEASE_MARGIN_CHANGED'};
  const id=`execlease_${input.symbol}_${now}_${Math.random().toString(36).slice(2,9)}`,lease:ExecutionLease={id,symbol:input.symbol,quoteAsset:input.quoteAsset,reservedMarginUsd:requested,createdAt:now,expiresAt:now+Math.max(1_000,input.ttlMs)};store(state).set(id,lease);return{ok:true,lease};
}
export function validateExecutionLease(state:RuntimeState,id:string|undefined,symbol:string,now=Date.now()){if(!id)return{ok:false as const,reason:'EXECUTION_LEASE_MISSING'};const lease=prune(state,now).get(id);if(!lease)return{ok:false as const,reason:'EXECUTION_LEASE_EXPIRED'};if(lease.symbol!==symbol)return{ok:false as const,reason:'EXECUTION_LEASE_SYMBOL_MISMATCH'};return{ok:true as const,lease};}
export function releaseExecutionLease(state:RuntimeState,id:string|undefined){if(id)store(state).delete(id);}
