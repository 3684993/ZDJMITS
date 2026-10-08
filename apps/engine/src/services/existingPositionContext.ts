import type {EntryIntelligencePacket} from '@zdj/contracts';
import type {RuntimeState} from '../state/runtimeState.js';
import {privateAccountFresh} from './privateAccountReadiness.js';

/** Scope fixed by the runtime account; never imports a different symbol, quote asset, side or cycle. */
type PositionContext=NonNullable<EntryIntelligencePacket['existingPositionContext']>;
export function existingPositionContext(state:RuntimeState,symbol:string,asOf:number):PositionContext{
  const all=[...state.positions.values()].filter(p=>p.symbol===symbol&&p.quantity!==0);
  const fresh=privateAccountFresh(state.account,asOf),overflow=all.length>8;
  const positions=all.slice(0,8).map<PositionContext['positions'][number]>(p=>{
    const validQuantity=Number.isFinite(p.quantity)&&p.quantity>0;
    const lifecycle=state.lifecycles.get(`${symbol}:${p.side}`);
    const cycleMatches=Boolean(p.cycleId)&&lifecycle?.cycleId===p.cycleId&&lifecycle.status!=='CLOSED'&&Number.isFinite(lifecycle.currentQty)&&Math.abs(lifecycle.currentQty-p.quantity)<Math.max(1e-8,p.quantity*1e-8);
    const fills=state.executionFills.filter(f=>f.symbol===symbol&&f.cycleId===p.cycleId&&f.direction===p.side&&f.positionSide===p.side&&f.side===(p.side==='LONG'?'BUY':'SELL')&&Number.isFinite(f.qty)&&f.qty>0&&Number.isSafeInteger(f.executionTime)&&f.executionTime>0&&f.executionTime<=asOf);
    const first=fills.length?Math.min(...fills.map(f=>f.executionTime)):null;
    const matched=fresh&&!overflow&&validQuantity&&cycleMatches&&first!==null&&first===p.openedAt&&lifecycle.openedAt===p.openedAt&&['SYSTEM_FILL','BINANCE_TRADE_HISTORY','SQLITE_EXECUTION_HISTORY'].includes(p.entryTimeSource);
    return {symbol,quoteAsset:symbol.endsWith('USDC')?'USDC':symbol.endsWith('USDT')?'USDT':'UNKNOWN',side:p.side,cycleId:p.cycleId??null,quantity:validQuantity?p.quantity:null,managementStatus:p.managementStatus??'UNKNOWN',
      recordedOpenedAt:Number.isSafeInteger(p.openedAt)&&p.openedAt>0&&p.openedAt<=asOf?p.openedAt:null,entryTimeSource:p.entryTimeSource??'UNKNOWN',
      firstFillAt:matched?first:null,holdingAgeMs:matched?asOf-first!:null,
      timeEvidence:matched?'PARTIAL_RETAINED_ENTRY_MATCHES_CYCLE_OPEN':'UNKNOWN',inventoryEvidence:fresh&&validQuantity&&!overflow?'CURRENT_PRIVATE_ACCOUNT_CONTEXT':'STALE_OR_UNPROVEN',
      reasons:matched?['RETAINED_FILL_NOT_COMPLETE_HISTORICAL_COVERAGE']:['CYCLE_OR_ORIGIN_FILL_OR_FRESHNESS_UNPROVEN']};
  });
  return {version:'V398_POSITION_CONTEXT_1',asOf,privateAccountAsOf:Number.isSafeInteger(state.account.asOf)?state.account.asOf:null,environment:state.settings.connections.exchange.environment,source:'PRIVATE_POSITION_AND_RETAINED_CYCLE_FILL',coverage:overflow?'BOUND_REACHED_UNKNOWN':fresh?'CURRENT_SNAPSHOT':'STALE_OR_UNPROVEN',positions,
    notice:'No independent same-side adds. Opposite inventory alone cannot veto. Primary sole Entry authority.'};
}
