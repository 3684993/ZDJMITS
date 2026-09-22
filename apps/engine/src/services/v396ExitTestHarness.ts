import { vi } from 'vitest';
import type { AdapterCapabilities } from './s04ExitCoordinator.js';
import { V396ExitRuntime } from './v396ExitRuntime.js';

/**
 * Test-only construction helpers for the C3 exit coordination seam. They use an in-memory journal
 * so no test touches a live data directory, and they only ever fake read-only exchange proofs.
 */
export const ONE_WAY_CAPABILITIES:AdapterCapabilities={
  oneWayReduceOnly:true,hedgePositionSide:false,cancelReplaceAtomic:false,partialFillExpected:true,
  supportsTimeInForce:['GTC','GTX'],positionMode:'ONE_WAY',
};

export function exitRuntimeHarness(identity={environment:'TESTNET',account:'binance-primary'},capabilities:AdapterCapabilities=ONE_WAY_CAPABILITIES){
  return new V396ExitRuntime(':memory:',()=>identity,async()=>capabilities);
}

/** The three read-only capabilities a coordinated exit demands from the adapter. */
export function coordinatedExchange(over:{liveQuantity?:number;mode?:'ONE_WAY'|'HEDGE';absent?:boolean}={}){
  const liveQuantity=Number(over.liveQuantity??1_000);
  return {
    exitCoordinationCapabilities:vi.fn(async()=>over.mode==='HEDGE'?{...ONE_WAY_CAPABILITIES,oneWayReduceOnly:false,hedgePositionSide:true,positionMode:'HEDGE' as const}:ONE_WAY_CAPABILITIES),
    proveReduction:vi.fn(async(input:{symbol:string;positionSide:'LONG'|'SHORT';quantity:number})=>({kind:over.mode==='HEDGE'?'HEDGE_POSITION_SIDE' as const:'ONE_WAY_REDUCE_ONLY' as const,checkedAt:Date.now(),positionSide:input.positionSide,liveQuantity})),
    findExitByClientOrderId:vi.fn(async()=>over.absent===false?{state:'ABSENT' as const,reason:'-2013 Order does not exist!'}:{state:'ABSENT' as const,reason:'-2013 Order does not exist!'}),
  };
}

export function manualJournalHarness(){const claims:{scope:string;value:any}[]=[];return{claims,claim:(scope:string,value:any)=>{claims.push({scope,value});return value;},save:vi.fn()};}
