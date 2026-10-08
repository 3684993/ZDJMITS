import type {RuntimeState} from '../state/runtimeState.js';
import {entryOrderOccupiesRisk} from './entryRiskOccupancy.js';

export const NO_ADD_POLICY='NO_SEPARATE_ADD_V398' as const;
export function noAddEnabled(settings:any){return settings?.connections?.exchange?.environment==='TESTNET'&&settings?.connections?.executionMode==='TESTNET_ENABLED';}
export type OriginAuthorization={intentId:string;clientOrderId:string;quantity:number;createdAt:number};
/** A physical authorization boundary, declared before Primary, never a quality/risk opinion. */
export function noSeparateAddBlock(state:RuntimeState,symbol:string,side:'LONG'|'SHORT',intentId?:string,now=Date.now(),requestedQuantity?:number):string|null{
 if(!noAddEnabled(state.settings))return null;
 let origin:OriginAuthorization|null=null;
 try{origin=(state as any).noAddOriginReader?.(symbol,side)??null;}catch{return'NO_ADD_DURABLE_AUTHORITY_UNAVAILABLE';}
 if(origin&&(!origin.intentId||!origin.clientOrderId||!Number.isFinite(origin.quantity)||origin.quantity<=0||!Number.isSafeInteger(origin.createdAt)||origin.createdAt<=0))return'NO_ADD_ORIGIN_FACT_UNPROVEN';
 const ownsOrigin=Boolean(intentId&&origin?.intentId===intentId);
 if(origin&&!ownsOrigin)return'NO_SEPARATE_ADD_ORIGIN_AUTHORIZATION_EXISTS';
 if(ownsOrigin&&requestedQuantity!==undefined&&(!Number.isFinite(requestedQuantity)||Math.abs(requestedQuantity-origin!.quantity)>1e-10))return'NO_ADD_ORIGIN_IDENTITY_OR_QUANTITY_CONFLICT';
 const sameSide=[...state.positions.values()].filter(p=>p.symbol===symbol&&p.side===side);
 if(sameSide.some(p=>!Number.isFinite(p.quantity)||p.quantity<0))return'NO_ADD_POSITION_QUANTITY_UNPROVEN';
 const positions=sameSide.filter(p=>p.quantity>0);
 if(positions.length&&!ownsOrigin)return'NO_SEPARATE_ADD_POSITION_EXISTS';
 if(ownsOrigin&&positions.some(p=>p.managementStatus==='HUMAN_MANAGED'||p.humanManagedAt))return'NO_ADD_ORIGIN_HUMAN_HANDOFF';
 if(ownsOrigin&&positions.reduce((n,p)=>n+p.quantity,0)>origin!.quantity+Math.max(1e-10,origin!.quantity*1e-9))return'NO_ADD_ORIGIN_QUANTITY_EXCEEDED';
 const lifecycle=state.lifecycles.get(`${symbol}:${side}`);
 if(lifecycle&&(!Number.isFinite(lifecycle.currentQty)||lifecycle.currentQty<0))return'NO_ADD_CYCLE_QUANTITY_UNPROVEN';
 if(lifecycle&&Number(lifecycle.currentQty)>0&&!ownsOrigin)return'NO_SEPARATE_ADD_CYCLE_EXISTS';
 if([...state.entryOrders.values()].some(o=>o.symbol===symbol&&o.side===side&&o.intentId!==intentId&&entryOrderOccupiesRisk(o,now)))return'NO_SEPARATE_ADD_PENDING_ORDER';
 if([...state.entryIntents.values()].some(i=>i.symbol===symbol&&i.side===side&&i.id!==intentId&&i.absoluteExpiresAt>now&&
   ![...state.entryOrders.values()].some(o=>o.intentId===i.id)))return'NO_SEPARATE_ADD_PENDING_AUTHORIZATION';
 return null;
}
